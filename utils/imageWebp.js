const sharp = require('sharp')

const MAX_BYTES = 5 * 1024 * 1024
const MAX_DIMENSION = 4096
const MIN_QUALITY = 45
const DEFAULT_QUALITY_STEPS = [85, 75, 65, 55, MIN_QUALITY]
const DEFAULT_SCALE_STEPS = [1, 0.85, 0.7, 0.55, 0.4]

/**
 * @param {number} startQuality
 * @returns {number[]}
 */
function buildQualityStepsFromStart(startQuality) {
  const start = Math.min(100, Math.max(MIN_QUALITY, Number(startQuality) || 85))
  const steps = [start]
  for (const drop of [8, 10, 10, 10, 10]) {
    const next = steps[steps.length - 1] - drop
    if (next >= MIN_QUALITY && !steps.includes(next)) steps.push(next)
  }
  if (steps[steps.length - 1] > MIN_QUALITY) steps.push(MIN_QUALITY)
  return steps
}

/**
 * 将图片 Buffer 转为 WebP 并压缩到 5MB 以内（与前端 uploadImageToWebpLimit5MB 策略对齐）
 * 直接 WebP 编码，避免 JPEG→PNG→WebP 二次有损。
 * @param {Buffer} buffer
 * @param {string} baseName 不含扩展名的文件名
 * @param {{ qualitySteps?: number[], scaleSteps?: number[], webpEffort?: number }} [options]
 * @returns {Promise<{ buffer: Buffer, mimetype: string, originalname: string, size: number }>}
 */
async function bufferToWebpLimit5MB(buffer, baseName = 'image', options = {}) {
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    const err = new Error('图片数据为空')
    err.code = 'IMAGE_EMPTY'
    throw err
  }

  const safeBase = String(baseName || 'image')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\.[^.]+$/, '')

  const qualitySteps = options.qualitySteps?.length
    ? options.qualitySteps
    : DEFAULT_QUALITY_STEPS
  const scaleSteps = options.scaleSteps?.length ? options.scaleSteps : DEFAULT_SCALE_STEPS
  const webpEffort = Math.min(6, Math.max(0, Number(options.webpEffort) ?? 4))

  const meta = await sharp(buffer, { failOn: 'none' }).metadata()
  const srcW = meta.width || 0
  const srcH = meta.height || 0

  for (const scale of scaleSteps) {
    for (const quality of qualitySteps) {
      const webpBuffer = await encodeWebpAtScale(buffer, srcW, srcH, scale, quality, webpEffort)
      if (webpBuffer.length <= MAX_BYTES) {
        return {
          buffer: webpBuffer,
          mimetype: 'image/webp',
          originalname: `${safeBase}.webp`,
          size: webpBuffer.length,
        }
      }
    }
  }

  const err = new Error('图片压缩后仍超过5MB')
  err.code = 'IMAGE_TOO_LARGE'
  throw err
}

async function encodeWebpAtScale(buffer, srcW, srcH, scale, quality, webpEffort) {
  let pipeline = sharp(buffer, { failOn: 'none' }).rotate()
  const s = scale < 1 ? scale : 1
  let targetW = srcW
  let targetH = srcH
  if (s < 1 && srcW && srcH) {
    targetW = Math.max(1, Math.floor(srcW * s))
    targetH = Math.max(1, Math.floor(srcH * s))
  }
  const needsResize =
    srcW > MAX_DIMENSION ||
    srcH > MAX_DIMENSION ||
    (s < 1 && srcW && srcH)

  if (needsResize) {
    const fitW = Math.min(MAX_DIMENSION, targetW || MAX_DIMENSION)
    const fitH = Math.min(MAX_DIMENSION, targetH || MAX_DIMENSION)
    pipeline = pipeline.resize(fitW, fitH, { fit: 'inside', withoutEnlargement: true })
  }

  return pipeline.webp({ quality, effort: webpEffort }).toBuffer()
}

module.exports = {
  bufferToWebpLimit5MB,
  buildQualityStepsFromStart,
  MAX_WEBP_BYTES: MAX_BYTES,
}
