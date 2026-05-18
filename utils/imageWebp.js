const sharp = require('sharp')

const MAX_BYTES = 5 * 1024 * 1024
const MAX_DIMENSION = 4096
const MIN_QUALITY = 45

/**
 * 将图片 Buffer 转为 WebP 并压缩到 5MB 以内（与前端 uploadImageToWebpLimit5MB 策略对齐）
 * @param {Buffer} buffer
 * @param {string} baseName 不含扩展名的文件名
 * @returns {Promise<{ buffer: Buffer, mimetype: string, originalname: string, size: number }>}
 */
async function bufferToWebpLimit5MB(buffer, baseName = 'image') {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    const err = new Error('图片数据为空')
    err.code = 'IMAGE_EMPTY'
    throw err
  }

  const safeBase = String(baseName || 'image')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.[^.]+$/, '')

  let pipeline = sharp(buffer, { failOn: 'none' }).rotate()
  const meta = await pipeline.metadata()
  const width = meta.width || 0
  const height = meta.height || 0

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: 'inside',
      withoutEnlargement: true,
    })
  }

  let quality = 85
  let webpBuffer = await pipeline.webp({ quality, effort: 4 }).toBuffer()

  while (webpBuffer.length > MAX_BYTES && quality > MIN_QUALITY) {
    quality -= 10
    webpBuffer = await rebuildWebp(buffer, meta, quality)
  }

  let scale = 0.85
  while (webpBuffer.length > MAX_BYTES && scale >= 0.35) {
    const targetW = Math.max(1, Math.floor((width || 2000) * scale))
    const targetH = Math.max(1, Math.floor((height || 2000) * scale))
    webpBuffer = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize(targetW, targetH, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: Math.max(MIN_QUALITY, quality), effort: 4 })
      .toBuffer()
    scale -= 0.1
  }

  if (webpBuffer.length > MAX_BYTES) {
    const err = new Error('图片压缩后仍超过5MB')
    err.code = 'IMAGE_TOO_LARGE'
    throw err
  }

  return {
    buffer: webpBuffer,
    mimetype: 'image/webp',
    originalname: `${safeBase}.webp`,
    size: webpBuffer.length,
  }
}

async function rebuildWebp(buffer, meta, quality) {
  let p = sharp(buffer, { failOn: 'none' }).rotate()
  const w = meta.width || 0
  const h = meta.height || 0
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
    p = p.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
  }
  return p.webp({ quality, effort: 4 }).toBuffer()
}

module.exports = {
  bufferToWebpLimit5MB,
  MAX_WEBP_BYTES: MAX_BYTES,
}
