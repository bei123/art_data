import { describe, it, expect } from 'vitest'
import {
  parseListPageParams,
  buildSimplePagination,
  DEFAULT_LIST_PAGE_SIZE,
} from '../utils/listQuery.js'

describe('parseListPageParams', () => {
  it('defaults page size when params omitted', () => {
    const params = parseListPageParams({})
    expect(params.page).toBe(1)
    expect(params.pageSize).toBe(DEFAULT_LIST_PAGE_SIZE)
    expect(params.explicit).toBe(false)
  })

  it('marks explicit pagination requests', () => {
    const params = parseListPageParams({ page: 2, pageSize: 20 })
    expect(params.page).toBe(2)
    expect(params.pageSize).toBe(20)
    expect(params.offset).toBe(20)
    expect(params.explicit).toBe(true)
  })

  it('caps page size at max', () => {
    const params = parseListPageParams({ pageSize: 500 })
    expect(params.pageSize).toBe(100)
  })
})

describe('buildSimplePagination', () => {
  it('computes has_more from total', () => {
    expect(buildSimplePagination({ page: 1, pageSize: 20, total: 50 }).has_more).toBe(true)
    expect(buildSimplePagination({ page: 3, pageSize: 20, total: 50 }).has_more).toBe(false)
  })
})
