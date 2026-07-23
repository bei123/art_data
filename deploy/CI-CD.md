# CI/CD 发布手册

流程图见 [docs/CICD-FLOW.md](../docs/CICD-FLOW.md)。  
**Jenkins 逐步点击配置**：[JENKINS-SETUP.md](./JENKINS-SETUP.md)。

单机宝塔 + **Jenkins**，两仓库分工：

| 仓库 | 职责 | 触发 |
|------|------|------|
| `bei123/art_data` | API + 管理台静态 | `main` push → Jenkins Deploy |
| `bei123/art_wx` | 微信小程序体验版 | 见 art_wx 自身发布文档（可仍用 Actions） |

> 原 GitHub Actions 工作流已归档至 [`.github/workflows-archived/`](../.github/workflows-archived/)。**勿与 Jenkins 同时自动部署生产。**

## 发布顺序（硬约定）

1. **先** `art_data` merge `main` → 等 Jenkins Deploy 绿灯 + smoke 通过  
2. **再** `art_wx` merge `main` → 上传体验版  
3. 体验版验证 OK → 微信公众平台人工提审发布正式版  

仅后端改动：只发 `art_data`。仅小程序改动（无 API 变更）：只发 `art_wx`。小程序发布细则见 [art_wx/docs/WECHAT-RELEASE.md](https://github.com/bei123/art_wx/blob/main/docs/WECHAT-RELEASE.md)。

---

## Jenkins 任务一览

| Job（建议名） | Script Path | 触发 |
|---------------|-------------|------|
| `art_data-ci` | `Jenkinsfile` | Multibranch：PR / 各分支 push |
| `art_data-deploy` | `jenkins/Jenkinsfile.deploy` | `main` push（Webhook）或手动参数 |
| `art_data-rollback` | `jenkins/Jenkinsfile.rollback` | 手动，参数 `REF` |
| `art_data-release` | `jenkins/Jenkinsfile.release` | tag `v*` |
| `art_data-audit` | `jenkins/Jenkinsfile.audit` | 每周一 cron / 手动 |

### Agent 要求

- Linux agent（需 `git`、`rsync`、`ssh`、`tar`、`zip`）
- Jenkins 插件：**Pipeline**、**NodeJS**、**Credentials Binding**、**SSH Credentials**、**GitHub**（或 Generic Webhook）
- Global Tool：NodeJS，Name / ID 必须为 **`node-24`**（Node 24.x）

### Credentials（Jenkins）

| Credentials ID | 类型 | 说明 |
|----------------|------|------|
| `art-data-ssh` | SSH Username with private key | 部署用户 + ed25519 私钥 |
| `art-data-ssh-host` | Secret text | 服务器 IP / 主机名 |
| `art-data-node-auth-token` | Secret text | GitHub Packages token（`@bei123/*`） |
| `art-data-vite-api-sign-secret` | Secret text | 与服务器 `API_SIGN_SECRET_ADMIN_WEB` 相同 |
| `art-data-bt-panel-url` | Secret text | 可选，宝塔面板 URL |
| `art-data-bt-api-key` | Secret text | 可选，宝塔 API 密钥 |
| `art-data-github-token` | Secret text | 可选，Release 用 `gh release` |

### Job / Folder 环境变量

| 名称 | 默认 | 说明 |
|------|------|------|
| `VITE_PUBLIC_API_BASE_URL` | `https://api.wx.2000gallery.art` | 管理台构建 |
| `VITE_OSS_PUBLIC_ORIGIN` | `https://wx.oss.2000gallery.art` | 管理台构建 |
| `VITE_API_SIGN_KEY` | `admin-web` | 管理台构建 |
| `ADMIN_DEPLOY_PATH` | `/www/wwwroot/wx.ht.2000gallery.art/` | rsync 目标 |
| `BACKEND_DEPLOY_PATH` | `/www/wwwroot/art_data` | 服务器仓库路径 |
| `BT_NODE_PROJECT_NAME` | `art_data` | 宝塔 Node 项目名 |
| `API_BASE_URL` | `https://api.wx.2000gallery.art` | smoke |
| `ADMIN_BASE_URL` | `https://wx.ht.2000gallery.art` | smoke |
| `WECOM_WEBHOOK_URL` | — | 企微通知（**不推荐**只放 Folder Properties，Pipeline 经常读不到） |
| `WECHAT_OA_APPID` / `SECRET` / `TEMPLATE_ID` / `TOUSER` | — | 公众号模板通知 |
| `WECHAT_OA_TEMPLATE_DATA_JSON` | — | 可选自定义模板字段 |

### 企业微信通知（推荐用 Credentials）

Folder Properties 里的 `WECOM_WEBHOOK_URL` **经常不会**注入到 Pipeline 的 `sh` 环境，日志会一直是 `no WeCom or WeChat OA channel configured, skip`。

请改成：

1. **Manage Jenkins → Credentials → Add Credentials**
2. Kind：**Secret text**
3. ID：`art-data-wecom-webhook`（必须一致）
4. Secret：企微群机器人 Webhook 整段 URL  
   `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`
5. 保存后 **push 含新 Jenkinsfile 的 main**，再跑一次 Deploy

日志应出现：`notify-deploy: WeCom sent`。

Deploy 参数：

| 参数 | 说明 |
|------|------|
| `REF` | 指定 commit/tag；空则当前 HEAD / `origin/main` |
| `FORCE_FULL` | 勾选则全量 FE+BE；默认否，按 `deploy/detect-changes.sh` 增量 |

Rollback 参数：`REF`（必填，如 `v1.0.0`）。

---

## 部署通知（企业微信 + 微信公众号）

部署结束（成功/失败）会同时尝试两个渠道，配哪个发哪个。详情页链接优先用 Jenkins `BUILD_URL`。

### 企业微信

1. 企业微信群 → 群机器人 → 添加  
2. 复制 Webhook，写入 Deploy / Rollback Job 环境变量：`WECOM_WEBHOOK_URL`

### 微信公众号（模板消息）

1. [微信公众平台](https://mp.weixin.qq.com/) → 广告与服务 → 模板消息 → 选用类目模板  
2. 建议字段：

| 模板字段 | 占位内容 |
|----------|----------|
| thing1 | 项目名 `{{project}}` |
| thing2 | 状态 `{{status}}` |
| thing3 | 版本 `{{version}}` |
| time4 | 时间 `{{time}}` |

3. 在 Job 环境变量中配置 `WECHAT_OA_*`（同上表）

---

## 日常发布 SOP

### art_data

```text
feature/* → PR → Jenkins CI 绿灯 → merge main
  → Jenkins: art_data-deploy
  → rsync 管理台 dist + SSH 后端 git sync + 宝塔 Node 重启
  → smoke-test（API / CORS / 管理台首页）
```

本地管理台构建（可选）：

```bash
cp .env.production.example .env.production
# 填入 VITE_API_SIGN_SECRET
npm run build
```

### art_wx

见 art_wx 仓库发布文档（与本仓库 Jenkins 独立）。

---

## 回滚

### 后端 + 管理台（art_data）

Jenkins → **art_data-rollback** → 输入 tag 或 commit SHA → Build。

或服务器手动：

```bash
cd /www/wwwroot/art_data
git log --oneline -5
git reset --hard <good-sha>
bash deploy/install-backend-deps.sh /www/wwwroot/art_data
BT_NODE_PROJECT_NAME=art_data bash deploy/restart-baota-node.sh
```

管理台静态由 rollback Pipeline 重新 build 该 ref 的 `dist` 并 rsync。

### 小程序（art_wx）

CI **无法**回退已发布的微信正式版。公众平台 → 版本管理 → 回退上一正式版。

---

## 服务器一次性检查

```bash
cd /www/wwwroot/art_data
bash deploy/verify-deploy-ready.sh
```

部署公钥：把 Jenkins 使用的私钥对应公钥写入服务器 `authorized_keys`（见 `deploy/server-init.sh`）。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| rsync `.user.ini` 失败 | 已 exclude；勿删宝塔保护文件 |
| 后端重启后 health 超时 | 迁移较慢；查 `art_data.log` |
| 管理端 API 签名失败 | 对齐 `VITE_API_SIGN_SECRET` 与 `API_SIGN_SECRET_ADMIN_WEB` |
| NodeJS tool 找不到 | Global Tool 名称必须为 `node-24` |
| `@bei123/*` 安装失败 | 检查 `art-data-node-auth-token` |
| 与旧 Actions 双部署 | 确认 `.github/workflows/` 下无启用的 deploy workflow |

---

## 相关脚本

| 脚本 | 用途 |
|------|------|
| `deploy/detect-changes.sh` | FE/BE 变更检测 |
| `deploy/jenkins/setup-ssh.sh` | Agent 写 deploy key |
| `deploy/jenkins/rsync-admin.sh` | 管理台 rsync |
| `deploy/jenkins/sync-backend.sh` | 服务器 git sync + 可选重启 |
| `deploy/smoke-test.sh` | 外网冒烟 |
| `deploy/install-backend-deps.sh` | 生产机 `npm ci --omit=dev` |
| `deploy/restart-baota-node.sh` | 宝塔 Node 重启 |
| `deploy/notify-deploy.mjs` | 企微 + 公众号通知 |

art_wx 侧见对应仓库 `scripts/`。
