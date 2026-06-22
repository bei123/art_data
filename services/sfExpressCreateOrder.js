/**
 * EXP_RECE_CREATE_ORDER 速运类下单（国内件、大陆港澳台互寄）
 * @see 顺丰开放平台 EXP_RECE_CREATE_ORDER
 */

const { buildContactInfo, buildCargoDetails } = require('./sfExpressClient')

const SF_FILTER_RESULT = {
  MANUAL_CONFIRM: 1,
  DELIVERABLE: 2,
  NOT_DELIVERABLE: 3,
  UNKNOWN: 4,
}

const SF_FILTER_RESULT_LABELS = {
  1: '人工确认',
  2: '可收派',
  3: '不可以收派',
  4: '无法确定',
}

const SF_FILTER_REMARK_LABELS = {
  1: '收方超范围',
  2: '派方超范围',
  3: '其它原因',
}

function clipField(value, maxLen) {
  if (value == null || value === '') return ''
  const str = String(value).trim()
  if (!str) return ''
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen)
}

function hasTelOrMobile(party) {
  if (!party || typeof party !== 'object') return false
  return Boolean(
    (party.tel != null && String(party.tel).trim() !== '')
    || (party.mobile != null && String(party.mobile).trim() !== ''),
  )
}

function normalizeParty(party, fallbackContact) {
  if (!party || typeof party !== 'object') return null
  return {
    name: clipField(party.name || party.contact || fallbackContact, 100),
    contact: clipField(party.contact || party.name || fallbackContact, 100),
    tel: clipField(party.tel, 20) || undefined,
    mobile: clipField(party.mobile, 20) || undefined,
    company: clipField(party.company, 100) || undefined,
    province: clipField(party.province, 30) || undefined,
    city: clipField(party.city, 100) || undefined,
    area: clipField(party.area || party.county, 30) || undefined,
    county: clipField(party.county || party.area, 30) || undefined,
    address: clipField(party.address, 200),
    country: clipField(party.country || 'CN', 30) || 'CN',
    postCode: clipField(party.postCode || party.post_code, 25) || undefined,
  }
}

function validateCreateOrderInput({ orderId, sender, receiver, cargo, expressTypeId }) {
  if (!orderId || !String(orderId).trim()) {
    return { ok: false, error: '客户订单号 orderId 不能为空' }
  }
  if (expressTypeId == null || Number.isNaN(Number(expressTypeId))) {
    return { ok: false, error: '快件产品 expressTypeId 无效' }
  }

  const senderNorm = normalizeParty(sender, '寄件人')
  const receiverNorm = normalizeParty(receiver, '收件人')
  if (!senderNorm) return { ok: false, error: '缺少发件人 sender' }
  if (!receiverNorm) return { ok: false, error: '缺少收件人 receiver' }

  if (!senderNorm.address) return { ok: false, error: '寄件地址不能为空', errorCode: '1010' }
  if (!senderNorm.contact) return { ok: false, error: '寄件联系人不能为空', errorCode: '1011' }
  if (!hasTelOrMobile(senderNorm)) return { ok: false, error: '寄件电话不能为空', errorCode: '1012' }

  if (!receiverNorm.address) return { ok: false, error: '到件地址不能为空', errorCode: '1014' }
  if (!receiverNorm.contact) return { ok: false, error: '到件联系人不能为空', errorCode: '1015' }
  if (!hasTelOrMobile(receiverNorm)) return { ok: false, error: '到件电话不能为空', errorCode: '1016' }

  const cargoDetails = buildCargoDetails(cargo)
  if (!cargoDetails.length || !cargoDetails.every((item) => item.name && String(item.name).trim())) {
    return { ok: false, error: '拖寄物品名不能为空', errorCode: '1023' }
  }

  return { ok: true, sender: senderNorm, receiver: receiverNorm, cargoDetails }
}

function resolveIsDocall({ isDocall, sendStartTm }) {
  if (isDocall === 0 || isDocall === 1) return isDocall
  if (isDocall === '0' || isDocall === '1') return Number(isDocall)
  return sendStartTm ? 1 : 0
}

function buildCreateOrderPayload({
  orderId,
  sender,
  receiver,
  cargo,
  expressTypeId,
  payMethod = 1,
  monthlyCard,
  sendStartTm,
  remark,
  serviceList,
  parcelQty = 1,
  isDocall,
  custReferenceNo,
  cargoDesc,
  totalWeight,
}) {
  const payload = {
    language: 'zh-CN',
    orderId: clipField(orderId, 64),
    contactInfoList: buildContactInfo(sender, receiver),
    cargoDetails: buildCargoDetails(cargo),
    expressTypeId: Number(expressTypeId),
    payMethod: Number(payMethod) || 1,
    parcelQty: Math.max(1, Number(parcelQty) || 1),
    isGenWaybillNo: 1,
    isReturnRoutelabel: 1,
    isUnifiedWaybillNo: 1,
    isDocall: resolveIsDocall({ isDocall, sendStartTm }),
  }

  if (monthlyCard) payload.monthlyCard = clipField(monthlyCard, 20)
  if (sendStartTm) payload.sendStartTm = sendStartTm
  if (remark) payload.remark = clipField(remark, 100)
  if (custReferenceNo) payload.custReferenceNo = clipField(custReferenceNo, 100)
  if (cargoDesc) payload.cargoDesc = clipField(cargoDesc, 20)
  if (Array.isArray(serviceList) && serviceList.length) payload.serviceList = serviceList
  if (totalWeight != null && Number(totalWeight) > 0) payload.totalWeight = Number(totalWeight)

  return payload
}

function getFilterResultMeta(filterResult) {
  const code = Number(filterResult)
  if (Number.isNaN(code)) return null
  return {
    code,
    label: SF_FILTER_RESULT_LABELS[code] || `筛单结果 ${code}`,
    remark_code_label: SF_FILTER_REMARK_LABELS[code] || undefined,
  }
}

function assessCreateOrderResponse(msgData) {
  if (!msgData || typeof msgData !== 'object') {
    return { ok: false, error: '顺丰未返回订单数据' }
  }

  const filterResult = msgData.filterResult != null ? Number(msgData.filterResult) : null
  const remark = msgData.remark != null ? String(msgData.remark).trim() : ''
  const filterMeta = filterResult != null ? getFilterResultMeta(filterResult) : null

  if (filterResult === SF_FILTER_RESULT.NOT_DELIVERABLE) {
    const reason = remark || filterMeta?.label || '不可以收派'
    return {
      ok: false,
      filterResult,
      filter_remark: remark || undefined,
      filter_meta: filterMeta,
      error: `筛单失败：${reason}`,
    }
  }

  const result = {
    ok: true,
    filterResult: filterResult ?? undefined,
    filter_remark: remark || undefined,
    filter_meta: filterMeta || undefined,
  }

  if (filterResult === SF_FILTER_RESULT.MANUAL_CONFIRM) {
    result.warning = `筛单结果：人工确认${remark ? `（${remark}）` : ''}`
  } else if (filterResult === SF_FILTER_RESULT.UNKNOWN) {
    result.warning = '筛单结果：无法确定'
  }

  return result
}

function extractWaybillNoInfoList(msgData) {
  if (!msgData || typeof msgData !== 'object') return []
  if (!Array.isArray(msgData.waybillNoInfoList)) return []
  return msgData.waybillNoInfoList
    .map((item) => ({
      waybill_type: item.waybillType,
      waybill_no: item.waybillNo != null ? String(item.waybillNo).trim() : '',
      box_no: item.boxNo || undefined,
    }))
    .filter((item) => item.waybill_no)
}

module.exports = {
  SF_FILTER_RESULT,
  SF_FILTER_RESULT_LABELS,
  SF_FILTER_REMARK_LABELS,
  validateCreateOrderInput,
  buildCreateOrderPayload,
  getFilterResultMeta,
  assessCreateOrderResponse,
  extractWaybillNoInfoList,
}
