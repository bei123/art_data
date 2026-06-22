import { describe, expect, it } from 'vitest'
import {
  maskWechatContact,
  formatUploadTimeRfc3339,
  buildShippingItemDesc,
  buildUploadShippingPayload,
  buildUploadCombinedShippingPayload,
  buildGetOrderPayload,
  buildGetOrderListPayload,
  buildNotifyConfirmReceivePayload,
  buildSetMsgJumpPathPayload,
  buildIsTradeManagementConfirmationCompletedPayload,
  isAutoNotifyConfirmReceiveEnabled,
  buildWechatOrderConfirmExtraData,
  hasWechatOrderConfirmExtraData,
  isWechatOrderConfirmReceiptCompleted,
  canOpenWechatOrderConfirmByWxState,
} from '../services/wechatShippingInfoService.js'

describe('wechatShippingInfoService helpers', () => {
  it('masks mobile phone for WeChat SF contact', () => {
    expect(maskWechatContact('13812345678')).toBe('138****5678')
    expect(maskWechatContact('+86 13812345678')).toBe('138****5678')
  })

  it('formats upload_time in RFC3339 +08:00', () => {
    const formatted = formatUploadTimeRfc3339(new Date('2022-12-15T05:29:35.120Z'))
    expect(formatted).toBe('2022-12-15T13:29:35.120+08:00')
  })

  it('builds item_desc from order items', () => {
    const desc = buildShippingItemDesc([
      { item_title: '微信红包抱枕', quantity: 1 },
      { item_title: '艺术画册', quantity: 2 },
    ])
    expect(desc).toBe('微信红包抱枕*1，艺术画册*2')
  })

  it('builds unified express shipping payload', () => {
    const built = buildUploadShippingPayload({
      orderKey: {
        order_number_type: 2,
        transaction_id: 'fake-transid',
      },
      openid: 'ogqztkPsejM9MQAFfwCQSCi4oNg3',
      trackingNo: '323244567777',
      expressCompany: 'SF',
      itemDesc: '微信气泡狗集线器*1',
      receiverPhone: '17712341234',
      uploadTime: '2022-12-15T13:29:35.120+08:00',
    })

    expect(built.payload).toMatchObject({
      order_key: { order_number_type: 2, transaction_id: 'fake-transid' },
      logistics_type: 1,
      delivery_mode: 1,
      upload_time: '2022-12-15T13:29:35.120+08:00',
      payer: { openid: 'ogqztkPsejM9MQAFfwCQSCi4oNg3' },
    })
    expect(built.payload.shipping_list).toHaveLength(1)
    expect(built.payload.shipping_list[0]).toMatchObject({
      tracking_no: '323244567777',
      express_company: 'SF',
      item_desc: '微信气泡狗集线器*1',
      contact: { receiver_contact: '177****1234' },
    })
  })

  it('builds combined shipping payload with split and unified sub orders', () => {
    const built = buildUploadCombinedShippingPayload({
      orderKey: {
        order_number_type: 1,
        mchid: 'fake-mchid-123',
        out_trade_no: 'fake-tradeno-20221214190427-0',
      },
      openid: 'ogqztkPsejM9MQAFfwCQSCi4oNg3',
      uploadTime: '2022-12-15T13:29:35.120+08:00',
      subOrders: [
        {
          order_key: {
            order_number_type: 1,
            mchid: 'fake-mchid-123',
            out_trade_no: 'fake-tradeno-20221214190427-01',
          },
          delivery_mode: 2,
          logistics_type: 1,
          is_all_delivered: true,
          shipping_list: [
            {
              tracking_no: 'fake-trackingno-1',
              express_company: 'YD',
              item_desc: '微信气泡狗零钱包*1',
              contact: { consignor_contact: '021-**34-12' },
            },
            {
              tracking_no: 'fake-trackingno-2',
              express_company: 'DHL',
              item_desc: '微信黄脸布艺胸针*1',
              contact: { consignor_contact: '021-**34-12' },
            },
          ],
        },
        {
          order_key: {
            order_number_type: 1,
            mchid: 'fake-mchid-321',
            out_trade_no: 'fake-tradeno-20221214190427-02',
          },
          delivery_mode: 1,
          logistics_type: 1,
          shipping_list: [
            {
              tracking_no: 'fake-trackingno-3',
              express_company: 'YTO',
              item_desc: '微信气泡狗双面钥匙扣*1',
              contact: { receiver_contact: '+86-123****4321' },
            },
          ],
        },
      ],
    })

    expect(built.payload).toMatchObject({
      order_key: {
        order_number_type: 1,
        mchid: 'fake-mchid-123',
        out_trade_no: 'fake-tradeno-20221214190427-0',
      },
      upload_time: '2022-12-15T13:29:35.120+08:00',
      payer: { openid: 'ogqztkPsejM9MQAFfwCQSCi4oNg3' },
    })
    expect(built.payload.sub_orders).toHaveLength(2)
    expect(built.payload.sub_orders[0]).toMatchObject({
      delivery_mode: 2,
      is_all_delivered: true,
    })
    expect(built.payload.sub_orders[0].shipping_list).toHaveLength(2)
    expect(built.payload.sub_orders[1].shipping_list).toHaveLength(1)
  })

  it('builds get_order payload by transaction_id or merchant trade no', () => {
    expect(buildGetOrderPayload({
      transactionId: 'fake-transid-20221209132531-44',
    }).payload).toEqual({
      transaction_id: 'fake-transid-20221209132531-44',
    })

    expect(buildGetOrderPayload({
      merchantId: 'fake-mchid-123',
      merchantTradeNo: 'fake-tradeno-20221209132531-44',
    }).payload).toEqual({
      merchant_id: 'fake-mchid-123',
      merchant_trade_no: 'fake-tradeno-20221209132531-44',
    })

    expect(buildGetOrderPayload({}).error).toBeTruthy()
  })

  it('builds get_order_list payload with filters and pagination', () => {
    expect(buildGetOrderListPayload({
      payTimeRange: { begin_time: 1670563531, end_time: 1670563531 },
      orderState: 1,
      openid: 'ogqztkPsejM9MQAFfwCQSCi4oNg3',
      lastIndex: '092dd3cecbc6926301',
      pageSize: 2,
    }).payload).toEqual({
      pay_time_range: { begin_time: 1670563531, end_time: 1670563531 },
      order_state: 1,
      openid: 'ogqztkPsejM9MQAFfwCQSCi4oNg3',
      last_index: '092dd3cecbc6926301',
      page_size: 2,
    })

    expect(buildGetOrderListPayload({}).payload).toEqual({})
    expect(buildGetOrderListPayload({ pageSize: 200 }).error).toBeTruthy()
    expect(buildGetOrderListPayload({
      payTimeRange: { begin_time: 200, end_time: 100 },
    }).error).toBeTruthy()
  })

  it('builds notify_confirm_receive payload with required received_time', () => {
    expect(buildNotifyConfirmReceivePayload({
      transactionId: 'fake-transid-20221209132531-44',
      merchantId: 'fake-mchid-123',
      merchantTradeNo: 'fake-tradeno-20221209132531-44',
      receivedTime: 1670829139,
    }).payload).toEqual({
      transaction_id: 'fake-transid-20221209132531-44',
      merchant_id: 'fake-mchid-123',
      merchant_trade_no: 'fake-tradeno-20221209132531-44',
      received_time: 1670829139,
    })

    expect(buildNotifyConfirmReceivePayload({
      merchantId: 'fake-mchid-123',
      merchantTradeNo: 'fake-tradeno-20221209132531-44',
    }).error).toBeTruthy()
  })

  it('builds set_msg_jump_path payload and strips leading slash', () => {
    expect(buildSetMsgJumpPathPayload({
      path: '/pages/order/detail',
    }).payload).toEqual({
      path: 'pages/order/detail',
    })

    expect(buildSetMsgJumpPathPayload({ path: '  ' }).error).toBeTruthy()
  })

  it('builds is_trade_management_confirmation_completed payload with appid', () => {
    const prev = process.env.WX_APPID
    process.env.WX_APPID = 'wx0123456789abcdef'

    expect(buildIsTradeManagementConfirmationCompletedPayload({}).payload).toEqual({
      appid: 'wx0123456789abcdef',
    })
    expect(buildIsTradeManagementConfirmationCompletedPayload({
      appid: 'wxoverride123',
    }).payload).toEqual({
      appid: 'wxoverride123',
    })

    process.env.WX_APPID = prev
  })

  it('auto notify confirm receive is enabled by default', () => {
    const prev = process.env.WX_AUTO_NOTIFY_CONFIRM_RECEIVE_ENABLED
    delete process.env.WX_AUTO_NOTIFY_CONFIRM_RECEIVE_ENABLED
    expect(isAutoNotifyConfirmReceiveEnabled()).toBe(true)
    process.env.WX_AUTO_NOTIFY_CONFIRM_RECEIVE_ENABLED = 'false'
    expect(isAutoNotifyConfirmReceiveEnabled()).toBe(false)
    if (prev == null) delete process.env.WX_AUTO_NOTIFY_CONFIRM_RECEIVE_ENABLED
    else process.env.WX_AUTO_NOTIFY_CONFIRM_RECEIVE_ENABLED = prev
  })

  it('builds weappOrderConfirm extraData', () => {
    expect(buildWechatOrderConfirmExtraData({
      transactionId: '420000123',
      merchantId: '1360639602',
      outTradeNo: 'ORDER123',
    })).toEqual({
      transaction_id: '420000123',
      merchant_id: '1360639602',
      merchant_trade_no: 'ORDER123',
    })
    expect(hasWechatOrderConfirmExtraData({
      merchant_id: '1360639602',
      merchant_trade_no: 'ORDER123',
    })).toBe(true)
    expect(isWechatOrderConfirmReceiptCompleted(3)).toBe(true)
    expect(isWechatOrderConfirmReceiptCompleted(2)).toBe(false)
    expect(canOpenWechatOrderConfirmByWxState(2)).toBe(true)
  })
})
