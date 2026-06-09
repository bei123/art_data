import { describe, it, expect } from 'vitest';
import {
  assertSafePathSegment,
  assertWechatOutTradeNo,
  joinUrlPath,
  wechatPayOutTradeNoQueryUrl,
  wechatPayOutTradeNoCloseUrl,
} from '../utils/safeOutboundUrl.js';

describe('safeOutboundUrl', () => {
  it('assertSafePathSegment accepts alphanumeric ids', () => {
    expect(assertSafePathSegment('abc-123_9')).toBe('abc-123_9');
  });

  it('assertSafePathSegment rejects traversal', () => {
    expect(() => assertSafePathSegment('../etc')).toThrow();
  });

  it('assertWechatOutTradeNo validates trade numbers', () => {
    expect(assertWechatOutTradeNo('  wx20260101123456  ')).toBe('wx20260101123456');
    expect(() => assertWechatOutTradeNo('bad/no')).toThrow();
  });

  it('joinUrlPath builds fixed-base URLs', () => {
    expect(joinUrlPath('https://api.example.com', 'v1', 'items', '42')).toBe(
      'https://api.example.com/v1/items/42'
    );
  });

  it('wechatPay URLs use fixed origin', () => {
    expect(wechatPayOutTradeNoQueryUrl('ORDER123')).toBe(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/ORDER123'
    );
    expect(wechatPayOutTradeNoCloseUrl('ORDER123')).toBe(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/ORDER123/close'
    );
  });
});
