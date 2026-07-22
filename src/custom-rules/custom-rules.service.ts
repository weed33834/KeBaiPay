import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  CustomRuleField,
  CustomRuleOperator,
  CustomRuleLogicalOp,
} from '../common/enums'
import { KBErrorCodes, kbError } from '../common/error-codes'
import { generateOrderNo } from '../common/helpers'
import {
  CreateCustomRuleDto,
  UpdateCustomRuleDto,
  TestRuleDto,
  ListCustomRuleDto,
  RuleConditionDto,
} from './dto/custom-rule.dto'

/**
 * 自定义风控规则服务
 *
 * DSL 设计：
 *  - conditions: 条件数组，每个条件 { field, operator, value }
 *  - logicalOp: AND（全部满足）/ OR（任一满足）
 *
 * 支持字段：amount, type, hour, dayOfWeek, userRiskLevel, ip
 * 支持算子：==, !=, >, >=, <, <=, in, not_in, in_range, contains
 *
 * in_range 算子：用于 hour 字段，支持跨午夜范围
 *  例如 [22, 6] 表示 22 点到次日 6 点
 */
@Injectable()
export class CustomRulesService {
  private readonly logger = new Logger(CustomRulesService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** 创建规则 */
  async create(createdBy: string, dto: CreateCustomRuleDto) {
    // 校验 conditions
    this.validateConditions(dto.conditions)

    // 检查名称重复
    const existing = await this.prisma.customRiskRule.findFirst({
      where: { name: dto.name },
    })
    if (existing) {
      throw new BadRequestException(kbError(KBErrorCodes.CUSTOM_RULE_DUPLICATED))
    }

    const ruleNo = generateOrderNo('CRR')
    return this.prisma.customRiskRule.create({
      data: {
        ruleNo,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled ?? true,
        action: dto.action || 'BLOCK',
        priority: dto.priority ?? 100,
        conditions: JSON.stringify(dto.conditions),
        logicalOp: dto.logicalOp || CustomRuleLogicalOp.AND,
        createdBy,
      },
    })
  }

  /** 列表 */
  async list(query: ListCustomRuleDto) {
    const where: any = {}
    if (query.enabled !== undefined) where.enabled = query.enabled
    if (query.action) where.action = query.action
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 10))

    const [items, total] = await Promise.all([
      this.prisma.customRiskRule.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customRiskRule.count({ where }),
    ])
    return { items, total, page, limit }
  }

  /** 详情 */
  async findByRuleNo(ruleNo: string) {
    const rule = await this.prisma.customRiskRule.findUnique({
      where: { ruleNo },
    })
    if (!rule) {
      throw new NotFoundException(kbError(KBErrorCodes.CUSTOM_RULE_NOT_FOUND))
    }
    return rule
  }

  /** 更新 */
  async update(ruleNo: string, dto: UpdateCustomRuleDto) {
    const rule = await this.findByRuleNo(ruleNo)
    if (dto.conditions) {
      this.validateConditions(dto.conditions)
    }
    if (dto.name && dto.name !== rule.name) {
      const dup = await this.prisma.customRiskRule.findFirst({
        where: { name: dto.name, NOT: { id: rule.id } },
      })
      if (dup) {
        throw new BadRequestException(kbError(KBErrorCodes.CUSTOM_RULE_DUPLICATED))
      }
    }
    return this.prisma.customRiskRule.update({
      where: { id: rule.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.enabled !== undefined && { enabled: dto.enabled }),
        ...(dto.action !== undefined && { action: dto.action }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.conditions !== undefined && {
          conditions: JSON.stringify(dto.conditions),
        }),
        ...(dto.logicalOp !== undefined && { logicalOp: dto.logicalOp }),
      },
    })
  }

  /** 删除 */
  async delete(ruleNo: string) {
    const rule = await this.findByRuleNo(ruleNo)
    await this.prisma.customRiskRule.delete({ where: { id: rule.id } })
    return { deleted: true, ruleNo }
  }

  /** 启用/禁用 */
  async toggle(ruleNo: string, enabled: boolean) {
    const rule = await this.findByRuleNo(ruleNo)
    return this.prisma.customRiskRule.update({
      where: { id: rule.id },
      data: { enabled },
    })
  }

  /** 测试规则（dry-run，不持久化） */
  async test(dto: TestRuleDto) {
    if (!dto.conditions || dto.conditions.length === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.CUSTOM_RULE_CONDITIONS_INVALID))
    }
    this.validateConditions(dto.conditions)

    const logicalOp = dto.logicalOp || CustomRuleLogicalOp.AND
    const results = dto.conditions.map((c) => {
      const ctxValue = this.resolveContextValue(c, dto)
      const matched = this.applyOperator(ctxValue, c.operator, c.value)
      return {
        field: c.field,
        operator: c.operator,
        expected: c.value,
        actual: ctxValue,
        matched,
      }
    })

    const hit =
      logicalOp === CustomRuleLogicalOp.AND
        ? results.every((r) => r.matched)
        : results.some((r) => r.matched)

    return {
      hit,
      logicalOp,
      conditions: results,
    }
  }

  /** 增加命中计数 */
  async incrementHitCount(ruleNo: string) {
    await this.prisma.customRiskRule.update({
      where: { ruleNo },
      data: { hitCount: { increment: 1 } },
    })
  }

  /**
   * 评估所有启用规则对给定上下文的命中情况
   * 供 RiskEngineService.check 调用
   */
  async evaluate(ctx: {
    userId: string
    type: string
    amount: number
    ip?: string
    userRiskLevel?: string
  }): Promise<{ rule: any; action: string; matched: boolean }[]> {
    const rules = await this.prisma.customRiskRule.findMany({
      where: { enabled: true },
      orderBy: [{ priority: 'asc' }],
    })
    const now = new Date()
    const hour = now.getHours()
    const dayOfWeek = now.getDay()
    const hits: { rule: any; action: string; matched: boolean }[] = []

    for (const rule of rules) {
      let conditions: RuleConditionDto[]
      try {
        conditions = JSON.parse(rule.conditions)
      } catch {
        this.logger.warn(`规则 ${rule.ruleNo} 的 conditions JSON 解析失败，跳过`)
        continue
      }
      const logicalOp = rule.logicalOp as CustomRuleLogicalOp
      const results = conditions.map((c) => {
        const ctxValue = this.resolveContextValueFromCtx(c, ctx, hour, dayOfWeek)
        const matched = this.applyOperator(ctxValue, c.operator, c.value)
        return matched
      })
      const matched =
        logicalOp === CustomRuleLogicalOp.AND
          ? results.every(Boolean)
          : results.some(Boolean)
      if (matched) {
        hits.push({ rule, action: rule.action, matched: true })
      }
    }
    return hits
  }

  // ============== 私有方法 ==============

  private validateConditions(conditions: RuleConditionDto[]) {
    if (!conditions || conditions.length === 0) {
      throw new BadRequestException(kbError(KBErrorCodes.CUSTOM_RULE_CONDITIONS_INVALID))
    }
    for (const c of conditions) {
      if (!Object.values(CustomRuleField).includes(c.field)) {
        throw new BadRequestException(kbError(KBErrorCodes.CUSTOM_RULE_FIELD_INVALID))
      }
      if (!Object.values(CustomRuleOperator).includes(c.operator)) {
        throw new BadRequestException(kbError(KBErrorCodes.CUSTOM_RULE_OPERATOR_INVALID))
      }
      if (c.value === undefined || c.value === null) {
        throw new BadRequestException(kbError(KBErrorCodes.CUSTOM_RULE_CONDITIONS_INVALID))
      }
    }
  }

  /** 从测试 DTO 解析字段值 */
  private resolveContextValue(
    c: RuleConditionDto,
    dto: TestRuleDto,
  ): any {
    switch (c.field) {
      case CustomRuleField.AMOUNT:
        return dto.amount ?? 0
      case CustomRuleField.TYPE:
        return dto.type || ''
      case CustomRuleField.HOUR:
        return new Date().getHours()
      case CustomRuleField.DAY_OF_WEEK:
        return new Date().getDay()
      case CustomRuleField.USER_RISK_LEVEL:
        return dto.userRiskLevel || 'LOW'
      case CustomRuleField.IP:
        return dto.ip || ''
      default:
        return null
    }
  }

  /** 从交易上下文解析字段值 */
  private resolveContextValueFromCtx(
    c: RuleConditionDto,
    ctx: { userId: string; type: string; amount: number; ip?: string; userRiskLevel?: string },
    hour: number,
    dayOfWeek: number,
  ): any {
    switch (c.field) {
      case CustomRuleField.AMOUNT:
        return ctx.amount
      case CustomRuleField.TYPE:
        return ctx.type
      case CustomRuleField.HOUR:
        return hour
      case CustomRuleField.DAY_OF_WEEK:
        return dayOfWeek
      case CustomRuleField.USER_RISK_LEVEL:
        return ctx.userRiskLevel || 'LOW'
      case CustomRuleField.IP:
        return ctx.ip || ''
      default:
        return null
    }
  }

  /** 应用算子 */
  private applyOperator(actual: any, operator: CustomRuleOperator, expected: any): boolean {
    switch (operator) {
      case CustomRuleOperator.EQ:
        return String(actual) === String(expected)
      case CustomRuleOperator.NE:
        return String(actual) !== String(expected)
      case CustomRuleOperator.GT:
        return Number(actual) > Number(expected)
      case CustomRuleOperator.GTE:
        return Number(actual) >= Number(expected)
      case CustomRuleOperator.LT:
        return Number(actual) < Number(expected)
      case CustomRuleOperator.LTE:
        return Number(actual) <= Number(expected)
      case CustomRuleOperator.IN:
        return Array.isArray(expected) && expected.map(String).includes(String(actual))
      case CustomRuleOperator.NOT_IN:
        return !Array.isArray(expected) || !expected.map(String).includes(String(actual))
      case CustomRuleOperator.IN_RANGE: {
        // 支持跨午夜：[start, end]，start>end 表示跨午夜
        if (!Array.isArray(expected) || expected.length !== 2) return false
        const [start, end] = expected.map(Number)
        const a = Number(actual)
        if (start <= end) {
          return a >= start && a <= end
        }
        // 跨午夜：a >= start OR a <= end
        return a >= start || a <= end
      }
      case CustomRuleOperator.CONTAINS:
        return String(actual).includes(String(expected))
      default:
        return false
    }
  }
}
