# 独立 API 域名：`api.wx.2000gallery.art`

管理台 `https://wx.ht.2000gallery.art` 通过跨域访问 `https://api.wx.2000gallery.art/api/*`。  
Node 已配置 CORS（含 `wx.ht.2000gallery.art` 与 `*.2000gallery.art`），**当前故障在 CDN 未把请求正确回源到 Node**。

## 现象与根因

| 检测项 | 当前（异常） | 修复后（期望） |
|--------|----------------|----------------|
| `OPTIONS /api/artists` | **405**，无 `Access-Control-Allow-Origin` | **204**，含 `Access-Control-Allow-Origin: https://wx.ht.2000gallery.art` |
| `GET /api/health` | **404**（ESA 默认页） | **200**，JSON `status: ok` |

说明：浏览器报 CORS，本质是 CDN 在边缘拦截/错误回源，**未到达** 本仓库 `index.js`（端口 **2000** HTTPS）。

## 架构（推荐）

```
浏览器 → api.wx.2000gallery.art:443 (阿里云 ESA/CDN)
       → 源站 Nginx:443（可选，见 nginx-api-origin.example.conf）
       → Node HTTPS :2000（npm start / index.js）
```

若 CDN 支持 **HTTPS 回源到自定义端口 2000**，也可 CDN → Node:2000 直连（需证书与防火墙放行）。

## 一、阿里云 ESA / CDN 控制台（必做）

在域名 **`api.wx.2000gallery.art`** 站点中逐项检查：

### 1. 回源配置

- **回源协议**：HTTPS（与 Node 一致；Node 使用 `https.createServer`）
- **回源端口**：
  - 若源站前有 Nginx 监听 **443**：回源端口 **443**
  - 若 CDN 直连 Node：回源端口 **2000**（与 `.env` 中 `PORT=2000` 一致）
- **回源 Host**：建议 `api.wx.2000gallery.art` 或与 Node 证书 CN/SAN 一致的域名
- **回源地址**：填 API 服务器内网/公网 IP，**不要**指到静态页或错误 bucket

### 2. 允许 OPTIONS（解决预检 405）

任选一种可行方式（按控制台实际菜单名称操作）：

- **回源 HTTP 方法**：勾选 `GET, POST, PUT, DELETE, PATCH, **OPTIONS**`
- 或 **缓存配置**：对路径 `/api/*` **不缓存** / **绕过缓存**，且不要对 OPTIONS 返回固定 405
- 或 **规则引擎 / 边缘脚本**：`OPTIONS` 请求 **回源**，不要边缘直接响应

> 预检必须由源站（Node）返回 CORS 头；边缘 405 且不带 `Access-Control-Allow-Origin` 时，浏览器一律报 CORS 失败。

### 3. 路径与 404

- 确认未把 `/api` 重写掉或指到别的站点根目录
- **动态接口** `/api/*`：建议 **不缓存** 或 TTL=0
- 若开启了「仅缓存 GET」，需保证 GET `/api/health` 能回源

### 4. WAF / 安全策略

- 放行 `OPTIONS` 与带 `Origin: https://wx.ht.2000gallery.art` 的请求
- 登录/管理接口不要误拦 `Authorization` 头

### 5. （可选）CDN 层 CORS

若控制台有 **跨域 CORS** 功能，可配置允许来源 `https://wx.ht.2000gallery.art`，并允许凭证。  
**仍须保证 OPTIONS 能回源或边缘正确响应**；与 Node 重复设置时，以「预检 204 + ACAO」自检通过为准。

## 二、源站 Nginx（CDN 只回源 443 时）

见 [nginx-api-origin.example.conf](./nginx-api-origin.example.conf)：在 API 机器上 443 反代到 `https://127.0.0.1:2000`，**不要**在 Nginx 再挡 OPTIONS。

## 三、Node 与前端环境变量

**服务器 `.env`（后端）**

```env
PORT=2000
PUBLIC_API_BASE_URL=https://api.wx.2000gallery.art
# 可选：额外管理台域名
# CORS_ORIGINS=https://other-admin.example.com
```

部署/重启 Node 后，CORS 中间件生效。

**构建管理台 `.env.production`（前端）**

```env
VITE_PUBLIC_API_BASE_URL=https://api.wx.2000gallery.art
VITE_OSS_PUBLIC_ORIGIN=https://wx.oss.2000gallery.art
```

```bash
npm run build
```

浏览器请求的 API 根为 `https://api.wx.2000gallery.art`（**不要**带 `:2000`，443 由 CDN 终结）。

## 四、验收命令

在本地 PowerShell 执行（修复 CDN 后应通过）：

```powershell
# 1. 预检
curl.exe -sI -X OPTIONS "https://api.wx.2000gallery.art/api/artists" `
  -H "Origin: https://wx.ht.2000gallery.art" `
  -H "Access-Control-Request-Method: GET" `
  -H "Access-Control-Request-Headers: authorization,content-type"

# 2. 健康检查
curl.exe -s "https://api.wx.2000gallery.art/api/health"
```

期望：

1. 第一条：状态 **204**（或 200），响应头含  
   `Access-Control-Allow-Origin: https://wx.ht.2000gallery.art`  
   与 `Access-Control-Allow-Credentials: true`
2. 第二条：JSON 中 `"status":"ok"`（或数据库/redis 降级时为 `degraded` 但仍为 200）

也可运行仓库脚本：`powershell -File deploy/verify-api-cors.ps1`

## 五、直连源站排查（绕过 CDN）

在 API 服务器上（将 `ORIGIN_IP` 换为源站 IP，`-k` 仅用于自签证书测试）：

```powershell
curl.exe -skI -X OPTIONS "https://ORIGIN_IP:2000/api/artists" `
  -H "Host: api.wx.2000gallery.art" `
  -H "Origin: https://wx.ht.2000gallery.art" `
  -H "Access-Control-Request-Method: GET"
```

- **源站 204 + ACAO，CDN 仍 405** → 只改 CDN/ESA 配置  
- **源站也失败** → 检查 Node 是否监听 2000、证书、防火墙、`npm start` 日志

## 备选：管理台同源反代

若短期无法改 CDN，可临时用 [nginx-admin.example.conf](./nginx-admin.example.conf) + `VITE_PUBLIC_API_BASE_URL=same-origin`。  
与「独立 API 域名」二选一，不要同时混用未文档化的第三种域名。
