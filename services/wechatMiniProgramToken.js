const axios = require('axios')
const redisClient = require('../utils/redisClient')

/**
 * 微信小程序 client_credential access_token（带 Redis 缓存）
 */
async function getAccessToken(appid, secret) {
  const cacheKey = `wx:access_token:${appid}`
  const cache = await redisClient.get(cacheKey)
  if (cache) return cache

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`
  const res = await axios.get(url)
  const access_token = res.data.access_token
  const expires_in = res.data.expires_in || 7200
  await redisClient.setEx(cacheKey, expires_in - 60, access_token)
  return access_token
}

module.exports = { getAccessToken }
