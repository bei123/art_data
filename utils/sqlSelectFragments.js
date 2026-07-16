/** Admin 订单列表/同步所需列（避免 SELECT o.*） */
const ADMIN_ORDER_LIST_SELECT = `
  o.id,
  o.user_id,
  o.referrer_id,
  o.referral_coupon_id,
  o.out_trade_no,
  o.total_fee,
  o.actual_fee,
  o.payment_total,
  o.discount_amount,
  o.shipping_fee,
  o.express_type_id,
  o.body,
  o.trade_state,
  o.trade_state_desc,
  o.transaction_id,
  o.success_time,
  o.created_at,
  o.updated_at
`.replace(/\s+/g, ' ').trim()

const INSTITUTION_PUBLIC_SELECT = `
  i.id,
  i.name,
  i.logo,
  i.description,
  i.address,
  i.phone,
  i.website,
  i.sort_order,
  i.created_at,
  i.updated_at
`.replace(/\s+/g, ' ').trim()

const ARTIST_LIST_SELECT = `
  a.id,
  a.avatar,
  a.banner,
  a.name,
  a.era,
  a.description,
  a.biography,
  a.journey,
  a.achievements,
  a.institution_id,
  a.is_public,
  a.sort_order,
  a.created_at,
  a.updated_at
`.replace(/\s+/g, ' ').trim()

module.exports = {
  ADMIN_ORDER_LIST_SELECT,
  INSTITUTION_PUBLIC_SELECT,
  ARTIST_LIST_SELECT,
}
