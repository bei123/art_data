/**
 * Build outbound HTTP URLs from fixed origins + validated path segments (SSRF / request-forgery mitigation).
 */

const WECHAT_PAY_API_ORIGIN = 'https://api.mch.weixin.qq.com';

function assertSafePathSegment(value, label = 'id') {
  const segment = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    const err = new Error(`Invalid ${label}`);
    err.code = 'INVALID_PATH_SEGMENT';
    throw err;
  }
  return segment;
}

function assertWechatOutTradeNo(value) {
  const outTradeNo = String(value ?? '').trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(outTradeNo)) {
    const err = new Error('Invalid out_trade_no');
    err.code = 'INVALID_OUT_TRADE_NO';
    throw err;
  }
  return outTradeNo;
}

function joinUrlPath(baseUrl, ...segments) {
  const base = String(baseUrl).replace(/\/+$/, '');
  return segments.reduce((acc, segment) => `${acc}/${segment}`, base);
}

function wechatPayOutTradeNoQueryUrl(outTradeNo) {
  const safe = assertWechatOutTradeNo(outTradeNo);
  return `${WECHAT_PAY_API_ORIGIN}/v3/pay/transactions/out-trade-no/${safe}`;
}

function wechatPayOutTradeNoCloseUrl(outTradeNo) {
  const safe = assertWechatOutTradeNo(outTradeNo);
  return `${WECHAT_PAY_API_ORIGIN}/v3/pay/transactions/out-trade-no/${safe}/close`;
}

module.exports = {
  WECHAT_PAY_API_ORIGIN,
  assertSafePathSegment,
  assertWechatOutTradeNo,
  joinUrlPath,
  wechatPayOutTradeNoQueryUrl,
  wechatPayOutTradeNoCloseUrl,
};
