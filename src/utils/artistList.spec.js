import { describe, it, expect } from 'vitest'
import { normalizeArtistsListPayload } from './artistList.js'

describe('normalizeArtistsListPayload', () => {
  it('accepts plain array', () => {
    const items = [{ id: 1, name: 'A' }]
    expect(normalizeArtistsListPayload(items).items).toEqual(items)
  })

  it('accepts paginated envelope', () => {
    const payload = {
      data: [{ id: 1 }],
      pagination: { page: 1, pageSize: 100, total: 143, has_more: true },
    }
    const { items, pagination } = normalizeArtistsListPayload(payload)
    expect(items).toHaveLength(1)
    expect(pagination?.has_more).toBe(true)
  })

  it('accepts institution wrapper', () => {
    const payload = { artists: [{ id: 2 }], total: 1 }
    expect(normalizeArtistsListPayload(payload).items).toEqual([{ id: 2 }])
  })
})
