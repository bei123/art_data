import { describe, it, expect } from 'vitest'
import {
  FIRST_RIGHT_IMAGE_SUBQUERY_SQL,
  attachRightImagesToOrderItems,
} from '../utils/rightImagesQuery.js'

describe('rightImagesQuery', () => {
  it('uses scalar subquery for first right image', () => {
    expect(FIRST_RIGHT_IMAGE_SUBQUERY_SQL).toContain('ORDER BY ri.id ASC LIMIT 1')
    expect(FIRST_RIGHT_IMAGE_SUBQUERY_SQL).not.toContain('LEFT JOIN')
  })

  it('attaches grouped images to order items', () => {
    const items = [
      { id: 1, right_id: 10, title: 'A' },
      { id: 2, right_id: null, title: 'B' },
      { id: 3, right_id: 20, title: 'C' },
    ]
    const imagesByRightId = new Map([
      [10, ['img-a.jpg', 'img-b.jpg']],
      [20, ['img-c.jpg']],
    ])

    const result = attachRightImagesToOrderItems(items, imagesByRightId)

    expect(result[0].images).toEqual(['img-a.jpg', 'img-b.jpg'])
    expect(result[1].images).toEqual([])
    expect(result[2].images).toEqual(['img-c.jpg'])
  })
})
