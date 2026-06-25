import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import express from 'express'

const require = createRequire(import.meta.url)
const auth = require('../auth')

describe('admin route mount (Express 5)', () => {
  it('registers admin prefix middleware without path-to-regexp error', () => {
    const app = express()
    const adminReferralRouter = require('../routes/adminReferral')
    expect(() => {
      app.use('/api/admin', auth.authenticateToken, auth.checkRole(['admin']))
      app.use('/api/admin/referral', adminReferralRouter)
    }).not.toThrow()
  })

  it('rejects legacy /api/admin/* wildcard mount', () => {
    const app = express()
    expect(() => {
      app.use('/api/admin/*', auth.authenticateToken, auth.checkRole(['admin']))
    }).toThrow(/Missing parameter name/)
  })
})

describe('uploadIdcard auth binding', () => {
  it('uses session userId instead of body userId', async () => {
    const wxService = require('../services/wxService')
    const req = {
      headers: {},
      files: {},
      body: { userId: '99999' },
    }
    const result = await wxService.uploadIdcard(req)
    expect(result.status).toBe(401)
    expect(result.body?.message || result.body?.error).toMatch(/登录|token/i)
  })
})
