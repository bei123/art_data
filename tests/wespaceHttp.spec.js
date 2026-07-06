import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  isWespaceTlsInsecure,
  getWespaceHttpsAgent,
  withWespaceTls,
} from '../utils/wespaceHttp.js'

describe('wespaceHttp', () => {
  const envBackup = { ...process.env }

  afterEach(() => {
    process.env = { ...envBackup }
  })

  it('does not attach httpsAgent by default', async () => {
    delete process.env.WESPACE_NODE_TLS_INSECURE
    delete process.env.EXTERNAL_API_TLS_INSECURE
    vi.resetModules()
    const mod = await import('../utils/wespaceHttp.js')
    expect(mod.isWespaceTlsInsecure()).toBe(false)
    expect(mod.withWespaceTls({ timeout: 1000 })).toEqual({ timeout: 1000 })
  })

  it('attaches httpsAgent when WESPACE_NODE_TLS_INSECURE=true', async () => {
    process.env.WESPACE_NODE_TLS_INSECURE = 'true'
    vi.resetModules()
    const mod = await import('../utils/wespaceHttp.js')
    expect(mod.isWespaceTlsInsecure()).toBe(true)
    expect(mod.getWespaceHttpsAgent()).toBeTruthy()
    expect(mod.withWespaceTls({}).httpsAgent).toBeTruthy()
  })
})
