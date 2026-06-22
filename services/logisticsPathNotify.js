const db = require('../db')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const { fetchSfPathItemList, assertSfConfig } = require('./sfExpressClient')
const { isWxSubscribeNotifyEnabled } = require('../config/wxSubscribeTemplates')
const { ensureOrderShipmentsTable, persistShipmentLatestPath } = require('../utils/orderShipmentsSchema')
const { pickFulfillmentPathNode } = require('../utils/orderFulfillmentStatus')
const { fireSubscribeNotify, notifyLogisticsStatus } = require('./subscribeMessageNotify')
const {
  maybeNotifyConfirmReceiveOnSignOff,
  fireWechatConfirmReceiveNotify,
} = require('./wechatShippingInfoService')

const PATH_SEEN_REDIS_PREFIX = 'logistics:path:seen:'
const PATH_TERMINAL_REDIS_PREFIX = 'logistics:path:terminal:'
const PATH_SEEN_TTL_SEC = parseInt(process.env.WX_LOGISTICS_PATH_LAST_TTL_SEC || `${60 * 60 * 24 * 45}`, 10)
const PATH_POLL_MS = parseInt(process.env.WX_LOGISTICS_PATH_POLL_MS || '300000', 10)
const PATH_POLL_BATCH = parseInt(process.env.WX_LOGISTICS_PATH_POLL_BATCH || '20', 10)
const PATH_NOTIFY_GAP_MS = parseInt(process.env.WX_LOGISTICS_PATH_NOTIFY_GAP_MS || '300', 10)

const PATH_ACTION_LABELS = {
  100001: '揽件成功',
  100002: '揽件失败',
  100003: '分配业务员',
  200001: '运输中',
  300002: '派送中',
  300003: '已签收',
  300004: '签收失败',
  400001: '订单取消',
  400002: '订单滞留',
}

const MILESTONE_PATH_ACTION_TYPES = new Set([100001, 100002, 100003, 300002, 300003, 300004, 400001, 400002])

const TERMINAL_PATH_ACTION_TYPES = new Set([300003, 300004, 400001])

let logisticsPathSchedulerTimer = null

function clipUtf8(str, maxBytes) {
  if (str == null || str === '') return ''
  const buf = Buffer.from(String(str), 'utf8')
  if (buf.length <= maxBytes) return String(str)
  let end = maxBytes
  while (end > 0 && (buf[end - 1] & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf8')
}

function clipText(value, maxLen) {
  if (value == null) return ''
  const str = String(value).trim()
  if (!str) return ''
  return [...str].slice(0, maxLen).join('')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isLogisticsPathNotifyEnabled() {
  if (String(process.env.WX_LOGISTICS_PATH_NOTIFY_ENABLED || 'true').toLowerCase() === 'false') return false
  return isWxSubscribeNotifyEnabled()
}

function pathSeenRedisKey(orderId, waybillId) {
  return `${PATH_SEEN_REDIS_PREFIX}${orderId}:${String(waybillId || '').trim()}`
}

function pathTerminalRedisKey(orderId, waybillId) {
  return `${PATH_TERMINAL_REDIS_PREFIX}${orderId}:${String(waybillId || '').trim()}`
}

function normalizePathItemList(pathItemList) {
  if (!Array.isArray(pathItemList)) return []
  return pathItemList.filter((item) => item && typeof item === 'object')
}

function pickLatestPathNode(pathItemList) {
  const list = normalizePathItemList(pathItemList)
  if (!list.length) return null

  return list.reduce((latest, item) => {
    if (!latest) return item
    const latestTs = Number(latest.action_time) || 0
    const itemTs = Number(item.action_time) || 0
    if (itemTs > latestTs) return item
    if (itemTs < latestTs) return latest
    const latestType = Number(latest.action_type) || 0
    const itemType = Number(item.action_type) || 0
    return itemType >= latestType ? item : latest
  }, null)
}

function buildPathNodeFingerprint(node) {
  if (!node) return ''
  const actionTime = Number(node.action_time) || 0
  const actionType = Number(node.action_type) || 0
  const actionMsg = String(node.action_msg || '').trim()
  return `${actionTime}|${actionType}|${actionMsg}`
}

function sortPathNodesChronologically(pathItemList) {
  return normalizePathItemList(pathItemList).slice().sort((a, b) => {
    const ta = Number(a.action_time) || 0
    const tb = Number(b.action_time) || 0
    if (ta !== tb) return ta - tb
    const typeA = Number(a.action_type) || 0
    const typeB = Number(b.action_type) || 0
    if (typeA !== typeB) return typeA - typeB
    return String(a.action_msg || '').localeCompare(String(b.action_msg || ''))
  })
}

function formatLogisticsStatusFromNode(node) {
  if (!node) return '物流状态已更新'
  const actionType = Number(node.action_type)
  const label = PATH_ACTION_LABELS[actionType]
  const msg = String(node.action_msg || '').trim()

  if (label && MILESTONE_PATH_ACTION_TYPES.has(actionType)) {
    return clipText(label, 20)
  }
  if (msg) return clipText(msg, 20)
  if (label) return clipText(label, 20)
  return '物流状态已更新'
}

function isTerminalPathNode(node) {
  const actionType = Number(node?.action_type)
  return TERMINAL_PATH_ACTION_TYPES.has(actionType)
}

function hasTerminalPathInList(pathItemList) {
  return normalizePathItemList(pathItemList).some((node) => isTerminalPathNode(node))
}

async function loadSeenPathFingerprints(orderId, waybillId) {
  try {
    const raw = await redisClient.get(pathSeenRedisKey(orderId, waybillId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter(Boolean))
  } catch {
    return new Set()
  }
}

async function saveSeenPathFingerprints(orderId, waybillId, seenSet) {
  try {
    await redisClient.setEx(
      pathSeenRedisKey(orderId, waybillId),
      PATH_SEEN_TTL_SEC,
      JSON.stringify([...seenSet]),
    )
  } catch (err) {
    logger.warn('保存物流轨迹已通知节点失败', { orderId, waybillId, err: err?.message || err })
  }
}

async function markShipmentPathTerminal(orderId, waybillId) {
  try {
    await redisClient.setEx(pathTerminalRedisKey(orderId, waybillId), PATH_SEEN_TTL_SEC, '1')
  } catch (err) {
    logger.warn('标记物流终态失败', { orderId, waybillId, err: err?.message || err })
  }
}

async function isShipmentPathTerminal(orderId, waybillId) {
  try {
    return Boolean(await redisClient.get(pathTerminalRedisKey(orderId, waybillId)))
  } catch {
    return false
  }
}

async function fetchSfPathRaw({ orderIdForSf, waybillId }) {
  const auth = assertSfConfig()
  if (!auth.ok) {
    return { ok: false, error: auth.error || 'missing_sf_config' }
  }

  try {
    const result = await fetchSfPathItemList({
      waybillNo: String(waybillId || '').trim(),
      orderId: clipUtf8(orderIdForSf, 500),
    })

    if (!result.ok) {
      return {
        ok: false,
        error: result.error || 'sf_path_error',
        errorCode: result.errorCode,
      }
    }

    const pathItemList = result.path_item_list || []
    return {
      ok: true,
      data: {
        path_item_num: pathItemList.length,
        path_item_list: pathItemList,
      },
    }
  } catch (err) {
    return { ok: false, error: err?.message || 'fetch_path_failed' }
  }
}

function findNewPathNodes(pathItemList, seenSet) {
  const sorted = sortPathNodesChronologically(pathItemList)
  const newNodes = []

  for (const node of sorted) {
    const fingerprint = buildPathNodeFingerprint(node)
    if (!fingerprint || seenSet.has(fingerprint)) continue
    newNodes.push({ node, fingerprint })
  }

  return newNodes
}

/**
 * 每个轨迹节点各推送一次；首次同步仅建立基线，不补发历史节点
 */
async function handleLogisticsPathNotify({
  orderId,
  outTradeNo,
  deliveryId,
  waybillId,
  companyName,
  pathItemList,
  source = 'getPath',
  force = false,
}) {
  if (!isLogisticsPathNotifyEnabled()) {
    return { skipped: true, reason: 'path_notify_disabled' }
  }
  if (!orderId || !waybillId) {
    return { skipped: true, reason: 'missing_order_or_waybill' }
  }

  const nodes = sortPathNodesChronologically(pathItemList)
  if (!nodes.length) {
    return { skipped: true, reason: 'empty_path_list' }
  }

  const latestNode = pickFulfillmentPathNode(nodes)
  if (latestNode) {
    const actionAtSec = Number(latestNode.action_time) || 0
    const actionAt = actionAtSec > 0 ? new Date(actionAtSec * 1000) : new Date()
    await persistShipmentLatestPath({
      orderId,
      waybillId,
      actionType: latestNode.action_type,
      actionAt,
    })
  }

  const seenSet = await loadSeenPathFingerprints(orderId, waybillId)

  if (!force && seenSet.size === 0) {
    for (const node of nodes) {
      const fingerprint = buildPathNodeFingerprint(node)
      if (fingerprint) seenSet.add(fingerprint)
    }
    await saveSeenPathFingerprints(orderId, waybillId, seenSet)
    if (hasTerminalPathInList(nodes)) {
      await markShipmentPathTerminal(orderId, waybillId)
    }
    logger.info('物流轨迹基线已建立（不补发历史节点）', {
      source,
      orderId,
      waybillId,
      nodeCount: nodes.length,
    })
    return { ok: true, baselined: true, notifiedCount: 0, nodeCount: nodes.length }
  }

  const newNodes = findNewPathNodes(nodes, seenSet)
  if (!newNodes.length) {
    return { skipped: true, reason: 'no_new_path_nodes', nodeCount: nodes.length }
  }

  let notifiedCount = 0
  const notifyResults = []

  for (let i = 0; i < newNodes.length; i += 1) {
    const { node, fingerprint } = newNodes[i]
    const logisticsStatus = formatLogisticsStatusFromNode(node)

    const notifyResult = await notifyLogisticsStatus({
      orderId,
      outTradeNo,
      waybillId,
      deliveryId,
      companyName,
      logisticsStatus,
      pathNodeFingerprint: fingerprint,
      force,
    })

    notifyResults.push({ fingerprint, logisticsStatus, result: notifyResult })

    const shouldMarkSeen = notifyResult?.ok === true
      || notifyResult?.skipped
      || notifyResult?.error?.errcode === 43101

    if (shouldMarkSeen) {
      seenSet.add(fingerprint)
      if (notifyResult?.ok === true) notifiedCount += 1
    } else if (notifyResult?.ok === false) {
      logger.warn('物流节点订阅消息未送达，稍后重试', {
        source,
        orderId,
        waybillId,
        actionType: node.action_type,
        logisticsStatus,
        error: notifyResult.error,
      })
      break
    }

    if (i < newNodes.length - 1 && PATH_NOTIFY_GAP_MS > 0) {
      await sleep(PATH_NOTIFY_GAP_MS)
    }
  }

  await saveSeenPathFingerprints(orderId, waybillId, seenSet)

  if (hasTerminalPathInList(nodes)) {
    await markShipmentPathTerminal(orderId, waybillId)
  }

  const signedNodeEntry = newNodes.find(({ node }) => Number(node.action_type) === 300003)
  if (signedNodeEntry) {
    fireWechatConfirmReceiveNotify(
      maybeNotifyConfirmReceiveOnSignOff({
        orderId,
        actionType: signedNodeEntry.node.action_type,
        actionTime: signedNodeEntry.node.action_time,
        force,
      }),
      { orderId, waybillId, source },
    )
  }

  if (notifiedCount > 0) {
    logger.info('物流轨迹新节点已推送订阅消息', {
      source,
      orderId,
      waybillId,
      notifiedCount,
      newNodeCount: newNodes.length,
    })
  }

  return {
    ok: true,
    notified: notifiedCount > 0,
    notifiedCount,
    newNodeCount: newNodes.length,
    nodeCount: nodes.length,
    details: notifyResults,
  }
}

function handleLogisticsPathNotifyAsync(params) {
  fireSubscribeNotify(handleLogisticsPathNotify(params), 'logisticsPath')
}

async function loadActiveShipmentsForPoll(limit) {
  const batch = Math.max(1, Math.min(Number(limit) || PATH_POLL_BATCH, 100))
  try {
    await ensureOrderShipmentsTable()
    const [rows] = await db.query(
      `SELECT
          os.id AS shipment_id,
          os.order_id,
          os.delivery_id,
          os.waybill_id,
          os.add_source,
          os.wx_appid,
          os.company_name,
          o.out_trade_no,
          o.trade_state,
          wu.openid
       FROM order_shipments os
       INNER JOIN orders o ON o.id = os.order_id
       INNER JOIN wx_users wu ON wu.id = o.user_id
       WHERE os.status = 'active'
         AND o.trade_state = 'SUCCESS'
       ORDER BY os.updated_at ASC, os.id ASC
       LIMIT ?`,
      [batch],
    )
    return rows || []
  } catch (err) {
    logger.warn('加载待轮询运单失败', { err: err?.message || err })
    return []
  }
}

async function pollShipmentPathAndNotify(shipmentRow) {
  const orderId = shipmentRow.order_id
  const waybillId = shipmentRow.waybill_id
  const deliveryId = shipmentRow.delivery_id

  if (!orderId || !waybillId || !deliveryId) {
    return { skipped: true, reason: 'invalid_shipment_row' }
  }

  if (await isShipmentPathTerminal(orderId, waybillId)) {
    return { skipped: true, reason: 'terminal' }
  }

  const fetchResult = await fetchSfPathRaw({
    orderIdForSf: shipmentRow.out_trade_no,
    waybillId,
  })

  if (!fetchResult.ok) {
    return { skipped: true, reason: 'fetch_failed', error: fetchResult.error }
  }

  return handleLogisticsPathNotify({
    orderId,
    outTradeNo: shipmentRow.out_trade_no,
    deliveryId,
    waybillId,
    companyName: shipmentRow.company_name || null,
    pathItemList: fetchResult.data.path_item_list,
    source: 'scheduler',
  })
}

async function processLogisticsPathPollBatch() {
  if (!isLogisticsPathNotifyEnabled()) return { processed: 0, notified: 0 }

  const shipments = await loadActiveShipmentsForPoll(PATH_POLL_BATCH)
  let processed = 0
  let notified = 0

  for (const shipment of shipments) {
    processed += 1
    try {
      const result = await pollShipmentPathAndNotify(shipment)
      if (result?.notifiedCount > 0) notified += result.notifiedCount
    } catch (err) {
      logger.warn('物流轨迹轮询异常', {
        orderId: shipment.order_id,
        waybillId: shipment.waybill_id,
        err: err?.message || err,
      })
    }
  }

  if (processed > 0) {
    logger.info('物流轨迹轮询完成', { processed, notified })
  }

  return { processed, notified }
}

function startLogisticsPathNotifyScheduler() {
  if (String(process.env.WX_LOGISTICS_PATH_NOTIFY_SCHEDULER || 'true').toLowerCase() === 'false') {
    return
  }
  if (logisticsPathSchedulerTimer) return

  logisticsPathSchedulerTimer = setInterval(() => {
    processLogisticsPathPollBatch().catch((err) => {
      logger.warn('物流轨迹定时轮询异常', { err: err?.message || err })
    })
  }, Math.max(60000, PATH_POLL_MS))

  setTimeout(() => {
    processLogisticsPathPollBatch().catch((err) => {
      logger.warn('物流轨迹轮询启动扫描异常', { err: err?.message || err })
    })
  }, 15000)

  logger.info('物流轨迹订阅推送调度已启动', {
    pollMs: Math.max(60000, PATH_POLL_MS),
    batch: PATH_POLL_BATCH,
    perNodeNotify: true,
  })
}

module.exports = {
  PATH_ACTION_LABELS,
  pickLatestPathNode,
  buildPathNodeFingerprint,
  formatLogisticsStatusFromNode,
  sortPathNodesChronologically,
  findNewPathNodes,
  handleLogisticsPathNotify,
  handleLogisticsPathNotifyAsync,
  processLogisticsPathPollBatch,
  startLogisticsPathNotifyScheduler,
}
