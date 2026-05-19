# 管理台 `wx.ht.2000gallery.art` 打不开（502）

## 当前状态

外网访问 `https://wx.ht.2000gallery.art/` 返回 **502 Bad Gateway**（阿里云 ESA + 源站 **nginx**）。

含义：**CDN 能连到源站 Nginx，但 Nginx 的上游失败**（或 Nginx 自身配置错误）。  
与仓库里 Vue 构建产物是否最新**无直接关系**，需先恢复源站。

> 使用**独立 API 域名**时，管理台应只提供 **静态文件**，不要把整站反代到 Node。  
> 见 [nginx-admin-static-only.example.conf](./nginx-admin-static-only.example.conf)。

---

## 一、在管理台服务器上快速自查

SSH 登录 **wx.ht 回源机器**（CDN 控制台里该域名的源站 IP）。

### 1. Nginx 是否在跑

```bash
sudo nginx -t
sudo systemctl status nginx
```

`nginx -t` 必须 `syntax is ok`。若失败，先修配置再 `reload`。

### 2. 静态目录是否存在

```bash
ls -la /var/www/art_data/dist/index.html
```

路径需与 Nginx 里 `root` 一致。没有则重新上传 `npm run build` 生成的 `dist/`。

### 3. 看错误日志（最重要）

```bash
sudo tail -n 50 /var/log/nginx/error.log
```

常见关键字：

| 日志 | 含义 |
|------|------|
| `connect() failed (111: Connection refused)` | 反代到了未监听的端口（如 Node 未启动） |
| `upstream timed out` | 反代超时，上游无响应 |
| `No such file or directory` | `root` 路径错误或 `dist` 未部署 |

### 4. 本机绕过 CDN 测源站

```bash
curl -sI -k -H "Host: wx.ht.2000gallery.art" https://127.0.0.1/
```

- **127.0.0.1 也 502**：源站 Nginx/上游问题，修 Nginx 或恢复进程。  
- **127.0.0.1 200，外网 502**：CDN 回源地址/端口/协议填错，改 ESA 控制台。

---

## 二、宝塔面板（当前环境）

站点目录一般为 `/www/wwwroot/wx.ht.2000gallery.art`。

**常见问题（与你现网配置相关）：**

| 现网配置 | 问题 |
|----------|------|
| `index index.php ...` | 优先找 PHP，Vue 应改为 `index index.html` |
| `include enable-php-00.conf` | 纯静态站应**注释掉** |
| `include .../rewrite/...conf` | 伪静态可能覆盖路由，SPA 需用 `try_files` |
| `include .../extension/*.conf` | 若有反代 Node 且未启动 → **502** |
| 仅 `listen 80` | CDN 若 HTTPS 回源 443，需在宝塔申请 SSL 或改 CDN 回源为 HTTP:80 |

**操作步骤：**

1. 本地 `npm run build`，把 `dist/` **里的文件**（不是 dist 文件夹本身）上传到 `/www/wwwroot/wx.ht.2000gallery.art/`。
2. 宝塔 → 网站 → `wx.ht.2000gallery.art` → 设置 → **配置文件**，对照 [nginx-baota-wx.ht.example.conf](./nginx-baota-wx.ht.example.conf) 修改。
3. **刷新子路径 404**：必须加 Vue history 回退（见下文「刷新页面 404」）。
4. 保存后点击 **重载配置**，或 SSH：`nginx -t && nginx -s reload`。
5. 查看 `/www/wwwlogs/wx.ht.2000gallery.art.error.log`。

### 刷新页面 404（Vue Router history）

项目使用 `createWebHistory()`，访问 `/artists` 等路径后 **F5 刷新** 时，Nginx 会按磁盘找 `/artists` 文件，找不到就 404。

在 `wx.ht` 的 `server` 里增加（并 **注释** `include .../rewrite/wx.ht...conf`，避免伪静态冲突）：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

或在宝塔 → 网站 → **伪静态** 选择「vue」/ 自定义，内容为上面 `try_files` 一行。

`assets/` 等真实文件仍会按 `$uri` 正常返回，只有不存在的路径才回落 `index.html`。

## 三、通用 Nginx（非宝塔）

管理台**仅静态**，API 仍走 `https://api.wx.2000gallery.art`：

见 [nginx-admin-static-only.example.conf](./nginx-admin-static-only.example.conf)

**不要**在管理台 Nginx 里把 `location /` 反代到 `127.0.0.1:2000`，除非已确认 Node 常驻且仅需 `/api` 走反代。

若曾按 [nginx-admin.example.conf](./nginx-admin.example.conf) 加了 `location /api/` 反代，但 Node 未启动，通常 **`/api` 会坏**；若整站被改成反代，则 **首页也会 502**。

恢复步骤：

```bash
# 备份后改回静态配置
sudo nano /etc/nginx/sites-available/wx.ht.2000gallery.art
sudo nginx -t && sudo systemctl reload nginx
```

---

## 四、阿里云 ESA（管理台域名，按官方文档）

官方说明：

- [配置回源协议和端口](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/origin-protocol-and-port)（**源站证书** 菜单）
- [HTTP 状态码 502](https://help.aliyun.com/zh/edge-security-acceleration/esa/support/http-status-code-description)：ESA **无法与源站建立连接**
- [绕过 ESA 排查源站](https://help.aliyun.com/zh/edge-security-acceleration/esa/support/point-domain-to-origin-without-changing-dns)

你已验证源站正常：

```bash
curl -sI -H "Host: wx.ht.2000gallery.art" http://127.0.0.1/   # 200
```

说明源站 **HTTP:80** 可用；外网仍 **502** 时，按文档通常是 **ESA 回源协议/端口与源站不一致**。

### 关键：默认「跟随客户端协议」

ESA 默认 **跟随客户端协议回源**（[回源协议和端口](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/back-to-source-protocols-and-ports-1)）：

| 用户访问 | ESA 回源 |
|----------|----------|
| `https://wx.ht...` | **HTTPS → 源站 443** |
| `http://wx.ht...` | HTTP → 源站 80 |

宝塔当前多为 **仅 `listen 80`**。用户用 HTTPS 打开管理台时，ESA 会去连源站 **443**，连不上 → 官方归类为 **502 Bad Gateway**。

### 推荐改法（二选一）

**方案 A（与现网源站一致，推荐）**

控制台：**站点管理** → `wx.ht.2000gallery.art` → **源站证书** → **回源协议和端口** → 配置：

| 项 | 值 |
|----|-----|
| 回源协议 | **HTTP**（不要再用默认的「跟随客户端协议」） |
| HTTP 端口 | **80** |
| HTTPS 端口 | 可保留 443（在强制 HTTP 回源时不走） |

**源站证书校验**：若已开启，且回源并非 HTTPS，请 **关闭**；文档写明校验失败也会 **502**（[源站证书](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/origin-protocol-and-port)）。

**方案 B**

在宝塔为 `wx.ht.2000gallery.art` 申请 SSL，Nginx 增加 `listen 443 ssl`，保持「跟随客户端协议」或设为 **HTTPS** 回源 443。

### 回源 Host

默认 **跟随请求 Host**（[回源 Host](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/origin-fetch-host)），即 `wx.ht.2000gallery.art`，与宝塔 `server_name` 一致，一般无需改。

### 源站 IP / 防火墙

- **DNS / 源地址**：ESA 站点里源站记录指向当前 ECS **公网 IP**。
- **安全组 / 防火墙**：对 ESA 回源网段放行 **80**（方案 A）或 **443**（方案 B）。502 文档要求检查 [源站防火墙是否对 ESA 节点放开](https://help.aliyun.com/zh/edge-security-acceleration/esa/support/http-status-code-description)。

### 官方绕过 ESA 自测（在任意机器）

```bash
# 源站 80 端口（将 IP 换为你的 ECS 公网 IP）
curl -voa "http://wx.ht.2000gallery.art/" -x <源站公网IP>:80
```

### 刷新

改完后：**缓存刷新** → 刷新 URL `https://wx.ht.2000gallery.art/`。

---

## 五、与 API 域名区分

| 域名 | 作用 | 回源应指向 |
|------|------|------------|
| `wx.ht.2000gallery.art` | 管理台静态页 | Nginx + `dist/` |
| `api.wx.2000gallery.art` | 接口 | Node HTTPS **2000** 或 Nginx→2000 |

两个域名在 CDN 里**不要共用同一个错误源站**。API 修参见 [CDN-API-CORS.md](./CDN-API-CORS.md)。

---

## 六、恢复后验收

```powershell
# 管理台首页应 200
curl.exe -sI "https://wx.ht.2000gallery.art/"

# 独立 API（CDN 修好后）
powershell -File deploy/verify-api-cors.ps1
```

首页期望：`HTTP/1.1 200`，`Content-Type: text/html`。
