# 独立 API 域名：`api.wx.2000gallery.art`（ESA 官方配置）

管理台 `https://wx.ht.2000gallery.art` 跨域访问 `https://api.wx.2000gallery.art/api/*`。  
前端使用 `withCredentials: true`，响应头必须是 **具体 Origin**，不能只用 `*`。

Node 源码已处理 CORS（`middleware/corsPolicy.js`），但 **请求必须先到达 Node**。  
当前外网检测为 **ESA 502**，浏览器表现为「无 `Access-Control-Allow-Origin`」。

---

## 一、先修 502（否则谈不上 CORS）

官方 [502 说明](https://help.aliyun.com/zh/edge-security-acceleration/esa/support/http-status-code-description)：ESA **无法与源站建立连接**。

### 常见架构：宝塔 Nginx :80 反代 Node :2000

```
浏览器 https://api.wx...  →  ESA  →  源站 Nginx :80  →  proxy_pass https://127.0.0.1:2000
```

Nginx 示例：[nginx-baota-api-wx.example.conf](./nginx-baota-api-wx.example.conf)

**常见错误**：宝塔反代写成 `proxy_pass http://127.0.0.1:2000`。本仓库 Node 为 **HTTPS** 监听 2000（`https.createServer`），应改为：

```nginx
proxy_pass https://127.0.0.1:2000;
proxy_ssl_verify off;
```

否则源站 Nginx 报 502，ESA 对外也是 502，浏览器显示 CORS 失败。

此时 **ESA 必须回源到 HTTP:80**，不能仍用默认「跟随客户端 → HTTPS:443」。

### ESA 控制台（api.wx 站点必改）

**站点管理** → **`api.wx.2000gallery.art`** → **源站证书** → **回源协议和端口**

| 项 | 值 |
|----|-----|
| 回源协议 | **HTTP**（不要「跟随客户端协议」） |
| HTTP 端口 | **80** |
| 源站地址 | API 机公网 IP（与宝塔 Nginx 同机） |
| 回源 Host | `api.wx.2000gallery.art`（默认跟随请求 Host 即可） |
| 源站证书校验 | HTTP 回源时 **关闭** |

与 `wx.ht` 管理台同理，只是 `server_name` 不同。改完后 **缓存刷新** `/api/health`。

### 源站自测（在 API 服务器上，应先 200）

```bash
# 经 Nginx 80（与 ESA 回源路径一致）
curl -sI -X OPTIONS "http://127.0.0.1/api/health" \
  -H "Host: api.wx.2000gallery.art" \
  -H "Origin: https://wx.ht.2000gallery.art" \
  -H "Access-Control-Request-Method: GET"

curl -s "http://127.0.0.1/api/health" -H "Host: api.wx.2000gallery.art"
```

期望：OPTIONS **204** + `Access-Control-Allow-Origin`；GET **200** JSON。

若 80 失败、直连 Node 成功，查宝塔 `api.wx` 站点 `proxy_pass` 与 Node 是否在跑：

```bash
curl -skI "https://127.0.0.1:2000/api/health" -H "Host: api.wx.2000gallery.art"
```

### 备选：ESA 直连 Node :2000（不经 80）

| 项 | 值 |
|----|-----|
| 回源协议 | **HTTPS** |
| HTTPS 端口 | **2000** |

见 [nginx-api-origin.example.conf](./nginx-api-origin.example.conf)（443 终结场景）。

---

## 二、长耗时接口（WMS 同步 `POST /api/original-artworks/admin/sync-from-wms`）

管理台一次同步可能运行 **数分钟**。若 ESA/Nginx **读超时** 短于实际耗时，边缘会返回 **502/524** 等错误页，**不带** `Access-Control-Allow-Origin`，浏览器会误报为 **CORS / Network Error**（并非 `wx.ht` 未加入白名单）。

| 层级 | 建议 |
|------|------|
| 宝塔 `api.wx` 站点 Nginx | `proxy_read_timeout` / `proxy_send_timeout` **≥ 600s**（见 [nginx-baota-api-wx.example.conf](./nginx-baota-api-wx.example.conf)） |
| ESA 源站/规则 | 回源读超时尽量与 Nginx 一致，避免 60–120s 默认值 |
| 管理台 | 同步参数「最大页数」不宜过大；客户端超时已按页数动态放大 |

源站自测（应返回 JSON 且带 ACAO，而非 HTML 错误页）：

```bash
curl -sI -X OPTIONS "https://api.wx.2000gallery.art/api/original-artworks/admin/sync-from-wms" \
  -H "Origin: https://wx.ht.2000gallery.art" \
  -H "Access-Control-Request-Method: POST"
```

---

## 三、回源成功后：OPTIONS 须能到源站

带 `Authorization` 的请求会先发 **OPTIONS 预检**。须满足其一：

1. **回源到 Node**（推荐）：Node 已在最前处理 OPTIONS（`corsPreflightMiddleware`）。
2. ESA **不**在边缘对 `/api/*` 的 OPTIONS 返回 405/502；动态接口 **不缓存**。

---

## 四、（可选）ESA 边缘 CORS 规则

在 **回源已 200** 仍缺 CORS 头时，按官方 [配置跨域资源共享](https://help.aliyun.com/zh/edge-security-acceleration/esa/use-cases/configure-cross-domain-resource-sharing) 在边缘补头。

路径：**规则** → **转换规则** → **修改响应头** → 位置 **ESA 到客户端** → **新增规则**

### 规则 1：允许管理台 Origin（须与 withCredentials 配合）

| 字段 | 值 |
|------|-----|
| 条件 | 标头 `Origin` 等于 `https://wx.ht.2000gallery.art`（或正则匹配 `*.2000gallery.art`） |
| 类型 | **动态** |
| 响应头 | `Access-Control-Allow-Origin` = `http.request.headers["origin"]` |
| 操作 | 添加 |

### 规则 2：允许携带 Cookie / Authorization

| 字段 | 值 |
|------|-----|
| 条件 | 同上 |
| 类型 | 静态 |
| 响应头 | `Access-Control-Allow-Credentials` = `true` |

### 规则 3：预检方法与本站一致

| 字段 | 值 |
|------|-----|
| 条件 | 请求方法 **等于** `OPTIONS`（或与规则 1 相同 Origin 条件） |
| 类型 | 静态 |
| 响应头 | `Access-Control-Allow-Methods` = `GET, POST, PUT, DELETE, PATCH, OPTIONS` |
| 响应头 | `Access-Control-Allow-Headers` = `Content-Type, Authorization, Accept, Origin, X-Requested-With` |
| 响应头 | `Access-Control-Max-Age` = `86400` |

说明：边缘与 Node **同时**加 CORS 时，以浏览器开发者工具里实际响应头为准；优先保证 **502 消失** 且 Node 回源正常，通常不必重复配边缘 CORS。

---

## 五、Node 与前端环境变量

**API 服务器 `.env`**

```env
PORT=2000
PUBLIC_API_BASE_URL=https://api.wx.2000gallery.art
```

修改后 `npm start` / 重启进程。

**管理台构建 `.env.production`**

```env
VITE_PUBLIC_API_BASE_URL=https://api.wx.2000gallery.art
```

---

## 六、外网验收

```powershell
powershell -File deploy/verify-api-cors.ps1
```

或：

```powershell
curl.exe -sI -X OPTIONS "https://api.wx.2000gallery.art/api/original-artworks" `
  -H "Origin: https://wx.ht.2000gallery.art" `
  -H "Access-Control-Request-Method: GET" `
  -H "Access-Control-Request-Headers: authorization,content-type"

curl.exe -s "https://api.wx.2000gallery.art/api/health"
```

| 步骤 | 期望 |
|------|------|
| OPTIONS | **204/200** + `Access-Control-Allow-Origin: https://wx.ht.2000gallery.art` |
| GET health | **200** + JSON `"status"` |

当前若仍为 **502**，请只改 **api.wx** 站点的回源端口/协议，与 **wx.ht**（HTTP 80 静态）分开配置。

---

## 七、两个 ESA 站点对照

| 站点 | 源站实际服务 | ESA 回源建议 |
|------|----------------|--------------|
| `wx.ht.2000gallery.art` | 宝塔静态 **:80** | **HTTP :80** |
| `api.wx.2000gallery.art` | 宝塔 Nginx **:80** → Node **:2000** | **HTTP :80**（与反代一致） |

## 相关文档

- [管理台 502 / 打不开](./ADMIN-SITE-RECOVERY.md)
- [HTTP 状态码（502/525/526）](https://help.aliyun.com/zh/edge-security-acceleration/esa/support/http-status-code-description)
- [配置跨域资源共享（ESA）](https://help.aliyun.com/zh/edge-security-acceleration/esa/use-cases/configure-cross-domain-resource-sharing)
