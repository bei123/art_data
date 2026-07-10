# 千年时间艺术中心 · 数据管理平台（art_data）

艺术品与数字藏品业务的后端 API + 管理后台，为 [微信小程序 art_wx](https://github.com/bei123/art_wx) 及管理端提供统一数据服务。

| 环境 | 地址 |
|------|------|
| 生产 API | `https://api.wx.2000gallery.art` |
| 管理后台 | `https://wx.ht.2000gallery.art` |
| 静态资源 OSS | `https://wx.oss.2000gallery.art` |
| 微信小程序 | 见 [art_wx](https://github.com/bei123/art_wx) |

接口文档：[docs/PROJECT-API.md](./docs/PROJECT-API.md) · OpenAPI：[docs/openapi-esa.json](./docs/openapi-esa.json)  
发布流程：[deploy/CI-CD.md](./deploy/CI-CD.md) · 小程序发布：[art_wx/docs/WECHAT-RELEASE.md](https://github.com/bei123/art_wx/blob/main/docs/WECHAT-RELEASE.md)

---

## 技术栈

### 管理后台（`src/`）

- Vue 3、Vue Router、Pinia
- Element Plus、Tailwind CSS、shadcn-vue
- Vite 8、Axios

### 后端 API（根目录 Express）

- Express 5、MySQL（mysql2）
- Redis（缓存与搜索）
- 阿里云 OSS、微信/支付、顺丰、WMS 等集成

### 工程化

- ESLint、Vitest
- GitHub Actions（CI + 自动部署）
- 宝塔 Node 项目托管（生产）

---

## 功能概览

### 管理后台

- 仪表盘、艺术家、机构、展览
- 原创艺术品、数字艺术品、实物分类
- 权益商家、Banner、订单与退款审批
- 推荐官（佣金、提现、优惠券、顾问申请等）
- 微信用户、订阅消息模板

### 对外 API

- 管理端登录与权限
- 微信小程序用户、购物车、下单、支付
- 收藏、搜索、物流、WebView 代理
- 数字藏品申领、资产流转与核验

---

## 项目结构

```text
art_data/
├── src/                    # 管理后台前端（Vue）
│   ├── views/              # 业务页面
│   ├── components/         # 组件（含 shadcn/ui）
│   ├── layout/             # 布局
│   ├── router/             # 路由
│   └── utils/              # 前端工具
├── routes/                 # Express 路由
├── services/               # 业务服务层
├── middleware/             # 鉴权、CORS、签名等
├── utils/                  # 后端工具与 Schema 迁移
├── config/                 # OSS、微信、WMS 等配置
├── deploy/                 # CI/CD 脚本与运维文档
├── docs/                   # API、OpenAPI、安全文档
├── tests/                  # Vitest 单测
├── scripts/                # OpenAPI 审计等脚本
├── index.js                # 后端入口
├── db.js                   # 数据库连接
├── schema.sql              # 数据库基线
├── env.example             # 后端环境变量模板
├── .env.production.example # 管理台构建环境模板
└── package.json
```

---

## 环境要求

- **Node.js 24**（见 `.nvmrc`）
- **MySQL 8+**
- **Redis**（生产推荐，本地可选）
- npm 9+

```bash
node -v   # 建议 v24.x
```

---

## 本地开发

### 1. 克隆与安装

```bash
git clone git@github.com:bei123/art_data.git
cd art_data
npm ci
```

### 2. 配置后端环境

```bash
cp env.example .env
# 编辑 .env：数据库、JWT、微信、OSS 等
```

### 3. 初始化数据库

```bash
mysql -u root -p < schema.sql
```

### 4. 启动服务

```bash
# 终端 1：后端 API（默认端口见 .env / index.js）
npm start
# 或开发热重载
npm run server

# 终端 2：管理后台
npm run dev
```

本地管理台通过 Vite 代理访问 `/api`（配置见 `vite.config.js`）。

### 5. 生产构建（管理台）

```bash
cp .env.production.example .env.production
# 填入 VITE_API_SIGN_SECRET（须与服务器 API_SIGN_SECRET_ADMIN_WEB 一致）
npm run build
```

产物在 `dist/`，由 Nginx 或 CI 部署到静态站点目录。

---

## 测试与质量

```bash
npm run lint          # ESLint
npm run test          # Vitest
npm run ci            # lint + test + build
npm run audit:openapi # 校验 OpenAPI 与路由一致性
```

GitHub Actions：

| Workflow | 触发 | 说明 |
|----------|------|------|
| `CI` | PR / push `main` | lint、测试、构建 |
| `Deploy Production` | push `main` | rsync 管理台 + 后端拉取 + 宝塔重启 + 冒烟 |
| `Rollback` | 手动 | 回滚管理台静态资源 |

---

## 部署（概要）

生产环境：**单机宝塔** + GitHub Actions SSH 部署。

```text
feature/* → PR → CI 绿灯 → merge main
  → Deploy Production
  → rsync 管理台 dist/ + SSH 后端 git pull + 宝塔 Node 重启
  → smoke-test（API / CORS / 管理台首页）
```

**发布顺序（与小程序联动）：**

1. 先部署 `art_data`，确认冒烟通过  
2. 再发布 `art_wx` 体验版  
3. 微信公众平台人工提审、发布正式版  

完整 Secrets、冒烟、回滚与通知配置见 **[deploy/CI-CD.md](./deploy/CI-CD.md)**。

快速验收：

```bash
curl -s https://api.wx.2000gallery.art/api/health
```

---

## 运维文档

| 文档 | 内容 |
|------|------|
| [deploy/CI-CD.md](./deploy/CI-CD.md) | CI/CD 发布手册 |
| [deploy/CDN-API-CORS.md](./deploy/CDN-API-CORS.md) | API CDN 与 CORS |
| [deploy/WECHAT-MINIPROGRAM.md](./deploy/WECHAT-MINIPROGRAM.md) | 小程序域名与请求排错 |
| [deploy/ADMIN-SITE-RECOVERY.md](./deploy/ADMIN-SITE-RECOVERY.md) | 管理台 502 / 恢复 |
| [docs/PROJECT-API.md](./docs/PROJECT-API.md) | 接口说明 |
| [docs/SECURITY-REVIEW.md](./docs/SECURITY-REVIEW.md) | 安全审查报告 |
| [docs/ESA-API-SCHEMA.md](./docs/ESA-API-SCHEMA.md) | ESA API Schema |

Nginx 示例：`deploy/nginx-api-origin.example.conf`、`deploy/nginx-admin.example.conf`

---

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 管理后台开发服务器 |
| `npm start` | 启动后端 API |
| `npm run server` | 后端 nodemon 热重载 |
| `npm run build` | 构建管理后台 |
| `npm run test` | 运行测试 |
| `npm run lint` | 代码检查 |
| `npm run ci` | CI 同等检查 |

---

## License

[MIT](./LICENSE)
