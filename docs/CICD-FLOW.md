# CI/CD 流水线

操作细则与 Credentials 见 [deploy/CI-CD.md](../deploy/CI-CD.md)。本文只给流程图。

## 仓库分工

| 仓库 | 产物 | Jenkins Job |
|------|------|-------------|
| `art_data` | API 进程 + 管理台 `dist/` | CI · Deploy · Rollback · Release · Audit |
| `art_wx` | 小程序体验版 | `art_wx-ci` · `art_wx-deploy` |
| `art_vision` | 识图服务（可选） | 独立部署 |

## 主路径

```mermaid
flowchart TB
  A[feature/* 开发] --> B[PR → art_data CI]
  B -->|lint · test · build| C{CI 绿灯?}
  C -->|否| A
  C -->|是| D[merge main]
  D --> E[Jenkins Deploy Production]
  E --> F{变更检测}
  F -->|仅文档/无关| G[跳过构建重启]
  F -->|前端| H[vite build + rsync 管理台]
  F -->|后端| I[SSH git sync + npm ci + 宝塔重启]
  F -->|force_full / 双端| H
  H --> I
  I --> J[smoke: health / CORS / 管理台]
  G --> K[通知企微/公众号]
  J -->|失败| L[人工排查 · Rollback]
  J -->|成功| K
  K --> M[可选: art_wx merge → 体验版]
  M --> N[人工提审正式版]
```

## 发布硬顺序

```mermaid
sequenceDiagram
  participant Dev as 开发
  participant Data as art_data Deploy
  participant Wx as art_wx Preview
  participant MP as 微信公众平台

  opt 识图变更
    Dev->>Dev: 先部署/重启 art_vision
  end
  Dev->>Data: merge main
  Data-->>Dev: smoke 通过
  Dev->>Wx: merge main（若需）
  Wx-->>Dev: 体验版可验
  Dev->>MP: 提审 · 发布正式版
```

## Deploy 步骤（art_data）

1. Checkout · 检测 FE/BE 路径变更（手动可勾选 `FORCE_FULL`）
2. 前端有变更：`npm ci` + `vite build` → rsync → `ADMIN_DEPLOY_PATH`
3. 后端有变更：SSH 同步代码 · `npm ci` · 宝塔 Node 重启
4. Smoke：`API_BASE_URL` / `ADMIN_BASE_URL`
5. 通知：`WECOM_WEBHOOK_URL` / 公众号模板（链接为 Jenkins `BUILD_URL`）

回滚：Jenkins Job `art_data-rollback` → 输入 tag 或 commit SHA。

## 与架构文档

物理机路径与域名：[ARCHITECTURE.md](./ARCHITECTURE.md) · 组件边界：[COMPONENTS.md](./COMPONENTS.md)。
