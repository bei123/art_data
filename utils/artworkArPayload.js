const { OSS_PUBLIC_HOST, OSS_PUBLIC_ORIGIN } = require('../config/publicEnv')
const {
  resolveArtworkShippingGoods,
  getDefaultArtworkThicknessCm,
} = require('./artworkShippingDimensions')

const { buildArtworkMarkerUrl, DEFAULT_MARKER_URL } = require('./artworkArMarker')

const MARKER_REF_WIDTH_M = 0.21
const AR_TEXTURE_MAX_WIDTH = Math.max(512, Number(process.env.AR_TEXTURE_MAX_WIDTH) || 2048)
const AR_TEXTURE_QUALITY = Math.min(100, Math.max(60, Number(process.env.AR_TEXTURE_QUALITY) || 85))

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

function appendOssProcess(url, processParam) {
  if (!url || !processParam) return url
  if (/x-oss-process=/i.test(url)) return url
  return url.includes('?') ? `${url}&${processParam}` : `${url}?${processParam}`
}

function buildArTextureUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return ''

  const process = `x-oss-process=image/resize,w_${AR_TEXTURE_MAX_WIDTH},m_lfit/quality,q_${AR_TEXTURE_QUALITY}/format,jpg`

  if (isAliyunOssUrl(imageUrl)) {
    return appendOssProcess(imageUrl, process)
  }

  return imageUrl
}

/**
 * 与小程序 resolveArDimensions 一致：collection_size 第一段为宽，第二段为高。
 * 后端 shipping 字段 length_cm 对应第一段，width_cm 对应第二段。
 */
function resolveArDimensionsMeters(artwork) {
  const goods = resolveArtworkShippingGoods({
    collection_size: artwork?.collection_size,
    length_cm: artwork?.length_cm,
    width_cm: artwork?.width_cm,
    height_cm: artwork?.height_cm,
  })

  const widthCm = goods.length_cm
  const heightCm = goods.width_cm

  if (!widthCm || !heightCm || widthCm <= 0 || heightCm <= 0) {
    return { widthM: null, heightM: null, frameDepthM: null }
  }

  let frameDepthM = null
  if (goods.height_cm && goods.height_cm > 0) {
    frameDepthM = goods.height_cm / 100
  } else {
    frameDepthM = getDefaultArtworkThicknessCm() / 100
  }

  return {
    widthM: widthCm / 100,
    heightM: heightCm / 100,
    frameDepthM,
  }
}

/**
 * 构建原作详情接口中的 ar 字段（Week 2）
 * @param {object} artwork - 含 image、collection_size、length_cm 等
 */
function buildArtworkArPayload(artwork) {
  const image = artwork?.image
  const textureUrl = image ? buildArTextureUrl(image) : ''
  const dims = resolveArDimensionsMeters(artwork)
  const { widthM, heightM, frameDepthM } = dims

  const enabled = !!(textureUrl && widthM && heightM)

  const markerUrl = image ? buildArtworkMarkerUrl(image) : DEFAULT_MARKER_URL

  return {
    enabled,
    texture_url: textureUrl,
    marker_url: markerUrl,
    width_m: widthM,
    height_m: heightM,
    aspect_ratio: widthM && heightM ? widthM / heightM : null,
    frame_depth_m: frameDepthM,
    marker_ref_width_m: MARKER_REF_WIDTH_M,
    size_text: artwork?.collection_size || null,
    suggested_mode: 'plane-wall',
    suggested_modes: {
      ios: 'plane-wall',
      android: 'desk-preview',
      fallback: 'marker-wall',
    },
    marker_is_custom: !!image,
  }
}

module.exports = {
  buildArTextureUrl,
  buildArtworkArPayload,
  resolveArDimensionsMeters,
  buildArtworkMarkerUrl,
  DEFAULT_MARKER_URL,
  MARKER_REF_WIDTH_M,
}
