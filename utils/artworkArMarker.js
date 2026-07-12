const { OSS_PUBLIC_HOST, OSS_PUBLIC_ORIGIN } = require('../config/publicEnv')

const DEFAULT_MARKER_URL =
  process.env.AR_MARKER_DEFAULT_URL ||
  'https://mmbizwxaminiprogram-1258344707.cos.ap-guangzhou.myqcloud.com/xr-frame/demo/marker/2dmarker-test.jpg'

const MARKER_PAD_WIDTH = Math.max(400, Number(process.env.AR_MARKER_PAD_WIDTH) || 600)
const MARKER_PAD_HEIGHT = Math.max(500, Number(process.env.AR_MARKER_PAD_HEIGHT) || 800)
const MARKER_LIVE_MAX_WIDTH = Math.max(480, Number(process.env.AR_MARKER_LIVE_MAX_WIDTH) || 1280)
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

function buildOssMarkerUrl(imageUrl, processParts) {
  if (!imageUrl || typeof imageUrl !== 'string') return DEFAULT_MARKER_URL

  if (!isAliyunOssUrl(imageUrl)) {
    const base = stripOssProcess(imageUrl)
    return base || imageUrl
  }

  const base = stripOssProcess(imageUrl)
  const process = ['x-oss-process=image', ...processParts].join('/')
  return `${base}?${process}`
}

/**
 * 实景扫描标记图：无白边，比例与原作一致，便于对准墙上真画识别
 */
function buildArtworkMarkerLiveUrl(imageUrl) {
  return buildOssMarkerUrl(imageUrl, [
    `resize,w_${MARKER_LIVE_MAX_WIDTH},m_lfit`,
    `quality,q_${MARKER_QUALITY}`,
    'format,jpg',
  ])
}

/**
 * 打印标记图：白边卡片，适合 A4/A5 打印或手机展示
 */
function buildArtworkMarkerPrintUrl(imageUrl) {
  return buildOssMarkerUrl(imageUrl, [
    `resize,w_${MARKER_PAD_WIDTH},h_${MARKER_PAD_HEIGHT},m_pad,color_FFFFFF`,
    `quality,q_${MARKER_QUALITY}`,
    'format,jpg',
  ])
}

/** @deprecated 默认返回实景扫描图 */
function buildArtworkMarkerUrl(imageUrl) {
  return buildArtworkMarkerLiveUrl(imageUrl)
}

module.exports = {
  buildArtworkMarkerUrl,
  buildArtworkMarkerLiveUrl,
  buildArtworkMarkerPrintUrl,
  DEFAULT_MARKER_URL,
  stripOssProcess,
}
