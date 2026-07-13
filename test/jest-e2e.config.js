/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/**/*.e2e-spec.ts'],
  // 在所有测试启动前预设完整 mock env，让需要导入 AppModule 的 e2e 测试能通过 validateEnv
  setupFiles: ['<rootDir>/setup-env.ts'],
  moduleNameMapper: {
    '^@prisma/client$': '<rootDir>/../node_modules/@prisma/client',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        target: 'ES2021',
        esModuleInterop: true,
        skipLibCheck: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        types: ['node', 'jest'],
      },
    }],
  },
  clearMocks: true,
}
