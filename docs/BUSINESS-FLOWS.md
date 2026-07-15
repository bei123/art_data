# 业务流程图 / 泳道图

仓库协作：`art_data` = Express API + Vue 管理后台；`art_wx` = 微信小程序；`art_vision` = 展览识图（内网）。

相关：[`SEQUENCES.md`](./SEQUENCES.md) · [`USE-CASES.md`](./USE-CASES.md) · [`STATE-MACHINES.md`](./STATE-MACHINES.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`COMPONENTS.md`](./COMPONENTS.md) · [接口文档](./PROJECT-API.md)

## 泳道角色

| 泳道 | 职责 | 关键落点 |
|------|------|----------|
| 小程序用户 | 浏览、下单、领取、推荐 | `art_wx` → `/api/wx/*` |
| 管理后台运营 | 商品、订单、履约、审核 | `src/views` → `requireAdmin` |
| art_data 后端 | 鉴权、计价、库存、编排 | `routes/` + `services/` |
| 微信 | 登录、JSAPI 支付、发货录入、转账 | `jscode2session` / pay notify |
| Wespace | 数字品链上 / 收银台 | `digital-artworks` + `webview` |
| 顺丰 | 下单、轨迹 | `logisticsService` / `sfExpress*` |
| WMS | 原作主档同步 | `wmsProductSyncService` |
| OSS | 图片 / 二维码存储 | `upload` / ali-oss |

## 总览

```mermaid
flowchart LR
  subgraph U[小程序用户]
    A1[浏览/加购] --> A2[下单支付]
    A2 --> A3[查物流/领码]
  end
  subgraph M[管理后台]
    B1[维护商品] --> B2[发货/传码]
    B2 --> B3[审批退款/提现]
  end
  subgraph S[art_data]
    C1[鉴权计价] --> C2[支付回调履约]
    C2 --> C3[物流/推荐结算]
  end
  subgraph X[外部]
    D1[微信]
    D2[Wespace]
    D3[顺丰]
    D4[WMS/OSS]
  end
  A1 --> C1
  A2 --> D1
  D1 --> C2
  B2 --> D3
  B2 --> D4
  A3 --> D2
```

## ① 用户登录（小程序）

```mermaid
sequenceDiagram
  participant U as 小程序用户
  participant API as art_data
  participant WX as 微信

  U->>U: wx.login 取 code
  U->>API: POST /api/wx/login
  API->>WX: jscode2session
  WX-->>API: openid / session_key
  API->>API: upsert wx_users + JWT
  API-->>U: access + refresh
  opt 绑定资料/手机
    U->>API: bindUserInfo / getPhoneNumber
  end
  U->>API: Bearer access 调业务接口
  opt Token 过期
    U->>API: POST /api/wx/refresh
  end
```

管理端并行：`Login.vue` → `POST /api/auth/login` → admin JWT。

## ② 实物下单支付

商品类型 `artwork` / `right`，须带 `address_id`。

```mermaid
sequenceDiagram
  participant U as 小程序用户
  participant API as art_data
  participant WX as 微信
  participant ADM as 管理后台
  participant SF as 顺丰

  U->>API: 浏览 /api/original-artworks|rights
  U->>API: 加购 /api/cart
  U->>API: 选地址 /api/wx/addresses
  U->>API: POST .../checkout/preview
  U->>API: unifiedorder / singleorder
  API->>WX: 预下单
  U->>WX: 调起 JSAPI 支付
  WX->>API: POST /api/wx/pay/notify
  API->>API: 履约 / 推荐归因 / 通知
  ADM->>API: 发货 POST /api/wx/logistics/orders
  API->>SF: createOrder
  U->>API: 查轨迹 / 确认收货
```

## ③ 数字藏品购买 / 领取

两条支线：

**A · 微信 JSAPI + 站内二维码**

1. 浏览数字品 → 下单 `type=digital`（可无发货地址）
2. 支付成功 → 订单「待上传二维码」
3. 管理端 `PATCH .../items/:id/qr-code`（常经 OSS）
4. 用户在订单 / 资产内扫码领取；文案见 `/api/digital-claim-copy`

**B · Wespace WebView 收银台**

1. 详情带 `goodsVerId` / `usn` 校验
2. `POST /api/digital-artworks/order/purchase`
3. 返回收银台 URL → `POST /api/auth/url-access` + `GET /api/webview/proxy`
4. Wespace 侧完成支付与链上履约

```mermaid
flowchart TB
  Start[浏览数字品] --> Choose{履约方式}
  Choose -->|站内微信买| A1[微信支付]
  A1 --> A2[管理上传领取码]
  A2 --> A3[用户扫码领取]
  Choose -->|Wespace| B1[purchase 下单]
  B1 --> B2[webview 代理收银台]
  B2 --> B3[Wespace 履约]
```

## ④ 推荐官邀请与奖励

```mermaid
sequenceDiagram
  participant R as 推荐官
  participant N as 被邀用户
  participant API as art_data
  participant ADM as 管理后台
  participant WX as 微信

  R->>API: GET /api/wx/referral/code 分享
  N->>API: 登录后 POST .../bind
  N->>API: 可选用券下单支付
  API->>API: 支付成功写 referrer_id / 佣金
  API->>API: 定时结算
  R->>API: 中心查看 + POST .../withdraw
  ADM->>API: 提现审批
  API->>WX: 企业付款/转账
```

## ⑤ 管理后台发货 / 履约

| 类型 | 步骤 |
|------|------|
| 实物 | `Orders.vue` → `GET .../admin/orders` → `POST /api/wx/logistics/orders`（顺丰）→ `order_shipments` → 可选微信发货录入 → 用户查轨迹 |
| 数字码 | 同订单页上传 `qr-code`（衔接支线 A） |
| 辅线 | WMS 同步原作、退款审批、推荐提现审批 |

## 业务域与路由挂载

| 域 | 路由前缀 |
|----|----------|
| 鉴权 | `/api/auth`、`/api/wx/login`、`/api/wx/refresh` |
| 内容 | `/api/original-artworks`、`/api/digital-artworks`、`/api/rights`、`/api/exhibitions` |
| 交易 | `/api/cart`、`/api/wx/pay/*`、`/api/wx/addresses` |
| 物流 | `/api/wx/logistics*` |
| 推荐 | `/api/wx/referral/*`、`/api/admin/referral/*` |
| 代理 | `/api/webview` |
| 对接 | `/api/external`、`/api/issuance`、`/api/upload` |
