const path = require('path')

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads')

function toUploadRelativePath(input) {
  if (!input || typeof input !== 'string') return null

  let value = input.trim()
  if (!value) return null

  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      value = new URL(value).pathname
    }
  } catch {
    return null
  }

  if (!value.startsWith('/uploads/')) return null

  const relative = value.slice('/uploads/'.length)
  if (!relative || relative.includes('\0')) return null

  const segments = relative.split('/').filter(Boolean)
  if (segments.some((seg) => seg === '..' || seg === '.')) return null

  return `/uploads/${segments.join('/')}`
}

function resolveSafeUploadFile(relativePath) {
  const normalized = toUploadRelativePath(relativePath)
  if (!normalized) return { ok: false, status: 400, message: '无效的上传路径' }

  const relativeFromRoot = normalized.slice('/uploads/'.length)
  const absolute = path.resolve(UPLOADS_ROOT, relativeFromRoot)
  const rootWithSep = `${UPLOADS_ROOT}${path.sep}`

  if (absolute !== UPLOADS_ROOT && !absolute.startsWith(rootWithSep)) {
    return { ok: false, status: 403, message: '禁止访问该路径' }
  }

  return { ok: true, normalized, absolute }
}

module.exports = {
  UPLOADS_ROOT,
  toUploadRelativePath,
  resolveSafeUploadFile,
}
