import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import {
  toUploadRelativePath,
  resolveSafeUploadFile,
} from '../utils/localUploadPath.js'

describe('localUploadPath', () => {
  it('normalizes relative upload paths', () => {
    expect(toUploadRelativePath('/uploads/a/b.jpg')).toBe('/uploads/a/b.jpg')
    expect(toUploadRelativePath('https://api.example.com/uploads/x.png')).toBe('/uploads/x.png')
  })

  it('rejects traversal and invalid paths', () => {
    expect(toUploadRelativePath('/uploads/../secret.txt')).toBe(null)
    expect(toUploadRelativePath('/uploads/foo/../../etc/passwd')).toBe(null)
    expect(toUploadRelativePath('/etc/passwd')).toBe(null)
  })

  it('resolves files only inside uploads root', () => {
    const resolved = resolveSafeUploadFile('/uploads/demo.jpg')
    expect(resolved.ok).toBe(true)
    expect(resolved.absolute.endsWith(path.join('uploads', 'demo.jpg'))).toBe(true)

    const blocked = resolveSafeUploadFile('/uploads/../index.js')
    expect(blocked.ok).toBe(false)
  })
})

describe('signedLocalUpload', () => {
  it('signs and verifies upload URLs', async () => {
    vi.stubEnv('JWT_SECRET', 'test-local-upload-secret')
    vi.resetModules()
    const { signLocalUploadPath, verifyLocalUploadSignature } = await import('../utils/signedLocalUpload.js')

    const signed = signLocalUploadPath('/uploads/demo.jpg')
    const url = new URL(signed)
    expect(url.pathname).toBe('/uploads/demo.jpg')
    expect(
      verifyLocalUploadSignature(
        '/uploads/demo.jpg',
        url.searchParams.get('exp'),
        url.searchParams.get('sig')
      )
    ).toBe(true)
  })

  it('rejects tampered signatures', async () => {
    vi.stubEnv('JWT_SECRET', 'test-local-upload-secret')
    vi.resetModules()
    const { signLocalUploadPath, verifyLocalUploadSignature } = await import('../utils/signedLocalUpload.js')

    const signed = signLocalUploadPath('/uploads/demo.jpg')
    const url = new URL(signed)
    expect(
      verifyLocalUploadSignature(
        '/uploads/other.jpg',
        url.searchParams.get('exp'),
        url.searchParams.get('sig')
      )
    ).toBe(false)
  })
})
