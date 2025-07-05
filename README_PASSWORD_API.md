# 微信小程序密码管理API文档

## 概述

为微信小程序用户提供密码管理功能，包括设置密码、修改密码和验证密码。所有密码都使用bcrypt进行哈希加密存储。

## 数据库表结构

### wx_users表
```sql
CREATE TABLE IF NOT EXISTS wx_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  openid VARCHAR(100) NOT NULL UNIQUE COMMENT '微信openid',
  session_key VARCHAR(255) COMMENT '微信session_key',
  nickname VARCHAR(100) COMMENT '用户昵称',
  avatar VARCHAR(255) COMMENT '用户头像',
  phone VARCHAR(20) COMMENT '手机号',
  password_hash VARCHAR(255) COMMENT '密码哈希',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_openid (openid),
  INDEX idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='微信小程序用户表';
```

## API接口

### 1. 设置密码

**接口地址：** `POST /wx/setPassword`

**请求头：**
```
Content-Type: application/json
Authorization: Bearer {token}
```

**请求参数：**
```json
{
  "password": "123456"
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "密码设置成功"
}
```

**错误响应：**
```json
{
  "error": "密码长度至少6位"
}
```

### 2. 修改密码

**接口地址：** `POST /wx/changePassword`

**请求头：**
```
Content-Type: application/json
Authorization: Bearer {token}
```

**请求参数：**
```json
{
  "oldPassword": "123456",
  "newPassword": "654321"
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "密码修改成功"
}
```

**错误响应：**
```json
{
  "error": "旧密码错误"
}
```

### 3. 验证密码

**接口地址：** `POST /wx/verifyPassword`

**请求头：**
```
Content-Type: application/json
Authorization: Bearer {token}
```

**请求参数：**
```json
{
  "password": "123456"
}
```

**响应示例：**
```json
{
  "success": true,
  "isValid": true,
  "message": "密码验证成功"
}
```

**错误响应：**
```json
{
  "success": true,
  "isValid": false,
  "message": "密码错误"
}
```

## 使用流程

1. **用户登录**：通过微信小程序登录获取token
2. **设置密码**：首次使用密码功能时设置密码
3. **验证密码**：在需要验证身份的场景下验证密码
4. **修改密码**：用户主动修改密码

## 安全特性

1. **密码加密**：使用bcrypt进行密码哈希，盐值长度为10
2. **密码强度验证**：密码长度至少6位
3. **Token验证**：所有接口都需要有效的JWT token
4. **防重复设置**：密码只能设置一次，如需修改使用修改密码接口

## 错误码说明

| 错误信息 | 说明 |
|---------|------|
| 未登录 | 缺少或无效的Authorization头 |
| token无效 | JWT token已过期或格式错误 |
| 缺少密码参数 | 请求体中缺少password字段 |
| 密码长度至少6位 | 密码强度不符合要求 |
| 用户不存在 | 用户ID在数据库中不存在 |
| 密码已经设置过 | 用户已经设置过密码，请使用修改密码接口 |
| 用户尚未设置密码 | 用户还没有设置密码 |
| 旧密码错误 | 修改密码时提供的旧密码不正确 |

## 测试

可以使用提供的Postman集合文件 `postman_password_apis.json` 进行API测试。

## 注意事项

1. 确保数据库中存在wx_users表，并且包含password_hash字段
2. 密码设置后无法通过API直接查看，只能验证
3. 建议在客户端实现密码强度检查，提高用户体验
4. 可以根据业务需求调整密码最小长度要求 