import { describe, it, expect } from 'vitest'
import {
  normalizeListPayload,
  hasMoreListPages,
} from './paginatedList.js'

describe('paginatedList', () => {
  it('normalizeListPayload handles array and envelope', () => {
    expect(normalizeListPayload([{ id: 1 }]).items).toHaveLength(1)
    expect(normalizeListPayload({ data: [{ id: 2 }], pagination: { total: 2 } }).items[0].id).toBe(2)
    expect(normalizeListPayload({ artists: [{ id: 3 }] }).items[0].id).toBe(3)
  })

  it('hasMoreListPages uses has_more', () => {
    expect(hasMoreListPages({ pagination: { has_more: true }, page: 1, pageSize: 100, itemsLength: 100 })).toBe(true)
    expect(hasMoreListPages({ pagination: { has_more: false }, page: 1, pageSize: 100, itemsLength: 100 })).toBe(false)
  })

  it('hasMoreListPages uses total and totalPages', () => {
    expect(hasMoreListPages({ pagination: { total: 143 }, page: 1, pageSize: 100, itemsLength: 100 })).toBe(true)
    expect(hasMoreListPages({ pagination: { totalPages: 2 }, page: 2, pageSize: 100, itemsLength: 43 })).toBe(false)
  })

  it('hasMoreListPages falls back to page fullness', () => {
    expect(hasMoreListPages({ pagination: null, page: 1, pageSize: 20, itemsLength: 20 })).toBe(true)
    expect(hasMoreListPages({ pagination: null, page: 2, pageSize: 20, itemsLength: 5 })).toBe(false)
  })
})
