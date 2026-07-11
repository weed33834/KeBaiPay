import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants'

export interface PaginationQuery {
  page?: number
  limit?: number
}

export interface PaginationResult {
  page: number
  limit: number
  skip: number
  take: number
}

export interface PaginatedData<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

/**
 * 计算分页参数。
 *
 * - page 不传或非法时回退到 1
 * - limit 不传或非法时回退到 DEFAULT_PAGE_SIZE
 * - limit 上限由 maxPageSize 控制（默认 MAX_PAGE_SIZE）
 */
export function computePagination(
  query: PaginationQuery,
  maxPageSize: number = MAX_PAGE_SIZE,
): PaginationResult {
  const page = Math.max(1, query.page || 1)
  const limit = Math.max(1, Math.min(maxPageSize, query.limit || DEFAULT_PAGE_SIZE))
  const skip = (page - 1) * limit
  return { page, limit, skip, take: limit }
}

/**
 * 组装分页返回结构。
 */
export function paginateResult<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedData<T> {
  return { data, total, page, limit }
}
