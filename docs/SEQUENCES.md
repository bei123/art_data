# 时序图

端到端调用时序（参与者、接口路径、关键副作用）。业务泳道见 [`BUSINESS-FLOWS.md`](./BUSINESS-FLOWS.md)，状态迁移见 [`STATE-MACHINES.md`](./STATE-MACHINES.md)，组件边界见 [`COMPONENTS.md`](./COMPONENTS.md)。

## 目录

1. [小程序登录 / Refresh](#1-小程序登录--refresh)
2. [实物下单 · JSAPI · 支付回调](#2-实物下单--jsapi--支付回调)
3. [管理端发货（顺丰 / 手工运单）](#3-管理端发货顺丰--手工运单)
4. [数字品：站内购码 vs Wespace](#4-数字品站内购码-vs-wespace)
5. [推荐绑定 · 佣金 · 提现](#5-推荐绑定--佣金--提现)
6. [展览扫画识图](#6-展览扫画识图)
7. [管理端登录](#7-管理端登录)

---

## 1. 小程序登录 / Refresh

**代码：** `routes/wx.js` → `wxService` → `wxSessionTokens`

```mermaid
sequenceDiagram
  actor U as 小程序用户
  participant MP as art_wx
  participant API as art_data
  participant WX as 微信
  participant DB as MySQL

  U->>MP: wx.login
  MP->>API: POST /api/wx/login { code, referrer? }
  API->>WX: jscode2session
  WX-->>API: openid / session_key
  API->>DB: upsert wx_users
  API->>DB: issueWxTokenPair<br/>sessions + refresh_tokens
  Note over API: tryAttributeReferralOnLogin<br/>新用户欢迎券 / tier
  API-->>MP: token + refreshToken + user
  MP->>API: Bearer 调业务接口

  opt Access 过期
    MP->>API: POST /api/wx/refresh { refreshToken }
    API->>DB: rotate access (+ refresh)
    API-->>MP: 新 token 对
  end
```

---

## 2. 实物下单 · JSAPI · 支付回调

商品类型 `artwork` / `right`，须带地址。**代码：** `routes/pay.js` → `checkoutPricing` / `payService`

```mermaid
sequenceDiagram
  actor U as 小程序用户
  participant MP as art_wx
  participant API as art_data
  participant WX as 微信支付
  participant DB as MySQL

  U->>MP: 选品加购 / 选地址
  MP->>API: POST /api/wx/pay/checkout/preview
  API-->>MP: 报价 · 运费 · 券

  MP->>API: POST .../unifiedorder | singleorder
  API->>DB: TX 建单 · 锁定库存 · 推荐归因 · 券占用
  API->>WX: v3 JSAPI 预下单<br/>notify → /api/wx/pay/notify
  WX-->>API: prepay_id
  Note over API: schedulePaymentPendingReminder
  API-->>MP: 支付参数
  MP->>WX: 调起 JSAPI

  WX->>API: POST /api/wx/pay/notify
  API->>API: 验签 · 解密 resource
  API->>DB: TX SUCCESS · 扣库存<br/>onPaymentSuccess / 佣金入账<br/>券核销 / 首单奖励
  Note over API: cancelPendingReminder<br/>emitPaymentSuccessSubscribeNotifies
  API-->>WX: 成功应答
```

支付成功后的异步/定时：订阅消息（含延迟重试）、`commissionSettlementScheduler` 结算到钱包、未支付订单由 `orderAutoCloseScheduler` 关闭。

---

## 3. 管理端发货（顺丰 / 手工运单）

**前提：** 订单 `trade_state === SUCCESS`，含实物行与地址。**代码：** `routes/wx.js` → `logisticsService` → `sfExpress*` / `wechatExpressOpenMsgService`

```mermaid
sequenceDiagram
  actor ADM as 管理后台
  participant API as art_data
  participant SF as 顺丰
  participant WX as 微信
  participant DB as MySQL

  alt 顺丰下单
    ADM->>API: POST /api/wx/logistics/orders
    API->>SF: createOrder
    SF-->>API: 运单号
  else 手工填运单
    ADM->>API: POST /api/wx/logistics/manual-shipment
  end
  API->>DB: 写入 order_shipments（ship_source=sf|manual）
  API->>WX: follow_waybill（物流消息）
  API->>DB: 存 waybill_token / follow_status
  opt 微信发货录入开启
    API->>WX: uploadShippingInfoForOrder（交易发货管理）
  end
  API-->>ADM: 运单结果

  Note over WX: 微信在揽件/派件/签收推送服务通知
  Note over API: logisticsPathNotify 仍可拉顺丰轨迹入库<br/>不再推送本地物流订阅消息
```

---

## 4. 数字品：站内购码 vs Wespace

### A · 微信 JSAPI + 管理上传领取码

支付链路同 §2（`type=digital`，地址可无）。履约差异：

```mermaid
sequenceDiagram
  actor U as 用户
  participant MP as art_wx
  participant API as art_data
  participant ADM as 管理后台
  participant OSS as OSS

  Note over MP,API: 支付回调后 digital_identity_purchases<br/>订单待上传二维码
  ADM->>API: PATCH /api/wx/pay/admin/orders/:orderId/items/:itemId/qr-code
  API->>OSS: 上传二维码图（常见）
  API->>API: 写 delivery_qr_code_*<br/>notifyVirtualDeliveryShipped
  API-->>ADM: OK
  U->>MP: 订单 / 资产查看领取码
  MP->>API: 订单详情 · GET /api/digital-claim-copy
  Note over U: 扫码指向站外领取目标<br/>无独立 claim API
```

### B · Wespace WebView 收银台

**代码：** `routes/digital-artworks.js` · `webview` · `urlAccessToken`

```mermaid
sequenceDiagram
  actor U as 用户
  participant MP as art_wx
  participant API as art_data
  participant WS as Wespace
  participant WV as webview proxy

  U->>MP: 数字品详情（goodsVerId / usn）
  MP->>API: POST /api/digital-artworks/order/purchase
  API->>WS: discountPrice · ver/details<br/>unifiedOrder · queryOrderPrice
  WS-->>API: orderId
  API-->>MP: cashierUrl（m.wespace.cn …）
  MP->>API: POST /api/auth/url-access
  API-->>MP: 短期 access
  MP->>WV: GET /api/webview/proxy?…
  WV-->>U: 打开收银台 H5
  U->>WS: 收银台完成支付 / 链上履约
  Note over API: 不走 /api/wx/pay/notify
```

---

## 5. 推荐绑定 · 佣金 · 提现

**挂载：** `/api/wx/referral/*`（经 `wx.js`）、`/api/admin/referral/*`

```mermaid
sequenceDiagram
  actor R as 推荐官
  actor N as 被邀用户
  participant API as art_data
  actor ADM as 管理后台
  participant WX as 微信转账
  participant DB as MySQL

  R->>API: GET /api/wx/referral/code
  API-->>R: 分享码
  N->>API: 登录（body 带 referrer）或<br/>POST /api/wx/referral/attribute
  API->>DB: attributeReferral（临时归因）
  opt 用户确认上级
    N->>API: POST /api/wx/referral/bind { confirm: true }
    API->>DB: bindReferral（永久绑定）
  end

  N->>API: 下单支付成功（payNotify）
  Note over API: resolveOrderReferrerId<br/>归因优先，否则绑定
  API->>DB: createCommissionsForPaidOrder<br/>（commission_ledger pending）
  Note over API: commissionSettlementScheduler<br/>→ settlePendingCommissions

  R->>API: POST /api/wx/referral/withdraw
  API->>DB: withdrawal_requests pending
  ADM->>API: POST /api/admin/referral/withdrawals/:id/approve
  API->>WX: processWithdrawTransfer
  WX->>API: POST /api/wx/referral/withdraw/notify
  API->>DB: 提现终态
```

---

## 6. 展览扫画识图

**代码：** `routes/exhibitions.js` → `artworkVisualSearchService` → `artVisionClient` / dHash

```mermaid
sequenceDiagram
  actor U as 现场用户
  participant MP as art_wx scan
  participant API as art_data
  participant VIS as art_vision
  participant DB as MySQL

  U->>MP: 拍摄墙上原作
  MP->>API: POST /api/exhibitions/:id/visual-search<br/>{ image_base64 }
  Note over API: IP 限流

  alt ART_VISION_ENABLED
    API->>VIS: POST /internal/exhibitions/:id/search
    VIS-->>API: CLIP 命中
  else 未启用 / 失败
    API->>DB: 展览候选作品
    API->>API: dHash 比对打分
  end

  API-->>MP: matched + detail_path<br/>或无匹配原因
  MP->>MP: 跳转作品详情页
```

索引侧（非用户请求路径）：展览发布/改作品 → `exhibitionVisionIndex` 防抖 → `art_vision` `/internal/.../index`；启动时可 `exhibitionVisionIndexBootstrap`。

---

## 7. 管理端登录

**代码：** `index.js` + `auth.js`

```mermaid
sequenceDiagram
  actor ADM as 运营
  participant SPA as 管理后台
  participant API as art_data
  participant DB as MySQL

  ADM->>SPA: 输入账号密码
  SPA->>API: POST /api/auth/login
  API->>DB: users ⋈ roles
  API->>API: bcrypt.compare
  API->>DB: user_sessions · last_login
  API-->>SPA: token + user{ role }
  SPA->>API: GET /api/auth/me（守卫）
  Note over SPA,API: 业务接口带 admin JWT<br/>requireAdmin / 角色
```

---

## 与定时任务的衔接（支付后）

| 时机 | 副作用 | 模块 |
|------|--------|------|
| `payNotify` 事务内 | 佣金 ledger、等级、券/首单奖 | `payService` |
| `payNotify` 提交后 | 支付成功订阅消息（含重试） | `emitPaymentSuccessSubscribeNotifies` |
| 进程常驻 | 催付、佣金结算、物流轨迹、推荐对账、订单自动关闭 | `index.js` 启的各 `*Scheduler` |
| 上传数字码后 | 虚拟发货订阅消息 | `uploadDigitalItemQrCode` |
| 顺丰下单后 | follow_waybill（物流消息）+ upload_shipping_info；轨迹由 logisticsPathNotify 同步（不推订阅） | `logisticsService` |
