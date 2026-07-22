import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcrypt'
import { createCipheriv, randomBytes, scryptSync, createHash } from 'crypto'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL 未配置，无法运行 seed')
  process.exit(1)
}

const adapter = new PrismaPg(databaseUrl)
const prisma = new PrismaClient({ adapter })

/**
 * 复用 CryptoService 的加密逻辑：AES-256-GCM，base64(iv:ciphertext:authTag)。
 * seed 脱离 NestJS DI 容器独立运行，因此这里手动复刻一套同样的加密实现，
 * 保证 seed 写入的 idCard 与 verifyIdentity 写入的格式一致（可被 decrypt 解开）。
 */
const SALT = 'kebaipay-salt-v1'
const IV_LENGTH = 12

function getEncryptionKey(): Buffer {
  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error(
      'ENCRYPTION_KEY 未配置或长度不足 32 字符，拒绝 seed。请在 .env 中设置 32 字符以上的随机字符串。',
    )
  }
  return scryptSync(encryptionKey, SALT, 32)
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64')
}

/** 计算明文 SHA-256 哈希，用于 idCardHash 唯一约束 */
function sha256Hex(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

/** 判断 idCard 是否已是加密格式：加密后 base64 长度至少 40+，明文身份证 18 位 */
function isEncrypted(idCard: string): boolean {
  if (!idCard) return false
  // 明文身份证长度固定 15 或 18 位；加密后 base64 长度必然 > 40
  return idCard.length > 40
}

async function main() {
  console.log('开始 seed...')

  const encryptionKey = getEncryptionKey()

  // 1. 管理员账户（如果不存在）
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@2026'
  const adminCount = await prisma.adminUser.count()
  if (adminCount === 0) {
    await prisma.adminUser.create({
      data: {
        username: 'admin',
        password: await bcrypt.hash(adminPassword, 10),
        role: 'SUPER_ADMIN',
      },
    })
    console.log(`  管理员账户已创建: admin / 密码来自 ADMIN_DEFAULT_PASSWORD`)
  }

  // 2. 测试用户（upsert 确保密码正确）
  const testPhone = '139******11'
  const testIdCardPlain = '110101199001011234'
  const existingUser = await prisma.user.findUnique({ where: { phone: testPhone } })
  if (!existingUser) {
    const user = await prisma.user.create({
      data: {
        nickname: '测试用户',
        phone: testPhone,
        email: 't***@************',
        loginPassword: await bcrypt.hash('Abc12345', 10),
        payPassword: await bcrypt.hash('123456', 10),
        status: 'ACTIVE',
        realNameStatus: 'VERIFIED',
      },
    })

    // 3. 给测试用户建账户（余额 10000 元 = 1000000 分）
    await prisma.account.create({
      data: {
        userId: user.id,
        availableBalance: 1000000,
        frozenBalance: 0,
        totalBalance: 1000000,
        status: 'ACTIVE',
      },
    })

    // 4. 测试用户实名认证（idCard 必须加密入库 + 写入 idCardHash，
    //    否则 resetPayPassword 调用 crypto.decrypt 会抛错；唯一约束也会被绕过）
    await prisma.identityVerification.create({
      data: {
        userId: user.id,
        realName: '测试用户',
        idCard: encrypt(testIdCardPlain, encryptionKey),
        idCardHash: sha256Hex(testIdCardPlain),
        status: 'VERIFIED',
      },
    })

    console.log(`  测试用户已创建: ${testPhone} / Abc12345 (余额 10000 元)`)
  } else {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        loginPassword: await bcrypt.hash('Abc12345', 10),
        payPassword: await bcrypt.hash('123456', 10),
      },
    })
    const account = await prisma.account.findUnique({ where: { userId: existingUser.id } })
    if (!account) {
      await prisma.account.create({
        data: { userId: existingUser.id, availableBalance: 1000000, frozenBalance: 0, totalBalance: 1000000, status: 'ACTIVE' },
      })
    }

    // 修复历史数据：旧版 seed 把 idCard 以明文写入，导致 resetPayPassword 调用
    // crypto.decrypt 时崩溃，且 idCardHash 为 NULL 绕过唯一约束。这里幂等地修复。
    const identity = await prisma.identityVerification.findUnique({
      where: { userId: existingUser.id },
    })
    if (identity && !isEncrypted(identity.idCard)) {
      await prisma.identityVerification.update({
        where: { userId: existingUser.id },
        data: {
          idCard: encrypt(testIdCardPlain, encryptionKey),
          idCardHash: sha256Hex(testIdCardPlain),
        },
      })
      console.log(`  测试用户历史 idCard 已修复为加密格式`)
    }

    console.log(`  测试用户密码已重置: ${testPhone} / Abc12345`)
  }

  console.log('seed 完成')
}

main()
  .catch((e) => {
    console.error('seed 失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
