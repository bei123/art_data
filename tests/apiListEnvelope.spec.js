import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildListEnvelope, buildPaginationMeta } = require('../utils/apiListEnvelope')

describe('apiListEnvelope', () => {
  it('buildPaginationMeta computes has_more', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 20, total: 45 })).toEqual({
      page: 1,
      pageSize: 20,
      total: 45,
      has_more: true,
    })
    expect(buildPaginationMeta({ page: 3, pageSize: 20, total: 45 }).has_more).toBe(false)
  })

  it('buildListEnvelope wraps data array', () => {
    const payload = buildListEnvelope([{ id: 1 }], buildPaginationMeta({ page: 1, pageSize: 10, total: 1 }))
    expect(payload).toEqual({
      data: [{ id: 1 }],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 1,
        has_more: false,
      },
    })
  })
})
