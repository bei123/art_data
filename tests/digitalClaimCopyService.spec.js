import { describe, it, expect, afterEach } from 'vitest'
import {
  normalizeBlocks,
  blocksFromLegacyIntroSteps,
  resolveListBlocks,
  validateBlocksInput,
} from '../utils/digitalClaimCopyBlocks.js'
import {
  DEFAULT_DIGITAL_CLAIM_COPY,
  mapRow,
  applyForceHidden,
} from '../services/digitalClaimCopyService.js'

describe('digitalClaimCopyBlocks', () => {
  it('normalizes mixed content blocks', () => {
    const blocks = normalizeBlocks([
      { type: 'text', content: '说明文字' },
      { type: 'image', url: '/uploads/demo.png', alt: '示意图' },
      { type: 'link', label: '下载 App', url: 'https://example.com/app' },
    ])

    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('text')
    expect(blocks[1].url).toContain('/uploads/demo.png')
    expect(blocks[2].label).toBe('下载 App')
  })

  it('builds legacy intro and steps into text blocks', () => {
    const blocks = blocksFromLegacyIntroSteps('intro', ['step1', 'step2'])
    expect(blocks).toEqual([
      { type: 'text', content: 'intro' },
      { type: 'text', content: 'step1' },
      { type: 'text', content: 'step2' },
    ])
  })

  it('validates https link blocks', () => {
    const result = validateBlocksInput(
      [{ type: 'link', label: '官网', url: 'http://insecure.example.com' }],
      '测试内容'
    )
    expect(result.error).toContain('https')
  })
})

describe('digitalClaimCopyService', () => {
  const originalForceHidden = process.env.DIGITAL_CLAIM_COPY_FORCE_HIDDEN

  afterEach(() => {
    if (originalForceHidden == null) {
      delete process.env.DIGITAL_CLAIM_COPY_FORCE_HIDDEN
    } else {
      process.env.DIGITAL_CLAIM_COPY_FORCE_HIDDEN = originalForceHidden
    }
  })

  it('seeds hidden-by-default copy with blocks', () => {
    expect(DEFAULT_DIGITAL_CLAIM_COPY.list_visible).toBe(false)
    expect(DEFAULT_DIGITAL_CLAIM_COPY.list_blocks.length).toBeGreaterThan(0)
  })

  it('maps db row into public block payload', () => {
    const mapped = mapRow({
      list_visible: 1,
      sheet_guide_visible: 0,
      guide_title: '领取说明',
      list_blocks: JSON.stringify([{ type: 'text', content: 'hello' }]),
      sheet_blocks: JSON.stringify([{ type: 'link', label: '下载', url: 'https://example.com' }]),
    })
    expect(mapped.list_visible).toBe(true)
    expect(mapped.list_blocks[0].content).toBe('hello')
    expect(mapped.sheet_blocks[0].type).toBe('link')
  })

  it('falls back to legacy intro and steps when blocks missing', () => {
    const mapped = resolveListBlocks({
      guide_intro: 'intro',
      guide_steps: JSON.stringify(['a']),
    })
    expect(mapped).toEqual([
      { type: 'text', content: 'intro' },
      { type: 'text', content: 'a' },
    ])
  })

  it('force hidden env overrides visibility flags', () => {
    process.env.DIGITAL_CLAIM_COPY_FORCE_HIDDEN = 'true'
    const hidden = applyForceHidden({
      list_visible: true,
      sheet_guide_visible: true,
      guide_title: 't',
      list_blocks: [{ type: 'text', content: 's' }],
      sheet_blocks: [],
    })
    expect(hidden.list_visible).toBe(false)
    expect(hidden.sheet_guide_visible).toBe(false)
  })
})
