const fs = require('fs')
const path = require('path')
const { extractBearerToken, verifyActiveSessionToken } = require('../utils/sessionAuth')
const { verifyUrlAccessToken } = require('../utils/urlAccessToken')
const { resolveSafeUploadFile, toUploadRelativePath } = require('../utils/localUploadPath')
const { verifyLocalUploadSignature } = require('../utils/signedLocalUpload')
const logger = require('../utils/logger')

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
}

function resolveContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

async function isAuthorizedLocalUpload(req, relativePath) {
  const { exp, sig, access } = req.query || {}

  if (verifyLocalUploadSignature(relativePath, exp, sig)) {
    return true
  }

  if (access) {
    const verified = await verifyUrlAccessToken(String(access), {
      purpose: 'local_upload',
      claims: { filePath: relativePath },
    })
    if (verified.ok) return true
  }

  const bearer = extractBearerToken(req.headers.authorization)
  if (!bearer) return false

  const verified = await verifyActiveSessionToken(bearer)
  if (!verified.ok) return false

  const { query } = require('../db')
  const [users] = await query('SELECT role FROM users WHERE id = ?', [verified.userId])
  if (users.length > 0 && users[0].role === 'admin') return true

  return false
}

async function serveLocalUpload(req, res) {
  const requestPath = `/uploads${req.path === '/' ? '' : req.path}`
  const relativePath = toUploadRelativePath(requestPath)
  if (!relativePath) {
    return res.status(400).json({ error: '无效的上传路径' })
  }

  try {
    const authorized = await isAuthorizedLocalUpload(req, relativePath)
    if (!authorized) {
      return res.status(401).json({ error: '无权访问该文件' })
    }

    const resolved = resolveSafeUploadFile(relativePath)
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.message })
    }

    if (!fs.existsSync(resolved.absolute) || !fs.statSync(resolved.absolute).isFile()) {
      return res.status(404).json({ error: '文件不存在' })
    }

    res.setHeader('Content-Type', resolveContentType(resolved.absolute))
    res.setHeader('Cache-Control', 'private, max-age=300')
    return res.sendFile(resolved.absolute)
  } catch (error) {
    logger.error('serveLocalUpload', { err: error, path: relativePath })
    return res.status(500).json({ error: '文件读取失败' })
  }
}

module.exports = {
  serveLocalUpload,
}
