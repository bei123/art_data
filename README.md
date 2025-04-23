# 艺术品数据管理系统

一个基于 Vue 3 + Express + MySQL 的艺术品数据管理系统，用于管理艺术家、原创艺术品、数字艺术品和实物分类等信息。

## 技术栈

### 前端
- Vue 3
- Vue Router
- Pinia
- Element Plus
- Axios
- Vite

### 后端
- Express
- MySQL
- mysql2

## 功能特性

- 艺术家管理
  - 添加、编辑、删除艺术家信息
  - 查看艺术家详情

- 原创艺术品管理
  - 添加、编辑、删除原创艺术品
  - 关联艺术家信息
  - 上传艺术品图片

- 数字艺术品管理
  - 添加、编辑、删除数字艺术品
  - 关联艺术家信息
  - 上传数字艺术品文件

- 实物分类管理
  - 添加、编辑、删除实物分类
  - 分类描述和统计

## 项目结构

```
art_data/
├── src/                    # 前端源代码
│   ├── views/             # 页面组件
│   ├── layouts/           # 布局组件
│   ├── router/            # 路由配置
│   ├── App.vue            # 根组件
│   └── main.js            # 入口文件
├── index.js               # 后端入口文件
├── db.js                  # 数据库连接配置
├── schema.sql             # 数据库表结构
├── package.json           # 项目依赖配置
└── vite.config.js         # Vite 配置
```

## 开发环境要求

- Node.js >= 16.0.0
- MySQL >= 8.0.0
- npm >= 7.0.0

## 安装和运行

1. 克隆项目
```bash
git clone [项目地址]
cd art_data
```

2. 安装依赖
```bash
npm install
```

3. 初始化数据库
```bash
mysql -u root -p < schema.sql
```

4. 启动后端服务
```bash
npm start
```

5. 启动前端开发服务器
```bash
npm run dev
```

## 环境配置

1. 数据库配置
在 `db.js` 中配置数据库连接信息：
```javascript
{
  host: 'localhost',
  user: 'root',
  password: '123456',
  database: 'art_data'
}
```

2. 前端代理配置
在 `vite.config.js` 中配置 API 代理：
```javascript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true
    }
  }
}
```

## 部署

1. 构建前端
```bash
npm run build
```

2. 部署后端
```bash
npm start
```

## 贡献指南

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 许可证

[MIT](LICENSE)