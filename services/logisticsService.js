const db = require('../db')
const logger = require('../utils/logger')
const {
  isWechatShippingUploadEnabled,
  uploadShippingInfoForOrder,
  uploadShippingInfo: uploadWechatShippingInfo,
  uploadCombinedShippingInfo: uploadWechatCombinedShippingInfo,
  getWechatOrder: queryWechatOrderShippingStatus,
  getWechatOrderList: queryWechatOrderList,
  notifyConfirmReceive: notifyWechatConfirmReceive,
  setMsgJumpPath: setWechatMsgJumpPath,
  isTradeManagementConfirmationCompleted: queryWechatTradeManagementConfirmation,
  buildShippingItemDesc,
} = require('./wechatShippingInfoService')
const {
  getDeliveryList: getOpenMsgDeliveryListApi,
  followWaybill,
  queryFollowTrace,
} = require('./wechatExpressOpenMsgService')
const {
  handleLogisticsPathNotifyAsync,
} = require('./logisticsPathNotify')
const { ensureOrderShipmentsTable, persistShipmentLatestPath } = require('../utils/orderShipmentsSchema')
const { ensureRightsShippingColumns } = require('./rightsService')
const { ensureArtworksShippingColumns } = require('../utils/artworkShippingDimensions')
const { pickFulfillmentPathNode } = require('../utils/orderFulfillmentStatus')
const { FIRST_RIGHT_IMAGE_SUBQUERY_SQL } = require('../utils/rightImagesQuery')
const {
  assertSfConfig,
  getSfConfig,
  createOrder,
  updateOrder,
  searchOrder,
  fetchSfPathItemList,
  formatSendStartTm,
  resolvePayAndMonthlyCard,
  buildWaybillPreviewHtml,
  queryDeliverTm: sfQueryDeliverTm,
} = require('./sfExpressClient')
const { extractPrimaryWaybillNo } = require('./sfExpressPathMap')
const { parseSfServiceTypesFromEnv, getAllSfServiceTypes } = require('./sfExpressConstants')
const {
  validateCreateOrderInput,
  buildCreateOrderPayload,
  assessCreateOrderResponse,
  extractWaybillNoInfoList,
} = require('./sfExpressCreateOrder')
const {
  SF_DEAL_TYPE,
  resolveWaybillNoInfoList,
  validateUpdateOrderInput,
  buildConfirmOrderPayload,
  buildCancelOrderPayload,
  assessUpdateOrderResponse,
} = require('./sfExpressUpdateOrder')
const {
  SF_SEARCH_TYPE,
  validateSearchOrderInput,
  buildSearchOrderPayload,
  assessSearchOrderResponse,
} = require('./sfExpressSearchOrder')
const {
  SF_TRACKING_TYPE,
  normalizeCheckPhoneNo,
  buildSearchRoutesPayload,
} = require('./sfExpressSearchRoutes')
const {
  buildQueryDeliverTmPayload,
  assessQueryDeliverTmResponse,
} = require('./sfExpressQueryDeliverTm')
const {
  buildShippingMetricsFromPhysicalItems,
  applyShippingMetricsOverrides,
} = require('./checkoutPricing')

const DELIVERY_ID_SF = 'SF'
const DELIVERY_NAME_SF = '顺丰速运'

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function clipUtf8(str, maxBytes) {
  if (str == null || str === '') return ''
  const buf = Buffer.from(String(str), 'utf8')
  if (buf.length <= maxBytes) return String(str)
  let end = maxBytes
  while (end > 0 && (buf[end - 1] & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf8')
}

function hasTelOrMobile(obj) {
  if (!obj || typeof obj !== 'object') return false
  const tel = obj.tel != null && String(obj.tel).trim() !== ''
  const mobile = obj.mobile != null && String(obj.mobile).trim() !== ''
  return tel || mobile
}

function loadSfServiceTypes() {
  const fromEnv = parseSfServiceTypesFromEnv(process.env.SF_EXPRESS_TYPES)
  if ((process.env.SF_EXPRESS_TYPES || '').trim()) return fromEnv
  return getAllSfServiceTypes()
}

/**
 * 补全轨迹/面单/取消所需的客户订单号 orderId（orders.out_trade_no）
 */
async function resolveLogisticsOrderContext(b) {
  let orderId = b.order_id != null && String(b.order_id).trim() !== '' ? String(b.order_id).trim() : ''

  let internal_order_id = null
  const internalOrderId = parseInt(String(b.internal_order_id ?? ''), 10)
  if (!Number.isNaN(internalOrderId) && internalOrderId > 0) {
    internal_order_id = internalOrderId
    const [orderRows] = await db.query(
      'SELECT id, out_trade_no FROM orders WHERE id = ? LIMIT 1',
      [internalOrderId]
    )
    if (!orderRows || orderRows.length === 0) {
      return { error: adminResult(404, { error: '订单不存在' }) }
    }
    if (!orderId) orderId = String(orderRows[0].out_trade_no || '').trim()
  }

  if (!orderId) {
    return {
      error: adminResult(400, {
        error: '缺少 order_id（客户订单号）；可传 internal_order_id 以自动使用 out_trade_no',
      }),
    }
  }

  return { order_id: orderId, internal_order_id }
}

async function loadShippableOrderContext(internalOrderId) {
  await ensureRightsShippingColumns()
  await ensureArtworksShippingColumns()

  const [orderRows] = await db.query(
    `SELECT o.id, o.out_trade_no, o.user_id, o.trade_state, o.body, o.transaction_id,
            u.openid AS buyer_openid
     FROM orders o
     LEFT JOIN wx_users u ON u.id = o.user_id
     WHERE o.id = ?
     LIMIT 1`,
    [internalOrderId]
  )
  if (!orderRows || orderRows.length === 0) {
    return { error: adminResult(404, { error: '订单不存在' }) }
  }
  const orderRow = orderRows[0]
  if (orderRow.trade_state !== 'SUCCESS') {
    return { error: adminResult(400, { error: '仅支付成功的订单可发货', trade_state: orderRow.trade_state }) }
  }

  const [refundBlocking] = await db.query(
    `SELECT COUNT(*) AS c FROM refund_requests
     WHERE out_trade_no = ? AND status IN ('APPROVED', 'PROCESSING')`,
    [orderRow.out_trade_no]
  )
  if (refundBlocking && refundBlocking[0] && Number(refundBlocking[0].c) > 0) {
    return { error: adminResult(400, { error: '订单存在进行中或已同意的退款，暂不可发货' }) }
  }

  const [physicalItems] = await db.query(
    `SELECT
        oi.id,
        oi.type,
        oi.quantity,
        oi.right_id,
        oi.artwork_id,
        oi.address_id,
        COALESCE(r.title, oa.title) AS item_title,
        ${FIRST_RIGHT_IMAGE_SUBQUERY_SQL},
        oa.image AS artwork_image,
        r.length_cm AS right_length_cm,
        r.width_cm AS right_width_cm,
        r.height_cm AS right_height_cm,
        r.weight_kg AS right_weight_kg,
        oa.collection_size,
        oa.length_cm AS artwork_length_cm,
        oa.width_cm AS artwork_width_cm,
        oa.height_cm AS artwork_height_cm,
        oa.weight_kg AS artwork_weight_kg,
        wa.receiver_name,
        wa.receiver_phone,
        wa.province,
        wa.city,
        wa.district,
        wa.detail_address
      FROM order_items oi
      LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
      LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
      LEFT JOIN wx_user_addresses wa ON oi.address_id = wa.id
      WHERE oi.order_id = ? AND oi.type IN ('right', 'artwork')`,
    [internalOrderId]
  )

  if (!physicalItems || physicalItems.length === 0) {
    return { error: adminResult(400, { error: '订单不含实物商品（权益/原作），无需发货' }) }
  }

  const missingAddr = physicalItems.filter((row) => !row.address_id || !row.receiver_phone)
  if (missingAddr.length > 0) {
    return { error: adminResult(400, { error: '存在未绑定收货地址的实物订单项，请先完善收货地址' }) }
  }

  const addrIds = [...new Set(physicalItems.map((r) => r.address_id))]
  if (addrIds.length > 1) {
    return { error: adminResult(400, { error: '实物商品存在多个不同收货地址，请拆分订单或统一地址后再发货' }) }
  }

  const firstAddr = physicalItems[0]
  const receiver = {
    name: clipUtf8(firstAddr.receiver_name || '', 64),
    mobile: clipUtf8(String(firstAddr.receiver_phone || '').trim(), 32),
    province: clipUtf8(firstAddr.province || '', 64),
    city: clipUtf8(firstAddr.city || '', 64),
    area: clipUtf8(firstAddr.district || '', 64),
    address: clipUtf8(firstAddr.detail_address || '', 512),
  }
  if (!hasTelOrMobile(receiver)) {
    return { error: adminResult(400, { error: '收件人手机号无效' }) }
  }

  const cargoDefault = {
    count: physicalItems.reduce((sum, row) => sum + (Number(row.quantity) || 1), 0),
    detail_list: physicalItems.map((row) => ({
      name: clipUtf8(row.item_title || '商品', 128),
      count: Number(row.quantity) > 0 ? Number(row.quantity) : 1,
    })),
  }

  const goodsItems = physicalItems.map((row) => ({
    item_title: row.item_title || '商品',
    image_url: row.type === 'artwork' ? row.artwork_image : row.right_image_url,
    quantity: Number(row.quantity) > 0 ? Number(row.quantity) : 1,
  }))

  const shippingMetrics = buildShippingMetricsFromPhysicalItems(physicalItems)

  return { orderRow, receiver, cargoDefault, physicalItems, goodsItems, shippingMetrics }
}

function buildFollowGoodsFromCargo(cargoDefault, goodsItems) {
  if (Array.isArray(goodsItems) && goodsItems.length) return goodsItems
  const details = cargoDefault?.detail_list
  if (!Array.isArray(details)) return []
  return details.map((row) => ({
    item_title: row.name || '商品',
    image_url: null,
  }))
}

async function persistFollowResult(shipmentId, followResult) {
  if (!shipmentId) return followResult
  await ensureOrderShipmentsTable()
  if (followResult?.ok && followResult.body?.waybill_token) {
    await db.query(
      `UPDATE order_shipments
       SET waybill_token = ?, follow_status = 'followed', follow_error = NULL, updated_at = NOW()
       WHERE id = ?`,
      [String(followResult.body.waybill_token), shipmentId]
    )
    return {
      ok: true,
      waybill_token: followResult.body.waybill_token,
      follow_status: 'followed',
    }
  }

  const errMsg = clipUtf8(
    followResult?.body?.error || followResult?.body?.errmsg || followResult?.error || 'follow_waybill 失败',
    512,
  )
  await db.query(
    `UPDATE order_shipments
     SET follow_status = 'failed', follow_error = ?, updated_at = NOW()
     WHERE id = ?`,
    [errMsg, shipmentId]
  )
  return {
    ok: false,
    follow_status: 'failed',
    error: errMsg,
    errcode: followResult?.body?.errcode,
  }
}

async function followWaybillForShipment({
  shipmentId,
  orderRow,
  receiver,
  waybillId,
  deliveryId,
  goodsItems,
  senderPhone = null,
}) {
  const openid = orderRow.buyer_openid || orderRow.openid
  const transId = orderRow.transaction_id
  if (!openid) {
    return persistFollowResult(shipmentId, {
      ok: false,
      body: { error: '订单用户缺少 openid，无法登记物流消息' },
    })
  }
  if (!transId) {
    return persistFollowResult(shipmentId, {
      ok: false,
      body: { error: '订单缺少微信支付 transaction_id，无法登记物流消息' },
    })
  }

  await db.query(
    `UPDATE order_shipments SET follow_status = 'pending', follow_error = NULL, updated_at = NOW() WHERE id = ?`,
    [shipmentId]
  )

  const followResult = await followWaybill({
    openid,
    receiverPhone: receiver.mobile || receiver.tel,
    waybillId,
    transId,
    outTradeNo: orderRow.out_trade_no,
    goodsItems,
    deliveryId,
    senderPhone,
  })
  return persistFollowResult(shipmentId, followResult)
}

/**
 * 运力列表：优先微信物流消息 get_delivery_list；失败回退顺丰硬编码
 */
async function getAllDelivery() {
  try {
    const openMsg = await getOpenMsgDeliveryListApi()
    if (openMsg.ok && Array.isArray(openMsg.body?.delivery_list) && openMsg.body.delivery_list.length) {
      const list = openMsg.body.delivery_list.map((row) => ({
        delivery_id: row.delivery_id,
        delivery_name: row.delivery_name,
        service_type: row.delivery_id === DELIVERY_ID_SF ? loadSfServiceTypes() : undefined,
      }))
      return adminResult(200, {
        count: list.length,
        provider: 'wechat-open-msg',
        configured: true,
        data: list,
      })
    }
  } catch (err) {
    logger.warn('getAllDelivery open_msg 失败，回退顺丰列表', { err: err.message })
  }

  const auth = assertSfConfig()
  if (!auth.ok) {
    return adminResult(503, { error: auth.error, configured: false })
  }

  return adminResult(200, {
    count: 1,
    provider: 'sf-express',
    configured: true,
    data: [{
      delivery_id: DELIVERY_ID_SF,
      delivery_name: DELIVERY_NAME_SF,
      service_type: loadSfServiceTypes(),
    }],
  })
}

/**
 * 仅 open_msg 运力列表（管理端手工发货下拉）
 */
async function getOpenMsgDeliveryList() {
  const result = await getOpenMsgDeliveryListApi()
  if (!result.ok) return result
  return adminResult(200, {
    count: result.body?.count || 0,
    delivery_list: result.body?.delivery_list || [],
    cached: result.body?.cached || false,
  })
}

/**
 * 顺丰开放平台：下单（EXP_RECE_CREATE_ORDER）
 */
async function addOrder(req) {
  const auth = assertSfConfig()
  if (!auth.ok) {
    logger.error('addOrder: 顺丰配置不完整')
    return adminResult(503, { error: auth.error })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const internalOrderId = parseInt(String(b.internal_order_id ?? b.order_id ?? ''), 10)
  if (!internalOrderId || Number.isNaN(internalOrderId) || internalOrderId <= 0) {
    return adminResult(400, { error: '缺少有效的 internal_order_id（或 order_id）' })
  }

  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : DELIVERY_ID_SF
  if (delivery_id !== DELIVERY_ID_SF) {
    return adminResult(400, { error: '当前仅支持顺丰（SF）发货' })
  }

  const sender = b.sender
  if (!sender || typeof sender !== 'object') return adminResult(400, { error: '缺少发件人 sender' })

  const service_type = b.service_type
  if (service_type === undefined || service_type === null || Number.isNaN(Number(service_type))) {
    return adminResult(400, { error: '缺少有效的 service_type（快件产品 expressTypeId）' })
  }

  const service_name = b.service_name != null ? String(b.service_name).trim() : ''
  const cfg = getSfConfig()
  const expressTypeId = Number(service_type) || cfg.defaultExpressTypeId

  const expect_time = b.expect_time
  if (expect_time === undefined) {
    return adminResult(400, { error: '顺丰发货须传 expect_time（Unix 秒；0 表示已约定取件时间）' })
  }

  try {
    const shipCtx = await loadShippableOrderContext(internalOrderId)
    if (shipCtx.error) return shipCtx.error
    const { orderRow, receiver, cargoDefault, shippingMetrics } = shipCtx
    const packageMetrics = applyShippingMetricsOverrides(shippingMetrics, b)

    const sfOrderIdRaw = b.sf_order_id != null && String(b.sf_order_id).trim() !== ''
      ? String(b.sf_order_id).trim()
      : String(orderRow.out_trade_no || '').trim()
    const sfOrderId = clipUtf8(sfOrderIdRaw, 64)
    if (!sfOrderId) {
      return adminResult(400, { error: '无法生成客户订单号 orderId，请传 sf_order_id' })
    }

    const cargo = b.cargo && typeof b.cargo === 'object' ? b.cargo : cargoDefault
    const senderOut = {
      name: sender.name != null ? clipUtf8(String(sender.name), 64) : undefined,
      tel: sender.tel != null ? clipUtf8(String(sender.tel), 32) : undefined,
      mobile: sender.mobile != null ? clipUtf8(String(sender.mobile), 32) : undefined,
      company: sender.company != null ? clipUtf8(String(sender.company), 100) : undefined,
      province: sender.province != null ? clipUtf8(String(sender.province), 64) : undefined,
      city: sender.city != null ? clipUtf8(String(sender.city), 64) : undefined,
      area: sender.area != null ? clipUtf8(String(sender.area), 64) : undefined,
      address: sender.address != null ? clipUtf8(String(sender.address), 200) : undefined,
      country: sender.country != null ? clipUtf8(String(sender.country), 30) : undefined,
    }

    const inputCheck = validateCreateOrderInput({
      orderId: sfOrderId,
      sender: senderOut,
      receiver,
      cargo,
      expressTypeId,
    })
    if (!inputCheck.ok) {
      return adminResult(400, {
        error: inputCheck.error,
        errorCode: inputCheck.errorCode,
      })
    }

    const payInfo = resolvePayAndMonthlyCard(b.biz_id)
    const insuredIn = b.insured && typeof b.insured === 'object' ? b.insured : {}
    const useInsured = insuredIn.use_insured === 1
    const insuredValueFen = insuredIn.insured_value != null ? Number(insuredIn.insured_value) : 0
    const sendStartTm = formatSendStartTm(expect_time)

    let serviceList
    if (useInsured && Number.isFinite(insuredValueFen) && insuredValueFen > 0) {
      const insuredYuan = Math.max(1, Math.round(insuredValueFen / 100))
      serviceList = [{ name: 'INSURE', value: String(insuredYuan) }]
    }

    const sfPayload = buildCreateOrderPayload({
      orderId: sfOrderId,
      sender: inputCheck.sender,
      receiver: inputCheck.receiver,
      cargo,
      expressTypeId,
      payMethod: payInfo.payMethod,
      monthlyCard: payInfo.monthlyCard ? clipUtf8(payInfo.monthlyCard, 20) : undefined,
      sendStartTm,
      remark: b.custom_remark != null ? clipUtf8(String(b.custom_remark), 100) : undefined,
      serviceList,
      parcelQty: b.parcel_qty,
      isDocall: b.is_docall,
      custReferenceNo: orderRow.out_trade_no || String(internalOrderId),
      totalWeight: packageMetrics.totalWeight,
      totalVolume: packageMetrics.totalVolume,
      totalLength: packageMetrics.totalLength,
      totalWidth: packageMetrics.totalWidth,
      totalHeight: packageMetrics.totalHeight,
    })

    const sfResult = await createOrder(sfPayload)
    if (!sfResult.ok) {
      return adminResult(502, {
        error: sfResult.error || '顺丰下单失败',
        errorCode: sfResult.errorCode,
        apiResultCode: sfResult.apiResultCode,
        sf_error: sfResult.sf_error,
      })
    }

    const waybillId = extractPrimaryWaybillNo(sfResult.msgData)
    if (!waybillId) {
      return adminResult(502, { error: '顺丰未返回运单号', sf_response: sfResult.msgData })
    }

    const filterAssessment = assessCreateOrderResponse(sfResult.msgData)
    if (!filterAssessment.ok) {
      return adminResult(422, {
        error: filterAssessment.error,
        order_id: sfOrderId,
        waybill_id: waybillId,
        filter_result: filterAssessment.filterResult,
        filter_remark: filterAssessment.filter_remark,
        filter_meta: filterAssessment.filter_meta,
        sf_response: sfResult.msgData,
        provider: 'sf-express',
      })
    }

    let shipment_persisted = true
    let shipmentId = null
    const companyName = b.delivery_name || b.company_name
      ? clipUtf8(String(b.delivery_name || b.company_name).trim(), 64)
      : DELIVERY_NAME_SF
    const bizIdStored = payInfo.monthlyCard || 'SF_CASH'

    try {
      await ensureOrderShipmentsTable()
      const [insertResult] = await db.query(
        `INSERT INTO order_shipments (
          order_id, delivery_id, waybill_id, wechat_order_id, biz_id, service_type, service_name,
          use_insured, insured_value_fen, add_source, wx_appid, waybill_data_json, company_name,
          ship_source, follow_status, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sf', 'pending', 'active')`,
        [
          internalOrderId,
          DELIVERY_ID_SF,
          String(waybillId).trim(),
          clipUtf8(sfOrderId, 512),
          clipUtf8(bizIdStored, 64),
          expressTypeId,
          clipUtf8(service_name || `expressTypeId:${expressTypeId}`, 128),
          useInsured ? 1 : 0,
          Number.isFinite(insuredValueFen) ? Math.round(insuredValueFen) : 0,
          0,
          null,
          JSON.stringify(sfResult.msgData || {}),
          companyName,
        ]
      )
      shipmentId = insertResult?.insertId || null
    } catch (dbErr) {
      shipment_persisted = false
      logger.error('addOrder 顺丰已成功但写入 order_shipments 失败', {
        err: dbErr,
        internalOrderId,
        waybill_id: waybillId,
      })
    }

    let open_msg_follow = { skipped: true, reason: 'shipment_not_persisted' }
    if (shipment_persisted && shipmentId) {
      const goodsItems = buildFollowGoodsFromCargo(cargoDefault, shipCtx.goodsItems)
      open_msg_follow = await followWaybillForShipment({
        shipmentId,
        orderRow,
        receiver,
        waybillId: String(waybillId).trim(),
        deliveryId: DELIVERY_ID_SF,
        goodsItems,
        senderPhone: senderOut.mobile || senderOut.tel,
      })
    }

    let wx_shipping_upload = { skipped: true, reason: 'disabled' }
    if (isWechatShippingUploadEnabled()) {
      const wxUploadResult = await uploadShippingInfoForOrder({
        internalOrderId,
        waybillId: String(waybillId).trim(),
        deliveryId: DELIVERY_ID_SF,
        itemDesc: buildShippingItemDesc(
          (cargo?.detail_list || []).map((row) => ({
            item_title: row.name,
            quantity: row.count,
          })),
        ),
        receiverPhone: receiver.mobile || receiver.tel,
        consignorPhone: senderOut.mobile || senderOut.tel,
      })
      if (wxUploadResult.ok) {
        wx_shipping_upload = { ok: true, errcode: wxUploadResult.body?.errcode ?? 0 }
      } else {
        wx_shipping_upload = {
          ok: false,
          errcode: wxUploadResult.body?.errcode,
          error: wxUploadResult.body?.error,
          errmsg: wxUploadResult.body?.errmsg,
        }
        logger.warn('顺丰发货成功但微信发货信息录入失败', {
          internalOrderId,
          waybill_id: waybillId,
          wx_shipping_upload,
        })
      }
    }

    return adminResult(200, {
      internal_order_id: internalOrderId,
      out_trade_no: orderRow.out_trade_no,
      order_id: sfOrderId,
      waybill_id: waybillId,
      waybill_data: extractWaybillNoInfoList(sfResult.msgData),
      route_label_info: sfResult.msgData?.routeLabelInfo || null,
      filter_result: filterAssessment.filterResult,
      filter_remark: filterAssessment.filter_remark,
      filter_warning: filterAssessment.warning,
      origin_code: sfResult.msgData?.originCode,
      dest_code: sfResult.msgData?.destCode,
      shipping_metrics: packageMetrics,
      shipment_persisted,
      open_msg_follow,
      wx_shipping_upload,
      provider: 'sf-express',
    })
  } catch (err) {
    logger.error('addOrder 失败', { err })
    return adminResult(500, { error: '生成运单失败', detail: err.message })
  }
}

/**
 * 手工填运单号发货 → follow_waybill + upload_shipping_info
 */
async function addManualShipment(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const internalOrderId = parseInt(String(b.internal_order_id ?? b.order_id ?? ''), 10)
  if (!internalOrderId || Number.isNaN(internalOrderId) || internalOrderId <= 0) {
    return adminResult(400, { error: '缺少有效的 internal_order_id（或 order_id）' })
  }

  const deliveryId = b.delivery_id != null ? String(b.delivery_id).trim() : ''
  const waybillId = b.waybill_id != null ? String(b.waybill_id).trim() : ''
  if (!deliveryId) return adminResult(400, { error: '缺少 delivery_id（运力公司）' })
  if (!waybillId) return adminResult(400, { error: '缺少 waybill_id（运单号）' })

  try {
    const shipCtx = await loadShippableOrderContext(internalOrderId)
    if (shipCtx.error) return shipCtx.error
    const { orderRow, receiver, cargoDefault, goodsItems } = shipCtx

    const phoneOverride = b.receiver_phone != null ? String(b.receiver_phone).trim() : ''
    if (phoneOverride) {
      receiver.mobile = clipUtf8(phoneOverride, 32)
      receiver.tel = clipUtf8(phoneOverride, 32)
    }
    if (!receiver.mobile && !receiver.tel) {
      return adminResult(400, { error: '缺少收件人手机号' })
    }

    const companyName = b.company_name || b.delivery_name
      ? clipUtf8(String(b.company_name || b.delivery_name).trim(), 64)
      : deliveryId

    await ensureOrderShipmentsTable()
    const [insertResult] = await db.query(
      `INSERT INTO order_shipments (
        order_id, delivery_id, waybill_id, wechat_order_id, biz_id, service_type, service_name,
        use_insured, insured_value_fen, add_source, wx_appid, waybill_data_json, company_name,
        ship_source, follow_status, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, ?, ?, 'manual', 'pending', 'active')`,
      [
        internalOrderId,
        clipUtf8(deliveryId, 64),
        clipUtf8(waybillId, 128),
        clipUtf8(orderRow.out_trade_no || String(internalOrderId), 512),
        'MANUAL',
        0,
        'manual',
        JSON.stringify({ manual: true, delivery_id: deliveryId, waybill_id: waybillId }),
        companyName,
      ]
    )
    const shipmentId = insertResult?.insertId || null
    if (!shipmentId) {
      return adminResult(500, { error: '写入运单记录失败' })
    }

    const open_msg_follow = await followWaybillForShipment({
      shipmentId,
      orderRow,
      receiver,
      waybillId,
      deliveryId,
      goodsItems: buildFollowGoodsFromCargo(cargoDefault, goodsItems),
      senderPhone: b.sender_phone != null ? String(b.sender_phone).trim() : null,
    })

    let wx_shipping_upload = { skipped: true, reason: 'disabled' }
    if (isWechatShippingUploadEnabled()) {
      const wxUploadResult = await uploadShippingInfoForOrder({
        internalOrderId,
        waybillId,
        deliveryId,
        itemDesc: buildShippingItemDesc(
          (cargoDefault?.detail_list || []).map((row) => ({
            item_title: row.name,
            quantity: row.count,
          })),
        ),
        receiverPhone: receiver.mobile || receiver.tel,
        consignorPhone: b.sender_phone != null ? String(b.sender_phone).trim() : undefined,
      })
      if (wxUploadResult.ok) {
        wx_shipping_upload = { ok: true, errcode: wxUploadResult.body?.errcode ?? 0 }
      } else {
        wx_shipping_upload = {
          ok: false,
          errcode: wxUploadResult.body?.errcode,
          error: wxUploadResult.body?.error,
          errmsg: wxUploadResult.body?.errmsg,
        }
        logger.warn('手工发货成功但微信发货信息录入失败', {
          internalOrderId,
          waybill_id: waybillId,
          wx_shipping_upload,
        })
      }
    }

    return adminResult(200, {
      internal_order_id: internalOrderId,
      out_trade_no: orderRow.out_trade_no,
      shipment_id: shipmentId,
      delivery_id: deliveryId,
      waybill_id: waybillId,
      company_name: companyName,
      ship_source: 'manual',
      open_msg_follow,
      wx_shipping_upload,
    })
  } catch (err) {
    logger.error('addManualShipment 失败', { err })
    return adminResult(500, { error: '手工发货失败', detail: err.message })
  }
}

/**
 * 对已有 shipment 补调 follow_waybill
 */
async function retryFollowWaybill(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const shipmentId = parseInt(String(b.shipment_id ?? b.id ?? ''), 10)
  if (!shipmentId || Number.isNaN(shipmentId) || shipmentId <= 0) {
    return adminResult(400, { error: '缺少有效的 shipment_id' })
  }

  try {
    await ensureOrderShipmentsTable()
    const [rows] = await db.query(
      `SELECT s.*, o.out_trade_no, o.transaction_id, o.user_id, u.openid AS buyer_openid
       FROM order_shipments s
       INNER JOIN orders o ON o.id = s.order_id
       LEFT JOIN wx_users u ON u.id = o.user_id
       WHERE s.id = ?
       LIMIT 1`,
      [shipmentId]
    )
    if (!rows || !rows.length) {
      return adminResult(404, { error: '运单记录不存在' })
    }
    const shipment = rows[0]
    if (shipment.status && shipment.status !== 'active') {
      return adminResult(400, { error: '运单已取消，无法登记物流消息' })
    }

    const shipCtx = await loadShippableOrderContext(shipment.order_id)
    if (shipCtx.error) return shipCtx.error
    const { orderRow, receiver, cargoDefault, goodsItems } = shipCtx

    const phoneOverride = b.receiver_phone != null ? String(b.receiver_phone).trim() : ''
    if (phoneOverride) {
      receiver.mobile = clipUtf8(phoneOverride, 32)
      receiver.tel = clipUtf8(phoneOverride, 32)
    }

    orderRow.buyer_openid = shipment.buyer_openid || orderRow.buyer_openid
    orderRow.transaction_id = shipment.transaction_id || orderRow.transaction_id

    const open_msg_follow = await followWaybillForShipment({
      shipmentId,
      orderRow,
      receiver,
      waybillId: shipment.waybill_id,
      deliveryId: shipment.delivery_id,
      goodsItems: buildFollowGoodsFromCargo(cargoDefault, goodsItems),
      senderPhone: b.sender_phone != null ? String(b.sender_phone).trim() : null,
    })

    return adminResult(200, {
      shipment_id: shipmentId,
      delivery_id: shipment.delivery_id,
      waybill_id: shipment.waybill_id,
      open_msg_follow,
    })
  } catch (err) {
    logger.error('retryFollowWaybill 失败', { err })
    return adminResult(500, { error: '重试物流消息失败', detail: err.message })
  }
}

/**
 * 按 waybill_token 查询物流消息轨迹
 */
async function queryOpenMsgFollowTrace(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  let waybillToken = b.waybill_token != null ? String(b.waybill_token).trim() : ''

  if (!waybillToken && b.shipment_id) {
    const shipmentId = parseInt(String(b.shipment_id), 10)
    if (shipmentId > 0) {
      await ensureOrderShipmentsTable()
      const [rows] = await db.query(
        `SELECT waybill_token FROM order_shipments WHERE id = ? LIMIT 1`,
        [shipmentId]
      )
      waybillToken = rows?.[0]?.waybill_token ? String(rows[0].waybill_token) : ''
    }
  }

  if (!waybillToken) {
    return adminResult(400, { error: '缺少 waybill_token 或 shipment_id' })
  }

  const result = await queryFollowTrace({ waybillToken })
  if (!result.ok) return result
  return adminResult(200, result.body || {})
}

/**
 * 顺丰：查询运单轨迹（EXP_RECE_SEARCH_ROUTES）
 * 支持三种查询：运单号（月结绑定）、客户订单号、运单号+收寄方电话后4位
 */
async function getPath(req) {
  const auth = assertSfConfig()
  if (!auth.ok) {
    logger.error('getPath: 顺丰配置不完整')
    return adminResult(503, { error: auth.error })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : DELIVERY_ID_SF
  const waybill_id = b.waybill_id != null ? String(b.waybill_id).trim() : ''
  if (delivery_id !== DELIVERY_ID_SF) {
    return adminResult(400, { error: '当前仅支持顺丰（SF）轨迹查询' })
  }

  try {
    const ctx = await resolveLogisticsOrderContext(b)
    if (ctx.error) return ctx.error

    const trackingTypeRaw = b.tracking_type != null ? Number(b.tracking_type) : null
    const trackingType = trackingTypeRaw === SF_TRACKING_TYPE.ORDER_ID
      ? SF_TRACKING_TYPE.ORDER_ID
      : (waybill_id ? SF_TRACKING_TYPE.WAYBILL : SF_TRACKING_TYPE.ORDER_ID)

    const trackingNumber = Array.isArray(b.tracking_numbers) && b.tracking_numbers.length
      ? b.tracking_numbers
      : (trackingType === SF_TRACKING_TYPE.WAYBILL
        ? (waybill_id ? [waybill_id] : [])
        : [ctx.order_id])

    const routePayload = buildSearchRoutesPayload({
      trackingType,
      trackingNumber,
      language: b.language,
      methodType: b.method_type,
      checkPhoneNo: normalizeCheckPhoneNo(b.check_phone_no ?? b.receiver_phone),
      referenceNumber: b.reference_number,
    })
    if (!routePayload.ok) {
      return adminResult(400, {
        error: routePayload.error,
        errorCode: routePayload.errorCode,
      })
    }

    const pathResult = await fetchSfPathItemList({
      ...routePayload.payload,
      waybillNo: waybill_id || undefined,
      orderId: ctx.order_id,
    })

    if (!pathResult.ok) {
      return adminResult(502, {
        error: pathResult.error || '查询运单轨迹失败',
        errorCode: pathResult.errorCode,
        sf_error: pathResult.sf_error,
      })
    }

    const pathItemList = pathResult.path_item_list || []
    const resolvedWaybillId = waybill_id || pathResult.mail_no || ''
    const skipPathNotify = b.skip_path_notify === true || b.skipPathNotify === true

    if (ctx.internal_order_id && pathItemList.length) {
      const latestNode = pickFulfillmentPathNode(pathItemList)
      if (latestNode?.action_type != null) {
        const actionAtSec = Number(latestNode.action_time) || 0
        const actionAt = actionAtSec > 0 ? new Date(actionAtSec * 1000) : new Date()
        await persistShipmentLatestPath({
          orderId: ctx.internal_order_id,
          waybillId: resolvedWaybillId,
          actionType: latestNode.action_type,
          actionAt,
        })
      }
    }

    if (ctx.internal_order_id && !skipPathNotify && pathItemList.length) {
      handleLogisticsPathNotifyAsync({
        orderId: ctx.internal_order_id,
        deliveryId: delivery_id,
        waybillId: resolvedWaybillId,
        companyName: b.delivery_name || b.company_name || DELIVERY_NAME_SF,
        pathItemList,
        source: 'getPath',
      })
    }

    return adminResult(200, {
      delivery_id,
      waybill_id: resolvedWaybillId || undefined,
      mail_no: pathResult.mail_no || undefined,
      tracking_type: trackingType,
      path_item_num: pathItemList.length,
      path_item_list: pathItemList,
      route_resps: pathResult.route_resps || [],
      has_routes: pathResult.has_routes,
      routes_empty_hint: pathResult.routes_empty_hint,
      provider: 'sf-express',
    })
  } catch (err) {
    logger.error('getPath 失败', { err })
    return adminResult(500, { error: '查询运单轨迹失败', detail: err.message })
  }
}

/**
 * 顺丰：查询订单/面单信息
 * 面单 HTML 优先走 COM_RECE_CLOUD_PRINT_HTML 云打印；失败时回退简易预览。
 */
async function getOrder(req) {
  const auth = assertSfConfig()
  if (!auth.ok) {
    logger.error('getOrder: 顺丰配置不完整')
    return adminResult(503, { error: auth.error })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : DELIVERY_ID_SF
  if (delivery_id !== DELIVERY_ID_SF) {
    return adminResult(400, { error: '当前仅支持顺丰（SF）运单查询' })
  }

  const waybill_id = b.waybill_id != null && String(b.waybill_id).trim() !== ''
    ? String(b.waybill_id).trim()
    : undefined

  try {
    const ctx = await resolveLogisticsOrderContext(b)
    if (ctx.error) return ctx.error

    let storedWaybillData = null
    if (ctx.internal_order_id != null) {
      const [rows] = await db.query(
        `SELECT waybill_id, waybill_data_json FROM order_shipments
         WHERE order_id = ? AND delivery_id = ? AND status = 'active'
         ORDER BY id DESC LIMIT 1`,
        [ctx.internal_order_id, delivery_id],
      )
      if (rows && rows.length) {
        storedWaybillData = rows[0].waybill_data_json
        if (typeof storedWaybillData === 'string') {
          try { storedWaybillData = JSON.parse(storedWaybillData) } catch { storedWaybillData = null }
        }
      }
    }

    const waybillNoInfoList = resolveWaybillNoInfoList({
      waybillNoInfoList: b.waybill_no_info_list,
      waybillId: waybill_id || (storedWaybillData?.waybillNo ? String(storedWaybillData.waybillNo) : undefined),
      storedWaybillData,
    })

    const inputCheck = validateSearchOrderInput({ orderId: ctx.order_id })
    if (!inputCheck.ok) {
      return adminResult(400, { error: inputCheck.error })
    }

    let assessment = null
    const sfResult = await searchOrder(buildSearchOrderPayload({
      orderId: inputCheck.orderId,
      searchType: b.search_type ?? SF_SEARCH_TYPE.FORWARD,
      language: b.language,
      mainWaybillNo: waybill_id,
    }))

    if (sfResult.ok) {
      assessment = assessSearchOrderResponse(sfResult.msgData)
    } else if (!waybillNoInfoList.length && !waybill_id) {
      return adminResult(502, {
        error: sfResult.error || '获取运单数据失败',
        errorCode: sfResult.errorCode,
        sf_error: sfResult.sf_error,
      })
    }

    const resolvedWaybill = waybill_id
      || waybillNoInfoList.find((item) => String(item.waybillType) === '1')?.waybillNo
      || waybillNoInfoList[0]?.waybillNo
      || (assessment?.ok
        ? (assessment.waybill_data.find((item) => String(item.waybill_type) === '1')?.waybill_no
          || assessment.waybill_data[0]?.waybill_no
          || extractPrimaryWaybillNo(assessment.normalized))
        : null)

    if (!resolvedWaybill && (!assessment || !assessment.ok)) {
      return adminResult(404, {
        error: assessment?.error || '未找到可打印的运单号',
        order_id: ctx.order_id,
        provider: 'sf-express',
      })
    }

    const routeLabelInfo = assessment?.route_label_info || null
    const normalizedWaybillList = assessment?.ok && assessment.normalized?.waybillNoInfoList?.length
      ? assessment.normalized.waybillNoInfoList
      : waybillNoInfoList

    const { fetchCloudPrintWaybillHtml } = require('./sfExpressCloudPrintHtml')
    const cloudPrint = await fetchCloudPrintWaybillHtml({
      waybillNoInfoList: normalizedWaybillList,
      fallbackWaybillNo: resolvedWaybill,
      templateCode: b.template_code,
      customTemplateCode: b.custom_template_code,
      waybillNoCheckType: b.waybill_no_check_type,
      waybillNoCheckValue: b.waybill_no_check_value,
    })

    let printHtml = ''
    let printSource = 'fallback'
    let printFiles = []
    let cloudPrintError = null

    if (cloudPrint.ok) {
      printHtml = cloudPrint.html
      printSource = 'cloud_print'
      printFiles = cloudPrint.print_files || []
    } else {
      cloudPrintError = cloudPrint.error || '云打印面单失败'
      logger.warn('getOrder cloud print fallback', {
        orderId: ctx.order_id,
        waybillId: resolvedWaybill,
        error: cloudPrintError,
        errorCode: cloudPrint.errorCode,
      })
      printHtml = buildWaybillPreviewHtml({
        orderId: assessment?.order_id || ctx.order_id,
        waybillId: resolvedWaybill,
        routeLabelInfo,
        waybillNoInfoList: normalizedWaybillList,
      })
    }

    const print_html = Buffer.from(printHtml, 'utf8').toString('base64')

    return adminResult(200, {
      print_html,
      print_source: printSource,
      print_files: printFiles,
      cloud_print_error: cloudPrintError || undefined,
      template_code: cloudPrint.template_code,
      waybill_data: assessment?.waybill_data || extractWaybillNoInfoList(normalizedWaybillList),
      route_label_info: routeLabelInfo,
      route_label_summary: assessment?.route_label_summary,
      order_id: assessment?.order_id || ctx.order_id,
      delivery_id,
      waybill_id: resolvedWaybill,
      origin_code: assessment?.origin_code,
      dest_code: assessment?.dest_code,
      filter_result: assessment?.filter_result,
      filter_meta: assessment?.filter_meta,
      filter_warning: assessment?.filter_warning,
      route_label_warning: assessment?.route_label_warning,
      return_extra_info_list: assessment?.return_extra_info_list,
      provider: 'sf-express',
    })
  } catch (err) {
    logger.error('getOrder 失败', { err })
    return adminResult(500, { error: '获取运单数据失败', detail: err.message })
  }
}

/**
 * 顺丰：订单确认（EXP_RECE_UPDATE_ORDER, dealType=1）
 * 丰桥默认自动确认；若控制台改为「不自动确认」，发货后需调用本接口。
 */
async function confirmOrder(req) {
  const auth = assertSfConfig()
  if (!auth.ok) {
    logger.error('confirmOrder: 顺丰配置不完整')
    return adminResult(503, { error: auth.error })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : DELIVERY_ID_SF
  if (delivery_id !== DELIVERY_ID_SF) {
    return adminResult(400, { error: '当前仅支持顺丰（SF）订单确认' })
  }

  try {
    const ctx = await resolveLogisticsOrderContext(b)
    if (ctx.error) return ctx.error

    let storedWaybillData = null
    if (ctx.internal_order_id != null) {
      const [rows] = await db.query(
        `SELECT waybill_id, waybill_data_json FROM order_shipments
         WHERE order_id = ? AND delivery_id = ? AND status = 'active'
         ORDER BY id DESC LIMIT 1`,
        [ctx.internal_order_id, delivery_id],
      )
      if (rows && rows.length) {
        storedWaybillData = rows[0].waybill_data_json
        if (typeof storedWaybillData === 'string') {
          try { storedWaybillData = JSON.parse(storedWaybillData) } catch { storedWaybillData = null }
        }
      }
    }

    const waybillNoInfoList = resolveWaybillNoInfoList({
      waybillNoInfoList: b.waybill_no_info_list,
      waybillId: b.waybill_id,
      storedWaybillData,
    })

    const inputCheck = validateUpdateOrderInput({
      orderId: ctx.order_id,
      dealType: SF_DEAL_TYPE.CONFIRM,
      waybillNoInfoList,
    })
    if (!inputCheck.ok) {
      return adminResult(400, {
        error: inputCheck.error,
        errorCode: inputCheck.errorCode,
      })
    }

    const sfPayload = buildConfirmOrderPayload({
      orderId: inputCheck.orderId,
      waybillNoInfoList,
      totalWeight: b.total_weight,
      totalVolume: b.total_volume,
      totalLength: b.total_length,
      totalWidth: b.total_width,
      totalHeight: b.total_height,
      expressTypeId: b.express_type_id ?? b.service_type,
      remark: b.remark ?? b.custom_remark,
      sendStartTm: formatSendStartTm(b.expect_time),
      isDocall: b.is_docall,
      isConfirmNew: b.is_confirm_new,
    })

    const sfResult = await updateOrder(sfPayload)
    if (!sfResult.ok) {
      return adminResult(502, {
        error: sfResult.error || '订单确认失败',
        errorCode: sfResult.errorCode,
        apiResultCode: sfResult.apiResultCode,
        sf_error: sfResult.sf_error,
      })
    }

    const assessment = assessUpdateOrderResponse(sfResult.msgData)
    if (!assessment.ok) {
      return adminResult(422, {
        error: assessment.error,
        order_id: assessment.order_id,
        res_status: assessment.resStatus,
        res_status_meta: assessment.res_status_meta,
        sf_response: sfResult.msgData,
        provider: 'sf-express',
      })
    }

    return adminResult(200, {
      errcode: 0,
      errmsg: 'ok',
      order_id: assessment.order_id,
      res_status: assessment.resStatus,
      waybill_data: assessment.waybill_data,
      provider: 'sf-express',
      sf_result: sfResult.msgData,
    })
  } catch (err) {
    logger.error('confirmOrder 失败', { err })
    return adminResult(500, { error: '订单确认失败', detail: err.message })
  }
}

/**
 * 顺丰：取消运单（EXP_RECE_UPDATE_ORDER, dealType=2）
 */
async function cancelOrder(req) {
  const auth = assertSfConfig()
  if (!auth.ok) {
    logger.error('cancelOrder: 顺丰配置不完整')
    return adminResult(503, { error: auth.error })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : DELIVERY_ID_SF
  const waybill_id = b.waybill_id != null ? String(b.waybill_id).trim() : ''
  if (delivery_id !== DELIVERY_ID_SF) {
    return adminResult(400, { error: '当前仅支持顺丰（SF）取消运单' })
  }

  try {
    const ctx = await resolveLogisticsOrderContext(b)
    if (ctx.error) return ctx.error

    const inputCheck = validateUpdateOrderInput({
      orderId: ctx.order_id,
      dealType: SF_DEAL_TYPE.CANCEL,
      waybillNoInfoList: [],
    })
    if (!inputCheck.ok) {
      return adminResult(400, {
        error: inputCheck.error,
        errorCode: inputCheck.errorCode,
      })
    }

    const sfPayload = buildCancelOrderPayload({
      orderId: inputCheck.orderId,
      totalWeight: b.total_weight,
      remark: b.remark ?? b.custom_remark,
    })

    const sfResult = await updateOrder(sfPayload)
    if (!sfResult.ok) {
      return adminResult(502, {
        error: sfResult.error || '取消运单失败',
        errorCode: sfResult.errorCode,
        sf_error: sfResult.sf_error,
      })
    }

    const assessment = assessUpdateOrderResponse(sfResult.msgData)
    if (!assessment.ok) {
      return adminResult(422, {
        error: assessment.error,
        order_id: assessment.order_id,
        res_status: assessment.resStatus,
        res_status_meta: assessment.res_status_meta,
        sf_response: sfResult.msgData,
        provider: 'sf-express',
      })
    }

    const resolvedWaybillId = waybill_id
      || assessment.waybill_data?.[0]?.waybill_no
      || ''

    try {
      if (ctx.internal_order_id != null) {
        if (resolvedWaybillId) {
          await db.query(
            `UPDATE order_shipments SET status = 'cancelled', updated_at = NOW()
             WHERE order_id = ? AND delivery_id = ? AND waybill_id = ? AND status = 'active'`,
            [ctx.internal_order_id, delivery_id, resolvedWaybillId],
          )
        } else {
          await db.query(
            `UPDATE order_shipments SET status = 'cancelled', updated_at = NOW()
             WHERE order_id = ? AND delivery_id = ? AND status = 'active'`,
            [ctx.internal_order_id, delivery_id],
          )
        }
      } else if (resolvedWaybillId) {
        await db.query(
          `UPDATE order_shipments SET status = 'cancelled', updated_at = NOW()
           WHERE delivery_id = ? AND waybill_id = ? AND status = 'active'`,
          [delivery_id, resolvedWaybillId],
        )
      }
    } catch (dbErr) {
      logger.error('cancelOrder 成功后更新 order_shipments 失败', { err: dbErr })
    }

    return adminResult(200, {
      errcode: 0,
      errmsg: 'ok',
      order_id: assessment.order_id,
      waybill_id: resolvedWaybillId || undefined,
      res_status: assessment.resStatus,
      waybill_data: assessment.waybill_data,
      provider: 'sf-express',
      sf_result: sfResult.msgData,
    })
  } catch (err) {
    logger.error('cancelOrder 失败', { err })
    return adminResult(500, { error: '取消运单失败', detail: err.message })
  }
}

function buyerUserIdFromReq(req) {
  if (!req || !req.user || req.user.id == null) return null
  const id = Number(req.user.id)
  return Number.isNaN(id) ? null : id
}

async function assertBuyerLogisticsOrder(req, body, { requireWaybill }) {
  const buyerId = buyerUserIdFromReq(req)
  if (buyerId == null) return { error: adminResult(401, { error: '未登录' }) }

  const b = body && typeof body === 'object' ? body : {}
  const internalOrderId = parseInt(String(b.internal_order_id ?? ''), 10)
  if (!internalOrderId || Number.isNaN(internalOrderId) || internalOrderId <= 0) {
    return { error: adminResult(400, { error: '缺少 internal_order_id' }) }
  }

  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : DELIVERY_ID_SF
  if (delivery_id !== DELIVERY_ID_SF) {
    return { error: adminResult(400, { error: '当前仅支持顺丰（SF）物流' }) }
  }

  const waybillTrim = b.waybill_id != null ? String(b.waybill_id).trim() : ''
  const waybill_id = waybillTrim || undefined
  if (requireWaybill && !waybill_id) {
    return { error: adminResult(400, { error: '缺少 waybill_id' }) }
  }

  const [rows] = await db.query(
    'SELECT id, user_id, trade_state FROM orders WHERE id = ? LIMIT 1',
    [internalOrderId]
  )
  if (!rows || !rows.length) return { error: adminResult(404, { error: '订单不存在' }) }
  const order = rows[0]
  if (Number(order.user_id) !== buyerId) {
    return { error: adminResult(403, { error: '无权查看该订单的物流信息' }) }
  }
  if (order.trade_state !== 'SUCCESS') {
    return { error: adminResult(400, { error: '仅支付成功的订单可查看物流' }) }
  }

  return { internalOrderId, delivery_id, waybill_id }
}

async function getPathAsBuyer(req) {
  const a = await assertBuyerLogisticsOrder(req, req.body, { requireWaybill: true })
  if (a.error) return a.error
  return getPath({
    body: {
      internal_order_id: a.internalOrderId,
      delivery_id: a.delivery_id,
      waybill_id: a.waybill_id,
    },
  })
}

async function getOrderAsBuyer(req) {
  const a = await assertBuyerLogisticsOrder(req, req.body, { requireWaybill: false })
  if (a.error) return a.error
  const body = {
    internal_order_id: a.internalOrderId,
    delivery_id: a.delivery_id,
  }
  if (a.waybill_id) body.waybill_id = a.waybill_id
  return getOrder({ body })
}

/**
 * 顺丰：时效标准及价格查询（EXP_RECE_QUERY_DELIVERTM）
 */
async function queryDeliverTm(req) {
  const auth = assertSfConfig()
  if (!auth.ok) {
    logger.error('queryDeliverTm: 顺丰配置不完整')
    return adminResult(503, { error: auth.error })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : DELIVERY_ID_SF
  if (delivery_id !== DELIVERY_ID_SF) {
    return adminResult(400, { error: '当前仅支持顺丰（SF）时效价格查询' })
  }

  const srcAddress = b.src_address || b.srcAddress || b.sender
  const destAddress = b.dest_address || b.destAddress || b.receiver
  const payInfo = resolvePayAndMonthlyCard(b.biz_id)
  const monthlyCard = b.monthly_card != null && String(b.monthly_card).trim() !== ''
    ? String(b.monthly_card).trim()
    : payInfo.monthlyCard

  const built = buildQueryDeliverTmPayload({
    srcAddress,
    destAddress,
    businessType: b.business_type ?? b.businessType ?? b.express_type_id ?? b.service_type,
    weight: b.weight,
    volume: b.volume,
    consignedTime: b.consigned_time ?? b.consignedTime ?? b.expect_time,
    searchPrice: b.search_price ?? b.searchPrice,
    monthlyCard,
  })

  if (!built.ok) {
    return adminResult(400, { error: built.error })
  }

  try {
    const sfResult = await sfQueryDeliverTm(built.payload)
    if (!sfResult.ok) {
      return adminResult(502, {
        error: sfResult.error || '时效价格查询失败',
        errorCode: sfResult.errorCode,
        apiResultCode: sfResult.apiResultCode,
        sf_error: sfResult.sf_error,
      })
    }

    const assessment = assessQueryDeliverTmResponse(sfResult.msgData)
    if (!assessment.ok) {
      return adminResult(502, {
        error: assessment.error,
        provider: 'sf-express',
      })
    }

    return adminResult(200, {
      deliver_tm_list: assessment.deliver_tm_list,
      count: assessment.count,
      search_price: built.payload.searchPrice,
      business_type: built.payload.businessType || undefined,
      provider: 'sf-express',
    })
  } catch (err) {
    logger.error('queryDeliverTm 失败', { err })
    return adminResult(500, { error: '时效价格查询失败', detail: err.message })
  }
}

module.exports = {
  getAllDelivery,
  getOpenMsgDeliveryList,
  addOrder,
  addManualShipment,
  retryFollowWaybill,
  queryOpenMsgFollowTrace,
  getPath,
  getOrder,
  confirmOrder,
  cancelOrder,
  queryDeliverTm,
  getPathAsBuyer,
  getOrderAsBuyer,
  uploadShippingInfo: uploadWechatShippingInfo,
  uploadCombinedShippingInfo: uploadWechatCombinedShippingInfo,
  getWechatOrder: queryWechatOrderShippingStatus,
  getWechatOrderList: queryWechatOrderList,
  notifyConfirmReceive: notifyWechatConfirmReceive,
  setMsgJumpPath: setWechatMsgJumpPath,
  isTradeManagementConfirmationCompleted: queryWechatTradeManagementConfirmation,
}
