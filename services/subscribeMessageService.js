const axios = require('axios')
const db = require('../db')
const logger = require('../utils/logger')
const { getAccessToken } = require('./wechatMiniProgramToken')

const WECHAT_API_BASE = 'https://api.weixin.qq.com'
const DEFAULT_MINIPROGRAM_STATE = process.env.WX_SUBSCRIBE_MINIPROGRAM_STATE || 'formal'
const DEFAULT_LANG = process.env.WX_SUBSCRIBE_LANG || 'zh_CN'

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function getWxCredentials() {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) {
    return { error: adminResult(500, { error: '服务器配置错误', detail: '缺少 WX_APPID 或 WX_SECRET' }) }
  }
  return { appid, secret }
}

async function resolveAccessToken() {
  const creds = getWxCredentials()
  if (creds.error) return creds
  const access_token = await getAccessToken(creds.appid, creds.secret)
  return { access_token }
}

function mapWechatError(data, fallbackMessage) {
  return adminResult(502, {
    error: data.errmsg || fallbackMessage || '微信订阅消息接口返回错误',
    errcode: data.errcode,
  })
}

/**
 * 统一调用微信订阅消息相关 OpenAPI
 */
async function callWechatSubscribeApi({ method = 'GET', path, query = {}, body = null, timeout = 15000 }) {
  const tokenResult = await resolveAccessToken()
  if (tokenResult.error) return tokenResult.error

  const url = new URL(`${WECHAT_API_BASE}${path}`)
  url.searchParams.set('access_token', tokenResult.access_token)
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue
    url.searchParams.set(key, String(value))
  }

  try {
    const config = { method, url: url.toString(), timeout }
    if (body != null && method !== 'GET') config.data = body
    const { data } = await axios(config)

    if (data.errcode != null && data.errcode !== 0) {
      logger.warn('微信订阅消息接口返回错误', { path, errcode: data.errcode, errmsg: data.errmsg })
      return mapWechatError(data)
    }
    return adminResult(200, data)
  } catch (err) {
    logger.error('微信订阅消息接口请求失败', { path, err })
    return adminResult(500, { error: '微信订阅消息服务暂时不可用', detail: err.message })
  }
}

async function resolveOpenid({ touser, userId, wxUserId }) {
  if (touser && typeof touser === 'string' && touser.trim()) {
    return { openid: touser.trim() }
  }

  const id = parseInt(String(userId ?? wxUserId ?? ''), 10)
  if (Number.isNaN(id) || id <= 0) {
    return { error: adminResult(400, { error: '缺少 touser（openid）或有效的 userId / wxUserId' }) }
  }

  const [rows] = await db.query('SELECT openid FROM wx_users WHERE id = ? LIMIT 1', [id])
  if (!rows.length || !rows[0].openid) {
    return { error: adminResult(404, { error: '用户不存在或未绑定 openid' }) }
  }
  return { openid: String(rows[0].openid).trim() }
}

/** 获取类目 @see https://developers.weixin.qq.com/miniprogram/dev/server/API/mp-message-management/subscribe-message/api_getcategory.html */
async function getCategory() {
  return callWechatSubscribeApi({ path: '/wxaapi/newtmpl/getcategory' })
}

/** 获取类目下的公共模板 @see api_getpubnewtemplatetitles */
async function getPubTemplateTitles(req) {
  const ids = req.query.ids
  const start = parseInt(String(req.query.start ?? '0'), 10)
  const limit = parseInt(String(req.query.limit ?? '30'), 10)

  if (!ids || typeof ids !== 'string' || !ids.trim()) {
    return adminResult(400, { error: '缺少 ids（类目 id，多个用逗号隔开）' })
  }
  if (Number.isNaN(start) || start < 0) {
    return adminResult(400, { error: 'start 参数无效' })
  }
  if (Number.isNaN(limit) || limit < 1 || limit > 30) {
    return adminResult(400, { error: 'limit 参数无效，范围为 1-30' })
  }

  return callWechatSubscribeApi({
    path: '/wxaapi/newtmpl/getpubtemplatetitles',
    query: { ids: ids.trim(), start, limit },
  })
}

/** 获取模板标题下的关键词 @see api_getpubnewtemplatekeywords */
async function getPubTemplateKeywords(req) {
  const tid = req.query.tid ?? req.params.tid
  if (tid == null || String(tid).trim() === '') {
    return adminResult(400, { error: '缺少 tid（模板标题 id）' })
  }

  return callWechatSubscribeApi({
    path: '/wxaapi/newtmpl/getpubtemplatekeywords',
    query: { tid: String(tid).trim() },
  })
}

/** 获取已有模板列表 @see api_getwxapubnewtemplate */
async function getPrivateTemplates() {
  return callWechatSubscribeApi({ path: '/wxaapi/newtmpl/gettemplate' })
}

/** 选用模板 @see api_addwxanewtemplate */
async function addTemplate(req) {
  const { tid, kidList, sceneDesc } = req.body || {}

  if (tid == null || String(tid).trim() === '') {
    return adminResult(400, { error: '缺少 tid（模板标题 id）' })
  }
  if (!Array.isArray(kidList) || kidList.length < 2 || kidList.length > 5) {
    return adminResult(400, { error: 'kidList 需为 2-5 个关键词 id 的数组' })
  }
  if (!sceneDesc || typeof sceneDesc !== 'string' || !sceneDesc.trim()) {
    return adminResult(400, { error: '缺少 sceneDesc（服务场景描述）' })
  }
  if (sceneDesc.trim().length > 15) {
    return adminResult(400, { error: 'sceneDesc 不能超过 15 个字' })
  }

  return callWechatSubscribeApi({
    method: 'POST',
    path: '/wxaapi/newtmpl/addtemplate',
    body: {
      tid: String(tid).trim(),
      kidList,
      sceneDesc: sceneDesc.trim(),
    },
  })
}

/** 删除私有模板 @see api_delwxanewtemplate */
async function deleteTemplate(req) {
  const priTmplId = req.body?.priTmplId ?? req.params.priTmplId
  if (!priTmplId || typeof priTmplId !== 'string' || !priTmplId.trim()) {
    return adminResult(400, { error: '缺少 priTmplId（私有模板 id）' })
  }

  return callWechatSubscribeApi({
    method: 'POST',
    path: '/wxaapi/newtmpl/deltemplate',
    body: { priTmplId: priTmplId.trim() },
  })
}

/** 发送订阅消息 @see api_sendmessage */
async function sendSubscribeMessageDirect({
  openid,
  template_id,
  data,
  page,
  miniprogram_state,
  lang,
}) {
  if (!openid || typeof openid !== 'string' || !openid.trim()) {
    return adminResult(400, { error: '缺少 openid' })
  }
  if (!template_id || typeof template_id !== 'string' || !template_id.trim()) {
    return adminResult(400, { error: '缺少 template_id（订阅模板 id）' })
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return adminResult(400, { error: '缺少 data（模板内容）' })
  }

  const payload = {
    touser: openid.trim(),
    template_id: template_id.trim(),
    data,
    miniprogram_state: miniprogram_state || DEFAULT_MINIPROGRAM_STATE,
    lang: lang || DEFAULT_LANG,
  }
  if (page != null && String(page).trim() !== '') {
    payload.page = String(page).trim()
  }

  return callWechatSubscribeApi({
    method: 'POST',
    path: '/cgi-bin/message/subscribe/send',
    body: payload,
  })
}

async function sendSubscribeMessage(req) {
  const {
    template_id,
    data,
    page,
    miniprogram_state,
    lang,
    touser,
    userId,
    wxUserId,
  } = req.body || {}

  if (!template_id || typeof template_id !== 'string' || !template_id.trim()) {
    return adminResult(400, { error: '缺少 template_id（订阅模板 id）' })
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return adminResult(400, { error: '缺少 data（模板内容）' })
  }

  const openidResult = await resolveOpenid({ touser, userId, wxUserId })
  if (openidResult.error) return openidResult.error

  return sendSubscribeMessageDirect({
    openid: openidResult.openid,
    template_id,
    data,
    page,
    miniprogram_state,
    lang,
  })
}

/** 激活与更新服务卡片（内部调用） @see api_setusernotify */
async function setUserNotifyDirect({
  openid,
  notify_type,
  notify_code,
  content_json,
  check_json,
}) {
  if (!openid || typeof openid !== 'string' || !openid.trim()) {
    return adminResult(400, { error: '缺少 openid' })
  }
  if (notify_type == null || Number.isNaN(Number(notify_type))) {
    return adminResult(400, { error: '缺少 notify_type（卡片 id）' })
  }
  if (!notify_code || typeof notify_code !== 'string' || !notify_code.trim()) {
    return adminResult(400, { error: '缺少 notify_code（动态更新令牌）' })
  }
  if (!content_json || typeof content_json !== 'string' || !content_json.trim()) {
    return adminResult(400, { error: '缺少 content_json（卡片状态 JSON 字符串）' })
  }

  const body = {
    openid: openid.trim(),
    notify_type: Number(notify_type),
    notify_code: notify_code.trim(),
    content_json: content_json.trim(),
  }
  if (check_json != null && String(check_json).trim() !== '') {
    body.check_json = typeof check_json === 'string' ? check_json.trim() : JSON.stringify(check_json)
  }

  return callWechatSubscribeApi({
    method: 'POST',
    path: '/wxa/set_user_notify',
    body,
  })
}

/** 激活与更新服务卡片 @see api_setusernotify */
async function setUserNotify(req) {
  const { openid, notify_type, notify_code, content_json, check_json, userId, wxUserId } = req.body || {}

  if (notify_type == null || Number.isNaN(Number(notify_type))) {
    return adminResult(400, { error: '缺少 notify_type（卡片 id）' })
  }
  if (!notify_code || typeof notify_code !== 'string' || !notify_code.trim()) {
    return adminResult(400, { error: '缺少 notify_code（动态更新令牌）' })
  }
  if (!content_json || typeof content_json !== 'string' || !content_json.trim()) {
    return adminResult(400, { error: '缺少 content_json（卡片状态 JSON 字符串）' })
  }

  const openidResult = await resolveOpenid({ touser: openid, userId, wxUserId })
  if (openidResult.error) return openidResult.error

  return setUserNotifyDirect({
    openid: openidResult.openid,
    notify_type,
    notify_code,
    content_json,
    check_json,
  })
}

/** 更新服务卡片扩展信息 @see api_setusernotifyext */
async function setUserNotifyExt(req) {
  const { openid, notify_type, notify_code, ext_json, userId, wxUserId } = req.body || {}

  if (notify_type == null || Number.isNaN(Number(notify_type))) {
    return adminResult(400, { error: '缺少 notify_type（卡片 id）' })
  }
  if (!notify_code || typeof notify_code !== 'string' || !notify_code.trim()) {
    return adminResult(400, { error: '缺少 notify_code（动态更新令牌）' })
  }
  if (!ext_json || typeof ext_json !== 'string' || !ext_json.trim()) {
    return adminResult(400, { error: '缺少 ext_json（扩展信息 JSON 字符串）' })
  }

  const openidResult = await resolveOpenid({ touser: openid, userId, wxUserId })
  if (openidResult.error) return openidResult.error

  return callWechatSubscribeApi({
    method: 'POST',
    path: '/wxa/set_user_notifyext',
    body: {
      openid: openidResult.openid,
      notify_type: Number(notify_type),
      notify_code: notify_code.trim(),
      ext_json: ext_json.trim(),
    },
  })
}

/** 查询服务卡片状态 @see api_getusernotify */
async function getUserNotify(req) {
  const { openid, notify_type, notify_code, userId, wxUserId } = req.body || {}

  if (notify_type == null || Number.isNaN(Number(notify_type))) {
    return adminResult(400, { error: '缺少 notify_type（卡片 id）' })
  }
  if (!notify_code || typeof notify_code !== 'string' || !notify_code.trim()) {
    return adminResult(400, { error: '缺少 notify_code（动态更新令牌）' })
  }

  const openidResult = await resolveOpenid({ touser: openid, userId, wxUserId })
  if (openidResult.error) return openidResult.error

  return callWechatSubscribeApi({
    method: 'POST',
    path: '/wxa/get_user_notify',
    body: {
      openid: openidResult.openid,
      notify_type: Number(notify_type),
      notify_code: notify_code.trim(),
    },
  })
}

module.exports = {
  getCategory,
  getPubTemplateTitles,
  getPubTemplateKeywords,
  getPrivateTemplates,
  addTemplate,
  deleteTemplate,
  sendSubscribeMessage,
  sendSubscribeMessageDirect,
  setUserNotifyDirect,
  setUserNotify,
  setUserNotifyExt,
  getUserNotify,
}
