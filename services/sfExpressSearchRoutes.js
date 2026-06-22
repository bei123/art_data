/**
 * EXP_RECE_SEARCH_ROUTES 路由查询（速运类）
 * @see 顺丰开放平台 EXP_RECE_SEARCH_ROUTES
 */

const MAX_TRACKING_NUMBERS = 10

const SF_TRACKING_TYPE = {
  WAYBILL: 1,
  ORDER_ID: 2,
}

const SF_TRACKING_TYPE_LABELS = {
  1: '顺丰运单号',
  2: '客户订单号',
}

const SF_ROUTE_METHOD_TYPE = {
  STANDARD: 1,
  CUSTOM: 2,
}

const SF_ROUTES_EMPTY_HINT = '路由为空：可能无查询权限、暂无路由、运单超过3个月，或月结卡号与 partnerID 未绑定'

function clipField(value, maxLen) {
  if (value == null || value === '') return ''
  const str = String(value).trim()
  if (!str) return ''
  return str.length <= maxLen ? str : str.slice(0, maxLen)
}

function normalizeLanguage(language) {
  const raw = language != null ? String(language).trim() : ''
  if (!raw) return 'zh-CN'
  const lower = raw.toLowerCase()
  if (lower === 'zh-cn' || lower === 'zh_cn') return 'zh-CN'
  if (lower === '0') return 'zh-CN'
  if (lower === 'en') return 'en'
  return raw
}

function phoneTail4(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.length <= 4 ? digits : digits.slice(-4)
}

function normalizeCheckPhoneNo(input) {
  if (input == null) return undefined
  const raw = String(input).trim()
  if (!raw) return undefined

  if (raw.includes(',')) {
    const parts = raw.split(',').map((part) => phoneTail4(part)).filter(Boolean)
    return parts.length ? clipField(parts.join(','), 30) : undefined
  }

  const tail = phoneTail4(raw)
  return tail ? clipField(tail, 30) : undefined
}

function normalizeTrackingNumbers(trackingNumber) {
  const list = Array.isArray(trackingNumber)
    ? trackingNumber
    : (trackingNumber != null ? [trackingNumber] : [])

  return [...new Set(
    list
      .map((item) => clipField(item, 64))
      .filter(Boolean),
  )]
}

function validateSearchRoutesInput({ trackingType, trackingNumber }) {
  const type = Number(trackingType)
  if (type !== SF_TRACKING_TYPE.WAYBILL && type !== SF_TRACKING_TYPE.ORDER_ID) {
    return { ok: false, error: 'trackingType 仅支持 1（运单号）或 2（客户订单号）' }
  }

  const numbers = normalizeTrackingNumbers(trackingNumber)
  if (!numbers.length) {
    return { ok: false, error: 'trackingNumber 不能为空' }
  }
  if (numbers.length > MAX_TRACKING_NUMBERS) {
    return {
      ok: false,
      error: `查询单号超过最大限制（最多 ${MAX_TRACKING_NUMBERS} 个）`,
      errorCode: '8003',
    }
  }

  return { ok: true, trackingType: type, trackingNumber: numbers }
}

function buildSearchRoutesPayload({
  trackingType = SF_TRACKING_TYPE.WAYBILL,
  trackingNumber,
  language = 'zh-CN',
  methodType = SF_ROUTE_METHOD_TYPE.STANDARD,
  checkPhoneNo,
  referenceNumber,
}) {
  const validated = validateSearchRoutesInput({ trackingType, trackingNumber })
  if (!validated.ok) return validated

  const payload = {
    language: normalizeLanguage(language),
    trackingType: validated.trackingType,
    trackingNumber: validated.trackingNumber,
    methodType: Number(methodType) || SF_ROUTE_METHOD_TYPE.STANDARD,
  }

  const phone = normalizeCheckPhoneNo(checkPhoneNo)
  if (phone) payload.checkPhoneNo = phone

  const refNo = clipField(referenceNumber, 4000)
  if (refNo) payload.referenceNumber = refNo

  return { ok: true, payload }
}

function resolveLegacySearchRoutesOptions(options = {}) {
  if (options.payload) return options.payload
  if (options.trackingNumber) {
    const built = buildSearchRoutesPayload(options)
    return built.ok ? built.payload : null
  }

  const waybillNo = options.waybillNo != null ? String(options.waybillNo).trim() : ''
  const orderId = options.orderId != null ? String(options.orderId).trim() : ''
  const trackingType = waybillNo ? SF_TRACKING_TYPE.WAYBILL : SF_TRACKING_TYPE.ORDER_ID
  const trackingNumber = waybillNo ? [waybillNo] : (orderId ? [orderId] : [])

  const built = buildSearchRoutesPayload({
    trackingType,
    trackingNumber,
    language: options.language,
    methodType: options.methodType,
    checkPhoneNo: options.checkPhoneNo,
    referenceNumber: options.referenceNumber,
  })
  return built.ok ? built.payload : null
}

function extractRouteResps(msgData) {
  if (!msgData || typeof msgData !== 'object') return []
  if (!Array.isArray(msgData.routeResps)) return []
  return msgData.routeResps
    .map((item) => ({
      mail_no: item?.mailNo != null ? String(item.mailNo).trim() : '',
      routes: Array.isArray(item?.routes) ? item.routes : [],
    }))
    .filter((item) => item.mail_no || item.routes.length)
}

function assessSearchRoutesResponse(msgData) {
  const routeResps = extractRouteResps(msgData)
  const hasAnyRoute = routeResps.some((item) => item.routes.length > 0)

  return {
    ok: true,
    route_resps: routeResps,
    has_routes: hasAnyRoute,
    routes_empty_hint: hasAnyRoute ? undefined : SF_ROUTES_EMPTY_HINT,
    mail_no: routeResps[0]?.mail_no || undefined,
  }
}

module.exports = {
  MAX_TRACKING_NUMBERS,
  SF_TRACKING_TYPE,
  SF_TRACKING_TYPE_LABELS,
  SF_ROUTE_METHOD_TYPE,
  SF_ROUTES_EMPTY_HINT,
  normalizeCheckPhoneNo,
  validateSearchRoutesInput,
  buildSearchRoutesPayload,
  resolveLegacySearchRoutesOptions,
  extractRouteResps,
  assessSearchRoutesResponse,
}
