import { describe, expect, it, vi } from 'vitest'

vi.mock('@/config', () => ({
  isOssPublicUrl: (url) =>
    url.startsWith('https://wx.oss.2000gallery.art/'),
  OSS_PUBLIC_HOST: 'wx.oss.2000gallery.art',
  resolvePublicAssetUrl: (url) => {
    if (!url) return ''
    if (url.startsWith('http')) return url
    return `https://api.example.com${url.startsWith('/') ? url : `/${url}`}`
  },
}))

const { getListThumbnailUrl, isSignedQiniuUrl } = await import('@/utils/listImageUrl.js')

describe('getListThumbnailUrl', () => {
  it('appends x-oss-process for ali OSS custom domain', () => {
    const url = getListThumbnailUrl('https://wx.oss.2000gallery.art/editor/a.jpg')
    expect(url).toContain('x-oss-process=image/resize')
    expect(url).toContain('w_240')
    expect(url).toContain('q_80')
  })

  it('appends imageView2 for public qiniu CDN', () => {
    const url = getListThumbnailUrl('http://qn.2000gallery.art/rb/a.jpg')
    expect(url).toContain('imageView2/2/w/240')
    expect(url).toContain('q/80')
  })

  it('does not modify signed qiniu URLs', () => {
    const signed =
      'http://qn.2000gallery.art/rb/a.jpg?imageView2/2/w/400&e=999&token=ak:sig'
    expect(getListThumbnailUrl(signed)).toBe(signed)
  })

  it('leaves local upload paths without processing', () => {
    expect(getListThumbnailUrl('/uploads/x.jpg')).toBe('https://api.example.com/uploads/x.jpg')
  })

  it('skips when processing params already present', () => {
    const oss =
      'https://wx.oss.2000gallery.art/a.jpg?x-oss-process=image/resize,w_100'
    expect(getListThumbnailUrl(oss)).toBe(oss)
  })
})

describe('isSignedQiniuUrl', () => {
  it('detects token and e query', () => {
    expect(isSignedQiniuUrl('http://x/a?token=ak:s')).toBe(true)
    expect(isSignedQiniuUrl('http://x/a?e=123')).toBe(true)
    expect(isSignedQiniuUrl('http://x/a.jpg')).toBe(false)
  })
})
