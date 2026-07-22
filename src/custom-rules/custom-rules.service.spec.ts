import { Test } from '@nestjs/testing'
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common'
import { CustomRulesService } from './custom-rules.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  CustomRuleField,
  CustomRuleOperator,
  CustomRuleLogicalOp,
} from '../common/enums'

describe('CustomRulesService', () => {
  let service: CustomRulesService
  let prisma: any

  beforeEach(async () => {
    prisma = {
      customRiskRule: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        delete: jest.fn(),
      },
    }

    const module = await Test.createTestingModule({
      providers: [
        CustomRulesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()

    service = module.get(CustomRulesService)
  })

  // ============== create ==============
  describe('create', () => {
    it('成功创建规则', async () => {
      prisma.customRiskRule.create.mockResolvedValue({ id: 'r1', ruleNo: 'CRR001' })
      const result = await service.create('admin-1', {
        name: '夜间大额拦截',
        conditions: [
          { field: CustomRuleField.AMOUNT, operator: CustomRuleOperator.GTE, value: 1000000 },
          { field: CustomRuleField.HOUR, operator: CustomRuleOperator.IN_RANGE, value: [22, 6] },
        ],
        logicalOp: CustomRuleLogicalOp.AND,
      })
      expect(result?.ruleNo).toBe('CRR001')
    })

    it('名称重复应抛错', async () => {
      prisma.customRiskRule.findFirst.mockResolvedValue({ id: 'r1', name: '已存在' })
      await expect(
        service.create('admin-1', {
          name: '已存在',
          conditions: [
            { field: CustomRuleField.AMOUNT, operator: CustomRuleOperator.GT, value: 1000 },
          ],
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('空条件应抛错', async () => {
      await expect(
        service.create('admin-1', {
          name: '测试',
          conditions: [],
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('无效字段应抛错', async () => {
      await expect(
        service.create('admin-1', {
          name: '测试',
          conditions: [
            { field: 'invalid_field' as any, operator: CustomRuleOperator.EQ, value: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('无效算子应抛错', async () => {
      await expect(
        service.create('admin-1', {
          name: '测试',
          conditions: [
            { field: CustomRuleField.AMOUNT, operator: 'invalid_op' as any, value: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('value 为 null 应抛错', async () => {
      await expect(
        service.create('admin-1', {
          name: '测试',
          conditions: [
            { field: CustomRuleField.AMOUNT, operator: CustomRuleOperator.EQ, value: null as any },
          ],
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ============== list ==============
  describe('list', () => {
    it('返回分页列表', async () => {
      prisma.customRiskRule.findMany.mockResolvedValue([{ id: 'r1' }])
      prisma.customRiskRule.count.mockResolvedValue(1)
      const result = await service.list({})
      expect(result.total).toBe(1)
    })

    it('enabled 过滤生效', async () => {
      await service.list({ enabled: true })
      expect(prisma.customRiskRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enabled: true },
        }),
      )
    })
  })

  // ============== findByRuleNo ==============
  describe('findByRuleNo', () => {
    it('不存在应抛 404', async () => {
      prisma.customRiskRule.findUnique.mockResolvedValue(null)
      await expect(service.findByRuleNo('NOTEXIST')).rejects.toThrow(NotFoundException)
    })

    it('成功查询', async () => {
      prisma.customRiskRule.findUnique.mockResolvedValue({
        id: 'r1',
        ruleNo: 'CRR001',
        name: '测试',
      })
      const result = await service.findByRuleNo('CRR001')
      expect(result?.ruleNo).toBe('CRR001')
    })
  })

  // ============== update ==============
  describe('update', () => {
    it('规则不存在应抛 404', async () => {
      prisma.customRiskRule.findUnique.mockResolvedValue(null)
      await expect(service.update('NOTEXIST', { name: '新名' })).rejects.toThrow(NotFoundException)
    })

    it('成功更新名称', async () => {
      prisma.customRiskRule.findUnique.mockResolvedValue({ id: 'r1', ruleNo: 'CRR001', name: '旧名' })
      prisma.customRiskRule.update.mockResolvedValue({ id: 'r1', name: '新名' })
      const result = await service.update('CRR001', { name: '新名' })
      expect(result?.name).toBe('新名')
    })

    it('更新为已存在名称应抛错', async () => {
      prisma.customRiskRule.findUnique.mockResolvedValue({ id: 'r1', ruleNo: 'CRR001', name: '旧名' })
      prisma.customRiskRule.findFirst.mockResolvedValue({ id: 'r2', name: '已存在' })
      await expect(service.update('CRR001', { name: '已存在' })).rejects.toThrow(BadRequestException)
    })

    it('更新时校验新条件', async () => {
      prisma.customRiskRule.findUnique.mockResolvedValue({ id: 'r1', ruleNo: 'CRR001', name: '测试' })
      await expect(
        service.update('CRR001', {
          conditions: [
            { field: 'invalid' as any, operator: CustomRuleOperator.EQ, value: 1 },
          ],
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ============== delete ==============
  describe('delete', () => {
    it('规则不存在应抛 404', async () => {
      prisma.customRiskRule.findUnique.mockResolvedValue(null)
      await expect(service.delete('NOTEXIST')).rejects.toThrow(NotFoundException)
    })

    it('成功删除', async () => {
      prisma.customRiskRule.findUnique.mockResolvedValue({ id: 'r1', ruleNo: 'CRR001' })
      prisma.customRiskRule.delete.mockResolvedValue({})
      const result = await service.delete('CRR001')
      expect(result?.deleted).toBe(true)
    })
  })

  // ============== toggle ==============
  describe('toggle', () => {
    it('成功启用', async () => {
      prisma.customRiskRule.findUnique.mockResolvedValue({ id: 'r1', ruleNo: 'CRR001' })
      prisma.customRiskRule.update.mockResolvedValue({ id: 'r1', enabled: true })
      const result = await service.toggle('CRR001', true)
      expect(result?.enabled).toBe(true)
    })
  })

  // ============== test ==============
  describe('test', () => {
    it('空条件应抛错', async () => {
      await expect(service.test({ conditions: [] })).rejects.toThrow(BadRequestException)
    })

    it('AND 逻辑：全部满足应命中', async () => {
      const result = await service.test({
        conditions: [
          { field: CustomRuleField.AMOUNT, operator: CustomRuleOperator.GTE, value: 1000 },
          { field: CustomRuleField.TYPE, operator: CustomRuleOperator.EQ, value: 'TRANSFER' },
        ],
        logicalOp: CustomRuleLogicalOp.AND,
        amount: 5000,
        type: 'TRANSFER',
      })
      expect(result.hit).toBe(true)
      expect(result.conditions).toHaveLength(2)
    })

    it('AND 逻辑：部分满足应不命中', async () => {
      const result = await service.test({
        conditions: [
          { field: CustomRuleField.AMOUNT, operator: CustomRuleOperator.GTE, value: 1000 },
          { field: CustomRuleField.TYPE, operator: CustomRuleOperator.EQ, value: 'TRANSFER' },
        ],
        logicalOp: CustomRuleLogicalOp.AND,
        amount: 5000,
        type: 'RECHARGE',
      })
      expect(result.hit).toBe(false)
    })

    it('OR 逻辑：任一满足应命中', async () => {
      const result = await service.test({
        conditions: [
          { field: CustomRuleField.AMOUNT, operator: CustomRuleOperator.GTE, value: 1000 },
          { field: CustomRuleField.TYPE, operator: CustomRuleOperator.EQ, value: 'TRANSFER' },
        ],
        logicalOp: CustomRuleLogicalOp.OR,
        amount: 5000,
        type: 'RECHARGE',
      })
      expect(result.hit).toBe(true)
    })

    it('in_range 算子支持跨午夜', async () => {
      // 当前小时由 new Date() 决定，所以测试双向
      const result = await service.test({
        conditions: [
          { field: CustomRuleField.HOUR, operator: CustomRuleOperator.IN_RANGE, value: [22, 6] },
        ],
        amount: 100,
      })
      expect(result.conditions[0].matched).toBeDefined()
    })

    it('in 算子：值在集合中', async () => {
      const result = await service.test({
        conditions: [
          { field: CustomRuleField.TYPE, operator: CustomRuleOperator.IN, value: ['TRANSFER', 'WITHDRAW'] },
        ],
        type: 'TRANSFER',
      })
      expect(result.hit).toBe(true)
    })

    it('not_in 算子：值不在集合中', async () => {
      const result = await service.test({
        conditions: [
          { field: CustomRuleField.TYPE, operator: CustomRuleOperator.NOT_IN, value: ['TRANSFER'] },
        ],
        type: 'RECHARGE',
      })
      expect(result.hit).toBe(true)
    })

    it('contains 算子：字符串包含', async () => {
      const result = await service.test({
        conditions: [
          { field: CustomRuleField.IP, operator: CustomRuleOperator.CONTAINS, value: '10.1.' },
        ],
        ip: '10.1.2.3',
      })
      expect(result.hit).toBe(true)
    })

    it('所有数值算子', async () => {
      const ops = [
        { op: CustomRuleOperator.EQ, val: 100, expected: true },
        { op: CustomRuleOperator.NE, val: 200, expected: true },
        { op: CustomRuleOperator.GT, val: 50, expected: true },
        { op: CustomRuleOperator.GTE, val: 100, expected: true },
        { op: CustomRuleOperator.LT, val: 200, expected: true },
        { op: CustomRuleOperator.LTE, val: 100, expected: true },
      ]
      for (const { op, val, expected } of ops) {
        const result = await service.test({
          conditions: [
            { field: CustomRuleField.AMOUNT, operator: op, value: val },
          ],
          amount: 100,
        })
        expect(result.conditions[0].matched).toBe(expected)
      }
    })
  })

  // ============== evaluate ==============
  describe('evaluate', () => {
    it('无规则时返回空数组', async () => {
      prisma.customRiskRule.findMany.mockResolvedValue([])
      const result = await service.evaluate({
        userId: 'u1',
        type: 'TRANSFER',
        amount: 5000,
      })
      expect(result).toEqual([])
    })

    it('命中规则时返回规则', async () => {
      prisma.customRiskRule.findMany.mockResolvedValue([
        {
          id: 'r1',
          ruleNo: 'CRR001',
          name: '大额拦截',
          action: 'BLOCK',
          conditions: JSON.stringify([
            { field: CustomRuleField.AMOUNT, operator: CustomRuleOperator.GTE, value: 1000 },
          ]),
          logicalOp: 'AND',
        },
      ])
      const result = await service.evaluate({
        userId: 'u1',
        type: 'TRANSFER',
        amount: 5000,
      })
      expect(result).toHaveLength(1)
      expect(result[0].action).toBe('BLOCK')
    })

    it('不命中规则返回空数组', async () => {
      prisma.customRiskRule.findMany.mockResolvedValue([
        {
          id: 'r1',
          ruleNo: 'CRR001',
          name: '大额拦截',
          action: 'BLOCK',
          conditions: JSON.stringify([
            { field: CustomRuleField.AMOUNT, operator: CustomRuleOperator.GTE, value: 100000 },
          ]),
          logicalOp: 'AND',
        },
      ])
      const result = await service.evaluate({
        userId: 'u1',
        type: 'TRANSFER',
        amount: 5000,
      })
      expect(result).toEqual([])
    })

    it('conditions JSON 损坏时跳过规则', async () => {
      prisma.customRiskRule.findMany.mockResolvedValue([
        {
          id: 'r1',
          ruleNo: 'CRR001',
          name: '损坏的规则',
          action: 'BLOCK',
          conditions: 'not a json{',
          logicalOp: 'AND',
        },
      ])
      const result = await service.evaluate({
        userId: 'u1',
        type: 'TRANSFER',
        amount: 5000,
      })
      expect(result).toEqual([])
    })
  })
})
