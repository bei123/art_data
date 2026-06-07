import { describe, it, expect } from 'vitest'
import {
  isPrivateOrReservedIp,
  isHostnameAllowed,
  validateProxyTargetUrl,
} from '../utils/proxyUrlPolicy.js'

describe('proxyUrlPolicy', () => {
  describe('isPrivateOrReservedIp', () => {
    it('blocks loopback and RFC1918', () => {
      expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true)
      expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true)
      expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true)
      expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true)
    })

    it('allows public IPv4', () => {
      expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false)
    })
  })

  describe('isHostnameAllowed', () => {
    it('allows wespace hosts and subdomains', () => {
      expect(isHostnameAllowed('m.wespace.cn')).toBe(true)
      expect(isHostnameAllowed('node.wespace.cn')).toBe(true)
    })

    it('rejects IP literals and unknown hosts', () => {
      expect(isHostnameAllowed('127.0.0.1')).toBe(false)
      expect(isHostnameAllowed('evil.com')).toBe(false)
      expect(isHostnameAllowed('169.254.169.254')).toBe(false)
    })
  })

  describe('validateProxyTargetUrl', () => {
    it('accepts whitelisted https URL', () => {
      const r = validateProxyTargetUrl('https://m.wespace.cn/CCN1008/#/pages/trade')
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.hostname).toBe('m.wespace.cn')
    })

    it('rejects internal-looking hostnames', () => {
      expect(validateProxyTargetUrl('http://127.0.0.1/admin').ok).toBe(false)
      expect(validateProxyTargetUrl('http://localhost/').ok).toBe(false)
      expect(validateProxyTargetUrl('https://evil.com/').ok).toBe(false)
    })

    it('rejects non-http(s) and credentials in URL', () => {
      expect(validateProxyTargetUrl('file:///etc/passwd').ok).toBe(false)
      expect(validateProxyTargetUrl('https://user:pass@m.wespace.cn/').ok).toBe(false)
    })

    it('rejects non-standard ports', () => {
      expect(validateProxyTargetUrl('https://m.wespace.cn:8080/').ok).toBe(false)
    })
  })
})
