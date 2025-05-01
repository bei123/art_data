const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');

// 小程序登录
router.post('/login', UserController.login);

// 获取手机号
router.post('/getPhoneNumber', UserController.getPhoneNumber);

// 绑定/更新小程序用户信息（手机号、昵称、头像）
router.post('/bindUserInfo', authenticateToken, UserController.bindUserInfo);

// 获取用户信息
router.get('/userInfo', authenticateToken, UserController.getUserInfo);

module.exports = router; 