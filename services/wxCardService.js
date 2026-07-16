const crypto = require('crypto')
const axios = require('axios')
const db = require('../db')
const logger = require('../utils/logger')
const { ensureReferralRewardsSchema } = require('../utils/referralRewardsSchema')
const { getOaAccessToken, getOaApiTicket, isWxCardSyncEnabled } = require('./wechatOaTokenService')

function yuanToFen(yuan) {
  const n = Math.round(Number(yuan) * 100)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

function generateWxCouponCode() {
  return (`RC${crypto.randomBytes(8).toString('hex')}`).slice(0, 20)
}

function buildCardExtSignature({ apiTicket, timestamp, nonceStr, cardId, code, openid }) {
  const values = [
    String(apiTicket || ''),
    String(timestamp || ''),
    String(nonceStr || ''),
    String(cardId || ''),
  ]
  if (code) values.push(String(code))
  if (openid) values.push(String(openid))
  values.sort()
  return crypto.createHash('sha1').update(values.join(''), 'utf8').digest('hex')
}

function getDefaultBrandName() {
  return String(process.env.WX_CARD_DEFAULT_BRAND_NAME || '艺术商城').trim().slice(0, 36) || '艺术商城'
}

function getDefaultLogoUrl() {
  return String(process.env.WX_CARD_DEFAULT_LOGO_URL || '').trim()
}

function getMiniProgramGhUserName() {
  const gh = String(process.env.WX_MP_GH_ID || '').trim().replace(/@app$/i, '')
  if (!gh) return ''
  return `${gh}@app`
}

function getCardUsePagePath() {
  return String(process.env.WX_CARD_USE_PAGE || 'pages/order/checkout').trim() || 'pages/order/checkout'
}

async function callCardApi(path, body, { forceTokenRefresh = false } = {}) {
  const accessToken = await getOaAccessToken(forceTokenRefresh)
  const url = `https://api.weixin.qq.com${path}?access_token=${encodeURIComponent(accessToken)}`
  const res = await axios.post(url, body, { timeout: 15000 })
  const data = res.data || {}

  if (data.errcode === 40001 || data.errcode === 42001) {
    if (!forceTokenRefresh) {
      return callCardApi(path, body, { forceTokenRefresh: true })
    }
  }

  return data
}

/**
 * 为模板在微信侧创建 CASH 卡券（自定义 code）
 */
async function createWxCardForTemplate(templateId) {
  await ensureReferralRewardsSchema()

  if (!isWxCardSyncEnabled()) {
    return { ok: false, status: 400, body: { error: '卡券同步未启用（WX_CARD_SYNC_ENABLED）' } }
  }

  const id = parseInt(templateId, 10)
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, body: { error: '无效的模板 ID' } }
  }

  const [rows] = await db.query(
    `SELECT id, title, discount_yuan, min_order_yuan, valid_days, is_active,
            wx_card_id, wx_card_status, wx_logo_url, wx_brand_name, wx_color, wx_quantity
     FROM referral_coupon_templates
     WHERE id = ? LIMIT 1`,
    [id]
  )
  const tpl = rows[0]
  if (!tpl) return { ok: false, status: 404, body: { error: '模板不存在' } }
  if (!tpl.is_active) return { ok: false, status: 400, body: { error: '模板已停用' } }
  if (tpl.wx_card_id) {
    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        already_exists: true,
        wx_card_id: tpl.wx_card_id,
        wx_card_status: tpl.wx_card_status,
      },
    }
  }

  const logoUrl = String(tpl.wx_logo_url || getDefaultLogoUrl()).trim()
  if (!logoUrl) {
    return {
      ok: false,
      status: 400,
      body: { error: '请先配置模板 wx_logo_url 或环境变量 WX_CARD_DEFAULT_LOGO_URL' },
    }
  }

  const brandName = String(tpl.wx_brand_name || getDefaultBrandName()).trim().slice(0, 36)
  const color = String(tpl.wx_color || 'Color010').trim() || 'Color010'
  const quantity = Number(tpl.wx_quantity) > 0 ? Number(tpl.wx_quantity) : 100000
  const validDays = Math.max(1, Math.min(parseInt(tpl.valid_days, 10) || 30, 3650))
  const reduceCost = yuanToFen(tpl.discount_yuan)
  const leastCost = yuanToFen(tpl.min_order_yuan)
  if (reduceCost <= 0) {
    return { ok: false, status: 400, body: { error: '优惠金额无效，无法创建微信卡券' } }
  }

  const ghUserName = getMiniProgramGhUserName()
  const usePath = getCardUsePagePath()
  const title = String(tpl.title || '优惠券').trim().slice(0, 27)

  const baseInfo = {
    logo_url: logoUrl,
    brand_name: brandName,
    code_type: 'CODE_TYPE_TEXT',
    title,
    color,
    notice: '小程序下单结算时选用',
    description: `满 ${Number(tpl.min_order_yuan) || 0} 元可用，优惠 ${Number(tpl.discount_yuan) || 0} 元。不可与其他优惠同享。`,
    date_info: {
      type: 'DATE_TYPE_FIX_TERM',
      fixed_term: validDays,
      fixed_begin_term: 0,
    },
    sku: { quantity },
    get_limit: 50,
    use_custom_code: true,
    bind_openid: false,
    can_share: false,
    can_give_friend: false,
    center_title: '立即使用',
    center_sub_title: '去小程序下单',
  }

  if (ghUserName) {
    baseInfo.center_app_brand_user_name = ghUserName
    baseInfo.center_app_brand_pass = usePath
    baseInfo.custom_app_brand_user_name = ghUserName
    baseInfo.custom_app_brand_pass = 'pages/my/coupons'
    baseInfo.custom_url_name = '我的优惠券'
  }

  await db.query(
    `UPDATE referral_coupon_templates
     SET wx_card_status = 'creating', wx_sync_enabled = 1, updated_at = NOW()
     WHERE id = ?`,
    [id]
  )

  const payload = {
    card: {
      card_type: 'CASH',
      cash: {
        base_info: baseInfo,
        least_cost: leastCost,
        reduce_cost: reduceCost,
      },
    },
  }

  const data = await callCardApi('/card/create', payload)
  if (Number(data.errcode) !== 0 || !data.card_id) {
    await db.query(
      `UPDATE referral_coupon_templates
       SET wx_card_status = 'rejected', updated_at = NOW()
       WHERE id = ?`,
      [id]
    )
    logger.error('create wx card failed', { templateId: id, wx: data })
    return {
      ok: false,
      status: 502,
      body: { error: data.errmsg || '创建微信卡券失败', wx: data },
    }
  }

  await db.query(
    `UPDATE referral_coupon_templates
     SET wx_card_id = ?, wx_card_status = 'creating', wx_sync_enabled = 1,
         wx_logo_url = ?, wx_brand_name = ?, wx_color = ?, wx_quantity = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [data.card_id, logoUrl, brandName, color, quantity, id]
  )

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      wx_card_id: data.card_id,
      wx_card_status: 'creating',
      note: '卡券创建成功后需微信审核，审核通过事件会更新为 approved',
    },
  }
}

async function refreshWxCardStatusForTemplate(templateId) {
  await ensureReferralRewardsSchema()
  const id = parseInt(templateId, 10)
  const [rows] = await db.query(
    'SELECT id, wx_card_id FROM referral_coupon_templates WHERE id = ? LIMIT 1',
    [id]
  )
  const tpl = rows[0]
  if (!tpl?.wx_card_id) {
    return { ok: false, status: 404, body: { error: '模板尚未绑定微信卡券' } }
  }

  const data = await callCardApi('/card/get', { card_id: tpl.wx_card_id })
  if (Number(data.errcode) !== 0) {
    return { ok: false, status: 502, body: { error: data.errmsg || '查询卡券失败', wx: data } }
  }

  const status = String(data.card?.cash?.base_info?.status || data.card?.general_coupon?.base_info?.status || '')
  let wxCardStatus = 'creating'
  if (status === 'CARD_STATUS_VERIFY_OK' || status === 'CARD_STATUS_DISPATCH') wxCardStatus = 'approved'
  else if (status.includes('NOT_VERIFY') || status.includes('VERIFY_FAIL')) wxCardStatus = 'rejected'
  else if (status.includes('DELETE')) wxCardStatus = 'deleted'

  await db.query(
    `UPDATE referral_coupon_templates
     SET wx_card_status = ?, updated_at = NOW()
     WHERE id = ?`,
    [wxCardStatus, id]
  )

  return {
    ok: true,
    status: 200,
    body: { success: true, wx_card_id: tpl.wx_card_id, wx_card_status: wxCardStatus, wx_status: status },
  }
}

async function decryptCardCode(encryptCode) {
  const data = await callCardApi('/card/code/decrypt', {
    encrypt_code: String(encryptCode || '').trim(),
  })
  if (Number(data.errcode) !== 0 || !data.code) {
    const err = new Error(data.errmsg || 'code 解码失败')
    err.code = 'WX_CODE_DECRYPT_FAILED'
    err.wx = data
    throw err
  }
  return String(data.code)
}

async function getUserCardList(oaOpenid, cardId = null) {
  const body = { openid: String(oaOpenid) }
  if (cardId) body.card_id = String(cardId)
  const data = await callCardApi('/card/user/getcardlist', body)
  if (Number(data.errcode) !== 0) {
    const err = new Error(data.errmsg || 'getcardlist 失败')
    err.code = 'WX_GET_CARD_LIST_FAILED'
    err.wx = data
    throw err
  }
  return Array.isArray(data.card_list) ? data.card_list : []
}

async function buildAddCardPayload({ cardId, code, openid = '' }) {
  const apiTicket = await getOaApiTicket()
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonceStr = crypto.randomBytes(8).toString('hex')
  const signature = buildCardExtSignature({
    apiTicket,
    timestamp,
    nonceStr,
    cardId,
    code,
    openid,
  })

  const cardExtObj = {
    code: code || '',
    openid: openid || '',
    timestamp,
    nonce_str: nonceStr,
    signature,
  }

  return {
    cardId,
    cardExt: JSON.stringify(cardExtObj),
    cardExtObj,
  }
}

async function getCouponCardExtForUser(userId, couponId) {
  await ensureReferralRewardsSchema()

  if (!isWxCardSyncEnabled()) {
    return { ok: false, status: 400, body: { error: '卡券同步未启用' } }
  }

  const [rows] = await db.query(
    `SELECT id, user_id, status, wx_card_id, wx_code, wx_wallet_status
     FROM user_referral_coupons
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [couponId, userId]
  )
  const coupon = rows[0]
  if (!coupon) return { ok: false, status: 404, body: { error: '优惠券不存在' } }
  if (!['available', 'reserved'].includes(coupon.status)) {
    return { ok: false, status: 400, body: { error: '当前优惠券状态不可放入卡包' } }
  }
  if (!coupon.wx_card_id || !coupon.wx_code) {
    return { ok: false, status: 400, body: { error: '该券未绑定微信卡券，请使用已同步模板发放的券' } }
  }

  const [users] = await db.query(
    'SELECT openid, oa_openid FROM wx_users WHERE id = ? LIMIT 1',
    [userId]
  )
  const user = users[0] || {}

  await db.query(
    `UPDATE user_referral_coupons
     SET wx_wallet_status = CASE
           WHEN wx_wallet_status = 'in_wallet' THEN wx_wallet_status
           ELSE 'pending_add'
         END,
         wx_mp_openid = COALESCE(wx_mp_openid, ?),
         updated_at = NOW()
     WHERE id = ?`,
    [user.openid || null, coupon.id]
  )

  const payload = await buildAddCardPayload({
    cardId: coupon.wx_card_id,
    code: coupon.wx_code,
    openid: '',
  })

  return {
    ok: true,
    status: 200,
    body: {
      coupon_id: coupon.id,
      cardId: payload.cardId,
      cardExt: payload.cardExt,
      wx_code: coupon.wx_code,
      oa_openid: user.oa_openid || null,
    },
  }
}

async function markCouponCardAdded({ userId, couponId, encryptCode, cardId, isSuccess }) {
  await ensureReferralRewardsSchema()

  const [rows] = await db.query(
    `SELECT id, user_id, wx_card_id, wx_code, wx_wallet_status
     FROM user_referral_coupons
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [couponId, userId]
  )
  const coupon = rows[0]
  if (!coupon) return { ok: false, status: 404, body: { error: '优惠券不存在' } }

  if (isSuccess === false) {
    await db.query(
      `UPDATE user_referral_coupons
       SET wx_wallet_status = CASE
             WHEN wx_wallet_status = 'in_wallet' THEN 'in_wallet'
             ELSE 'not_added'
           END,
           wx_last_error = ?,
           updated_at = NOW()
       WHERE id = ?`,
      ['用户取消或领取失败', coupon.id]
    )
    return { ok: true, status: 200, body: { success: false, coupon_id: coupon.id } }
  }

  let realCode = coupon.wx_code
  if (encryptCode) {
    try {
      realCode = await decryptCardCode(encryptCode)
    } catch (err) {
      logger.warn('card-added decrypt failed, keep local code', {
        couponId: coupon.id,
        err: err.message,
      })
    }
  }

  const resolvedCardId = cardId || coupon.wx_card_id
  const [users] = await db.query(
    'SELECT openid, oa_openid FROM wx_users WHERE id = ? LIMIT 1',
    [userId]
  )

  await db.query(
    `UPDATE user_referral_coupons
     SET wx_card_id = COALESCE(?, wx_card_id),
         wx_code = COALESCE(?, wx_code),
         wx_wallet_status = 'in_wallet',
         wx_added_at = COALESCE(wx_added_at, NOW()),
         wx_mp_openid = COALESCE(wx_mp_openid, ?),
         wx_last_error = NULL,
         updated_at = NOW()
     WHERE id = ?`,
    [resolvedCardId || null, realCode || null, users[0]?.openid || null, coupon.id]
  )

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      coupon_id: coupon.id,
      wx_card_id: resolvedCardId,
      wx_code: realCode,
      wx_wallet_status: 'in_wallet',
    },
  }
}

/**
 * 卡面跳转小程序：用 encrypt_code 对齐本地券
 */
async function resolveCouponFromCardJump({ userId, encryptCode, cardId, oaOpenid }) {
  await ensureReferralRewardsSchema()

  if (!encryptCode) {
    return { ok: false, status: 400, body: { error: '缺少 encrypt_code' } }
  }

  const code = await decryptCardCode(encryptCode)
  const [rows] = await db.query(
    `SELECT id, user_id, status, wx_card_id, wx_code, wx_wallet_status, title, discount_yuan, min_order_yuan, expires_at
     FROM user_referral_coupons
     WHERE wx_code = ?
     LIMIT 1`,
    [code]
  )

  let coupon = rows[0]
  if (!coupon && cardId) {
    const [byCard] = await db.query(
      `SELECT id, user_id, status, wx_card_id, wx_code, wx_wallet_status, title, discount_yuan, min_order_yuan, expires_at
       FROM user_referral_coupons
       WHERE user_id = ? AND wx_card_id = ? AND status IN ('available', 'reserved')
       ORDER BY id DESC
       LIMIT 1`,
      [userId, cardId]
    )
    coupon = byCard[0]
  }

  if (!coupon) {
    return { ok: false, status: 404, body: { error: '未找到对应优惠券', wx_code: code } }
  }
  if (coupon.user_id !== userId) {
    return { ok: false, status: 403, body: { error: '优惠券不属于当前用户' } }
  }

  await db.query(
    `UPDATE user_referral_coupons
     SET wx_wallet_status = 'in_wallet',
         wx_card_id = COALESCE(?, wx_card_id),
         wx_code = COALESCE(wx_code, ?),
         wx_oa_openid = COALESCE(wx_oa_openid, ?),
         wx_added_at = COALESCE(wx_added_at, NOW()),
         updated_at = NOW()
     WHERE id = ?`,
    [cardId || null, code, oaOpenid || null, coupon.id]
  )

  if (oaOpenid) {
    await db.query(
      `UPDATE wx_users
       SET oa_openid = COALESCE(oa_openid, ?), updated_at = NOW()
       WHERE id = ?`,
      [oaOpenid, userId]
    )
  }

  return {
    ok: true,
    status: 200,
    body: {
      success: true,
      coupon_id: coupon.id,
      wx_code: code,
      status: coupon.status,
      title: coupon.title,
      discount_yuan: coupon.discount_yuan,
      min_order_yuan: coupon.min_order_yuan,
      expires_at: coupon.expires_at,
    },
  }
}

module.exports = {
  generateWxCouponCode,
  buildCardExtSignature,
  createWxCardForTemplate,
  refreshWxCardStatusForTemplate,
  decryptCardCode,
  getUserCardList,
  buildAddCardPayload,
  getCouponCardExtForUser,
  markCouponCardAdded,
  resolveCouponFromCardJump,
  yuanToFen,
}
