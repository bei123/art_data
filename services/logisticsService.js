const axios = require('axios')
const db = require('../db')
const logger = require('../utils/logger')
const { getAccessToken } = require('./wechatMiniProgramToken')
const { OSS_PUBLIC_ORIGIN } = require('../config/publicEnv')

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

function absolutizeAssetUrl(maybeUrl) {
  if (!maybeUrl || typeof maybeUrl !== 'string') return ''
  const u = maybeUrl.trim()
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('//')) return `https:${u}`
  if (u.startsWith('/')) return `${OSS_PUBLIC_ORIGIN}${u}`
  return u
}

function hasTelOrMobile(obj) {
  if (!obj || typeof obj !== 'object') return false
  const tel = obj.tel != null && String(obj.tel).trim() !== ''
  const mobile = obj.mobile != null && String(obj.mobile).trim() !== ''
  return tel || mobile
}

/**
 * 补全 getPath / getOrder 所需的 order_id、openid（orders.user_id → wx_users.id）
 * 成功：{ order_id, buyerOpenid, add_source }；失败：{ error: adminResult(...) }
 */
async function resolveWechatLogisticsOrderContext(b) {
  const add_source = b.add_source === 2 ? 2 : 0
  let order_id = b.order_id != null && String(b.order_id).trim() !== '' ? String(b.order_id).trim() : ''
  let buyerOpenid = b.openid != null && String(b.openid).trim() !== '' ? String(b.openid).trim() : ''

  const internalOrderId = parseInt(String(b.internal_order_id ?? ''), 10)
  if (!Number.isNaN(internalOrderId) && internalOrderId > 0) {
    const [orderRows] = await db.query(
      'SELECT id, out_trade_no, user_id FROM orders WHERE id = ? LIMIT 1',
      [internalOrderId]
    )
    if (!orderRows || orderRows.length === 0) {
      return { error: adminResult(404, { error: '订单不存在' }) }
    }
    const orow = orderRows[0]
    if (!order_id) order_id = String(orow.out_trade_no || '').trim()
    if (add_source === 0 && !buyerOpenid) {
      const [wxUserRows] = await db.query(
        'SELECT openid FROM wx_users WHERE id = ? LIMIT 1',
        [orow.user_id]
      )
      buyerOpenid = wxUserRows && wxUserRows[0] && wxUserRows[0].openid != null
        ? String(wxUserRows[0].openid).trim()
        : ''
    }
  }

  if (!order_id) {
    return {
      error: adminResult(400, { error: '缺少 order_id（微信物流单号）；可传 internal_order_id 以自动使用 out_trade_no' })
    }
  }
  if (add_source === 0 && !buyerOpenid) {
    return {
      error: adminResult(400, {
        error: '缺少 openid；可传 internal_order_id 从 wx_users 读取，或直接传 openid；add_source=2 可不填'
      })
    }
  }
  return { order_id, buyerOpenid, add_source }
}

/**
 * 微信物流助手：获取支持的快递公司列表（HTTPS getAllDelivery）
 * @see https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/express/by-business/get-all-delivery.html
 */
async function getAllDelivery() {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) {
    logger.error('getAllDelivery: 缺少 WX_APPID 或 WX_SECRET')
    return adminResult(500, { error: '服务器配置错误' })
  }

  try {
    const access_token = await getAccessToken(appid, secret)
    const url = `https://api.weixin.qq.com/cgi-bin/express/business/delivery/getall?access_token=${encodeURIComponent(access_token)}`
    const { data } = await axios.get(url, { timeout: 15000 })
    if (data.errcode != null && data.errcode !== 0) {
      logger.warn('getAllDelivery 微信返回错误', { errcode: data.errcode, errmsg: data.errmsg })
      return adminResult(502, {
        error: data.errmsg || '微信物流接口返回错误',
        errcode: data.errcode
      })
    }
    return adminResult(200, {
      count: data.count ?? (Array.isArray(data.data) ? data.data.length : 0),
      data: data.data || []
    })
  } catch (err) {
    logger.error('getAllDelivery 请求失败', { err })
    return adminResult(500, { error: '获取快递公司列表失败', detail: err.message })
  }
}

/**
 * 微信物流助手：生成运单（HTTPS addOrder）
 * 仅允许：订单已支付成功、非退款态、且存在实物（权益/原作）与唯一收货地址。
 * @see https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/express/by-business/add-order.html
 */
async function addOrder(req) {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) {
    logger.error('addOrder: 缺少 WX_APPID 或 WX_SECRET')
    return adminResult(500, { error: '服务器配置错误' })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const internalOrderId = parseInt(String(b.internal_order_id ?? b.order_id ?? ''), 10)
  if (!internalOrderId || Number.isNaN(internalOrderId) || internalOrderId <= 0) {
    return adminResult(400, { error: '缺少有效的 internal_order_id（或 order_id）' })
  }

  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : ''
  if (!delivery_id) return adminResult(400, { error: '缺少 delivery_id' })

  const biz_id = (b.biz_id != null && String(b.biz_id).trim() !== '')
    ? String(b.biz_id).trim()
    : (process.env.WX_LOGISTICS_DEFAULT_BIZ_ID || '').trim()
  if (!biz_id) return adminResult(400, { error: '缺少 biz_id（可在请求体传入或配置 WX_LOGISTICS_DEFAULT_BIZ_ID）' })

  const service_type = b.service_type
  const service_name = b.service_name != null ? String(b.service_name).trim() : ''
  if (service_type === undefined || service_type === null || Number.isNaN(Number(service_type))) {
    return adminResult(400, { error: '缺少有效的 service_type' })
  }
  if (!service_name) return adminResult(400, { error: '缺少 service_name' })

  const sender = b.sender
  if (!sender || typeof sender !== 'object') return adminResult(400, { error: '缺少发件人 sender' })
  if (!hasTelOrMobile(sender)) return adminResult(400, { error: '发件人须填写 mobile 或 tel' })

  const add_source = b.add_source === 2 ? 2 : 0
  const wx_appid = b.wx_appid != null ? String(b.wx_appid).trim() : ''
  if (add_source === 2 && !wx_appid) {
    return adminResult(400, { error: 'add_source 为 2 时必须填写 wx_appid' })
  }

  const expect_time = b.expect_time
  if (delivery_id === 'SF' && expect_time === undefined) {
    return adminResult(400, { error: '顺丰发货须传 expect_time（Unix 秒；0 表示已约定取件时间）' })
  }

  try {
    const [orderRows] = await db.query(
      `SELECT o.id, o.out_trade_no, o.user_id, o.trade_state, o.body
       FROM orders o
       WHERE o.id = ?
       LIMIT 1`,
      [internalOrderId]
    )
    if (!orderRows || orderRows.length === 0) {
      return adminResult(404, { error: '订单不存在' })
    }
    const orderRow = orderRows[0]
    if (orderRow.trade_state !== 'SUCCESS') {
      return adminResult(400, { error: '仅支付成功的订单可发货', trade_state: orderRow.trade_state })
    }

    const [refundBlocking] = await db.query(
      `SELECT COUNT(*) AS c FROM refund_requests
       WHERE out_trade_no = ? AND status IN ('APPROVED', 'PROCESSING')`,
      [orderRow.out_trade_no]
    )
    if (refundBlocking && refundBlocking[0] && Number(refundBlocking[0].c) > 0) {
      return adminResult(400, { error: '订单存在进行中或已同意的退款，暂不可发货' })
    }

    // 买家 openid：orders.user_id 与 wx_users.id 对应，从 wx_users 读取
    const [wxUserRows] = await db.query(
      'SELECT openid FROM wx_users WHERE id = ? LIMIT 1',
      [orderRow.user_id]
    )
    const buyerOpenid = wxUserRows && wxUserRows[0] && wxUserRows[0].openid != null
      ? String(wxUserRows[0].openid).trim()
      : ''
    if (add_source === 0 && !buyerOpenid) {
      return adminResult(400, {
        error: 'wx_users 中未找到该买家的 openid（请确认 orders.user_id 对应 wx_users.id）；App/H5 订单请使用 add_source=2 并填写 wx_appid'
      })
    }

    const [physicalItems] = await db.query(
      `SELECT
          oi.id,
          oi.type,
          oi.quantity,
          oi.address_id,
          COALESCE(r.title, oa.title) AS item_title,
          COALESCE(r.description, oa.description) AS item_desc,
          (SELECT ri.image_url FROM right_images ri WHERE ri.right_id = oi.right_id ORDER BY ri.id ASC LIMIT 1) AS right_image_url,
          oa.image AS artwork_image,
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
      return adminResult(400, { error: '订单不含实物商品（权益/原作），无需走微信物流发货' })
    }

    const missingAddr = physicalItems.filter((row) => !row.address_id || !row.receiver_phone)
    if (missingAddr.length > 0) {
      return adminResult(400, { error: '存在未绑定收货地址的实物订单项，请先完善收货地址' })
    }

    const addrIds = [...new Set(physicalItems.map((r) => r.address_id))]
    if (addrIds.length > 1) {
      return adminResult(400, { error: '实物商品存在多个不同收货地址，请拆分订单或统一地址后再发货' })
    }

    const firstAddr = physicalItems[0]
    const receiver = {
      name: clipUtf8(firstAddr.receiver_name || '', 64),
      mobile: clipUtf8(String(firstAddr.receiver_phone || '').trim(), 32),
      province: clipUtf8(firstAddr.province || '', 64),
      city: clipUtf8(firstAddr.city || '', 64),
      area: clipUtf8(firstAddr.district || '', 64),
      address: clipUtf8(firstAddr.detail_address || '', 512)
    }
    if (!hasTelOrMobile(receiver)) {
      return adminResult(400, { error: '收件人手机号无效' })
    }

    const wechatOrderIdRaw = b.wechat_logistics_order_id != null && String(b.wechat_logistics_order_id).trim() !== ''
      ? String(b.wechat_logistics_order_id).trim()
      : String(orderRow.out_trade_no || '').trim()
    const wechatOrderId = clipUtf8(wechatOrderIdRaw, 500)
    if (!wechatOrderId) {
      return adminResult(400, { error: '无法生成微信物流 order_id，请传 wechat_logistics_order_id' })
    }

    const cargoDefault = {
      count: physicalItems.reduce((sum, row) => sum + (Number(row.quantity) || 1), 0),
      weight: 1,
      space_x: 20,
      space_y: 20,
      space_z: 20,
      detail_list: physicalItems.map((row) => ({
        name: clipUtf8(row.item_title || '商品', 128),
        count: Number(row.quantity) > 0 ? Number(row.quantity) : 1
      }))
    }
    const cargo = b.cargo && typeof b.cargo === 'object'
      ? {
          count: b.cargo.count != null ? Number(b.cargo.count) : cargoDefault.count,
          weight: b.cargo.weight != null ? Number(b.cargo.weight) : cargoDefault.weight,
          space_x: b.cargo.space_x != null ? Number(b.cargo.space_x) : cargoDefault.space_x,
          space_y: b.cargo.space_y != null ? Number(b.cargo.space_y) : cargoDefault.space_y,
          space_z: b.cargo.space_z != null ? Number(b.cargo.space_z) : cargoDefault.space_z,
          detail_list: Array.isArray(b.cargo.detail_list) && b.cargo.detail_list.length > 0
            ? b.cargo.detail_list.map((d) => ({
                name: clipUtf8(d.name, 128),
                count: Number(d.count) > 0 ? Number(d.count) : 1
              }))
            : cargoDefault.detail_list
        }
      : cargoDefault

    const shopDetailFromDb = physicalItems.map((row) => {
      const imgRaw = row.type === 'artwork' ? row.artwork_image : row.right_image_url
      const goods_img_url = absolutizeAssetUrl(imgRaw)
      const descBase = row.item_desc ? String(row.item_desc) : ''
      const qty = Number(row.quantity) > 1 ? `数量${row.quantity}` : ''
      const goods_desc = clipUtf8([descBase, qty].filter(Boolean).join(' · '), 512)
      return {
        goods_name: clipUtf8(row.item_title || '商品', 128),
        goods_img_url,
        goods_desc: goods_desc || clipUtf8(row.item_title || '商品', 512)
      }
    })

    const shopFromBody = b.shop && typeof b.shop === 'object' ? b.shop : null
    const useBodyShopList = shopFromBody && Array.isArray(shopFromBody.detail_list) && shopFromBody.detail_list.length > 0
    const resolvedShopDetail = useBodyShopList
      ? shopFromBody.detail_list.map((g) => ({
          goods_name: clipUtf8(g.goods_name, 128),
          goods_img_url: absolutizeAssetUrl(g.goods_img_url) || String(g.goods_img_url || '').trim(),
          goods_desc: clipUtf8(g.goods_desc, 512)
        }))
      : shopDetailFromDb

    const badShopImg = resolvedShopDetail.some(
      (x) => !x.goods_img_url || !/^https:\/\//i.test(String(x.goods_img_url))
    )
    if (badShopImg) {
      return adminResult(400, {
        error: 'shop.detail_list 中每项须含可用的 https goods_img_url；自动组单时请为实物商品配置图片'
      })
    }

    const shop = {
      wxa_path: shopFromBody && shopFromBody.wxa_path != null
        ? clipUtf8(String(shopFromBody.wxa_path), 512)
        : (process.env.WX_LOGISTICS_DEFAULT_WXA_PATH
          ? clipUtf8(
            String(process.env.WX_LOGISTICS_DEFAULT_WXA_PATH)
              .replace(/\{order_id\}/g, String(internalOrderId))
              .replace(/\{out_trade_no\}/g, String(orderRow.out_trade_no || '')),
            512
          )
          : undefined),
      detail_list: resolvedShopDetail
    }
    if (!shop.wxa_path) delete shop.wxa_path

    const insuredIn = b.insured && typeof b.insured === 'object' ? b.insured : {}
    const insured = {
      use_insured: insuredIn.use_insured === 1 ? 1 : 0,
      insured_value: insuredIn.insured_value != null ? Number(insuredIn.insured_value) : 0
    }

    const senderOut = {
      name: sender.name != null ? clipUtf8(String(sender.name), 64) : undefined,
      tel: sender.tel != null ? clipUtf8(String(sender.tel), 32) : undefined,
      mobile: sender.mobile != null ? clipUtf8(String(sender.mobile), 32) : undefined,
      company: sender.company != null ? clipUtf8(String(sender.company), 64) : undefined,
      post_code: sender.post_code != null ? clipUtf8(String(sender.post_code), 10) : undefined,
      country: sender.country != null ? clipUtf8(String(sender.country), 64) : undefined,
      province: sender.province != null ? clipUtf8(String(sender.province), 64) : undefined,
      city: sender.city != null ? clipUtf8(String(sender.city), 64) : undefined,
      area: sender.area != null ? clipUtf8(String(sender.area), 64) : undefined,
      address: sender.address != null ? clipUtf8(String(sender.address), 512) : undefined
    }
    Object.keys(senderOut).forEach((k) => {
      if (senderOut[k] === undefined || senderOut[k] === '') delete senderOut[k]
    })

    const payload = {
      order_id: wechatOrderId,
      delivery_id,
      biz_id,
      add_source,
      sender: senderOut,
      receiver,
      cargo,
      shop,
      insured,
      service: {
        service_type: Number(service_type),
        service_name: clipUtf8(service_name, 64)
      }
    }

    if (add_source === 0) payload.openid = buyerOpenid
    if (add_source === 2) payload.wx_appid = wx_appid

    if (b.custom_remark != null && String(b.custom_remark).trim() !== '') {
      payload.custom_remark = clipUtf8(String(b.custom_remark), 1024)
    }
    if (b.tagid != null && !Number.isNaN(Number(b.tagid))) payload.tagid = Number(b.tagid)
    if (expect_time !== undefined && expect_time !== null) payload.expect_time = Number(expect_time)
    if (b.take_mode !== undefined && b.take_mode !== null && !Number.isNaN(Number(b.take_mode))) {
      payload.take_mode = Number(b.take_mode)
    }

    const access_token = await getAccessToken(appid, secret)
    const url = `https://api.weixin.qq.com/cgi-bin/express/business/order/add?access_token=${encodeURIComponent(access_token)}`
    const { data } = await axios.post(url, payload, {
      timeout: 25000,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      responseType: 'json'
    })

    if (data.errcode != null && data.errcode !== 0) {
      logger.warn('addOrder 微信返回错误', {
        errcode: data.errcode,
        errmsg: data.errmsg,
        delivery_resultcode: data.delivery_resultcode,
        delivery_resultmsg: data.delivery_resultmsg
      })
      return adminResult(502, {
        error: data.errmsg || '微信物流下单失败',
        errcode: data.errcode,
        delivery_resultcode: data.delivery_resultcode,
        delivery_resultmsg: data.delivery_resultmsg
      })
    }

    if (!data.waybill_id) {
      return adminResult(502, { error: '微信未返回运单号', wechat_response: data })
    }

    return adminResult(200, {
      internal_order_id: internalOrderId,
      out_trade_no: orderRow.out_trade_no,
      order_id: data.order_id,
      waybill_id: data.waybill_id,
      waybill_data: data.waybill_data || []
    })
  } catch (err) {
    logger.error('addOrder 失败', { err })
    return adminResult(500, { error: '生成运单失败', detail: err.message })
  }
}

/**
 * 微信物流助手：查询运单轨迹（HTTPS getPath）
 * 请求体须含 delivery_id、waybill_id；order_id / openid 可传，或由 internal_order_id 从订单与 wx_users 补全。
 * @see https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/express/by-business/get-path.html
 */
async function getPath(req) {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) {
    logger.error('getPath: 缺少 WX_APPID 或 WX_SECRET')
    return adminResult(500, { error: '服务器配置错误' })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : ''
  const waybill_id = b.waybill_id != null ? String(b.waybill_id).trim() : ''
  if (!delivery_id) return adminResult(400, { error: '缺少 delivery_id' })
  if (!waybill_id) return adminResult(400, { error: '缺少 waybill_id' })

  try {
    const ctx = await resolveWechatLogisticsOrderContext(b)
    if (ctx.error) return ctx.error

    const wxPayload = {
      order_id: clipUtf8(ctx.order_id, 500),
      delivery_id,
      waybill_id
    }
    if (ctx.add_source === 0 && ctx.buyerOpenid) wxPayload.openid = ctx.buyerOpenid

    const access_token = await getAccessToken(appid, secret)
    const url = `https://api.weixin.qq.com/cgi-bin/express/business/path/get?access_token=${encodeURIComponent(access_token)}`
    const { data } = await axios.post(url, wxPayload, {
      timeout: 20000,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      responseType: 'json'
    })

    if (data.errcode != null && data.errcode !== 0) {
      logger.warn('getPath 微信返回错误', { errcode: data.errcode, errmsg: data.errmsg })
      return adminResult(502, {
        error: data.errmsg || '查询运单轨迹失败',
        errcode: data.errcode
      })
    }

    return adminResult(200, {
      openid: data.openid,
      delivery_id: data.delivery_id,
      waybill_id: data.waybill_id,
      path_item_num: data.path_item_num ?? (Array.isArray(data.path_item_list) ? data.path_item_list.length : 0),
      path_item_list: data.path_item_list || []
    })
  } catch (err) {
    logger.error('getPath 失败', { err })
    return adminResult(500, { error: '查询运单轨迹失败', detail: err.message })
  }
}

/**
 * 微信物流助手：获取运单数据（HTTPS getOrder，含面单 print_html BASE64 等）
 * 请求体须含 delivery_id；waybill_id、print_type 可选；order_id / openid 规则同 getPath。
 * @see https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/express/by-business/get-order.html
 */
async function getOrder(req) {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) {
    logger.error('getOrder: 缺少 WX_APPID 或 WX_SECRET')
    return adminResult(500, { error: '服务器配置错误' })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : ''
  if (!delivery_id) return adminResult(400, { error: '缺少 delivery_id' })

  const waybill_id = b.waybill_id != null && String(b.waybill_id).trim() !== ''
    ? String(b.waybill_id).trim()
    : undefined

  try {
    const ctx = await resolveWechatLogisticsOrderContext(b)
    if (ctx.error) return ctx.error

    const wxPayload = {
      order_id: clipUtf8(ctx.order_id, 500),
      delivery_id
    }
    if (waybill_id) wxPayload.waybill_id = waybill_id
    if (ctx.add_source === 0 && ctx.buyerOpenid) wxPayload.openid = ctx.buyerOpenid

    if (b.print_type !== undefined && b.print_type !== null && !Number.isNaN(Number(b.print_type))) {
      const pt = Number(b.print_type)
      if (pt === 0 || pt === 1) wxPayload.print_type = pt
    }

    const access_token = await getAccessToken(appid, secret)
    const url = `https://api.weixin.qq.com/cgi-bin/express/business/order/get?access_token=${encodeURIComponent(access_token)}`
    const { data } = await axios.post(url, wxPayload, {
      timeout: 25000,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      responseType: 'json'
    })

    if (data.errcode != null && data.errcode !== 0) {
      logger.warn('getOrder 微信返回错误', { errcode: data.errcode, errmsg: data.errmsg })
      return adminResult(502, {
        error: data.errmsg || '获取运单数据失败',
        errcode: data.errcode
      })
    }

    return adminResult(200, {
      print_html: data.print_html,
      waybill_data: data.waybill_data || [],
      order_id: data.order_id,
      delivery_id: data.delivery_id,
      waybill_id: data.waybill_id,
      order_status: data.order_status
    })
  } catch (err) {
    logger.error('getOrder 失败', { err })
    return adminResult(500, { error: '获取运单数据失败', detail: err.message })
  }
}

/**
 * 微信物流助手：取消运单（HTTPS cancelOrder）
 * 请求体须含 delivery_id、waybill_id；order_id / openid 规则同 getPath。
 * @see https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/express/by-business/cancel-order.html
 */
async function cancelOrder(req) {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) {
    logger.error('cancelOrder: 缺少 WX_APPID 或 WX_SECRET')
    return adminResult(500, { error: '服务器配置错误' })
  }

  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : ''
  const waybill_id = b.waybill_id != null ? String(b.waybill_id).trim() : ''
  if (!delivery_id) return adminResult(400, { error: '缺少 delivery_id' })
  if (!waybill_id) return adminResult(400, { error: '缺少 waybill_id' })

  try {
    const ctx = await resolveWechatLogisticsOrderContext(b)
    if (ctx.error) return ctx.error

    const wxPayload = {
      order_id: clipUtf8(ctx.order_id, 500),
      delivery_id,
      waybill_id
    }
    if (ctx.add_source === 0 && ctx.buyerOpenid) wxPayload.openid = ctx.buyerOpenid

    const access_token = await getAccessToken(appid, secret)
    const url = `https://api.weixin.qq.com/cgi-bin/express/business/order/cancel?access_token=${encodeURIComponent(access_token)}`
    const { data } = await axios.post(url, wxPayload, {
      timeout: 20000,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      responseType: 'json'
    })

    if (data.errcode != null && data.errcode !== 0) {
      logger.warn('cancelOrder 微信返回错误', {
        errcode: data.errcode,
        errmsg: data.errmsg,
        delivery_resultcode: data.delivery_resultcode,
        delivery_resultmsg: data.delivery_resultmsg
      })
      return adminResult(502, {
        error: data.errmsg || '取消运单失败',
        errcode: data.errcode,
        delivery_resultcode: data.delivery_resultcode,
        delivery_resultmsg: data.delivery_resultmsg
      })
    }

    return adminResult(200, {
      errcode: data.errcode ?? 0,
      errmsg: data.errmsg ?? 'ok',
      delivery_resultcode: data.delivery_resultcode ?? 0,
      delivery_resultmsg: data.delivery_resultmsg ?? ''
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

/**
 * 买家查看物流：校验订单归属与支付状态；不信任 body 中的 order_id / openid（防越权）
 */
async function assertBuyerLogisticsOrder(req, body, { requireWaybill }) {
  const buyerId = buyerUserIdFromReq(req)
  if (buyerId == null) return { error: adminResult(401, { error: '未登录' }) }

  const b = body && typeof body === 'object' ? body : {}
  const internalOrderId = parseInt(String(b.internal_order_id ?? ''), 10)
  if (!internalOrderId || Number.isNaN(internalOrderId) || internalOrderId <= 0) {
    return { error: adminResult(400, { error: '缺少 internal_order_id' }) }
  }

  const delivery_id = b.delivery_id != null ? String(b.delivery_id).trim() : ''
  if (!delivery_id) return { error: adminResult(400, { error: '缺少 delivery_id' }) }

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

/** 买家：查询运单轨迹（内部复用 getPath，仅传 internal_order_id 解析出的 order_id / openid） */
async function getPathAsBuyer(req) {
  const a = await assertBuyerLogisticsOrder(req, req.body, { requireWaybill: true })
  if (a.error) return a.error
  return getPath({
    body: {
      internal_order_id: a.internalOrderId,
      delivery_id: a.delivery_id,
      waybill_id: a.waybill_id,
      add_source: 0
    }
  })
}

/** 买家：获取运单数据/面单（内部复用 getOrder） */
async function getOrderAsBuyer(req) {
  const a = await assertBuyerLogisticsOrder(req, req.body, { requireWaybill: false })
  if (a.error) return a.error
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const body = {
    internal_order_id: a.internalOrderId,
    delivery_id: a.delivery_id,
    add_source: 0
  }
  if (a.waybill_id) body.waybill_id = a.waybill_id
  if (b.print_type !== undefined && b.print_type !== null && !Number.isNaN(Number(b.print_type))) {
    const pt = Number(b.print_type)
    if (pt === 0 || pt === 1) body.print_type = pt
  }
  return getOrder({ body })
}

module.exports = {
  getAllDelivery,
  addOrder,
  getPath,
  getOrder,
  cancelOrder,
  getPathAsBuyer,
  getOrderAsBuyer
}
