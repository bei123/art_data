# 微信小程序打不开 / 请求失败（基础设施变更后）

管理台（浏览器）与小程序（`wx.request`）走同一套 API，但**校验规则不同**：

| | 管理台 | 微信小程序 |
|---|--------|------------|
| 跨域 CORS | 需要 `Access-Control-Allow-Origin` | **不校验 CORS** |
| 域名白名单 | 无 | 必须在公众平台配置 **request 合法域名** |
| 端口 | 443 默认 | **不能**写 `:2000`，只能 `https://api.wx.2000gallery.art` |

当前 API 健康检查（外网）：

```bash
curl -s https://api.wx.2000gallery.art/api/health
# 应返回 {"status":"ok",...}
```

若此处失败，先按 [CDN-API-CORS.md](./CDN-API-CORS.md) 修 `api.wx`；小程序与管理台会一起挂。

---

## 一、微信公众平台（最常见）

登录 [微信公众平台](https://mp.weixin.qq.com/) → **开发** → **开发管理** → **开发设置** → **服务器域名**

### 1. request 合法域名

必须包含（**不要带端口、不要带路径**）：

```text
https://api.wx.2000gallery.art
```

若以前配的是 `https://api.wx.2000gallery.art:2000`，改域名后小程序**一定连不上**，需改成无端口并 **重新上传/发布** 小程序代码。

### 2. downloadFile / uploadFile 合法域名

图片在 OSS 时，还需：

```text
https://wx.oss.2000gallery.art
```

（与 `.env` 中 `OSS_PUBLIC_ORIGIN` 一致。）

### 3. 业务域名（仅 web-view 打开 H5 时需要）

若小程序内嵌 `web-view` 打开管理台或 H5，需单独配置 **业务域名**，与 request 域名不是同一项。

### 4. 保存后

- 开发版：开发者工具 → **详情** → 本地设置 → 可临时勾选「不校验合法域名」（仅调试）
- 体验版/正式版：必须域名已保存且小程序 **baseUrl 与 whitelist 一致**

---

## 二、小程序项目里的 baseUrl（不在本仓库）

本仓库是 **后端 + 管理台**，小程序源码一般在独立目录。请打开小程序工程搜索 `baseUrl` / `api` / `2000`：

```text
# 正确
https://api.wx.2000gallery.art

# 错误（ESA/宝塔 对外只有 443，没有 2000）
https://api.wx.2000gallery.art:2000
http://api.wx.2000gallery.art:2000
```

修改后重新 **上传代码** 并提交审核/发布体验版。

---

## 三、服务器 `.env`（影响接口返回的图片/支付回调 URL）

```env
PUBLIC_API_BASE_URL=https://api.wx.2000gallery.art
OSS_PUBLIC_ORIGIN=https://wx.oss.2000gallery.art
WX_APPID=你的appid
WX_SECRET=你的secret
```

**不要**写成 `https://api.wx.2000gallery.art:2000`。  
改完后重启 Node：`npm start` 或宝塔 Node 进程重启。

`PUBLIC_API_BASE_URL` 用于支付回调、搜索/用户接口里拼的绝对地址；若带 `:2000`，小程序拉图片或调支付会失败。

---

## 四、在开发者工具里看具体报错

打开微信开发者工具 → **调试器** → **Console** / **Network**：

| 报错关键词 | 处理 |
|------------|------|
| `url not in domain list` | 公众平台补 request 合法域名 |
| `request:fail ssl hand shake error` | 检查 `api.wx` 证书（ESA/源站 HTTPS） |
| `request:fail -2` / 超时 | API 仍 502/524，查 Nginx `https://127.0.0.1:2000` 与 ESA HTTP:80 |
| 登录 500 `服务器配置错误` | 服务器缺 `WX_APPID` / `WX_SECRET` |
| 登录 400 `微信登录失败` | code 无效或 AppID/Secret 与小程序不一致 |

自测登录接口（需替换真实 `code`）：

```bash
curl -s -X POST "https://api.wx.2000gallery.art/api/wx/login" \
  -H "Content-Type: application/json" \
  -d '{"code":"从小程序wx.login获取"}'
```

---

## 五、与管理台变更的关系

| 变更 | 对小程序影响 |
|------|----------------|
| `wx.ht` 静态 + `try_files` | 一般无影响（除非 web-view 打开管理台） |
| `api.wx` Nginx 80 → `https://127.0.0.1:2000` | 修好则小程序恢复；修前全体 API 失败 |
| ESA 回源 HTTP:80 | 必须，否则外网 502 |
| 管理台 CORS | **不影响**小程序 |

---

## 六、自检清单

- [ ] `curl https://api.wx.2000gallery.art/api/health` 返回 ok
- [ ] 公众平台 request 域名为 `https://api.wx.2000gallery.art`（无端口）
- [ ] 小程序代码 baseUrl 无 `:2000`
- [ ] 服务器 `.env` 中 `PUBLIC_API_BASE_URL` 无 `:2000`，已重启 Node
- [ ] OSS 域名在 downloadFile 白名单
- [ ] 体验版/正式版已重新发布（非仅改后台域名）
