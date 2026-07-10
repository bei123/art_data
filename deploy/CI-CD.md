# CI/CD 发布手册

单机宝塔 + GitHub Actions，两仓库分工：

| 仓库 | 职责 | 触发 |
|------|------|------|
| `bei123/art_data` | API + 管理台静态 | `main` push → Deploy Production |
| `bei123/art_wx` | 微信小程序体验版 | `main` push → Deploy WeChat Preview |

## 发布顺序（硬约定）

1. **先** `art_data` merge `main` → 等 Deploy 绿灯 + smoke 通过  
2. **再** `art_wx` merge `main` → 自动上传体验版  
3. 体验版验证 OK → 微信公众平台人工提审发布正式版  

仅后端改动：只发 `art_data`。仅小程序改动（无 API 变更）：只发 `art_wx`。

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
| `DEPLOY_NOTIFY_WEBHOOK_URL` | Secret | 可选，企业微信/钉钉机器人 webhook |
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
| `DEPLOY_NOTIFY_WEBHOOK_URL` | Secret | 可选，与 art_data 可共用同一机器人 |
| `WECHAT_ROBOT` | Variable | 默认 `1` |
| `API_BASE_URL` | Variable | 上传前 API 健康检查 |
| `WX_DEPLOY_RUNNER` | Variable | 默认 `ubuntu-latest`；IP 白名单场景填 `self-hosted` |

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
| `deploy/restart-baota-node.sh` | 宝塔 Node 重启 |
| `deploy/rollback.yml` | 手动回滚 workflow |
| `deploy/notify-deploy.mjs` | 部署结果 webhook |

art_wx 侧见 `scripts/check-config.mjs`、`check-version.mjs`、`upload-miniprogram.mjs`。
