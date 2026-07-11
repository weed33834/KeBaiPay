import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcrypt'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL 未配置，无法运行 seed')
  process.exit(1)
}

const adapter = new PrismaPg(databaseUrl)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('开始 seed...')

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

    // 4. 测试用户实名认证
    await prisma.identityVerification.create({
      data: {
        userId: user.id,
        realName: '测试用户',
        idCard: '110101199001011234',
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
