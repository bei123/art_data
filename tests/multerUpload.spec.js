import { describe, it, expect } from 'vitest'
import { createExtensionFileFilter, MEDIA_EXTENSIONS, IMAGE_EXTENSIONS } from '../config/multerUpload.js'

function runFilter(allowedExtensions, originalname) {
  const filter = createExtensionFileFilter(allowedExtensions)
  return new Promise((resolve, reject) => {
    filter({}, { originalname }, (err, ok) => {
      if (err) reject(err)
      else resolve(ok)
    })
  })
}

describe('multerUpload', () => {
  it('accepts allowed media extensions', async () => {
    await expect(runFilter(MEDIA_EXTENSIONS, 'photo.JPG')).resolves.toBe(true)
    await expect(runFilter(MEDIA_EXTENSIONS, 'clip.mp4')).resolves.toBe(true)
  })

  it('rejects disallowed extensions', async () => {
    await expect(runFilter(MEDIA_EXTENSIONS, 'script.exe')).rejects.toThrow('不支持的文件类型')
    await expect(runFilter(IMAGE_EXTENSIONS, 'clip.mp4')).rejects.toThrow('不支持的文件类型')
  })

  it('rejects files without extension', async () => {
    await expect(runFilter(MEDIA_EXTENSIONS, 'noext')).rejects.toThrow('不支持的文件类型')
  })
})
