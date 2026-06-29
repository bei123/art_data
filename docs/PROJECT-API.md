# 项目接口文档

本文档面向管理后台、微信小程序及后端联调人员。机器可读的完整接口定义见：

- [`openapi-esa.json`](./openapi-esa.json)：格式化的 OpenAPI 3.0 文档
- [`openapi-esa.min.json`](./openapi-esa.min.json)：可上传 ESA 的压缩版本

当前接口基线：**257 个操作，213 条路径**。接口清单由后端路由自动生成，并通过
`npm run audit:openapi` 校验。

## 1. 基础信息

| 环境 | Base URL |
| --- | --- |
| 生产环境 | `https://api.wx.2000gallery.art` |
| 本地后端 | `http://localhost:2000` |

除 `/uploads/*` 静态文件外，业务接口统一使用 `/api` 前缀。JSON 请求应发送：

```http
Content-Type: application/json
```

## 2. 认证

管理后台和小程序登录成功后均通过请求头传递访问令牌：

```http
Authorization: Bearer <access_token>
```

### 管理后台登录

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "******"
}
```

### 微信小程序登录

小程序先调用 `uni.login`/`wx.login` 获取临时 `code`：

```http
POST /api/wx/login
Content-Type: application/json

{
  "code": "<wx.login 返回的 code>"
}
```

成功响应包含：

```json
{
  "token": "<access_token>",
  "refreshToken": "<refresh_token>",
  "expires_at": "2026-06-29T18:00:00.000Z",
  "expiresIn": 7200,
  "refresh_expires_at": "2026-07-29T16:00:00.000Z",
  "refreshExpiresIn": 2592000,
  "user": {
    "id": 1,
    "openid": "openid",
    "nickname": "昵称",
    "avatar": "https://..."
  }
}
```

刷新访问令牌：

```http
POST /api/wx/refresh
Content-Type: application/json

{
  "refreshToken": "<refresh_token>"
}
```

刷新令牌采用轮换机制，成功后客户端必须保存响应中的新 `refreshToken`。

## 3. 响应与错误约定

成功请求通常返回 HTTP `200`。列表接口兼容两种历史结构：

```json
[]
```

或：

```json
{
  "data": [],
  "pagination": {
    "total": 0,
    "page": 1,
    "limit": 20,
    "totalPages": 0
  }
}
```

失败响应通常为：

```json
{
  "error": "错误说明"
}
```

| 状态码 | 含义 | 客户端处理 |
| --- | --- | --- |
| `400` | 参数或业务状态不合法 | 显示服务端错误信息 |
| `401` | 未登录、访问令牌失效 | 尝试刷新令牌并重试 |
| `403` | 权限不足 | 停止请求并提示无权限 |
| `404` | 资源不存在 | 返回列表或空状态 |
| `409` | 数据冲突 | 刷新数据后重试 |
| `429` | 请求过于频繁 | 按响应头等待后重试 |
| `500` | 服务端异常 | 记录 `X-Request-Id` 后排查 |

## 4. 小程序核心接口

### 登录和用户

| 方法 | 路径 | 认证 | 用途 |
| --- | --- | --- | --- |
| `POST` | `/api/wx/login` | 否 | 微信 code 登录 |
| `POST` | `/api/wx/refresh` | 否 | 刷新并轮换令牌 |
| `GET` | `/api/wx/userInfo` | 是 | 当前微信用户资料 |
| `POST` | `/api/wx/bindUserInfo` | 是 | 首次绑定昵称、头像或手机 |
| `POST` | `/api/wx/updateProfile` | 是 | 修改昵称或上传头像 |
| `POST` | `/api/wx/getPhoneNumber` | 是 | 用微信动态 code 获取手机号 |
| `GET` | `/api/wx/userPhone` | 是 | 获取当前用户手机号 |
| `GET` | `/api/wx/userVerificationStatus` | 是 | 查询实名状态 |
| `POST` | `/api/auth/logout` | 是 | 注销访问及刷新令牌 |

### 首页和内容

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/home-titles` | 首页标题 |
| `GET` | `/api/banners` | 首页轮播 |
| `GET` | `/api/showcase` | 首页展陈 |
| `GET` | `/api/exhibitions` | 展览列表 |
| `GET` | `/api/exhibitions/{id}` | 展览详情 |
| `GET` | `/api/artists` | 艺术家列表 |
| `GET` | `/api/artists/{id}` | 艺术家详情 |
| `GET` | `/api/original-artworks` | 原作列表 |
| `GET` | `/api/original-artworks/{id}` | 原作详情 |
| `GET` | `/api/digital-artworks` | 数字艺术品列表 |
| `GET` | `/api/digital-artworks/{id}` | 数字艺术品详情 |
| `GET` | `/api/rights` | 权益商品列表 |
| `GET` | `/api/rights/{id}` | 权益商品详情 |
| `GET` | `/api/search?q=关键词` | 全站搜索 |

### 购物车和收藏

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/cart` | 购物车列表 |
| `POST` | `/api/cart` | 加入购物车 |
| `PUT` | `/api/cart/{id}` | 修改数量 |
| `DELETE` | `/api/cart/{id}` | 删除购物车项 |
| `DELETE` | `/api/cart` | 清空购物车 |
| `GET` | `/api/favorites` | 收藏列表 |
| `GET` | `/api/favorites/{itemType}/{itemId}` | 查询收藏状态 |
| `POST` | `/api/favorites` | 添加收藏 |
| `DELETE` | `/api/favorites/{itemType}/{itemId}` | 取消收藏 |

收藏类型使用后端定义的值，例如 `artwork`、`digital_art`、`copyright_item`。

### 地址、订单和支付

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/wx/addresses` | 地址列表 |
| `GET` | `/api/wx/addresses/default` | 默认地址 |
| `POST` | `/api/wx/addresses` | 新增地址 |
| `PUT` | `/api/wx/addresses/{id}` | 修改地址 |
| `PUT` | `/api/wx/addresses/{id}/default` | 设置默认地址 |
| `DELETE` | `/api/wx/addresses/{id}` | 删除地址 |
| `POST` | `/api/wx/pay/checkout/preview` | 结算预览，以服务端价格为准 |
| `POST` | `/api/wx/pay/unifiedorder` | 购物车统一下单 |
| `POST` | `/api/wx/pay/singleorder` | 单商品下单 |
| `POST` | `/api/wx/pay/sign` | 获取支付签名 |
| `GET` | `/api/wx/pay/orders` | 当前用户订单列表 |
| `GET` | `/api/wx/pay/orders/detail` | 当前用户订单详情 |
| `POST` | `/api/wx/pay/close` | 关闭待支付订单 |
| `POST` | `/api/wx/pay/refund` | 申请退款 |
| `GET` | `/api/wx/pay/check-repayable` | 检查订单是否可重新支付 |
| `POST` | `/api/wx/pay/orders/confirm-receipt/verify` | 校验微信确认收货结果 |

客户端不得自行决定订单金额；必须使用结算预览和下单接口返回的服务端价格。

### 推荐与优惠

推荐接口统一使用 `/api/wx/referral` 前缀，包含推荐码、绑定关系、分享事件、
佣金、提现、优惠券及艺术顾问申请。写接口需要登录，公开规则接口无需登录。

## 5. 管理端接口模块

管理写接口均要求管理员 JWT。当前模块及操作数如下：

| 模块 | 前缀 | 操作数 |
| --- | --- | ---: |
| 管理推荐 | `/api/admin/referral` | 20 |
| 微信用户管理 | `/api/admin/wx-users` | 3 |
| 微信支付与订单 | `/api/wx/pay` | 21 |
| 微信用户、物流、订阅消息 | `/api/wx` | 68 |
| 数字艺术品 | `/api/digital-artworks` | 16 |
| 展览 | `/api/exhibitions` | 14 |
| 原作 | `/api/original-artworks` | 13 |
| 外部系统对接 | `/api/external` | 10 |
| 商家 | `/api/merchants` | 9 |
| 艺术家 | `/api/artists` | 8 |
| 发行铸造 | `/api/issuance` | 8 |

其余模块包括轮播、分类、机构、版权权益、资产过户、资产查验、交易记录、
数字权益副本、展陈、仪表盘、上传及 WebView 代理。每个接口的准确方法、路径参数
及已建模请求体以 OpenAPI 文件为准。

## 6. 文件上传

通用管理上传：

```http
POST /api/upload
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data

file=<binary>
```

小程序头像上传：

```http
POST /api/wx/updateProfile
Authorization: Bearer <access_token>
Content-Type: multipart/form-data

avatar=<binary>
```

图片返回地址通常位于 `https://wx.oss.2000gallery.art`。该域名需加入微信小程序
`downloadFile`/`uploadFile` 合法域名配置。

## 7. 联调检查

```bash
# 服务健康
curl https://api.wx.2000gallery.art/api/health

# 重新生成 OpenAPI
node scripts/generate-openapi-esa.js

# 检查代码路由与文档是否一致
npm run audit:openapi
```

提交路由变更前必须重新生成文档并通过审计。涉及登录、支付、退款、实名或物流时，
还应运行 `npm test`。

## 8. 安全约定

- 不在 URL、日志或客户端代码中保存 access token、refresh token、AppSecret。
- 小程序只保存用户自己的令牌，不接受客户端传入的 `user_id` 作为数据归属依据。
- 支付回调、退款回调和第三方 webhook 必须使用各自的签名校验。
- 管理端写操作必须通过管理员角色校验。
- 展示服务端错误时不要暴露堆栈、SQL、密钥或第三方完整响应。

