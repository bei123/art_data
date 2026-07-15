const crypto = require('crypto')
const axios = require('axios')
const logger = require('../utils/logger')
const { enrichSfErrorResult } = require('./sfExpressErrorCodes')

const SERVICE_CODE = {
  CREATE_ORDER: 'EXP_RECE_CREATE_ORDER',
  UPDATE_ORDER: 'EXP_RECE_UPDATE_ORDER',
  SEARCH_ORDER: 'EXP_RECE_SEARCH_ORDER_RESP',
  SEARCH_ROUTES: 'EXP_RECE_SEARCH_ROUTES',
  QUERY_DELIVERTM: 'EXP_RECE_QUERY_DELIVERTM',
  CLOUD_PRINT_HTML: 'COM_RECE_CLOUD_PRINT_HTML',
}

const API_RESULT_OK = 'A1000'
const BIZ_RESULT_OK = 'S0000'

/** 顺丰统一接入平台地址（仅 HTTPS，POST form-urlencoded） */
const SF_API_URL_PRODUCTION = 'https://bspgw.sf-express.com/std/service'
const SF_API_URL_SANDBOX = 'https://sfapi-sbox.sf-express.com/std/service'
const SF_OAUTH_URL_PRODUCTION = 'https://sfapi.sf-express.com/oauth2/accessToken'
const SF_OAUTH_URL_SANDBOX = 'https://sfapi-sbox.sf-express.com/oauth2/accessToken'
const DEFAULT_BASE_URL = SF_API_URL_SANDBOX

let oauthTokenCache = { token: '', expiresAt: 0 }

function resolveSfAuthMode({ accessToken, oauthSecret, useOAuth }) {
  if (accessToken) return 'oauth2-static'
  if (useOAuth || oauthSecret) return 'oauth2-fetch'
  return 'md5'
}

function getSfConfig() {
  const accessToken = (process.env.SF_ACCESS_TOKEN || '').trim()
  const oauthSecret = (process.env.SF_OAUTH_SECRET || '').trim()
  const useOAuth = String(process.env.SF_USE_OAUTH || '').trim().toLowerCase() === 'true'
  const baseUrl = (process.env.SF_API_BASE_URL || DEFAULT_BASE_URL).trim()
  return {
    partnerId: (process.env.SF_PARTNER_ID || '').trim(),
    checkWord: (process.env.SF_CHECK_WORD || '').trim(),
    accessToken,
    oauthSecret,
    useOAuth,
    authMode: resolveSfAuthMode({ accessToken, oauthSecret, useOAuth }),
    baseUrl,
    monthlyCard: (process.env.SF_MONTHLY_CARD || '').trim(),
    defaultExpressTypeId: parseInt(process.env.SF_DEFAULT_EXPRESS_TYPE_ID || '1', 10),
    isSandbox: baseUrl.includes('sbox'),
  }
}

function assertSfConfig() {
  const cfg = getSfConfig()
  if (!cfg.partnerId) {
    return {
      ok: false,
      error: '缺少 SF_PARTNER_ID（顾客编码 CustomerCode，顺丰开放平台获取）',
    }
  }
  if (cfg.authMode === 'oauth2-static' || cfg.authMode === 'oauth2-fetch') return { ok: true, cfg }
  if (!cfg.checkWord) {
    return {
      ok: false,
      error: '缺少 SF_CHECK_WORD（MD5 鉴权）、SF_OAUTH_SECRET/SF_USE_OAUTH=true（OAuth2）或 SF_ACCESS_TOKEN',
    }
  }
  return { ok: true, cfg }
}

function buildRequestId() {
  return crypto.randomUUID()
}

/** 与 Java URLEncoder.encode(UTF-8) 对齐 */
function sfUrlEncode(text) {
  return encodeURIComponent(text).replace(/%20/g, '+')
}

/**
 * 标准 MD5 鉴权：URLEncode(msgData + timestamp + checkWord) → MD5 → Base64
 */
function buildMsgDigest(msgData, timestamp, checkWord) {
  // SF Express Open Platform MD5 digest contract (not local password storage).
  const toVerifyText = sfUrlEncode(`${msgData}${timestamp}${checkWord}`)
  // codeql[js/weak-cryptographic-algorithm]
  return crypto.createHash('md5').update(toVerifyText, 'utf8').digest('base64')
}

function getOAuthTokenUrl(baseUrl) {
  return String(baseUrl).includes('sbox') ? SF_OAUTH_URL_SANDBOX : SF_OAUTH_URL_PRODUCTION
}

function resetSfOAuthTokenCache() {
  oauthTokenCache = { token: '', expiresAt: 0 }
}

async function fetchSfOAuthAccessToken(cfg) {
  const secret = cfg.oauthSecret || cfg.checkWord
  if (!secret) {
    return { ok: false, error: 'OAuth2 需要 SF_OAUTH_SECRET 或 SF_CHECK_WORD（应用校验码）' }
  }

  const form = new URLSearchParams()
  form.set('partnerID', cfg.partnerId)
  form.set('secret', secret)
  form.set('grantType', 'password')

  try {
    const { data } = await axios.post(getOAuthTokenUrl(cfg.baseUrl), form.toString(), {
      timeout: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      responseType: 'json',
    })

    const token = data?.accessToken != null ? String(data.accessToken).trim() : ''
    if (!token) {
      return {
        ok: false,
        error: data?.apiErrorMsg || data?.errorMsg || 'OAuth2 获取 accessToken 失败',
        oauth_response: data,
      }
    }

    const expiresInSec = Number(data.expiresIn) > 0 ? Number(data.expiresIn) : 7200
    oauthTokenCache = {
      token,
      expiresAt: Date.now() + expiresInSec * 1000,
    }
    return { ok: true, accessToken: token, expiresIn: expiresInSec }
  } catch (err) {
    return {
      ok: false,
      error: 'OAuth2 请求失败',
      detail: err?.response?.data || err?.message || String(err),
    }
  }
}

async function resolveSfAccessToken(cfg) {
  if (cfg.authMode === 'oauth2-static') return { ok: true, accessToken: cfg.accessToken }
  if (cfg.authMode !== 'oauth2-fetch') return { ok: true, accessToken: null }

  const now = Date.now()
  if (oauthTokenCache.token && oauthTokenCache.expiresAt > now + 60_000) {
    return { ok: true, accessToken: oauthTokenCache.token, cached: true }
  }

  return fetchSfOAuthAccessToken(cfg)
}

function parseApiEnvelope(data) {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: '顺丰接口返回非 JSON', raw: data }
  }
  if (String(data.apiResultCode) !== API_RESULT_OK) {
    return enrichSfErrorResult({
      ok: false,
      error: data.apiErrorMsg || `顺丰平台错误（${data.apiResultCode || 'unknown'}）`,
      apiResultCode: data.apiResultCode,
      apiErrorMsg: data.apiErrorMsg,
      apiResponseID: data.apiResponseID,
    })
  }

  let biz = null
  if (data.apiResultData != null && String(data.apiResultData).trim() !== '') {
    try {
      biz = typeof data.apiResultData === 'object'
        ? data.apiResultData
        : JSON.parse(data.apiResultData)
    } catch (err) {
      return {
        ok: false,
        error: '顺丰业务报文解析失败',
        apiResponseID: data.apiResponseID,
        detail: err.message,
      }
    }
  }

  if (!biz || typeof biz !== 'object') {
    return {
      ok: false,
      error: '顺丰未返回业务数据',
      apiResponseID: data.apiResponseID,
    }
  }

  if (biz.success === false) {
    return enrichSfErrorResult({
      ok: false,
      error: biz.errorMessage || biz.errorMsg || '顺丰业务处理失败',
      errorCode: biz.errorCode,
      apiResultCode: API_RESULT_OK,
      apiResponseID: data.apiResponseID,
      biz,
    })
  }

  const bizCode = biz.errorCode != null ? String(biz.errorCode).trim() : ''
  if (bizCode && bizCode !== BIZ_RESULT_OK) {
    return enrichSfErrorResult({
      ok: false,
      error: biz.errorMessage || biz.errorMsg || `顺丰业务错误（${bizCode}）`,
      errorCode: biz.errorCode,
      apiResultCode: API_RESULT_OK,
      apiResponseID: data.apiResponseID,
      biz,
    })
  }

  return {
    ok: true,
    apiResponseID: data.apiResponseID,
    biz,
    msgData: biz.msgData ?? null,
  }
}

async function callSfService(serviceCode, msgDataObject, options = {}) {
  const auth = assertSfConfig()
  if (!auth.ok) return auth

  const { cfg } = auth
  const msgData = JSON.stringify(msgDataObject ?? {})
  const timestamp = String(options.timestamp ?? Date.now())
  const requestID = options.requestID || buildRequestId()

  const form = new URLSearchParams()
  form.set('partnerID', cfg.partnerId)
  form.set('requestID', requestID)
  form.set('serviceCode', serviceCode)
  form.set('timestamp', timestamp)
  form.set('msgData', msgData)
  if (cfg.authMode === 'oauth2-static' || cfg.authMode === 'oauth2-fetch') {
    const tokenResult = await resolveSfAccessToken(cfg)
    if (!tokenResult.ok) return tokenResult
    form.set('accessToken', tokenResult.accessToken)
  } else {
    form.set('msgDigest', buildMsgDigest(msgData, timestamp, cfg.checkWord))
  }

  try {
    const { data } = await axios.post(cfg.baseUrl, form.toString(), {
      timeout: options.timeout ?? 25000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      responseType: 'json',
    })

    const parsed = parseApiEnvelope(data)
    if (!parsed.ok) {
      logger.warn('顺丰接口业务失败', {
        serviceCode,
        error: parsed.error,
        apiResultCode: parsed.apiResultCode,
        errorCode: parsed.errorCode,
        sf_error: parsed.sf_error,
      })
    }
    return parsed
  } catch (err) {
    logger.error('顺丰接口请求失败', { serviceCode, err: err?.message || err })
    return { ok: false, error: '顺丰接口请求失败', detail: err?.message || String(err) }
  }
}

function formatSendStartTm(expectTimeUnix) {
  const sec = Number(expectTimeUnix)
  if (!Number.isFinite(sec) || sec <= 0) return null
  const d = new Date(sec * 1000)
  if (Number.isNaN(d.getTime())) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function resolvePayAndMonthlyCard(bizId) {
  const cfg = getSfConfig()
  const trimmed = bizId != null ? String(bizId).trim() : ''
  if (trimmed && trimmed !== 'SF_CASH') {
    return { payMethod: 1, monthlyCard: trimmed }
  }
  if (cfg.monthlyCard) {
    return { payMethod: 1, monthlyCard: cfg.monthlyCard }
  }
  return { payMethod: 1, monthlyCard: undefined }
}

function buildContactInfo(sender, receiver) {
  const clip = (value, max) => {
    if (value == null || value === '') return undefined
    const str = String(value).trim()
    if (!str) return undefined
    return str.length <= max ? str : str.slice(0, max)
  }

  const list = []
  if (sender && typeof sender === 'object') {
    list.push({
      contactType: 1,
      contact: clip(sender.name || sender.contact || '寄件人', 100),
      mobile: clip(sender.mobile, 20),
      tel: clip(sender.tel, 20),
      company: clip(sender.company, 100),
      province: clip(sender.province, 30),
      city: clip(sender.city, 100),
      county: clip(sender.area || sender.county, 30),
      address: clip(sender.address, 200),
      country: clip(sender.country || 'CN', 30) || 'CN',
      postCode: clip(sender.postCode || sender.post_code, 25),
    })
  }
  if (receiver && typeof receiver === 'object') {
    list.push({
      contactType: 2,
      contact: clip(receiver.name || receiver.contact || '收件人', 100),
      mobile: clip(receiver.mobile, 20),
      tel: clip(receiver.tel, 20),
      company: clip(receiver.company, 100),
      province: clip(receiver.province, 30),
      city: clip(receiver.city, 100),
      county: clip(receiver.area || receiver.county, 30),
      address: clip(receiver.address, 200),
      country: clip(receiver.country || 'CN', 30) || 'CN',
      postCode: clip(receiver.postCode || receiver.post_code, 25),
    })
  }
  return list
}

function buildCargoDetails(cargo) {
  const clipName = (name) => {
    const str = String(name || '商品').trim() || '商品'
    return str.length <= 128 ? str : str.slice(0, 128)
  }

  if (!cargo || typeof cargo !== 'object') {
    return [{ name: '商品', count: 1 }]
  }
  if (Array.isArray(cargo.detail_list) && cargo.detail_list.length) {
    return cargo.detail_list.map((item) => ({
      name: clipName(item.name),
      count: Number(item.count) > 0 ? Number(item.count) : 1,
      unit: item.unit ? String(item.unit).slice(0, 30) : undefined,
      weight: item.weight != null && Number(item.weight) > 0 ? Number(item.weight) : undefined,
    }))
  }
  return [{
    name: clipName(cargo.name),
    count: Number(cargo.count) > 0 ? Number(cargo.count) : 1,
    unit: cargo.unit ? String(cargo.unit).slice(0, 30) : undefined,
    weight: cargo.weight != null && Number(cargo.weight) > 0 ? Number(cargo.weight) : undefined,
  }]
}

async function createOrder(payload) {
  return callSfService(SERVICE_CODE.CREATE_ORDER, payload)
}

async function updateOrder(payload) {
  return callSfService(SERVICE_CODE.UPDATE_ORDER, payload)
}

async function searchOrder(options) {
  const { buildSearchOrderPayload } = require('./sfExpressSearchOrder')
  const payload = typeof options === 'string'
    ? buildSearchOrderPayload({ orderId: options })
    : buildSearchOrderPayload(options || {})
  return callSfService(SERVICE_CODE.SEARCH_ORDER, payload)
}

async function searchRoutes(options = {}) {
  const {
    buildSearchRoutesPayload,
    resolveLegacySearchRoutesOptions,
  } = require('./sfExpressSearchRoutes')

  const payload = resolveLegacySearchRoutesOptions(options)
  if (!payload) {
    const built = buildSearchRoutesPayload(options)
    if (!built.ok) {
      return { ok: false, error: built.error, errorCode: built.errorCode }
    }
    return callSfService(SERVICE_CODE.SEARCH_ROUTES, built.payload)
  }

  return callSfService(SERVICE_CODE.SEARCH_ROUTES, payload)
}

async function queryDeliverTm(payload) {
  return callSfService(SERVICE_CODE.QUERY_DELIVERTM, payload)
}

async function fetchSfPathItemList(options = {}) {
  const { assessSearchRoutesResponse } = require('./sfExpressSearchRoutes')
  const {
    sfRoutesToPathItemList,
    extractSfRoutesFromSearchResponse,
    extractRouteRespsFromSearchResponse,
  } = require('./sfExpressPathMap')

  const result = await searchRoutes(options)
  if (!result.ok) return result

  const assessment = assessSearchRoutesResponse(result.msgData)
  const routeRespsRaw = extractRouteRespsFromSearchResponse(result.msgData)
  const targetMailNo = options.waybillNo != null ? String(options.waybillNo).trim() : ''
  const routes = extractSfRoutesFromSearchResponse(result.msgData, targetMailNo || undefined)

  const route_resps = routeRespsRaw.map((item) => ({
    mail_no: item.mailNo != null ? String(item.mailNo).trim() : '',
    path_item_list: sfRoutesToPathItemList(Array.isArray(item.routes) ? item.routes : []),
    routes: Array.isArray(item.routes) ? item.routes : [],
  }))

  return {
    ok: true,
    path_item_list: sfRoutesToPathItemList(routes),
    sf_routes: routes,
    route_resps,
    mail_no: assessment.mail_no || targetMailNo || null,
    has_routes: assessment.has_routes,
    routes_empty_hint: assessment.routes_empty_hint,
  }
}

function buildWaybillPreviewHtml({ orderId, waybillId, routeLabelInfo, waybillNoInfoList }) {
  const lines = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>顺丰面单</title>',
    '<style>body{font-family:sans-serif;padding:16px;line-height:1.5}pre{white-space:pre-wrap;word-break:break-all;background:#f6f6f6;padding:12px;border-radius:8px}</style>',
    '</head><body>',
    '<h2>顺丰运单信息</h2>',
  ]
  if (orderId) lines.push(`<p><strong>客户订单号：</strong>${orderId}</p>`)
  if (waybillId) lines.push(`<p><strong>运单号：</strong>${waybillId}</p>`)
  if (Array.isArray(waybillNoInfoList) && waybillNoInfoList.length) {
    lines.push('<h3>运单号列表</h3><pre>', JSON.stringify(waybillNoInfoList, null, 2), '</pre>')
  }
  if (routeLabelInfo) {
    lines.push('<h3>路由标签</h3><pre>', JSON.stringify(routeLabelInfo, null, 2), '</pre>')
  }
  lines.push('</body></html>')
  return lines.join('')
}

module.exports = {
  SERVICE_CODE,
  API_RESULT_OK,
  BIZ_RESULT_OK,
  SF_API_URL_PRODUCTION,
  SF_API_URL_SANDBOX,
  SF_OAUTH_URL_PRODUCTION,
  SF_OAUTH_URL_SANDBOX,
  getSfConfig,
  assertSfConfig,
  sfUrlEncode,
  buildMsgDigest,
  fetchSfOAuthAccessToken,
  resolveSfAccessToken,
  resetSfOAuthTokenCache,
  buildRequestId,
  parseApiEnvelope,
  callSfService,
  formatSendStartTm,
  resolvePayAndMonthlyCard,
  buildContactInfo,
  buildCargoDetails,
  createOrder,
  updateOrder,
  searchOrder,
  searchRoutes,
  queryDeliverTm,
  fetchSfPathItemList,
  buildWaybillPreviewHtml,
}
