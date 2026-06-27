import { describe, it, expect, afterEach } from 'vitest'
import {
  normalizeColumnsList,
  isFulltextIndexMismatchError,
  markFulltextReadyForTests,
  resetFulltextReadyForTests,
} from '../utils/searchIndexSchema.js'

describe('normalizeColumnsList', () => {
  it('normalizes column names for comparison', () => {
    expect(normalizeColumnsList(' title , description , era ')).toBe('title,description,era')
  })
})

describe('isFulltextIndexMismatchError', () => {
  it('detects mysql fulltext column mismatch', () => {
    expect(
      isFulltextIndexMismatchError(new Error("Can't find FULLTEXT index matching the column list"))
    ).toBe(true)
    expect(isFulltextIndexMismatchError({ code: 'ER_CANT_FIND_FTWIDX' })).toBe(true)
    expect(isFulltextIndexMismatchError(new Error('other'))).toBe(false)
  })
})

describe('fulltext ready flags', () => {
  afterEach(() => {
    resetFulltextReadyForTests()
  })

  it('allows tests to override readiness', () => {
    markFulltextReadyForTests({ original_artworks: true })
    resetFulltextReadyForTests()
  })
})
