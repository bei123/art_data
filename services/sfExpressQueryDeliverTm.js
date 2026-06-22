/**
 * EXP_RECE_QUERY_DELIVERTM 时效标准及价格查询（速运类）
 * @see 顺丰开放平台 EXP_RECE_QUERY_DELIVERTM
 */

const SF_DELIVER_TM_BUSINESS_TYPE = {
  EXPRESS: '1',
  STANDARD: '2',
  NEXT_MORNING: '5',
  SAME_DAY: '6',
}

const SF_DELIVER_TM_BUSINESS_TYPE_LABELS = {
  1: '特快时效产品',
  2: '标快时效产品',
  5: '顺丰次晨',
  6: '即日件',
}

const PRESET_TIMELINESS_BUSINESS_TYPES = new Set(['1', '2', '5', '6'])

function clipField(value, maxLen) {
  if (value == null || value === '') return ''
  const str = String(value).trim()
  if (!str) return ''
  return str.length <= maxLen ? str : str.slice(0, maxLen)
}

function normalizeAddress(input) {
  if (!input || typeof input !== 'object') return null
  return {
    province: clipField(input.province, 30) || undefined,
    city: clipField(input.city, 100) || undefined,
    district: clipField(input.district || input.area || input.county, 100) || undefined,
    address: clipField(input.address, 450) || undefined,
    code: clipField(input.code, 30) || undefined,
  }
}

function validateAddress(addr, label) {
  if (!addr) return `${label}不能为空`

  const code = addr.code || ''
  const province = addr.province || ''
  const city = addr.city || ''
  const address = addr.address || ''

  if (code) return null
  if (province && city) return null
  if (address) return null

  return `${label}须填写 code，或 province+city，或含省市信息的 address`
}

function normalizeSearchPrice(searchPrice) {
  if (searchPrice == null || searchPrice === '') return undefined
  const raw = String(searchPrice).trim()
  if (raw === '0' || raw === '1') return raw
  return undefined
}

function normalizeConsignedTime(value) {
  if (value == null || value === '') return undefined
  const raw = String(value).trim()
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) {
    const sec = Number(raw)
    if (!Number.isFinite(sec) || sec <= 0) return undefined
    const d = new Date(sec * 1000)
    if (Number.isNaN(d.getTime())) return undefined
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  return raw.replace(/\s+/g, ' ')
}

function validateQueryDeliverTmInput({
  srcAddress,
  destAddress,
  businessType,
  monthlyCard,
  searchPrice,
}) {
  const src = normalizeAddress(srcAddress)
  const dest = normalizeAddress(destAddress)

  const srcError = validateAddress(src, '原寄地 srcAddress')
  if (srcError) return { ok: false, error: srcError }

  const destError = validateAddress(dest, '目的地 destAddress')
  if (destError) return { ok: false, error: destError }

  if (searchPrice != null && searchPrice !== '' && normalizeSearchPrice(searchPrice) == null) {
    return { ok: false, error: 'searchPrice 仅支持 0、1 或不传' }
  }

  const businessTypeStr = businessType != null && String(businessType).trim() !== ''
    ? String(businessType).trim()
    : ''

  if (businessTypeStr && !PRESET_TIMELINESS_BUSINESS_TYPES.has(businessTypeStr) && !monthlyCard) {
    return { ok: false, error: '查询特定快件产品时须传 monthlyCard（月结卡号）' }
  }

  return {
    ok: true,
    srcAddress: src,
    destAddress: dest,
    businessType: businessTypeStr,
    monthlyCard: monthlyCard ? clipField(monthlyCard, 20) : undefined,
    searchPrice: normalizeSearchPrice(searchPrice),
  }
}

function buildQueryDeliverTmPayload({
  srcAddress,
  destAddress,
  businessType,
  weight,
  volume,
  consignedTime,
  searchPrice,
  monthlyCard,
}) {
  const validated = validateQueryDeliverTmInput({
    srcAddress,
    destAddress,
    businessType,
    monthlyCard,
    searchPrice,
  })
  if (!validated.ok) return validated

  const payload = {
    destAddress: validated.destAddress,
    srcAddress: validated.srcAddress,
  }

  if (validated.businessType) payload.businessType = validated.businessType
  if (validated.searchPrice != null) payload.searchPrice = validated.searchPrice
  if (validated.monthlyCard) payload.monthlyCard = validated.monthlyCard

  if (weight != null && Number(weight) > 0) payload.weight = Number(weight)
  if (volume != null && Number(volume) > 0) payload.volume = Number(volume)

  const consigned = normalizeConsignedTime(consignedTime)
  if (consigned) payload.consignedTime = consigned

  return { ok: true, payload }
}

function mapDeliverTmItem(item) {
  if (!item || typeof item !== 'object') return null
  return {
    business_type: item.businessType != null ? String(item.businessType) : '',
    business_type_desc: item.businessTypeDesc != null ? String(item.businessTypeDesc) : undefined,
    deliver_time: item.deliverTime != null ? String(item.deliverTime) : undefined,
    fee: item.fee != null ? Number(item.fee) : null,
    search_price: item.searchPrice != null ? String(item.searchPrice) : undefined,
    close_time: item.closeTime != null ? String(item.closeTime) : undefined,
  }
}

function assessQueryDeliverTmResponse(msgData) {
  if (!msgData || typeof msgData !== 'object') {
    return { ok: false, error: '顺丰未返回时效价格数据' }
  }

  const rawList = Array.isArray(msgData.deliverTmDto) ? msgData.deliverTmDto : []
  const deliver_tm_list = rawList.map(mapDeliverTmItem).filter(Boolean)

  return {
    ok: true,
    deliver_tm_list,
    count: deliver_tm_list.length,
  }
}

module.exports = {
  SF_DELIVER_TM_BUSINESS_TYPE,
  SF_DELIVER_TM_BUSINESS_TYPE_LABELS,
  normalizeAddress,
  validateQueryDeliverTmInput,
  buildQueryDeliverTmPayload,
  assessQueryDeliverTmResponse,
}
