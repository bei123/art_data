const axios = require('axios')
const redisClient = require('../utils/redisClient')
const logger = require('../utils/logger')

const inflightAccessToken = new Map()
const inflightApiTicket = new Map()

function getOaCredentials() {
  const appid = String(process.env.WECHAT_OA_APPID || '').trim()
  const secret = String(process.env.WECHAT_OA_SECRET || '').trim()
  if (!appid || !secret) {
    const err = new Error('缺少 WECHAT_OA_APPID 或 WECHAT_OA_SECRET')
    err.code = 'OA_CREDENTIALS_MISSING'
    throw err
  }
  return { appid, secret }
}

function isWxCardSyncEnabled() {
  const raw = String(process.env.WX_CARD_SYNC_ENABLED ?? 'true').trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no'
}

function isOaCallbackEnabled() {
  const raw = String(process.env.WECHAT_OA_CALLBACK_ENABLED ?? 'true').trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no'
}

function getOaCallbackConfig() {
  const appid = String(process.env.WECHAT_OA_APPID || '').trim()
  const token = String(process.env.WECHAT_OA_TOKEN || '').trim()
  const aesKey = String(process.env.WECHAT_OA_AES_KEY || '').trim()
  return {
    appid,
    token,
    aesKey,
    enabled: isOaCallbackEnabled(),
    configured: Boolean(appid && token),
  }
}

async function fetchAccessToken(appid, secret) {
  const url = 'https://api.weixin.qq.com/cgi-bin/token'
  const res = await axios.get(url, {
    params: {
      grant_type: 'client_credential',
      appid,
      secret,
    },
    timeout: 10000,
  })

  const accessToken = res.data?.access_token
  if (!accessToken) {
    const err = new Error(res.data?.errmsg || '获取服务号 access_token 失败')
    err.code = 'OA_ACCESS_TOKEN_FAILED'
    err.wx = res.data
    throw err
  }

  const expiresIn = Number(res.data.expires_in) || 7200
  const ttl = Math.max(60, expiresIn - 120)
  const cacheKey = `wx:oa:access_token:${appid}`
  try {
    await redisClient.setEx(cacheKey, ttl, accessToken)
  } catch (err) {
    logger.warn('缓存服务号 access_token 失败', { err: err.message })
  }

  return accessToken
}

/**
 * 服务号 client_credential access_token（Redis 缓存 + 单飞）
 */
async function getOaAccessToken(forceRefresh = false) {
  const { appid, secret } = getOaCredentials()
  const cacheKey = `wx:oa:access_token:${appid}`

  if (!forceRefresh) {
    try {
      const cached = await redisClient.get(cacheKey)
      if (cached) return cached
    } catch (err) {
      logger.warn('读取服务号 access_token 缓存失败', { err: err.message })
    }
  }

  if (inflightAccessToken.has(appid)) {
    return inflightAccessToken.get(appid)
  }

  const promise = fetchAccessToken(appid, secret).finally(() => {
    inflightAccessToken.delete(appid)
  })
  inflightAccessToken.set(appid, promise)
  return promise
}

async function fetchApiTicket(accessToken, appid) {
  const url = 'https://api.weixin.qq.com/cgi-bin/ticket/getticket'
  const res = await axios.get(url, {
    params: {
      access_token: accessToken,
      type: 'wx_card',
    },
    timeout: 10000,
  })

  if (Number(res.data?.errcode) !== 0 || !res.data?.ticket) {
    const err = new Error(res.data?.errmsg || '获取卡券 api_ticket 失败')
    err.code = 'OA_API_TICKET_FAILED'
    err.wx = res.data
    throw err
  }

  const ticket = res.data.ticket
  const expiresIn = Number(res.data.expires_in) || 7200
  const ttl = Math.max(60, expiresIn - 120)
  const cacheKey = `wx:oa:api_ticket:${appid}`
  try {
    await redisClient.setEx(cacheKey, ttl, ticket)
  } catch (err) {
    logger.warn('缓存卡券 api_ticket 失败', { err: err.message })
  }

  return ticket
}

/**
 * 卡券 api_ticket（须用服务号 token；Redis 缓存 + 单飞）
 */
async function getOaApiTicket(forceRefresh = false) {
  const { appid } = getOaCredentials()
  const cacheKey = `wx:oa:api_ticket:${appid}`

  if (!forceRefresh) {
    try {
      const cached = await redisClient.get(cacheKey)
      if (cached) return cached
    } catch (err) {
      logger.warn('读取卡券 api_ticket 缓存失败', { err: err.message })
    }
  }

  if (inflightApiTicket.has(appid)) {
    return inflightApiTicket.get(appid)
  }

  const promise = (async () => {
    let accessToken = await getOaAccessToken(forceRefresh)
    try {
      return await fetchApiTicket(accessToken, appid)
    } catch (err) {
      // token 失效时强制刷新一次
      if (err?.wx?.errcode === 40001 || err?.wx?.errcode === 42001) {
        accessToken = await getOaAccessToken(true)
        return fetchApiTicket(accessToken, appid)
      }
      throw err
    }
  })().finally(() => {
    inflightApiTicket.delete(appid)
  })

  inflightApiTicket.set(appid, promise)
  return promise
}

module.exports = {
  getOaCredentials,
  getOaCallbackConfig,
  isWxCardSyncEnabled,
  isOaCallbackEnabled,
  getOaAccessToken,
  getOaApiTicket,
}
