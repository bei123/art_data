import { describe, it, expect } from 'vitest'
import {
  resolveCloudPrintTemplateCode,
  resolveOptionalCustomTemplateCode,
  buildCloudPrintDocuments,
  buildCloudPrintPayload,
  assessCloudPrintResponse,
  mergeCloudPrintHtmlPages,
} from '../services/sfExpressCloudPrintHtml.js'

describe('resolveCloudPrintTemplateCode', () => {
  it('replaces partnerId placeholders', () => {
    expect(resolveCloudPrintTemplateCode('ABC123')).toBe('fm_76130_standard_ABC123')
  })

  it('uses full template code as-is when no placeholder', () => {
    expect(resolveCloudPrintTemplateCode('ABC123', 'fm_76130_standard_ABC123')).toBe('fm_76130_standard_ABC123')
  })

  it('avoids double partnerId suffix', () => {
    expect(resolveCloudPrintTemplateCode('ABC123', 'fm_76130_standard_ABC123_{partnerId}')).toBe('fm_76130_standard_ABC123')
  })
})

describe('resolveOptionalCustomTemplateCode', () => {
  it('ignores standard template mistaken as custom', () => {
    expect(resolveOptionalCustomTemplateCode('fm_76130_standard_ABC', 'fm_76130_standard_ABC')).toBeUndefined()
    expect(resolveOptionalCustomTemplateCode('fm_76130_standard_ABC', 'fm_76130_standard_ABC123')).toBeUndefined()
  })

  it('accepts published custom template code', () => {
    expect(resolveOptionalCustomTemplateCode(
      'fm_76130_standard_ABC',
      'fm_76130_standard_custom_10000022213_1',
    )).toBe('fm_76130_standard_custom_10000022213_1')
  })
})

describe('buildCloudPrintDocuments', () => {
  it('builds single-waybill document', () => {
    expect(buildCloudPrintDocuments([], 'SF1234567890')).toEqual([
      { masterWaybillNo: 'SF1234567890' },
    ])
  })

  it('builds mother-child documents with seq and sum', () => {
    const docs = buildCloudPrintDocuments([
      { waybill_type: '1', waybill_no: 'SF100' },
      { waybill_type: '2', waybill_no: 'SF101' },
      { waybill_type: '2', waybill_no: 'SF102' },
    ])
    expect(docs).toHaveLength(3)
    expect(docs[0]).toMatchObject({ masterWaybillNo: 'SF100', seq: '1', sum: '3' })
    expect(docs[1]).toMatchObject({
      masterWaybillNo: 'SF100',
      branchWaybillNo: 'SF101',
      seq: '2',
      sum: '3',
    })
  })
})

describe('buildCloudPrintPayload', () => {
  it('returns version 2.0 html payload', () => {
    const built = buildCloudPrintPayload({
      partnerId: 'TEST001',
      fallbackWaybillNo: 'SF999',
    })
    expect(built.ok).toBe(true)
    expect(built.payload.version).toBe('2.0')
    expect(built.payload.fileType).toBe('html')
    expect(built.payload.templateCode).toBe('fm_76130_standard_TEST001')
    expect(built.payload.documents[0].masterWaybillNo).toBe('SF999')
  })
})

describe('assessCloudPrintResponse', () => {
  it('parses successful cloud print files', () => {
    const assessed = assessCloudPrintResponse({
      success: true,
      obj: {
        templateCode: 'fm_76130_standard_TEST',
        fileType: 'html',
        files: [
          { url: 'https://example.com/a.html', token: 'AUTH_1', waybillNo: 'SF1', seqNo: 2 },
          { url: 'https://example.com/b.html', token: 'AUTH_2', waybillNo: 'SF2', seqNo: 1 },
        ],
      },
    })
    expect(assessed.ok).toBe(true)
    expect(assessed.files).toHaveLength(2)
    expect(assessed.files[0].seq_no).toBe(1)
    expect(assessed.files[1].seq_no).toBe(2)
  })
})

describe('mergeCloudPrintHtmlPages', () => {
  it('returns single html unchanged', () => {
    const html = '<html><body><p>面单</p></body></html>'
    expect(mergeCloudPrintHtmlPages([html])).toBe(html)
  })

  it('merges multiple html bodies', () => {
    const merged = mergeCloudPrintHtmlPages([
      '<html><body><p>第一联</p></body></html>',
      '<html><body><p>第二联</p></body></html>',
    ])
    expect(merged).toContain('第一联')
    expect(merged).toContain('第二联')
    expect(merged).toContain('sf-waybill-page')
  })
})
