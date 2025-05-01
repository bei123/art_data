const express = require('express');
const router = express.Router();
const userRoutes = require('./routes/userRoutes');
const payRoutes = require('./routes/payRoutes');

// 注册所有微信相关的路由
router.use('/wx', userRoutes);
router.use('/wx/pay', payRoutes);

module.exports = router; 