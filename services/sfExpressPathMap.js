const {
  resolveSfRouteOpcode,
} = require('./sfExpressConstants')

const DEFAULT_TRANSPORT_ACTION_TYPE = 200001

function parseSfAcceptTime(acceptTime) {
  if (!acceptTime) return 0
  const normalized = String(acceptTime).trim().replace(' ', 'T')
  const ms = Date.parse(normalized)
  if (Number.isNaN(ms)) return 0
  return Math.floor(ms / 1000)
}

function extractRouteReasonCode(route) {
  if (!route || typeof route !== 'object') return ''
  const raw = route.reasonCode ?? route.reason_code ?? route.reasonName ?? route.reason_name
  return raw != null ? String(raw).trim() : ''
}

function sfRouteToPathItem(route) {
  if (!route || typeof route !== 'object') return null
  const opcode = route.opCode != null
    ? String(route.opCode).trim()
    : (route.opcode != null ? String(route.opcode).trim() : '')
  const reasonCode = extractRouteReasonCode(route)
  const remark = String(route.remark || '').trim()
  const address = String(route.acceptAddress || '').trim()
  const resolved = resolveSfRouteOpcode(opcode, remark, reasonCode)
  const statusLabel = route.secondaryStatusName
    || route.firstStatusName
    || resolved.secondaryStatusName
    || resolved.firstStatusName
    || ''
  const actionMsg = remark || resolved.name || statusLabel || address || (opcode ? `节点 ${opcode}` : '')
  return {
    action_time: parseSfAcceptTime(route.acceptTime),
    action_type: opcode || remark ? resolved.actionType : DEFAULT_TRANSPORT_ACTION_TYPE,
    action_msg: actionMsg,
    sf_opcode: opcode || undefined,
    sf_reason_code: reasonCode || undefined,
    sf_opcode_name: resolved.name || undefined,
    sf_first_status_code: route.firstStatusCode ?? resolved.firstStatusCode ?? undefined,
    sf_first_status_name: route.firstStatusName || resolved.firstStatusName || undefined,
    sf_secondary_status_code: route.secondaryStatusCode ?? resolved.secondaryStatusCode ?? undefined,
    sf_secondary_status_name: route.secondaryStatusName || resolved.secondaryStatusName || undefined,
    sf_action_source: resolved.source,
    sf_accept_address: address || undefined,
  }
}

function sfRoutesToPathItemList(routes) {
  if (!Array.isArray(routes)) return []
  return routes.map(sfRouteToPathItem).filter(Boolean)
}

function extractSfRoutesFromSearchResponse(msgData, mailNo) {
  const routeResps = extractRouteRespsFromSearchResponse(msgData)
  if (!routeResps.length) return []

  if (mailNo) {
    const target = routeResps.find((item) => item.mailNo === String(mailNo).trim())
    return Array.isArray(target?.routes) ? target.routes : []
  }

  const first = routeResps[0]
  return Array.isArray(first?.routes) ? first.routes : []
}

function extractRouteRespsFromSearchResponse(msgData) {
  if (!msgData || typeof msgData !== 'object') return []
  if (!Array.isArray(msgData.routeResps)) return []
  return msgData.routeResps
}

function extractPrimaryWaybillNo(msgData) {
  if (!msgData || typeof msgData !== 'object') return ''
  const list = msgData.waybillNoInfoList
  if (!Array.isArray(list) || !list.length) return ''
  const mother = list.find((item) => String(item.waybillType) === '1')
  const picked = mother || list[0]
  return picked?.waybillNo != null ? String(picked.waybillNo).trim() : ''
}

module.exports = {
  sfRouteToPathItem,
  sfRoutesToPathItemList,
  extractSfRoutesFromSearchResponse,
  extractRouteRespsFromSearchResponse,
  extractPrimaryWaybillNo,
}
