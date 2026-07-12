const { OSS_PUBLIC_HOST, OSS_PUBLIC_ORIGIN } = require('../config/publicEnv')

const DEFAULT_MARKER_URL =
  process.env.AR_MARKER_DEFAULT_URL ||
  'https://mmbizwxaminiprogram-1258344707.cos.ap-guangzhou.myqcloud.com/xr-frame/demo/marker/2dmarker-test.jpg'

const MARKER_PAD_WIDTH = Math.max(400, Number(process.env.AR_MARKER_PAD_WIDTH) || 600)
const MARKER_PAD_HEIGHT = Math.max(500, Number(process.env.AR_MARKER_PAD_HEIGHT) || 800)
const MARKER_QUALITY = Math.min(100, Math.max(60, Number(process.env.AR_MARKER_QUALITY) || 90))

function isAliyunOssUrl(url) {
  if (!url || typeof url !== 'string') return false
  if (url.startsWith(`${OSS_PUBLIC_ORIGIN}/`)) return true
  try {
    const host = new URL(url).hostname
    if (host === OSS_PUBLIC_HOST) return true
    return /\.aliyuncs\.com$/i.test(host)
  } catch {
    return false
  }
}

function stripOssProcess(url) {
  if (!url || typeof url !== 'string') return ''
  return url.replace(/[?&]x-oss-process=[^&]*/gi, '').replace(/\?$/, '')
}

/**
 * 为作品生成可打印/识别的标记图 URL（OSS 白边卡片，便于贴墙识别）
 * 非 OSS 图回退通用 demo 标记图。
 */
function buildArtworkMarkerUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return DEFAULT_MARKER_URL

  if (!isAliyunOssUrl(imageUrl)) {
    const base = stripOssProcess(imageUrl)
    return base || imageUrl
  }

  const base = stripOssProcess(imageUrl)
  const process = [
    'x-oss-process=image',
    `resize,w_${MARKER_PAD_WIDTH},h_${MARKER_PAD_HEIGHT},m_pad,color_FFFFFF`,
    `quality,q_${MARKER_QUALITY}`,
    'format,jpg',
  ].join('/')

  return `${base}?${process}`
}

module.exports = {
  buildArtworkMarkerUrl,
  DEFAULT_MARKER_URL,
  stripOssProcess,
}
