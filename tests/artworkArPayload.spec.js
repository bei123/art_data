import { describe, it, expect } from 'vitest'
import {
  buildArtworkArPayload,
  buildArTextureUrl,
  resolveArDimensionsMeters,
} from '../utils/artworkArPayload.js'

describe('artworkArPayload', () => {
  it('resolveArDimensionsMeters maps collection_size to width/height meters', () => {
    const dims = resolveArDimensionsMeters({ collection_size: '80×120cm' })
    expect(dims.widthM).toBeCloseTo(0.8)
    expect(dims.heightM).toBeCloseTo(1.2)
    expect(dims.frameDepthM).toBeCloseTo(0.05)
  })

  it('buildArTextureUrl appends oss process for ali OSS urls', () => {
    const url = buildArTextureUrl('https://wx.oss.2000gallery.art/demo.jpg')
    expect(url).toContain('x-oss-process=image/resize')
    expect(url).toContain('format,jpg')
  })

  it('buildArtworkArPayload returns enabled when image and size exist', () => {
    const payload = buildArtworkArPayload({
      image: 'https://wx.oss.2000gallery.art/a.jpg',
      collection_size: '30×40cm',
    })
    expect(payload.enabled).toBe(true)
    expect(payload.texture_url).toContain('x-oss-process')
    expect(payload.width_m).toBeCloseTo(0.3)
    expect(payload.height_m).toBeCloseTo(0.4)
    expect(payload.marker_url).toBeTruthy()
    expect(payload.marker_live_url).toBeTruthy()
    expect(payload.marker_print_url).toContain('m_pad')
    expect(payload.marker_live_url).not.toContain('m_pad')
    expect(payload.marker_is_custom).toBe(true)
    expect(payload.marker_scan_target).toBe('live_artwork')
    expect(payload.marker_ref_source).toBe('artwork_width')
    expect(payload.marker_ref_width_m).toBeCloseTo(0.3)
    expect(payload.suggested_modes.android).toBe('desk-preview')
    expect(payload.suggested_modes.ios).toBe('plane-wall')
  })

  it('buildArtworkArPayload disabled without size', () => {
    const payload = buildArtworkArPayload({
      image: 'https://wx.oss.2000gallery.art/a.jpg',
    })
    expect(payload.enabled).toBe(false)
  })
})
