# CI/CD 发布手册

流程图见 [docs/CICD-FLOW.md](../docs/CICD-FLOW.md)。

单机宝塔 + GitHub Actions，两仓库分工：

| 仓库 | 职责 | 触发 |
|------|------|------|
| `bei123/art_data` | API + 管理台静态 | `main` push → Deploy Production |
| `bei123/art_wx` | 微信小程序体验版 | `main` push → Deploy WeChat Preview |

## 发布顺序（硬约定）

1. **先** `art_data` merge `main` → 等 Deploy 绿灯 + smoke 通过  
2. **再** `art_wx` merge `main` → 自动上传体验版  
3. 体验版验证 OK → 微信公众平台人工提审发布正式版  

仅后端改动：只发 `art_data`。仅小程序改动（无 API 变更）：只发 `art_wx`。小程序发布细则见 [art_wx/docs/WECHAT-RELEASE.md](https://github.com/bei123/art_wx/blob/main/docs/WECHAT-RELEASE.md)。

---

## GitHub Secrets / Variables

### art_data（Environment: `production`）

| 名称 | 类型 | 说明 |
|------|------|------|
| `SSH_HOST` | Secret | 服务器 IP |
| `SSH_USER` | Secret | `root` |
| `SSH_PRIVATE_KEY` | Secret | 部署专用 ed25519 私钥 |
| `VITE_API_SIGN_SECRET` | Secret | 与服务器 `API_SIGN_SECRET_ADMIN_WEB` 相同 |
| `BT_PANEL_URL` | Secret | 可选，宝塔面板 URL |
| `BT_API_KEY` | Secret | 可选，宝塔 API 密钥 |
| `WECOM_WEBHOOK_URL` | Secret | 企业微信群机器人 Webhook |
| `WECHAT_OA_APPID` | Secret | 微信公众号 AppID |
| `WECHAT_OA_SECRET` | Secret | 微信公众号 AppSecret |
| `WECHAT_OA_TEMPLATE_ID` | Secret | 公众号模板消息 ID |
| `WECHAT_OA_TOUSER` | Secret | 接收人 openid，多个用英文逗号分隔 |
| `WECHAT_OA_TEMPLATE_DATA_JSON` | Secret | 可选，自定义模板字段 JSON |
| `DEPLOY_NOTIFY_WEBHOOK_URL` | Secret | 已废弃，兼容旧配置，等同 `WECOM_WEBHOOK_URL` |
| `VITE_PUBLIC_API_BASE_URL` | Variable | 默认 `https://api.wx.2000gallery.art` |
| `VITE_OSS_PUBLIC_ORIGIN` | Variable | 默认 `https://wx.oss.2000gallery.art` |
| `VITE_API_SIGN_KEY` | Variable | 默认 `admin-web` |
| `ADMIN_DEPLOY_PATH` | Variable | 默认 `/www/wwwroot/wx.ht.2000gallery.art/` |
| `BACKEND_DEPLOY_PATH` | Variable | 默认 `/www/wwwroot/art_data` |
| `BT_NODE_PROJECT_NAME` | Variable | 默认 `art_data` |
| `API_BASE_URL` | Variable | smoke 测试用 |
| `ADMIN_BASE_URL` | Variable | smoke 测试用 |

### art_wx（Environment: `production`）

| 名称 | 类型 | 说明 |
|------|------|------|
| `WECHAT_APPID` | Secret | `wx96a502c78c9156d0` |
| `WECHAT_PRIVATE_KEY` | Secret | 上传密钥 PEM（或改用 BASE64） |
| `WECHAT_PRIVATE_KEY_BASE64` | Secret | 可选，私钥文件 base64 |
| `WECOM_WEBHOOK_URL` | Secret | 企业微信群机器人 Webhook |
| `WECHAT_OA_APPID` | Secret | 微信公众号 AppID（可与 art_data 共用） |
| `WECHAT_OA_SECRET` | Secret | 微信公众号 AppSecret |
| `WECHAT_OA_TEMPLATE_ID` | Secret | 公众号模板消息 ID |
| `WECHAT_OA_TOUSER` | Secret | 接收人 openid，多个用英文逗号分隔 |
| `WECHAT_OA_TEMPLATE_DATA_JSON` | Secret | 可选，自定义模板字段 JSON |
| `DEPLOY_NOTIFY_WEBHOOK_URL` | Secret | 已废弃，兼容旧配置 |
| `WECHAT_ROBOT` | Variable | 默认 `1` |
| `API_BASE_URL` | Variable | 上传前 API 健康检查 |
| `WX_DEPLOY_RUNNER` | Variable | 默认 `ubuntu-latest`；IP 白名单场景填 `self-hosted` |

---

## 部署通知（企业微信 + 微信公众号）

部署结束（成功/失败）会同时尝试两个渠道，配哪个发哪个。

### 企业微信

1. 企业微信群 → 群机器人 → 添加  
2. 复制 Webhook 地址，填入两仓库 Secret：`WECOM_WEBHOOK_URL`

### 微信公众号（模板消息）

1. [微信公众平台](https://mp.weixin.qq.com/) → 广告与服务 → 模板消息 → 选用类目模板  
2. 建议字段（可用默认映射）：

| 模板字段 | 占位内容 |
|----------|----------|
| thing1 | 项目名 `{{project}}` |
| thing2 | 状态 `{{status}}` |
| thing3 | 版本 `{{version}}` |
| time4 | 时间 `{{time}}` |

3. 配置 Secrets：

| Secret | 说明 |
|--------|------|
| `WECHAT_OA_APPID` | 公众号 AppID |
| `WECHAT_OA_SECRET` | 公众号 AppSecret |
| `WECHAT_OA_TEMPLATE_ID` | 模板 ID |
| `WECHAT_OA_TOUSER` | 管理员 openid（关注公众号后获取） |

4. 若模板字段名不同，设置 `WECHAT_OA_TEMPLATE_DATA_JSON`：

```json
{"thing1":{"value":"{{project}}"},"character_string2":{"value":"{{status}}"},"thing3":{"value":"{{version}}"},"time4":{"value":"{{time}}"}}
```

消息详情页链接指向 GitHub Actions 运行日志。

---

## 日常发布 SOP

### art_data

```text
feature/* → PR → CI 绿灯 → merge main
  → Actions: Deploy Production
  → rsync 管理台 dist + SSH 后端 git pull + 宝塔 Node 重启
  → smoke-test（API / CORS / 管理台首页）
```

本地管理台构建（可选）：

```bash
cp .env.production.example .env.production
# 填入 VITE_API_SIGN_SECRET
npm run build
```

### art_wx

```bash
npm run version:patch   # 或 minor / major
git add src/manifest.json package.json src/utils/armsMonitor.js
git commit -m "chore: bump version to x.y.z"
# PR → merge main
```

merge 后 Actions 自动：check → build → upload 体验版 → 打 `v{x.y.z}` tag。

---

## 回滚

### 后端 + 管理台（art_data）

GitHub → Actions → **Rollback Production** → 输入 tag 或 commit SHA。

或服务器手动：

```bash
cd /www/wwwroot/art_data
git log --oneline -5
git reset --hard <good-sha>
bash deploy/install-backend-deps.sh /www/wwwroot/art_data
BT_NODE_PROJECT_NAME=art_data bash deploy/restart-baota-node.sh
```

管理台静态由 rollback workflow 重新 build 该 ref 的 dist 并 rsync。

### 小程序（art_wx）

CI **无法**回退已发布的微信正式版。公众平台 → 版本管理 → 回退上一正式版。  
体验版重新上传：修正代码后 bump 版本再 merge。

---

## 服务器一次性检查

```bash
cd /www/wwwroot/art_data
bash deploy/verify-deploy-ready.sh
```

---

## 常见问题

| 现象 | 处理 |
|------|------|
| rsync `.user.ini` 失败 | 已 exclude；勿删宝塔保护文件 |
| 后端重启后 health 超时 | 迁移较慢，已延长轮询；查 `art_data.log` |
| 管理端 API 签名失败 | 对齐 `VITE_API_SIGN_SECRET` 与 `API_SIGN_SECRET_ADMIN_WEB` |
| 微信 `invalid ip` | 关闭代码上传 IP 白名单，或 `WX_DEPLOY_RUNNER=self-hosted` |
| 微信 PEM 解码失败 | 用 `WECHAT_PRIVATE_KEY_BASE64` 或检查 Secret 换行 |
| 版本未递增 | `npm run version:patch` 后再 merge |

---

## 相关脚本

| 脚本 | 用途 |
|------|------|
| `deploy/smoke-test.sh` | 外网冒烟 |
| `deploy/install-backend-deps.sh` | 生产机 `npm ci --omit=dev`（默认 Node 堆 512MB，`DEPLOY_NPM_CI_HEAP_MB` 可覆盖） |
| `deploy/restart-baota-node.sh` | 宝塔 Node 重启 |
| `deploy/rollback.yml` | 手动回滚 workflow |
| `deploy/notify-deploy.mjs` | 企业微信 + 公众号通知 |

art_wx 侧见 `scripts/check-config.mjs`、`check-version.mjs`、`upload-miniprogram.mjs`。
