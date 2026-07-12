import { describe, it, expect } from 'vitest'
import {
  buildArtworkMarkerUrl,
  stripOssProcess,
  DEFAULT_MARKER_URL,
} from '../utils/artworkArMarker.js'

describe('artworkArMarker', () => {
  it('stripOssProcess removes oss query', () => {
    expect(stripOssProcess('https://wx.oss.2000gallery.art/a.jpg?x-oss-process=image/resize,w_100')).toBe(
      'https://wx.oss.2000gallery.art/a.jpg'
    )
  })

  it('buildArtworkMarkerUrl pads OSS artwork for printable marker', () => {
    const url = buildArtworkMarkerUrl('https://wx.oss.2000gallery.art/demo.jpg')
    expect(url).toContain('x-oss-process=image')
    expect(url).toContain('m_pad')
    expect(url).toContain('format,jpg')
    expect(url).not.toBe(DEFAULT_MARKER_URL)
  })

  it('buildArtworkMarkerUrl uses artwork image for non-OSS', () => {
    expect(buildArtworkMarkerUrl('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })
})
