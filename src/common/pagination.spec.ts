import {
  computePagination,
  paginateResult,
  type PaginationQuery,
} from './pagination'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants'

describe('common/pagination', () => {
  describe('computePagination', () => {
    it('空查询回退到默认 page=1 / limit=DEFAULT_PAGE_SIZE', () => {
      const r = computePagination({})
      expect(r.page).toBe(1)
      expect(r.limit).toBe(DEFAULT_PAGE_SIZE)
      expect(r.skip).toBe(0)
      expect(r.take).toBe(DEFAULT_PAGE_SIZE)
    })

    it('正常分页计算 skip 与 take', () => {
      const r = computePagination({ page: 3, limit: 20 })
      expect(r.page).toBe(3)
      expect(r.limit).toBe(20)
      expect(r.skip).toBe(40)
      expect(r.take).toBe(20)
    })

    it('page 小于 1 回退到 1', () => {
      expect(computePagination({ page: 0 }).page).toBe(1)
      expect(computePagination({ page: -5 }).page).toBe(1)
    })

    it('limit 超过 MAX_PAGE_SIZE 被截断', () => {
      const r = computePagination({ limit: 9999 })
      expect(r.limit).toBe(MAX_PAGE_SIZE)
    })

    it('limit 为 0 回退到默认值（0 是 falsy）', () => {
      expect(computePagination({ limit: 0 }).limit).toBe(DEFAULT_PAGE_SIZE)
    })

    it('limit 为负数被下限截断到 1（负数是 truthy，经 Math.max(1, ...) 截断）', () => {
      expect(computePagination({ limit: -3 }).limit).toBe(1)
    })

    it('支持自定义 maxPageSize', () => {
      const r = computePagination({ limit: 50 }, 30)
      expect(r.limit).toBe(30)
    })

    it('take 始终等于 limit（Prisma findMany 用法）', () => {
      const r = computePagination({ page: 2, limit: 15 })
      expect(r.take).toBe(r.limit)
    })
  })

  describe('paginateResult', () => {
    it('组装分页返回结构', () => {
      const query: PaginationQuery = { page: 2, limit: 10 }
      const { page, limit } = computePagination(query)
      const data = [{ id: 'a' }, { id: 'b' }]
      const result = paginateResult(data, 25, page, limit)
      expect(result).toEqual({ data, total: 25, page: 2, limit: 10 })
    })

    it('保留泛型数据', () => {
      const result = paginateResult<number>([1, 2, 3], 3, 1, 10)
      expect(result.data).toEqual([1, 2, 3])
      expect(result.total).toBe(3)
    })
  })
})
