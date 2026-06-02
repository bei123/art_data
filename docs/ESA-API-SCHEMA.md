# ESA API 安全架构验证 — 后端 OpenAPI 说明

## 文件

| 文件 | 说明 | 上传 ESA |
|------|------|----------|
| `openapi-esa.min.json` | 压缩版，须 ≤58KB | **推荐上传此文件** |
| `openapi-esa-smoke.json` | 仅 2 个接口的冒烟测试 | 上传失败时先测此文件 |
| `openapi-esa.json` | 格式化版，便于本地阅读 | 可选 |
| `scripts/generate-openapi-esa.js` | 从 `routes/` 与 `index.js` 自动生成 | 路由变更后执行 |

重新生成：

```bash
node scripts/generate-openapi-esa.js
```

## 规范约束（与阿里云 ESA 一致）

- OpenAPI **3.0.0**
- 必选：`openapi`、`info`、`paths`（≥1 条）、`servers`（绝对 URL）
- `servers.url`：`https://api.wx.2000gallery.art`（与 `config/publicEnv.js` 生产默认一致）
- 带 JSON 请求体的接口仅声明 `application/json`
- Schema 使用 `int32` / `email` 等 ESA 支持的 format；`$ref` 仅指向 `#/components/schemas/*`
- 文件上传（`multipart/form-data`）接口**仅登记路径**，不声明 requestBody（ESA 不支持非 JSON 体）

认证方式：请求头 `Authorization: Bearer <JWT>`（与 `auth.authenticateToken` 一致）。

## API 模块一览

| 标签 | 前缀 | 职责 |
|------|------|------|
| 系统 | `/api/health` | 健康检查、存活探针 |
| 认证 | `/api/auth` | 后台注册、登录、当前用户、登出 |
| 上传 | `/api/upload` | 文件上传 OSS |
| 微信小程序 | `/api/wx` | 登录、手机号、资料、地址、实名、物流等 |
| 微信支付 | `/api/wx/pay` | 统一下单、回调、退款、订单查询 |
| 收藏 | `/api/favorites` | 收藏列表、添加、删除 |
| 购物车 | `/api/cart` | 购物车 CRUD |
| 轮播图 | `/api/banners` | 首页轮播 |
| 艺术家 | `/api/artists` | 艺术家 CRUD、代表作 |
| 原作 | `/api/original-artworks` | 原作列表/详情、WMS 同步与仓库图 |
| 数字艺术品 | `/api/digital-artworks` | 数字艺术、下单、外部商品同步 |
| 实物分类 | `/api/physical-categories` | 分类管理 |
| 版权实物 | `/api/rights` | 版权实物商品 |
| 商家 | `/api/merchants` | 商家入驻与展示 |
| 用户 | `/api/user` | 用户已购等 |
| 搜索 | `/api/search` | 全站搜索（`q` 必填） |
| 外部对接 | `/api/external` | 第三方用户/资产/订单 |
| 发行铸造 | `/api/issuance` | 发行铸造与资产产品 |
| 资产过户 | `/api/asset-transfer` | 过户、回调、币种 |
| 资产查证 | `/api/asset-verify` | 扫码查证、批量、历史 |
| 交易记录 | `/api/transaction` | 记录、统计、导出 |
| 机构 | `/api/institutions` | 机构与旗下艺术家 |
| 首页标题 | `/api/home-titles` | 首页文案 |
| 展览 | `/api/exhibitions` | 展览、展品、现场图 |
| WebView | `/api/webview` | H5 代理 |
| 数字身份 | `/api/digital-identity` | 数字身份购买记录 |

当前共 **183** 个接口操作（`GET`/`POST`/`PUT`/`DELETE`/`PATCH`），合并为 **144** 条 `paths`（同一路径多种方法算一条 path），由代码自动扫描生成。

**完整性校验**（代码路由 ⊆ OpenAPI）：

```bash
node scripts/audit-openapi-routes.js
```

最近一次审计结果：`Code routes: 183`，`OpenAPI operations: 183`，**无遗漏**。

### 上传报错「错误码 63 / accidents」

多为 ESA 解析器不接受的 OpenAPI 写法，已在新版生成器中规避：

| 问题 | 处理 |
|------|------|
| `operationId` 含 `:`（如 `get_artists_:id`） | 已改为 `get_artists_id` |
| schema 使用 `enum`、`array` | 已移除 |
| 中文 `title`/`tags`/`description` | 已改为英文 |
| 文件超过 58KB | 生成时自动检查 |

**排查步骤：**

1. 务必上传 **`openapi-esa.min.json`**（不要传格式化版 `openapi-esa.json`）
2. 先上传 **`openapi-esa-smoke.json`**，若成功再传完整版
3. 仍失败：工单提供 RequestId `D3D009CC-4FD1-5A5C-9538-1FEF4C4EE00B`

### 未纳入架构文件的内容（本身不是可调用 API）

| 项 | 说明 |
|----|------|
| `app.use('/api/admin/*', …)` | 仅为管理员鉴权中间件，本仓库无挂载在其下的具体路由 |
| `GET /uploads/*` | 静态文件，非 JSON API |
| `OPTIONS` | 由 CORS 中间件处理，无独立 handler |
| 已注释代码 | 如 `payService.js` 内测试路由 |

## 已建模的请求体示例（components）

- `AuthRegister` / `AuthLogin` — 后台账号
- `WxCodeBody` — 小程序 `code`
- `CartAddItem` / `CartUpdateQuantity` — 购物车
- `FavoriteAdd` — 收藏 `item_type` + `item_id`
- `PayOrderBody` — 微信支付下单
- `BulkDeleteBody` — 批量删除 ID 列表

其余 `POST`/`PUT`/`PATCH` 接口在架构文件中仅描述路径与方法；业务字段以实际路由 `req.body` 为准，可按需在 `generate-openapi-esa.js` 的 `BODY_REF_RULES` 中补充 schema。

## 本地校验大小

```powershell
(Get-Item docs\openapi-esa.min.json).Length   # 须 ≤ 59392 (58KB)
```
