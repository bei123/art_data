/** 公开读接口响应中需剔除的字段（运维/同步/隐藏状态等） */
const PUBLIC_RESPONSE_STRIP_KEYS = [
  'is_hidden',
  'is_public',
  'sort_order',
  'fetched_at',
  'wespace_sync_raw',
  'password_hash',
  'salt',
  'token',
  'refresh_token',
  'openid',
  'institution_id',
  'institution_name',
  'institution_logo',
  'institution_description',
]

function stripPublicFields(value, { extraKeys = [] } = {}) {
  const skip = new Set([...PUBLIC_RESPONSE_STRIP_KEYS, ...extraKeys])
  if (Array.isArray(value)) {
    return value.map((item) => stripPublicFields(item, { extraKeys }))
  }
  if (!value || typeof value !== 'object') return value

  const out = { ...value }
  for (const key of skip) {
    if (key in out) delete out[key]
  }

  if (out.wespace && typeof out.wespace === 'object') {
    const wespace = { ...out.wespace }
    delete wespace.legacy_details_json
    out.wespace = wespace
  }

  return out
}

function notImplementedBody(feature) {
  return {
    code: 501,
    status: false,
    message: feature ? `${feature} 尚未实现` : '接口尚未实现',
    data: null,
  }
}

module.exports = {
  PUBLIC_RESPONSE_STRIP_KEYS,
  stripPublicFields,
  notImplementedBody,
}
