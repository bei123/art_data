const BLOCKED_FULFILLMENT_CODES = new Set([
  'received',
  'delivered',
  'completed',
  'refunding',
  'refunded',
  'cancelled',
  'closed',
  'created',
  'awaiting_payment',
  'payment_failed',
  'awaiting_delivery',
])

function isValidWechatTransactionId(value) {
  const text = value != null ? String(value).trim() : ''
  if (!text) return false
  if (text.includes('*')) return false
  return true
}

function hasPhysicalOrderItems(items) {
  return (items || []).some((item) => item?.type === 'right' || item?.type === 'artwork')
}

function hasActiveShipment(shipment) {
  if (!shipment || !shipment.waybill_id) return false
  if (shipment.status === 'cancelled') return false
  return true
}

function buildWechatOrderConfirmFields({
  order,
  wxPay,
  tradeState,
  fulfillmentStatus,
  items,
  shipment,
  merchantId,
}) {
  const transactionIdRaw = wxPay?.transaction_id || order?.transaction_id || null
  const transactionId = isValidWechatTransactionId(transactionIdRaw) ? String(transactionIdRaw).trim() : null
  const resolvedMerchantId = merchantId != null && String(merchantId).trim() !== ''
    ? String(merchantId).trim()
    : null
  const merchantTradeNo = order?.out_trade_no != null && String(order.out_trade_no).trim() !== ''
    ? String(order.out_trade_no).trim()
    : null

  const fulfillmentCode = fulfillmentStatus?.code || null
  const physical = hasPhysicalOrderItems(items)
  const shipped = hasActiveShipment(shipment)

  const canConfirmReceipt = tradeState === 'SUCCESS'
    && physical
    && shipped
    && Boolean(transactionId && resolvedMerchantId && merchantTradeNo)
    && (!fulfillmentCode || !BLOCKED_FULFILLMENT_CODES.has(fulfillmentCode))

  const wechatOrderConfirm = {
    enabled: canConfirmReceipt,
    transaction_id: transactionId,
    merchant_id: resolvedMerchantId,
    merchant_trade_no: merchantTradeNo,
  }

  return {
    can_confirm_receipt: canConfirmReceipt,
    wechat_order_confirm: wechatOrderConfirm,
    payment_merchant_id: resolvedMerchantId,
    payment_transaction_id: transactionId,
  }
}

module.exports = {
  isValidWechatTransactionId,
  buildWechatOrderConfirmFields,
}
