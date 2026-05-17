/**
 * 调用 WMS 的通用 HTTP 客户端（axios）。含 RB/WEB 与浏览器一致的 user-login。
 */
const axios = require('axios')
const logger = require('./logger')
const {
  WMS_HTTP_BASE_URL,
  WMS_HTTP_BEARER_TOKEN,
  WMS_HTTP_USER,
  getWmsHttpPasswordForLogin,
  WMS_HTTP_COOKIE,
  WMS_HTTP_VCODE,
  WMS_HTTP_USER_AGENT,
  isWmsHttpConfigured,
  parseExtraHeaders,
} = require('../config/wmsHttp')

function joinBaseAndPath(base, path) {
  const p = String(path || '').startsWith('/') ? String(path) : `/${path || ''}`
  return `${base}${p}`
}

/** REBUILD 前端常见 X-ReqRandom：两段数字 */
function newWmsReqRandom() {
  const a = Math.floor(Math.random() * 1e8)
  const b = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  return `${a}-${b}`
}

function wmsOrigin() {
  return WMS_HTTP_BASE_URL.startsWith('http')
    ? WMS_HTTP_BASE_URL
    : `http://${WMS_HTTP_BASE_URL}`
}

/**
 * 与 RB/WEB 浏览器一致的通用头（JSON 接口多为 Content-Type: text/plain + JSON 字符串）
 * @param {{ refererPath: string, cookie?: string, noCache?: boolean, contentType?: string, userAgent?: string }} p
 */
function buildRbWebHeaders(p) {
  const origin = wmsOrigin()
  const ref = String(p.refererPath || '')
  const referer = `${origin}${ref.startsWith('/') ? ref : `/${ref}`}`
  const headers = {
    ...parseExtraHeaders(),
    Accept: '*/*',
    'Content-Type': p.contentType || 'text/plain;charset=UTF-8',
    'User-Agent': p.userAgent != null && String(p.userAgent).trim() ? String(p.userAgent).trim() : WMS_HTTP_USER_AGENT,
    'X-CsrfToken': '',
    'X-AuthToken': '',
    'X-ReqRandom': newWmsReqRandom(),
    'X-Requested-With': 'XMLHttpRequest',
    'X-Client': 'RB/WEB',
    Origin: origin,
    Referer: referer,
  }
  if (p.noCache) {
    headers.Pragma = 'no-cache'
    headers['Cache-Control'] = 'no-cache'
  }
  if (p.cookie && String(p.cookie).trim()) {
    headers.Cookie = String(p.cookie).trim()
  }
  return headers
}

/**
 * 从 axios 响应头拼 Cookie 串（只取各 Set-Cookie 的第一段 name=value）
 * @param {import('axios').AxiosResponse} res
 * @returns {string}
 */
function cookieHeaderFromSetCookie(res) {
  const raw = res && res.headers && res.headers['set-cookie']
  if (!raw) return ''
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .map((line) => String(line).split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

/**
 * 合并已有 Cookie 与新 Set-Cookie（同名后者覆盖需调用方处理；此处简单拼接去重 RBSESSION 较难，建议登录后只用返回的 cookie）
 * @param {string} existing
 * @param {string} fromSetCookie
 */
function mergeCookieHeader(existing, fromSetCookie) {
  const a = String(existing || '').trim()
  const b = String(fromSetCookie || '').trim()
  if (!a) return b
  if (!b) return a
  return `${a}; ${b}`
}

/**
 * 与浏览器一致：先打开登录页，拿到 RBSESSION（及验证码会话），再 POST /user/user-login。
 * @returns {Promise<string>} Cookie 请求头片段（可能为空）
 */
async function wmsWarmLoginSessionCookie() {
  if (!isWmsHttpConfigured()) return ''
  const url = joinBaseAndPath(WMS_HTTP_BASE_URL, '/user/login')
  const origin = wmsOrigin()
  const headers = {
    ...parseExtraHeaders(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'User-Agent': WMS_HTTP_USER_AGENT,
    Referer: `${origin}/user/login`,
  }
  try {
    const res = await axios.get(url, {
      headers,
      timeout: 30000,
      validateStatus: () => true,
    })
    if (res.status < 200 || res.status >= 400) {
      logger.warn('wms_warm_login_page_http', { status: res.status })
    }
    return cookieHeaderFromSetCookie(res)
  } catch (e) {
    logger.warn('wms_warm_login_page_failed', { err: e.message })
    return ''
  }
}

/**
 * RB/WEB 登录（与 REBUILD login.js 一致：URL 中 passwd 固定为 ******，真实密码放在 POST body）
 * @see https://github.com/getrebuild/rebuild/blob/master/src/main/resources/web/assets/js/login.js
 * @param {{ user: string, passwd: string, autoLogin?: boolean, vcode?: string, cookie?: string, postBody?: string, noCache?: boolean }} creds postBody 可覆盖默认正文（默认即明文密码）；noCache 默认 true（与浏览器 DevTools 一致）
 */
async function wmsUserLogin(creds) {
  if (!isWmsHttpConfigured()) {
    const err = new Error('WMS HTTP 未配置：请设置环境变量 WMS_HTTP_BASE_URL')
    err.code = 'WMS_HTTP_NOT_CONFIGURED'
    throw err
  }
  const user = creds && creds.user
  const passwd = creds && creds.passwd
  if (!user || !passwd) {
    const err = new Error('wmsUserLogin 需要 user 与 passwd')
    err.code = 'WMS_HTTP_BAD_REQUEST'
    throw err
  }
  const autoLogin = creds.autoLogin === true
  const vcode = creds.vcode != null ? String(creds.vcode) : ''
  const bodyPayload =
    creds.postBody !== undefined && creds.postBody !== null
      ? String(creds.postBody)
      : String(passwd)
  const urlObj = new URL(joinBaseAndPath(WMS_HTTP_BASE_URL, '/user/user-login'))
  urlObj.searchParams.set('user', user)
  urlObj.searchParams.set('passwd', '******')
  urlObj.searchParams.set('autoLogin', String(autoLogin))
  urlObj.searchParams.set('vcode', vcode)

  const useNoCache = creds.noCache !== false
  const headers = buildRbWebHeaders({
    refererPath: '/user/login',
    cookie: creds.cookie,
    noCache: useNoCache,
  })

  const timeoutMs = 30000
  try {
    const response = await axios.post(urlObj.toString(), bodyPayload, {
      headers,
      timeout: timeoutMs,
      validateStatus: () => true,
    })
    const sessionCookie = cookieHeaderFromSetCookie(response)
    return { response, sessionCookie }
  } catch (e) {
    logger.error('wms_user_login_failed', { err: e.message })
    throw e
  }
}

const WMS_SESSION_CACHE_TTL_MS = 25 * 60 * 1000
let wmsSessionCache = { cookie: '', expiresAt: 0 }
let wmsLoginInflight = null

/**
 * 使用环境变量 WMS_HTTP_USER 与 WMS_HTTP_PASSWORD（或 WMS_HTTP_PASSWORD_B64）登录。
 * 默认先 GET /user/login 取 RBSESSION（与浏览器一致）；可设 WMS_HTTP_COOKIE 跳过预热；WMS_HTTP_VCODE 传验证码。
 * @returns {Promise<{ response: import('axios').AxiosResponse, sessionCookie: string }>}
 */
async function wmsUserLoginFromEnv() {
  const now = Date.now()
  const cached = String(wmsSessionCache.cookie || '').trim()
  if (cached && wmsSessionCache.expiresAt > now) {
    return { response: null, sessionCookie: cached }
  }

  if (!wmsLoginInflight) {
    wmsLoginInflight = wmsUserLoginFromEnvUncached().finally(() => {
      wmsLoginInflight = null
    })
  }

  const { response, sessionCookie } = await wmsLoginInflight
  const merged = String(sessionCookie || '').trim()
  if (merged) {
    wmsSessionCache = { cookie: merged, expiresAt: Date.now() + WMS_SESSION_CACHE_TTL_MS }
  }
  return { response, sessionCookie: merged }
}

async function wmsUserLoginFromEnvUncached() {
  const passwd = getWmsHttpPasswordForLogin()
  if (!WMS_HTTP_USER || !passwd) {
    const err = new Error(
      'wmsUserLoginFromEnv 需要 WMS_HTTP_USER 与 WMS_HTTP_PASSWORD（或 WMS_HTTP_PASSWORD_B64）'
    )
    err.code = 'WMS_HTTP_BAD_REQUEST'
    throw err
  }
  const fromEnvCookie = String(WMS_HTTP_COOKIE || '').trim()
  const preCookie = fromEnvCookie || (await wmsWarmLoginSessionCookie())
  const vcode = String(WMS_HTTP_VCODE || '').trim()
  const { response, sessionCookie } = await wmsUserLogin({
    user: WMS_HTTP_USER,
    passwd,
    autoLogin: false,
    vcode,
    cookie: preCookie || undefined,
  })
  const fromLogin = sessionCookie && String(sessionCookie).trim()
  const merged = fromLogin || String(preCookie).trim()
  return { response, sessionCookie: merged }
}

/** 与列表页默认请求体一致；可用展开覆盖 pageNo、pageSize、fields、sort 等 */
const WMS_PRODUCT_DATA_LIST_DEFAULT_BODY = {
  entity: 'Product',
  fields: [
    'ProductName',
    'yishujia31',
    'zuopinleixing',
    'UnitPrice',
    'createdOn',
    'zuopintupian',
    'zuopinlaiyuan',
  ],
  pageNo: 1,
  pageSize: 20,
  advFilter: null,
  sort: 'createdOn:desc',
  reload: true,
  statsField: false,
}

/**
 * POST /app/Product/data-list（需已登录 Cookie，含 RBSESSION）
 * @param {{ cookie: string, body?: Record<string, unknown> }} opts body 与默认合并
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function wmsProductDataList(opts) {
  if (!isWmsHttpConfigured()) {
    const err = new Error('WMS HTTP 未配置：请设置环境变量 WMS_HTTP_BASE_URL')
    err.code = 'WMS_HTTP_NOT_CONFIGURED'
    throw err
  }
  const cookie = opts && opts.cookie
  if (!cookie || String(cookie).trim() === '') {
    const err = new Error('wmsProductDataList 需要 cookie（请先 wmsUserLogin 取得 RBSESSION）')
    err.code = 'WMS_HTTP_BAD_REQUEST'
    throw err
  }
  const body = { ...WMS_PRODUCT_DATA_LIST_DEFAULT_BODY, ...(opts && opts.body ? opts.body : {}) }
  return wmsRbWebJsonPost({
    path: '/app/Product/data-list',
    cookie: String(cookie).trim(),
    jsonBody: body,
    refererPath: '/app/Product/list',
    noCache: true,
  })
}

/**
 * RB/WEB：POST JSON 字符串，Content-Type 为 text/plain（与浏览器一致）
 * @param {{ path: string, cookie: string, jsonBody: object|string, refererPath: string, noCache?: boolean, timeoutMs?: number }} p
 */
async function wmsRbWebJsonPost(p) {
  if (!isWmsHttpConfigured()) {
    const err = new Error('WMS HTTP 未配置：请设置环境变量 WMS_HTTP_BASE_URL')
    err.code = 'WMS_HTTP_NOT_CONFIGURED'
    throw err
  }
  if (!p.cookie || String(p.cookie).trim() === '') {
    const err = new Error('wmsRbWebJsonPost 需要 cookie')
    err.code = 'WMS_HTTP_BAD_REQUEST'
    throw err
  }
  const url = joinBaseAndPath(WMS_HTTP_BASE_URL, p.path)
  const raw =
    typeof p.jsonBody === 'string' ? p.jsonBody : JSON.stringify(p.jsonBody)
  const headers = buildRbWebHeaders({
    refererPath: p.refererPath || '/',
    cookie: p.cookie,
    noCache: p.noCache !== false,
  })
  const timeoutMs = p.timeoutMs ?? 30000
  try {
    return await axios.post(url, raw, {
      headers,
      timeout: timeoutMs,
      validateStatus: () => true,
    })
  } catch (e) {
    logger.error('wms_rb_web_json_post_failed', { path: p.path, err: e.message })
    throw e
  }
}

/**
 * RB/WEB：GET（与浏览器 view-model 等一致）
 * @param {{ path: string, cookie: string, refererPath: string, query?: Record<string, unknown>, noCache?: boolean, contentType?: string, timeoutMs?: number }} p
 */
async function wmsRbWebGet(p) {
  if (!isWmsHttpConfigured()) {
    const err = new Error('WMS HTTP 未配置：请设置环境变量 WMS_HTTP_BASE_URL')
    err.code = 'WMS_HTTP_NOT_CONFIGURED'
    throw err
  }
  if (!p.cookie || String(p.cookie).trim() === '') {
    const err = new Error('wmsRbWebGet 需要 cookie')
    err.code = 'WMS_HTTP_BAD_REQUEST'
    throw err
  }
  const url = joinBaseAndPath(WMS_HTTP_BASE_URL, p.path)
  const headers = buildRbWebHeaders({
    refererPath: p.refererPath || '/',
    cookie: p.cookie,
    noCache: p.noCache !== false,
    contentType: p.contentType || 'text/plain;charset=utf-8',
  })
  const timeoutMs = p.timeoutMs ?? 30000
  try {
    return await axios.get(url, {
      headers,
      params: p.query || {},
      timeout: timeoutMs,
      validateStatus: () => true,
    })
  } catch (e) {
    logger.error('wms_rb_web_get_failed', { path: p.path, err: e.message })
    throw e
  }
}

/**
 * GET /app/Product/view-model?id=…&_=时间戳（详情 elements）
 * @param {{ cookie: string, id: string, query?: Record<string, unknown> }} opts 可传 query 覆盖 _ 等
 */
async function wmsProductViewModel(opts) {
  if (!isWmsHttpConfigured()) {
    const err = new Error('WMS HTTP 未配置：请设置环境变量 WMS_HTTP_BASE_URL')
    err.code = 'WMS_HTTP_NOT_CONFIGURED'
    throw err
  }
  const cookie = opts && opts.cookie
  const id = opts && opts.id
  if (!cookie || String(cookie).trim() === '') {
    const err = new Error('wmsProductViewModel 需要 cookie')
    err.code = 'WMS_HTTP_BAD_REQUEST'
    throw err
  }
  if (!id || String(id).trim() === '') {
    const err = new Error('wmsProductViewModel 需要 id（如 988-019cc33420f40333）')
    err.code = 'WMS_HTTP_BAD_REQUEST'
    throw err
  }
  const rid = String(id).trim()
  const extra = (opts && opts.query) || {}
  return wmsRbWebGet({
    path: '/app/Product/view-model',
    cookie: String(cookie).trim(),
    refererPath: `/app/Product/view/${encodeURIComponent(rid)}`,
    query: { id: rid, _: Date.now(), ...extra },
    noCache: true,
  })
}

/**
 * @param {{ method?: string, path: string, query?: Record<string, unknown>, data?: unknown, headers?: Record<string, string>, timeoutMs?: number }} opts
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function wmsRequest(opts) {
  if (!isWmsHttpConfigured()) {
    const err = new Error('WMS HTTP 未配置：请设置环境变量 WMS_HTTP_BASE_URL')
    err.code = 'WMS_HTTP_NOT_CONFIGURED'
    throw err
  }
  const method = (opts.method || 'GET').toUpperCase()
  const path = opts.path
  if (!path || typeof path !== 'string') {
    const err = new Error('wmsRequest 需要 path')
    err.code = 'WMS_HTTP_BAD_REQUEST'
    throw err
  }
  const url = joinBaseAndPath(WMS_HTTP_BASE_URL, path)
  const headers = {
    ...parseExtraHeaders(),
    ...(opts.headers || {}),
  }
  if (WMS_HTTP_BEARER_TOKEN && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${WMS_HTTP_BEARER_TOKEN}`
  }
  const timeoutMs = opts.timeoutMs ?? 30000
  try {
    return await axios({
      method,
      url,
      params: opts.query,
      data: opts.data,
      headers,
      timeout: timeoutMs,
      validateStatus: () => true,
    })
  } catch (e) {
    logger.error('wms_http_request_failed', { path, method, err: e.message })
    throw e
  }
}

module.exports = {
  wmsRequest,
  wmsUserLogin,
  wmsUserLoginFromEnv,
  wmsWarmLoginSessionCookie,
  wmsRbWebJsonPost,
  wmsRbWebGet,
  wmsProductDataList,
  wmsProductViewModel,
  WMS_PRODUCT_DATA_LIST_DEFAULT_BODY,
  buildRbWebHeaders,
  wmsOrigin,
  cookieHeaderFromSetCookie,
  mergeCookieHeader,
  newWmsReqRandom,
  isWmsHttpConfigured,
}
