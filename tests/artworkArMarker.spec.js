import { describe, it, expect } from 'vitest'
import {
  buildArtworkMarkerUrl,
  buildArtworkMarkerLiveUrl,
  buildArtworkMarkerPrintUrl,
  stripOssProcess,
  DEFAULT_MARKER_URL,
} from '../utils/artworkArMarker.js'

describe('artworkArMarker', () => {
  it('stripOssProcess removes oss query', () => {
    expect(stripOssProcess('https://wx.oss.2000gallery.art/a.jpg?x-oss-process=image/resize,w_100')).toBe(
      'https://wx.oss.2000gallery.art/a.jpg'
    )
  })

  it('buildArtworkMarkerLiveUrl does not pad white border', () => {
    const url = buildArtworkMarkerLiveUrl('https://wx.oss.2000gallery.art/demo.jpg')
    expect(url).toContain('x-oss-process=image')
    expect(url).toContain('m_lfit')
    expect(url).not.toContain('m_pad')
    expect(url).toContain('format,jpg')
    expect(url).not.toBe(DEFAULT_MARKER_URL)
  })

  it('buildArtworkMarkerPrintUrl pads OSS artwork for printable marker', () => {
    const url = buildArtworkMarkerPrintUrl('https://wx.oss.2000gallery.art/demo.jpg')
    expect(url).toContain('x-oss-process=image')
    expect(url).toContain('m_pad')
    expect(url).toContain('format,jpg')
    expect(url).not.toBe(DEFAULT_MARKER_URL)
  })

  it('buildArtworkMarkerUrl defaults to live marker', () => {
    const live = buildArtworkMarkerLiveUrl('https://wx.oss.2000gallery.art/demo.jpg')
    const legacy = buildArtworkMarkerUrl('https://wx.oss.2000gallery.art/demo.jpg')
    expect(legacy).toBe(live)
  })

  it('buildArtworkMarkerLiveUrl uses artwork image for non-OSS', () => {
    expect(buildArtworkMarkerLiveUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })
})
