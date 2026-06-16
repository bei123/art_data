const axios = require('axios')
const logger = require('../utils/logger')

const TENCENT_GEOCODER_URL = 'https://apis.map.qq.com/ws/geocoder/v1/'
const MAX_ADDRESS_LENGTH = 200

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

async function mapGeocode(req) {
  const address = String(req.query?.address || '').trim()
  if (!address) {
    return adminResult(400, { error: '地址不能为空' })
  }
  if (address.length > MAX_ADDRESS_LENGTH) {
    return adminResult(400, { error: `地址长度不能超过${MAX_ADDRESS_LENGTH}个字符` })
  }

  const key = process.env.TENCENT_MAP_KEY
  if (!key || !String(key).trim()) {
    logger.error('TENCENT_MAP_KEY 未配置')
    return adminResult(500, { error: '地图服务未配置' })
  }

  try {
    const { data } = await axios.get(TENCENT_GEOCODER_URL, {
      params: {
        address,
        key: String(key).trim(),
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
      return adminResult(400, { error: '地址解析失败' })
    }

    const { lat, lng } = data.result.location
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      return adminResult(400, { error: '地址解析失败' })
    }

    return adminResult(200, { lat, lng })
  } catch (err) {
    logger.error('腾讯地理编码请求失败', { err: err?.message || err })
    return adminResult(500, { error: '地址解析失败' })
  }
}

module.exports = {
  mapGeocode,
  MAX_ADDRESS_LENGTH,
}
