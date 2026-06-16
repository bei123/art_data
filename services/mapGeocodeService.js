const crypto = require('crypto')
const axios = require('axios')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')

const TENCENT_GEOCODER_URL = 'https://apis.map.qq.com/ws/geocoder/v1/'
const MAX_ADDRESS_LENGTH = 200
const REDIS_GEOCODE_KEY_PREFIX = 'geocode:addr:'
const REDIS_GEOCODE_TTL_SEC = parseInt(process.env.MAP_GEOCODE_CACHE_TTL_SEC || String(60 * 60 * 24 * 30), 10)

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function normalizeGeocodeAddress(address) {
  return String(address || '').trim().replace(/\s+/g, ' ')
}

function buildGeocodeCacheKey(address) {
  const normalized = normalizeGeocodeAddress(address)
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')
  return `${REDIS_GEOCODE_KEY_PREFIX}${digest}`
}

async function getGeocodeFromCache(address) {
  const normalized = normalizeGeocodeAddress(address)
  if (!normalized) return null

  try {
    const cached = await redisClient.get(buildGeocodeCacheKey(normalized))
    if (!cached) return null

    const parsed = JSON.parse(cached)
    const lat = Number(parsed?.lat)
    const lng = Number(parsed?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

    return { lat, lng }
  } catch (err) {
    logger.warn('读取地理编码缓存失败', { err: err?.message || err })
    return null
  }
}

async function isGeocodeCached(address) {
  const normalized = normalizeGeocodeAddress(address)
  if (!normalized || normalized.length > MAX_ADDRESS_LENGTH) return false

  try {
    const cached = await redisClient.get(buildGeocodeCacheKey(normalized))
    return Boolean(cached)
  } catch {
    return false
  }
}

async function setGeocodeCache(address, lat, lng) {
  const normalized = normalizeGeocodeAddress(address)
  if (!normalized) return

  const ttl = Number.isFinite(REDIS_GEOCODE_TTL_SEC) && REDIS_GEOCODE_TTL_SEC > 0
    ? REDIS_GEOCODE_TTL_SEC
    : 60 * 60 * 24 * 30

  try {
    await redisClient.setEx(
      buildGeocodeCacheKey(normalized),
      ttl,
      JSON.stringify({ lat, lng })
    )
  } catch (err) {
    logger.warn('写入地理编码缓存失败', { err: err?.message || err })
  }
}

async function invalidateGeocodeCache(address) {
  const normalized = normalizeGeocodeAddress(address)
  if (!normalized) return

  try {
    await redisClient.del(buildGeocodeCacheKey(normalized))
  } catch (err) {
    logger.warn('清除地理编码缓存失败', { err: err?.message || err })
  }
}

async function invalidateGeocodeCaches(addresses) {
  const keys = [...new Set(
    (addresses || [])
      .map((addr) => normalizeGeocodeAddress(addr))
      .filter(Boolean)
      .map((normalized) => buildGeocodeCacheKey(normalized))
  )]

  if (!keys.length) return

  try {
    await redisClient.del(keys)
  } catch (err) {
    logger.warn('批量清除地理编码缓存失败', { err: err?.message || err })
  }
}

async function fetchGeocodeFromTencent(address, mapKey) {
  const { data } = await axios.get(TENCENT_GEOCODER_URL, {
    params: {
      address,
      key: String(mapKey).trim(),
      output: 'json',
    },
    timeout: 10000,
  })

  if (data?.status !== 0 || !data?.result?.location) {
    logger.warn('腾讯地理编码失败', {
      status: data?.status,
      message: data?.message,
      address_preview: address.slice(0, 80),
    })
    return null
  }

  const { lat, lng } = data.result.location
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return null
  }

  return { lat: Number(lat), lng: Number(lng) }
}

async function mapGeocode(req) {
  const address = normalizeGeocodeAddress(req.query?.address)
  if (!address) {
    return adminResult(400, { error: '地址不能为空' })
  }
  if (address.length > MAX_ADDRESS_LENGTH) {
    return adminResult(400, { error: `地址长度不能超过${MAX_ADDRESS_LENGTH}个字符` })
  }

  const cached = await getGeocodeFromCache(address)
  if (cached) {
    return adminResult(200, cached)
  }

  const mapKey = process.env.TENCENT_MAP_KEY
  if (!mapKey || !String(mapKey).trim()) {
    logger.error('TENCENT_MAP_KEY 未配置')
    return adminResult(500, { error: '地图服务未配置' })
  }

  try {
    const coords = await fetchGeocodeFromTencent(address, mapKey)
    if (!coords) {
      return adminResult(400, { error: '地址解析失败' })
    }

    await setGeocodeCache(address, coords.lat, coords.lng)
    return adminResult(200, coords)
  } catch (err) {
    logger.error('腾讯地理编码请求失败', { err: err?.message || err })
    return adminResult(500, { error: '地址解析失败' })
  }
}

module.exports = {
  mapGeocode,
  normalizeGeocodeAddress,
  buildGeocodeCacheKey,
  getGeocodeFromCache,
  isGeocodeCached,
  setGeocodeCache,
  invalidateGeocodeCache,
  invalidateGeocodeCaches,
  MAX_ADDRESS_LENGTH,
}
