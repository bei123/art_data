const axios = require('axios')
const db = require('../db')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const { getAccessToken } = require('./wechatMiniProgramToken')
const { ensureOrderShipmentsTable } = require('../utils/orderShipmentsSchema')
const { fireSubscribeNotify, notifyLogisticsStatus } = require('./subscribeMessageNotify')

const PATH_LAST_REDIS_PREFIX = 'logistics:path:last:'
const PATH_TERMINAL_REDIS_PREFIX = 'logistics:path:terminal:'
const PATH_LAST_TTL_SEC = parseInt(process.env.WX_LOGISTICS_PATH_LAST_TTL_SEC || `${60 * 60 * 24 * 45}`, 10)
const PATH_POLL_MS = parseInt(process.env.WX_LOGISTICS_PATH_POLL_MS || '300000', 10)
const PATH_POLL_BATCH = parseInt(process.env.WX_LOGISTICS_PATH_POLL_BATCH || '20', 10)

const PATH_ACTION_LABELS = {
  100001: '揽件成功',
  100002: '揽件失败',
  100003: '分配业务员',
  200001: '运输中',
  300002: '开始派送',
  300003: '签收成功',
  300004: '签收失败',
  400001: '订单取消',
  400002: '订单滞留',
}

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

function isLogisticsPathNotifyEnabled() {
  if (String(process.env.WX_LOGISTICS_PATH_NOTIFY_ENABLED || 'true').toLowerCase() === 'false') return false
  return isWxSubscribeNotifyEnabled()
}

function pathLastRedisKey(orderId, waybillId) {
  return `${PATH_LAST_REDIS_PREFIX}${orderId}:${String(waybillId || '').trim()}`
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

function formatLogisticsStatusFromNode(node) {
  if (!node) return '物流状态已更新'
  const msg = String(node.action_msg || '').trim()
  if (msg) return clipUtf8(msg, 20)
  const actionType = Number(node.action_type)
  if (PATH_ACTION_LABELS[actionType]) return clipUtf8(PATH_ACTION_LABELS[actionType], 20)
  return '物流状态已更新'
}

function isTerminalPathNode(node) {
  const actionType = Number(node?.action_type)
  return TERMINAL_PATH_ACTION_TYPES.has(actionType)
}

async function getLastPathFingerprint(orderId, waybillId) {
  try {
    return await redisClient.get(pathLastRedisKey(orderId, waybillId))
  } catch {
    return null
  }
}

async function saveLastPathFingerprint(orderId, waybillId, fingerprint, node) {
  try {
    await redisClient.setEx(pathLastRedisKey(orderId, waybillId), PATH_LAST_TTL_SEC, fingerprint)
    if (isTerminalPathNode(node)) {
      await redisClient.setEx(pathTerminalRedisKey(orderId, waybillId), PATH_LAST_TTL_SEC, '1')
    }
  } catch (err) {
    logger.warn('保存物流轨迹指纹失败', { orderId, waybillId, err: err?.message || err })
  }
}

async function isShipmentPathTerminal(orderId, waybillId) {
  try {
    return Boolean(await redisClient.get(pathTerminalRedisKey(orderId, waybillId)))
  } catch {
    return false
  }
}

async function fetchWechatPathRaw({
  orderIdForWx,
  deliveryId,
  waybillId,
  buyerOpenid,
  addSource = 0,
  wxAppid,
}) {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) {
    return { ok: false, error: 'missing_wx_config' }
  }

  const wxPayload = {
    order_id: clipUtf8(orderIdForWx, 500),
    delivery_id: String(deliveryId || '').trim(),
    waybill_id: String(waybillId || '').trim(),
  }
  if (addSource === 0 && buyerOpenid) wxPayload.openid = String(buyerOpenid).trim()
  if (addSource === 2 && wxAppid) wxPayload.wx_appid = clipUtf8(wxAppid, 64)

  try {
    const access_token = await getAccessToken(appid, secret)
    const url = `https://api.weixin.qq.com/cgi-bin/express/business/path/get?access_token=${encodeURIComponent(access_token)}`
    const { data } = await axios.post(url, wxPayload, {
      timeout: 20000,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      responseType: 'json',
    })

    if (data.errcode != null && data.errcode !== 0) {
      return {
        ok: false,
        error: data.errmsg || 'wechat_path_error',
        errcode: data.errcode,
      }
    }

    return {
      ok: true,
      data: {
        path_item_num: data.path_item_num ?? (Array.isArray(data.path_item_list) ? data.path_item_list.length : 0),
        path_item_list: data.path_item_list || [],
      },
    }
  } catch (err) {
    return { ok: false, error: err?.message || 'fetch_path_failed' }
  }
}

/**
 * 对比最新轨迹节点，有变化则推送「物流状态提醒」
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

  const latestNode = pickLatestPathNode(pathItemList)
  if (!latestNode) {
    return { skipped: true, reason: 'empty_path_list' }
  }

  const fingerprint = buildPathNodeFingerprint(latestNode)
  if (!fingerprint) {
    return { skipped: true, reason: 'invalid_path_node' }
  }

  const lastFingerprint = await getLastPathFingerprint(orderId, waybillId)
  if (!force && lastFingerprint === fingerprint) {
    return { skipped: true, reason: 'path_unchanged', fingerprint }
  }

  const logisticsStatus = formatLogisticsStatusFromNode(latestNode)
  const notifyResult = await notifyLogisticsStatus({
    orderId,
    outTradeNo,
    waybillId,
    deliveryId,
    companyName,
    logisticsStatus,
    force,
  })

  if (notifyResult?.skipped && !force) {
    return notifyResult
  }
  if (notifyResult?.ok === false) {
    return notifyResult
  }

  await saveLastPathFingerprint(orderId, waybillId, fingerprint, latestNode)

  logger.info('物流轨迹变更已推送订阅消息', {
    source,
    orderId,
    waybillId,
    actionType: latestNode.action_type,
    logisticsStatus,
  })

  return {
    ok: true,
    notified: true,
    fingerprint,
    logisticsStatus,
    detail: notifyResult,
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

  const addSource = shipmentRow.add_source === 2 ? 2 : 0
  if (addSource === 0 && !shipmentRow.openid) {
    return { skipped: true, reason: 'missing_openid' }
  }

  const fetchResult = await fetchWechatPathRaw({
    orderIdForWx: shipmentRow.out_trade_no,
    deliveryId,
    waybillId,
    buyerOpenid: shipmentRow.openid,
    addSource,
    wxAppid: shipmentRow.wx_appid,
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
      if (result?.notified) notified += 1
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
  })
}

module.exports = {
  PATH_ACTION_LABELS,
  pickLatestPathNode,
  buildPathNodeFingerprint,
  formatLogisticsStatusFromNode,
  handleLogisticsPathNotify,
  handleLogisticsPathNotifyAsync,
  processLogisticsPathPollBatch,
  startLogisticsPathNotifyScheduler,
}
