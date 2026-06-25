import { describe, it, expect, afterEach } from 'vitest'
import {
  DEFAULT_DIGITAL_CLAIM_COPY,
  mapRow,
  normalizeSteps,
  applyForceHidden,
} from '../services/digitalClaimCopyService.js'

describe('digitalClaimCopyService', () => {
  const originalForceHidden = process.env.DIGITAL_CLAIM_COPY_FORCE_HIDDEN

  afterEach(() => {
    if (originalForceHidden == null) {
      delete process.env.DIGITAL_CLAIM_COPY_FORCE_HIDDEN
    } else {
      process.env.DIGITAL_CLAIM_COPY_FORCE_HIDDEN = originalForceHidden
    }
  })

  it('seeds hidden-by-default copy', () => {
    expect(DEFAULT_DIGITAL_CLAIM_COPY.list_visible).toBe(false)
    expect(DEFAULT_DIGITAL_CLAIM_COPY.sheet_guide_visible).toBe(false)
    expect(DEFAULT_DIGITAL_CLAIM_COPY.guide_steps.length).toBeGreaterThan(0)
  })

  it('normalizes guide steps from json string', () => {
    expect(normalizeSteps('["步骤一","步骤二"]')).toEqual(['步骤一', '步骤二'])
  })

  it('maps db row booleans and steps', () => {
    const mapped = mapRow({
      list_visible: 1,
      sheet_guide_visible: 0,
      guide_title: '领取说明',
      guide_intro: 'intro',
      guide_steps: '["a","b"]',
      sheet_tip: 'tip',
    })
    expect(mapped.list_visible).toBe(true)
    expect(mapped.sheet_guide_visible).toBe(false)
    expect(mapped.guide_steps).toEqual(['a', 'b'])
  })

  it('force hidden env overrides visibility flags', () => {
    process.env.DIGITAL_CLAIM_COPY_FORCE_HIDDEN = 'true'
    const hidden = applyForceHidden({
      list_visible: true,
      sheet_guide_visible: true,
      guide_title: 't',
      guide_intro: 'i',
      guide_steps: ['s'],
      sheet_tip: 'tip',
    })
    expect(hidden.list_visible).toBe(false)
    expect(hidden.sheet_guide_visible).toBe(false)
    expect(hidden.guide_title).toBe('t')
  })
})
