/**
 * 顺丰路由操作码解析
 * @see https://open.sf-express.com/developSupport/734349?activeIndex=589678
 *
 * 路由节点字段：
 * - opCode → 路由操作码
 * - reasonCode → 原因码（可与 opCode 组合唯一确定操作名称）
 * - firstStatusCode / secondaryStatusCode → 一/二级状态码
 */

const { SF_ROUTE_OPCODE_ROWS } = require('./sfExpressRouteOpcodeData')

/** 微信物流 action_type 兼容值（轨迹展示 / 订阅推送 / 履约状态） */
const ACTION_TYPE = {
  PICKED_UP: 100001,
  PICKUP_FAILED: 100002,
  ASSIGNED_COURIER: 100003,
  IN_TRANSIT: 200001,
  OUT_FOR_DELIVERY: 300002,
  DELIVERED: 300003,
  DELIVERY_FAILED: 300004,
  CANCELLED: 400001,
  DELAYED: 400002,
}

const FIRST_STATUS_ACTION_TYPE = {
  1: ACTION_TYPE.PICKED_UP,
  2: ACTION_TYPE.IN_TRANSIT,
  3: ACTION_TYPE.OUT_FOR_DELIVERY,
  4: ACTION_TYPE.DELIVERED,
  5: ACTION_TYPE.CANCELLED,
  6: ACTION_TYPE.CANCELLED,
  7: ACTION_TYPE.ASSIGNED_COURIER,
  10: ACTION_TYPE.IN_TRANSIT,
  11: ACTION_TYPE.OUT_FOR_DELIVERY,
  13: ACTION_TYPE.OUT_FOR_DELIVERY,
}

const FIRST_STATUS_NAME_ACTION_TYPE = {
  已退回: ACTION_TYPE.CANCELLED,
  已转寄: ACTION_TYPE.IN_TRANSIT,
}

const REMARK_ACTION_RULES = [
  { pattern: /签收|已领取|本人签收|代签/, actionType: ACTION_TYPE.DELIVERED },
  { pattern: /派件|派送|正在派|投递|待取|投柜|自取/, actionType: ACTION_TYPE.OUT_FOR_DELIVERY },
  { pattern: /揽收|收件|收取快件|上门取/, actionType: ACTION_TYPE.PICKED_UP },
  { pattern: /分配.*业务员|业务员|待揽收/, actionType: ACTION_TYPE.ASSIGNED_COURIER },
  { pattern: /取消|退回|退件|拒收|作废/, actionType: ACTION_TYPE.CANCELLED },
  { pattern: /异常|滞留|失败|不成功|问题件/, actionType: ACTION_TYPE.DELAYED },
]

function compositeKey(opCode, reasonCode) {
  const op = opCode != null ? String(opCode).trim() : ''
  const reason = reasonCode != null ? String(reasonCode).trim() : ''
  if (!op) return ''
  return reason ? `${op}:${reason}` : `${op}:`
}

function normalizeExtraRow(row) {
  const opCode = row?.opCode != null ? String(row.opCode).trim() : String(row?.code || '').trim()
  if (!opCode) return null
  const reasonCode = row?.reasonCode != null ? String(row.reasonCode).trim() : ''
  return {
    opCode,
    reasonCode,
    name: String(row.name || `操作码 ${opCode}`).trim(),
    firstStatusCode: row.firstStatusCode != null && row.firstStatusCode !== '-' ? Number(row.firstStatusCode) : null,
    firstStatusName: row.firstStatusName != null ? String(row.firstStatusName).trim() : '',
    secondaryStatusCode: row.secondaryStatusCode != null && row.secondaryStatusCode !== '-' ? Number(row.secondaryStatusCode) : null,
    secondaryStatusName: row.secondaryStatusName != null && row.secondaryStatusName !== '-' ? String(row.secondaryStatusName).trim() : '',
    actionType: row.actionType != null ? Number(row.actionType) : undefined,
  }
}

function rowToMeta(row) {
  const actionType = row.actionType != null && !Number.isNaN(row.actionType)
    ? row.actionType
    : mapFirstStatusToActionType(row.firstStatusCode, row.firstStatusName)
  return {
    opCode: row.opCode,
    reasonCode: row.reasonCode || '',
    name: row.name,
    firstStatusCode: row.firstStatusCode,
    firstStatusName: row.firstStatusName,
    secondaryStatusCode: row.secondaryStatusCode,
    secondaryStatusName: row.secondaryStatusName,
    actionType,
  }
}

function mapFirstStatusToActionType(firstStatusCode, firstStatusName) {
  if (firstStatusCode != null && !Number.isNaN(firstStatusCode)) {
    return FIRST_STATUS_ACTION_TYPE[firstStatusCode] ?? ACTION_TYPE.IN_TRANSIT
  }
  const name = firstStatusName != null ? String(firstStatusName).trim() : ''
  if (name && FIRST_STATUS_NAME_ACTION_TYPE[name] != null) {
    return FIRST_STATUS_NAME_ACTION_TYPE[name]
  }
  return ACTION_TYPE.IN_TRANSIT
}

function parseExtraOpcodeRowsFromEnv() {
  const raw = (process.env.SF_ROUTE_OPCODE_EXTRA || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeExtraRow).filter(Boolean)
  } catch {
    return []
  }
}

function buildIndexes(rows) {
  const byComposite = new Map()
  const byOpcodeDefault = new Map()

  for (const row of rows) {
    const meta = rowToMeta(row)
    const key = compositeKey(meta.opCode, meta.reasonCode)
    byComposite.set(key, meta)
    if (!meta.reasonCode) {
      byOpcodeDefault.set(meta.opCode, meta)
    }
  }

  return { byComposite, byOpcodeDefault }
}

let indexCache = null

function getSfRouteOpcodeIndexes() {
  if (!indexCache) {
    const extra = parseExtraOpcodeRowsFromEnv()
    indexCache = buildIndexes([...SF_ROUTE_OPCODE_ROWS, ...extra])
  }
  return indexCache
}

function resetSfRouteOpcodeCatalogCache() {
  indexCache = null
}

function getSfRouteOpcodeCatalog() {
  const { byComposite } = getSfRouteOpcodeIndexes()
  return Object.fromEntries(byComposite.entries())
}

function getSfRouteOpcodeMeta(opCode, reasonCode) {
  const op = opCode != null ? String(opCode).trim() : ''
  if (!op) return null
  const reason = reasonCode != null ? String(reasonCode).trim() : ''
  const { byComposite, byOpcodeDefault } = getSfRouteOpcodeIndexes()

  if (reason) {
    const exact = byComposite.get(compositeKey(op, reason))
    if (exact) return exact
  }

  return byOpcodeDefault.get(op) || byComposite.get(compositeKey(op, '')) || null
}

function getSfRouteOpcodeName(opCode, reasonCode) {
  return getSfRouteOpcodeMeta(opCode, reasonCode)?.name || ''
}

function inferActionTypeFromRemark(remark) {
  const text = remark != null ? String(remark).trim() : ''
  if (!text) return null
  for (const rule of REMARK_ACTION_RULES) {
    if (rule.pattern.test(text)) return rule.actionType
  }
  return null
}

function resolveSfRouteOpcode(opCode, remark, reasonCode) {
  const meta = getSfRouteOpcodeMeta(opCode, reasonCode)
  if (meta) {
    return {
      name: meta.name,
      actionType: meta.actionType,
      firstStatusCode: meta.firstStatusCode,
      firstStatusName: meta.firstStatusName,
      secondaryStatusCode: meta.secondaryStatusCode,
      secondaryStatusName: meta.secondaryStatusName,
      reasonCode: meta.reasonCode || undefined,
      source: 'catalog',
    }
  }

  const fromRemark = inferActionTypeFromRemark(remark)
  if (fromRemark != null) {
    return {
      name: opCode != null ? `操作码 ${String(opCode).trim()}` : '',
      actionType: fromRemark,
      firstStatusCode: null,
      firstStatusName: '',
      secondaryStatusCode: null,
      secondaryStatusName: '',
      reasonCode: reasonCode != null && String(reasonCode).trim() !== '' ? String(reasonCode).trim() : undefined,
      source: 'remark',
    }
  }

  return {
    name: opCode != null ? `操作码 ${String(opCode).trim()}` : '',
    actionType: ACTION_TYPE.IN_TRANSIT,
    firstStatusCode: null,
    firstStatusName: '',
    secondaryStatusCode: null,
    secondaryStatusName: '',
    reasonCode: reasonCode != null && String(reasonCode).trim() !== '' ? String(reasonCode).trim() : undefined,
    source: 'default',
  }
}

function mapSfOpcodeToActionType(opCode, remark, reasonCode) {
  return resolveSfRouteOpcode(opCode, remark, reasonCode).actionType
}

module.exports = {
  ACTION_TYPE,
  SF_ROUTE_OPCODE_ROWS,
  getSfRouteOpcodeCatalog,
  resetSfRouteOpcodeCatalogCache,
  getSfRouteOpcodeMeta,
  getSfRouteOpcodeName,
  resolveSfRouteOpcode,
  mapSfOpcodeToActionType,
  inferActionTypeFromRemark,
  mapFirstStatusToActionType,
}
