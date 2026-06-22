/**
 * EXP_RECE_UPDATE_ORDER 订单确认/取消（速运类）
 * @see 顺丰开放平台 EXP_RECE_UPDATE_ORDER
 */

const SF_DEAL_TYPE = {
  CONFIRM: 1,
  CANCEL: 2,
}

const SF_DEAL_TYPE_LABELS = {
  1: '确认',
  2: '取消',
}

const SF_UPDATE_RES_STATUS = {
  ORDER_WAYBILL_MISMATCH: 1,
  SUCCESS: 2,
}

const SF_UPDATE_RES_STATUS_LABELS = {
  1: '客户订单号与顺丰运单不匹配',
  2: '操作成功',
}

function clipField(value, maxLen) {
  if (value == null || value === '') return ''
  const str = String(value).trim()
  if (!str) return ''
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen)
}

function normalizeWaybillNoInfoItem(item) {
  if (!item || typeof item !== 'object') return null
  const waybillNo = clipField(item.waybillNo ?? item.waybill_no, 15)
  if (!waybillNo) return null
  const waybillType = item.waybillType ?? item.waybill_type
  return {
    waybillType: waybillType != null ? Number(waybillType) : 1,
    waybillNo,
    boxNo: item.boxNo ? clipField(item.boxNo, 64) : undefined,
    length: item.length != null ? Number(item.length) : undefined,
    width: item.width != null ? Number(item.width) : undefined,
    height: item.height != null ? Number(item.height) : undefined,
    weight: item.weight != null ? Number(item.weight) : undefined,
  }
}

function buildWaybillNoInfoList(items) {
  if (!Array.isArray(items)) return []
  return items.map(normalizeWaybillNoInfoItem).filter(Boolean)
}

function resolveWaybillNoInfoList({ waybillNoInfoList, waybillId, storedWaybillData }) {
  const fromBody = buildWaybillNoInfoList(waybillNoInfoList)
  if (fromBody.length) return fromBody

  if (waybillId) {
    return [{ waybillType: 1, waybillNo: clipField(waybillId, 15) }]
  }

  if (storedWaybillData && typeof storedWaybillData === 'object') {
    const list = storedWaybillData.waybillNoInfoList
    const parsed = buildWaybillNoInfoList(list)
    if (parsed.length) return parsed
    const single = clipField(storedWaybillData.waybillNo ?? storedWaybillData.mailNo, 15)
    if (single) return [{ waybillType: 1, waybillNo: single }]
  }

  return []
}

function validateUpdateOrderInput({ orderId, dealType, waybillNoInfoList }) {
  const clippedOrderId = clipField(orderId, 64)
  if (!clippedOrderId) {
    return { ok: false, error: '客户订单号 orderId 不能为空', errorCode: '6118' }
  }

  const deal = Number(dealType)
  if (deal !== SF_DEAL_TYPE.CONFIRM && deal !== SF_DEAL_TYPE.CANCEL) {
    return { ok: false, error: 'dealType 仅支持 1（确认）或 2（取消）' }
  }

  if (deal === SF_DEAL_TYPE.CONFIRM && (!Array.isArray(waybillNoInfoList) || !waybillNoInfoList.length)) {
    return { ok: false, error: '订单确认须传 waybillNoInfoList（含母单/子单运单号）' }
  }

  return { ok: true, orderId: clippedOrderId, dealType: deal }
}

function appendPackageSizeFields(payload, {
  totalWeight,
  totalVolume,
  totalLength,
  totalWidth,
  totalHeight,
}) {
  if (totalWeight != null && Number(totalWeight) > 0) payload.totalWeight = Number(totalWeight)
  if (totalVolume != null && Number(totalVolume) > 0) payload.totalVolume = Number(totalVolume)
  if (totalLength != null && Number(totalLength) > 0) payload.totalLength = Number(totalLength)
  if (totalWidth != null && Number(totalWidth) > 0) payload.totalWidth = Number(totalWidth)
  if (totalHeight != null && Number(totalHeight) > 0) payload.totalHeight = Number(totalHeight)
}

function appendNumericFields(payload, fields) {
  const {
    totalWeight,
    totalVolume,
    totalLength,
    totalWidth,
    totalHeight,
    expressTypeId,
    remark,
    sendStartTm,
    isDocall,
  } = fields

  appendPackageSizeFields(payload, {
    totalWeight,
    totalVolume,
    totalLength,
    totalWidth,
    totalHeight,
  })
  if (expressTypeId != null && !Number.isNaN(Number(expressTypeId))) {
    payload.expressTypeId = Number(expressTypeId)
  }
  if (remark) payload.remark = clipField(remark, 100)
  if (sendStartTm) payload.sendStartTm = sendStartTm
  if (isDocall === 0 || isDocall === 1) payload.isDocall = isDocall
}

function buildConfirmOrderPayload({
  orderId,
  waybillNoInfoList,
  totalWeight,
  totalVolume,
  totalLength,
  totalWidth,
  totalHeight,
  expressTypeId,
  remark,
  sendStartTm,
  isDocall,
  serviceList,
  isConfirmNew,
}) {
  const payload = {
    orderId: clipField(orderId, 64),
    dealType: SF_DEAL_TYPE.CONFIRM,
    waybillNoInfoList: buildWaybillNoInfoList(waybillNoInfoList),
  }

  appendNumericFields(payload, {
    totalWeight,
    totalVolume,
    totalLength,
    totalWidth,
    totalHeight,
    expressTypeId,
    remark,
    sendStartTm,
    isDocall,
  })

  if (Array.isArray(serviceList) && serviceList.length) payload.serviceList = serviceList
  if (isConfirmNew === 0 || isConfirmNew === 1) payload.isConfirmNew = isConfirmNew

  return payload
}

function buildCancelOrderPayload({
  orderId,
  totalWeight,
  remark,
}) {
  const payload = {
    language: 'zh-CN',
    orderId: clipField(orderId, 64),
    dealType: SF_DEAL_TYPE.CANCEL,
    waybillNoInfoList: [],
  }

  if (totalWeight != null && Number(totalWeight) > 0) payload.totalWeight = Number(totalWeight)
  if (remark) payload.remark = clipField(remark, 100)

  return payload
}

function getUpdateResStatusMeta(resStatus) {
  const code = Number(resStatus)
  if (Number.isNaN(code)) return null
  return {
    code,
    label: SF_UPDATE_RES_STATUS_LABELS[code] || `resStatus ${code}`,
  }
}

function extractUpdateOrderWaybills(msgData) {
  if (!msgData || typeof msgData !== 'object') return []
  return buildWaybillNoInfoList(msgData.waybillNoInfoList).map((item) => ({
    waybill_type: item.waybillType,
    waybill_no: item.waybillNo,
  }))
}

function assessUpdateOrderResponse(msgData) {
  if (!msgData || typeof msgData !== 'object') {
    return { ok: false, error: '顺丰未返回订单更新结果' }
  }

  const resStatus = msgData.resStatus != null ? Number(msgData.resStatus) : null
  const meta = resStatus != null ? getUpdateResStatusMeta(resStatus) : null

  if (resStatus === SF_UPDATE_RES_STATUS.ORDER_WAYBILL_MISMATCH) {
    return {
      ok: false,
      resStatus,
      res_status_meta: meta,
      error: meta?.label || '客户订单号与顺丰运单不匹配',
      order_id: msgData.orderId,
    }
  }

  if (resStatus != null && resStatus !== SF_UPDATE_RES_STATUS.SUCCESS) {
    return {
      ok: false,
      resStatus,
      res_status_meta: meta,
      error: meta?.label || `订单更新失败（resStatus=${resStatus}）`,
      order_id: msgData.orderId,
    }
  }

  return {
    ok: true,
    resStatus: resStatus ?? SF_UPDATE_RES_STATUS.SUCCESS,
    res_status_meta: meta,
    order_id: msgData.orderId,
    waybill_data: extractUpdateOrderWaybills(msgData),
  }
}

module.exports = {
  SF_DEAL_TYPE,
  SF_DEAL_TYPE_LABELS,
  SF_UPDATE_RES_STATUS,
  SF_UPDATE_RES_STATUS_LABELS,
  buildWaybillNoInfoList,
  resolveWaybillNoInfoList,
  validateUpdateOrderInput,
  buildConfirmOrderPayload,
  buildCancelOrderPayload,
  appendPackageSizeFields,
  getUpdateResStatusMeta,
  assessUpdateOrderResponse,
  extractUpdateOrderWaybills,
}
