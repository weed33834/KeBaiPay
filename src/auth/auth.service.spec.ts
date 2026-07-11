import { Test } from '@nestjs/testing'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { AuthService } from './auth.service'
import { UsersService } from '../users/users.service'
import { PrismaService } from '../prisma/prisma.service'

type UsersServiceMock = Record<'create' | 'findByCredential', jest.Mock>
type JwtServiceMock = Record<'sign', jest.Mock>
type PrismaMock = {
  user: Record<string, jest.Mock>
  loginLog: Record<string, jest.Mock>
}

describe('AuthService', () => {
  let service: AuthService
  let usersService: UsersServiceMock
  let jwtService: JwtServiceMock
  let prisma: PrismaMock

  beforeEach(async () => {
    usersService = {
      create: jest.fn(),
      findByCredential: jest.fn(),
    }

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-token'),
    }

    prisma = {
      user: { findUnique: jest.fn() },
      loginLog: { create: jest.fn().mockResolvedValue(undefined) },
    }

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get(AuthService)
  })

  describe('register 参数校验', () => {
    it('无手机号和邮箱时报 BadRequestException', async () => {
      await expect(
        service.register({ nickname: '张三', password: '123456' }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  describe('register 正常流程', () => {
    it('创建用户并返回 token', async () => {
      usersService.create.mockResolvedValue({ id: 'u1', nickname: '张三' })

      const result = await service.register({
        nickname: '张三',
        phone: '13800138000',
        password: '123456',
      })

      expect(result).toEqual({ userId: 'u1', token: 'mock-token' })
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          nickname: '张三',
          phone: '13800138000',
        }),
      )
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'u1', typ: 'user' })
    })
  })

  describe('login 参数校验', () => {
    it('无手机号和邮箱时报 BadRequestException', async () => {
      await expect(service.login({ password: '123456' })).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('login 账号校验', () => {
    it('用户不存在时报 UnauthorizedException', async () => {
      usersService.findByCredential.mockResolvedValue(null)

      await expect(
        service.login({ phone: '13800138000', password: '123456' }),
      ).rejects.toThrow(UnauthorizedException)
    })
  })

  describe('login 密码校验', () => {
    it('密码错误时报 UnauthorizedException', async () => {
      const hash = await bcrypt.hash('123456', 10)
      usersService.findByCredential.mockResolvedValue({
        id: 'u1',
        loginPassword: hash,
      })

      await expect(
        service.login({ phone: '13800138000', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException)
    })
  })

  describe('login 正常流程', () => {
    it('验证通过并返回 token', async () => {
      const hash = await bcrypt.hash('123456', 10)
      usersService.findByCredential.mockResolvedValue({
        id: 'u1',
        loginPassword: hash,
      })

      const result = await service.login({
        phone: '13800138000',
        password: '123456',
      })

      expect(result).toEqual({ userId: 'u1', token: 'mock-token' })
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'u1', typ: 'user' })
    })
  })
})
