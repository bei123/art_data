/**
 * EXP_RECE_SEARCH_ORDER_RESP 订单结果查询（速运类）
 * @see 顺丰开放平台 EXP_RECE_SEARCH_ORDER_RESP
 */

const {
  getFilterResultMeta,
  extractWaybillNoInfoList,
} = require('./sfExpressCreateOrder')

const SF_SEARCH_TYPE = {
  FORWARD: '1',
  RETURN: '2',
}

const SF_SEARCH_TYPE_LABELS = {
  1: '正向单',
  2: '退货单',
}

const SF_ROUTE_LABEL_CODE_LABELS = {
  1000: '路由标签获取成功',
  0: '接口参数异常',
  10: '其它异常',
  1: 'xml解析异常',
  2: '字段校验异常',
  3: '票数节点超出最大值',
  4: 'RLS获取路由标签的必要字段为空',
}

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
  if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo') return raw
  if (lower === 'en') return 'en'
  return raw
}

function validateSearchOrderInput({ orderId }) {
  const clippedOrderId = clipField(orderId, 64)
  if (!clippedOrderId) {
    return { ok: false, error: '客户订单号 orderId 不能为空' }
  }
  return { ok: true, orderId: clippedOrderId }
}

function buildSearchOrderPayload({
  orderId,
  searchType = SF_SEARCH_TYPE.FORWARD,
  language = 'zh-CN',
  mainWaybillNo,
}) {
  const payload = {
    orderId: clipField(orderId, 64),
    searchType: String(searchType || SF_SEARCH_TYPE.FORWARD),
    language: normalizeLanguage(language),
  }

  const mainNo = clipField(mainWaybillNo, 15)
  if (mainNo) payload.mainWaybillNo = mainNo

  return payload
}

function normalizeSearchOrderMsgData(msgData) {
  if (!msgData || typeof msgData !== 'object') return null

  const filterRaw = msgData.filterResult
  const filterResult = filterRaw != null && String(filterRaw).trim() !== ''
    ? Number(filterRaw)
    : null

  return {
    orderId: msgData.orderId != null ? String(msgData.orderId).trim() : '',
    originCode: msgData.originCode ?? msgData.origincode ?? undefined,
    destCode: msgData.destCode ?? msgData.destcode ?? undefined,
    filterResult: Number.isNaN(filterResult) ? null : filterResult,
    waybillNoInfoList: Array.isArray(msgData.waybillNoInfoList) ? msgData.waybillNoInfoList : [],
    routeLabelInfo: Array.isArray(msgData.routeLabelInfo) ? msgData.routeLabelInfo : [],
    returnExtraInfoList: Array.isArray(msgData.returnExtraInfoList) ? msgData.returnExtraInfoList : [],
  }
}

function getRouteLabelCodeMeta(code) {
  const normalized = code != null ? String(code).trim() : ''
  if (!normalized) return null

  if (normalized === '1000') {
    return { code: normalized, label: SF_ROUTE_LABEL_CODE_LABELS[1000], ok: true }
  }

  const suffix = normalized.replace(/^0+/, '') || normalized
  const numeric = Number(suffix)
  const label = SF_ROUTE_LABEL_CODE_LABELS[numeric]
    || SF_ROUTE_LABEL_CODE_LABELS[Number(normalized)]
    || `路由标签异常（${normalized}）`

  return { code: normalized, label, ok: false }
}

function summarizeRouteLabelInfo(routeLabelInfo) {
  if (!Array.isArray(routeLabelInfo) || !routeLabelInfo.length) {
    return { items: [], all_ok: true }
  }

  const items = routeLabelInfo.map((item) => {
    const meta = getRouteLabelCodeMeta(item?.code)
    return {
      code: item?.code != null ? String(item.code) : '',
      message: item?.message != null ? String(item.message) : undefined,
      waybill_no: item?.routeLabelData?.waybillNo || undefined,
      route_label_meta: meta || undefined,
      ok: meta ? meta.ok : true,
    }
  })

  return {
    items,
    all_ok: items.every((item) => item.ok),
  }
}

function assessSearchOrderResponse(msgData) {
  const normalized = normalizeSearchOrderMsgData(msgData)
  if (!normalized) {
    return { ok: false, error: '顺丰未返回订单查询数据' }
  }

  const filterMeta = normalized.filterResult != null
    ? getFilterResultMeta(normalized.filterResult)
    : null

  const routeSummary = summarizeRouteLabelInfo(normalized.routeLabelInfo)
  const waybill_data = extractWaybillNoInfoList(normalized)

  const result = {
    ok: true,
    order_id: normalized.orderId,
    origin_code: normalized.originCode,
    dest_code: normalized.destCode,
    filter_result: normalized.filterResult ?? undefined,
    filter_meta: filterMeta || undefined,
    waybill_data,
    route_label_info: normalized.routeLabelInfo,
    route_label_summary: routeSummary,
    return_extra_info_list: normalized.returnExtraInfoList,
    normalized,
  }

  if (normalized.filterResult === 1) {
    result.filter_warning = `筛单结果：人工确认`
  } else if (normalized.filterResult === 3) {
    result.filter_warning = '筛单结果：不可以收派'
  } else if (normalized.filterResult === 4) {
    result.filter_warning = '筛单结果：无法确定'
  }

  if (!routeSummary.all_ok) {
    result.route_label_warning = '部分路由标签获取失败'
  }

  if (!normalized.orderId && !waybill_data.length) {
    return {
      ok: false,
      error: '未查询到该订单的运单信息',
      normalized,
    }
  }

  return result
}

module.exports = {
  SF_SEARCH_TYPE,
  SF_SEARCH_TYPE_LABELS,
  SF_ROUTE_LABEL_CODE_LABELS,
  validateSearchOrderInput,
  buildSearchOrderPayload,
  normalizeSearchOrderMsgData,
  getRouteLabelCodeMeta,
  summarizeRouteLabelInfo,
  assessSearchOrderResponse,
}
