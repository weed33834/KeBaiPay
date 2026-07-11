"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('开始 seed...');
    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@2026';
    const adminCount = await prisma.adminUser.count();
    if (adminCount === 0) {
        await prisma.adminUser.create({
            data: {
                username: 'admin',
                password: await bcrypt.hash(adminPassword, 10),
                role: 'SUPER_ADMIN',
            },
        });
        console.log(`  管理员账户已创建: admin / 密码来自 ADMIN_DEFAULT_PASSWORD`);
    }
    const testPhone = '13900001111';
    const existingUser = await prisma.user.findUnique({ where: { phone: testPhone } });
    if (!existingUser) {
        const user = await prisma.user.create({
            data: {
                nickname: '测试用户',
                phone: testPhone,
                email: 'test@kebaipay.com',
                loginPassword: await bcrypt.hash('Abc12345', 10),
                payPassword: await bcrypt.hash('Abc12345', 10),
                status: client_1.UserStatus.ACTIVE,
                realNameStatus: client_1.RealNameStatus.VERIFIED,
            },
        });
        await prisma.account.create({
            data: {
                userId: user.id,
                availableBalance: 1000000,
                frozenBalance: 0,
                totalBalance: 1000000,
                status: 'ACTIVE',
            },
        });
        await prisma.identityVerification.create({
            data: {
                userId: user.id,
                realName: '测试用户',
                idCard: '110101199001011234',
                status: 'VERIFIED',
            },
        });
        console.log(`  测试用户已创建: ${testPhone} / Abc12345 (余额 10000 元)`);
    }
    console.log('seed 完成');
}
main()
    .catch((e) => {
    console.error('seed 失败:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map