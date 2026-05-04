const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const multer = require('multer');
const upload = multer();
const svc = require('../services/wxService');

router.post('/getPhoneNumber', async (req, res) => {
    try {
        const r = await svc.getPhoneNumber(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取手机号失败', { err: error });
        res.status(500).json({ error: '获取手机号服务暂时不可用' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const r = await svc.login(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('登录失败', { err: error });
        res.status(500).json({ error: '获取用户信息服务暂时不可用', detail: error.message });
    }
});

router.post('/bindUserInfo', async (req, res) => {
    try {
        const r = await svc.bindUserInfo(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('绑定用户信息失败', { err: error });
        res.status(500).json({ error: '更新用户信息服务暂时不可用' });
    }
});

router.get('/userInfo', async (req, res) => {
    try {
        const r = await svc.userInfo(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取用户信息失败', { err: error });
        res.status(500).json({ error: '获取用户信息服务暂时不可用' });
    }
});

router.post('/updateProfile', upload.single('avatar'), async (req, res) => {
    try {
        const r = await svc.updateProfile(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('更新用户信息失败', { err: error });
        res.status(500).json({ error: '更新用户信息服务暂时不可用', detail: error.message });
    }
});

router.post('/userApi/user/getToken', express.urlencoded({ extended: false }), async (req, res) => {
    try {
        const r = await svc.userApiGetToken(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取token失败', { err: error });
        res.status(500).json({
            error: '获取外部token服务暂时不可用',
            detail: error.message
        });
    }
});

router.post('/userApi/external/user/real_name_registration/simplify/v3', async (req, res) => {
    try {
        const r = await svc.realNameRegistration(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('实名注册失败', { err: error });
        res.status(500).json({
            code: 500,
            status: false,
            message: '实名注册服务暂时不可用',
            detail: error.message
        });
    }
});

router.get('/userPhone', async (req, res) => {
    try {
        const r = await svc.userPhone(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取手机号失败', { err: error });
        res.status(500).json({ error: '获取手机号服务暂时不可用', detail: error.message });
    }
});

router.get('/userVerificationStatus', async (req, res) => {
    try {
        const r = await svc.userVerificationStatus(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('查询实名状态失败', { err: error });
        res.status(500).json({ error: '查询实名状态服务暂时不可用', detail: error.message });
    }
});

router.post('/userApi/external/user/upload/idcard', upload.fields([
    { name: 'idCardFront', maxCount: 1 },
    { name: 'idCardBack', maxCount: 1 },
    { name: 'businessLicense', maxCount: 1 }
]), async (req, res) => {
    try {
        const r = await svc.uploadIdcard(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('上传身份证照片失败', { err: error });
        res.status(500).json({
            code: 500,
            status: false,
            message: '上传身份证照片服务暂时不可用',
            detail: error.message
        });
    }
});

router.get('/getIp', async (req, res) => {
    try {
        const r = await svc.getIp(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取IP失败', { err: error });
        res.status(500).json({ error: '服务暂时不可用', detail: error.message });
    }
});

router.post('/userApi/external/user/idcard-verify', async (req, res) => {
    try {
        const r = await svc.idcardVerify(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('二要素核验失败', { err: error });
        res.status(500).json({
            code: 500,
            message: '身份证核验服务暂时不可用',
            detail: error.message,
            recommend: error.data?.Recommend
        });
    }
});

router.get('/font-url', async (req, res) => {
    try {
        const r = await svc.getFontUrl(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取字体链接失败', { err: error });
        res.status(500).json({ error: '服务暂时不可用', detail: error.message });
    }
});

router.post('/setPassword', async (req, res) => {
    try {
        const r = await svc.setPassword(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('设置密码失败', { err: error });
        res.status(500).json({ error: '设置密码服务暂时不可用', detail: error.message });
    }
});

router.post('/changePassword', async (req, res) => {
    try {
        const r = await svc.changePassword(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('修改密码失败', { err: error });
        res.status(500).json({ error: '修改密码服务暂时不可用', detail: error.message });
    }
});

router.post('/verifyPassword', async (req, res) => {
    try {
        const r = await svc.verifyPassword(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('验证密码失败', { err: error });
        res.status(500).json({ error: '验证密码服务暂时不可用', detail: error.message });
    }
});

router.get('/addresses', async (req, res) => {
    try {
        const r = await svc.listAddresses(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取地址列表失败', { err: error });
        res.status(500).json({ error: '获取地址列表服务暂时不可用', detail: error.message });
    }
});

router.get('/addresses/default', async (req, res) => {
    try {
        const r = await svc.getAddressDefault(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取默认地址失败', { err: error });
        res.status(500).json({ error: '获取默认地址服务暂时不可用', detail: error.message });
    }
});

router.get('/addresses/:id', async (req, res) => {
    try {
        const r = await svc.getAddressById(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取地址详情失败', { err: error });
        res.status(500).json({ error: '获取地址详情服务暂时不可用', detail: error.message });
    }
});

router.post('/addresses', async (req, res) => {
    try {
        const r = await svc.createAddress(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('添加地址失败', { err: error });
        res.status(500).json({ error: '添加地址服务暂时不可用', detail: error.message });
    }
});

router.put('/addresses/:id', async (req, res) => {
    try {
        const r = await svc.updateAddress(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('修改地址失败', { err: error });
        res.status(500).json({ error: '修改地址服务暂时不可用', detail: error.message });
    }
});

router.delete('/addresses/:id', async (req, res) => {
    try {
        const r = await svc.deleteAddress(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('删除地址失败', { err: error });
        res.status(500).json({ error: '删除地址服务暂时不可用', detail: error.message });
    }
});

router.put('/addresses/:id/default', async (req, res) => {
    try {
        const r = await svc.setAddressDefault(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('设置默认地址失败', { err: error });
        res.status(500).json({ error: '设置默认地址服务暂时不可用', detail: error.message });
    }
});

module.exports = router;
