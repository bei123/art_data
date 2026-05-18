const sharp = require('sharp')

const MAX_BYTES = 5 * 1024 * 1024
const MAX_DIMENSION = 4096
const MIN_QUALITY = 45

/**
 * 将图片 Buffer 转为 WebP 并压缩到 5MB 以内（与前端 uploadImageToWebpLimit5MB 策略对齐）
 * 先单次旋转+缩放到上限，再在同一中间结果上迭代质量，避免多次全图解码。
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

  const meta = await sharp(buffer, { failOn: 'none' }).metadata()
  const srcW = meta.width || 0
  const srcH = meta.height || 0

  const scaleSteps = [1, 0.85, 0.7, 0.55, 0.4]
  const qualitySteps = [85, 75, 65, 55, MIN_QUALITY]

  for (const scale of scaleSteps) {
    let normalized = await normalizeImageBuffer(buffer, srcW, srcH, scale)
    for (const quality of qualitySteps) {
      const webpBuffer = await sharp(normalized).webp({ quality, effort: 3 }).toBuffer()
      if (webpBuffer.length <= MAX_BYTES) {
        return {
          buffer: webpBuffer,
          mimetype: 'image/webp',
          originalname: `${safeBase}.webp`,
          size: webpBuffer.length,
        }
      }
    }
    normalized = null
  }

  const err = new Error('图片压缩后仍超过5MB')
  err.code = 'IMAGE_TOO_LARGE'
  throw err
}

async function normalizeImageBuffer(buffer, srcW, srcH, scale) {
  let p = sharp(buffer, { failOn: 'none' }).rotate()
  const s = scale < 1 ? scale : 1
  let targetW = srcW
  let targetH = srcH
  if (s < 1 && srcW && srcH) {
    targetW = Math.max(1, Math.floor(srcW * s))
    targetH = Math.max(1, Math.floor(srcH * s))
  }
  const needsResize =
    (srcW > MAX_DIMENSION || srcH > MAX_DIMENSION) ||
    (s < 1 && srcW && srcH)

  if (needsResize) {
    const fitW = Math.min(MAX_DIMENSION, targetW || MAX_DIMENSION)
    const fitH = Math.min(MAX_DIMENSION, targetH || MAX_DIMENSION)
    p = p.resize(fitW, fitH, { fit: 'inside', withoutEnlargement: true })
  }

  return p.png({ compressionLevel: 6 }).toBuffer()
}

module.exports = {
  bufferToWebpLimit5MB,
  MAX_WEBP_BYTES: MAX_BYTES,
}
