const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const rateLimit = require('express-rate-limit');
const { merchantImageUpload } = require('../config/multerUpload');
const wxImageUpload = merchantImageUpload;
const { authenticateToken, checkRole } = require('../auth');
const { wxAuthenticated } = require('../utils/wxRouteAuth');
const { appendClientErrorDetail } = require('../utils/clientErrorDetail');
const { wxLoginLimiter, wxRefreshLimiter, wxPublicAuxLimiter } = require('../utils/wxAuthRateLimit');
const { rateLimitIpKey, rateLimitUserOrIpKey } = require('../utils/rateLimitKeys');
const svc = require('../services/wxService');
const mapGeocodeSvc = require('../services/mapGeocodeService');
const logisticsSvc = require('../services/logisticsService');
const subscribeMessageSvc = require('../services/subscribeMessageService');
const subscribeNotifySvc = require('../services/subscribeMessageNotify');
const referralRouter = require('./referral');

const geocodeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.MAP_GEOCODE_RATE_LIMIT_PER_MIN || '30', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `geocode:ip:${rateLimitIpKey(req)}`,
    skip: async (req) => {
        const address = String(req.query?.address || '').trim();
        if (!address) return false;
        return mapGeocodeSvc.isGeocodeCached(address);
    },
    handler: (req, res) => {
        res.status(429).json({ error: '地理编码请求过于频繁，请稍后再试' });
    },
});

const wxPhoneNumberLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.WX_GET_PHONE_NUMBER_RATE_LIMIT || '10', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => rateLimitUserOrIpKey('wx-phone', req),
    handler: (req, res) => {
        res.status(429).json({ error: '获取手机号过于频繁，请稍后再试' });
    },
});

const idcardVerifyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: parseInt(process.env.WX_IDCARD_VERIFY_RATE_LIMIT_PER_HOUR || '20', 10),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => rateLimitUserOrIpKey('idcard-verify', req),
    handler: (req, res) => {
        res.status(429).json({
            code: 429,
            message: '核验次数过多，请稍后再试',
        });
    },
});

router.post('/getPhoneNumber', authenticateToken, wxPhoneNumberLimiter, async (req, res) => {
    try {
        const r = await svc.getPhoneNumber(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取手机号失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取手机号服务暂时不可用' }, error));
    }
});

router.post('/login', wxLoginLimiter, async (req, res) => {
    try {
        const r = await svc.login(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('登录失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取用户信息服务暂时不可用' }, error));
    }
});

router.post('/refresh', wxRefreshLimiter, async (req, res) => {
    try {
        const r = await svc.refreshToken(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('刷新 token 失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '刷新登录状态失败' }, error));
    }
});

router.post('/bindUserInfo', ...wxAuthenticated, async (req, res) => {
    try {
        const r = await svc.bindUserInfo(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('绑定用户信息失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '更新用户信息服务暂时不可用' }, error));
    }
});

router.get('/userInfo', ...wxAuthenticated, async (req, res) => {
    try {
        const r = await svc.userInfo(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取用户信息失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取用户信息服务暂时不可用' }, error));
    }
});

router.post('/updateProfile', authenticateToken, wxImageUpload.single('avatar'), async (req, res) => {
    try {
        const r = await svc.updateProfile(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('更新用户信息失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '更新用户信息服务暂时不可用' }, error));
    }
});

router.post('/userApi/user/getToken', authenticateToken, express.urlencoded({ extended: false }), async (req, res) => {
    try {
        const r = await svc.userApiGetToken(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取token失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取外部token服务暂时不可用'
        }, error));
    }
});

router.post('/userApi/external/user/real_name_registration/simplify/v3', ...wxAuthenticated, async (req, res) => {
    try {
        const r = await svc.realNameRegistration(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('实名注册失败', { err: error });
        res.status(500).json(appendClientErrorDetail({
            code: 500,
            status: false,
            message: '实名注册服务暂时不可用',
        }, error));
    }
});

router.get('/userPhone', ...wxAuthenticated, async (req, res) => {
    try {
        const r = await svc.userPhone(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取手机号失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取手机号服务暂时不可用' }, error));
    }
});

router.get('/userVerificationStatus', ...wxAuthenticated, async (req, res) => {
    try {
        const r = await svc.userVerificationStatus(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('查询实名状态失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '查询实名状态服务暂时不可用' }, error));
    }
});

router.post('/userApi/external/user/upload/idcard', authenticateToken, wxImageUpload.fields([
    { name: 'idCardFront', maxCount: 1 },
    { name: 'idCardBack', maxCount: 1 },
    { name: 'businessLicense', maxCount: 1 }
]), async (req, res) => {
    try {
        const r = await svc.uploadIdcard(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('上传身份证照片失败', { err: error });
        res.status(500).json(appendClientErrorDetail({
            code: 500,
            status: false,
            message: '上传身份证照片服务暂时不可用',
        }, error));
    }
});

router.get('/getIp', wxPublicAuxLimiter, async (req, res) => {
    try {
        const r = await svc.getIp(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取IP失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '服务暂时不可用' }, error));
    }
});

router.post('/userApi/external/user/idcard-verify', authenticateToken, idcardVerifyLimiter, async (req, res) => {
    try {
        const r = await svc.idcardVerify(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('二要素核验失败', { err: error });
        res.status(500).json(appendClientErrorDetail({
            code: 500,
            message: '身份证核验服务暂时不可用',
            recommend: error.data?.Recommend,
        }, error));
    }
});

router.get('/font-url', wxPublicAuxLimiter, async (req, res) => {
    try {
        const r = await svc.getFontUrl(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取字体链接失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '服务暂时不可用' }, error));
    }
});

router.post('/setPassword', ...wxAuthenticated, async (req, res) => {
    try {
        const r = await svc.setPassword(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('设置密码失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '设置密码服务暂时不可用' }, error));
    }
});

router.post('/changePassword', ...wxAuthenticated, async (req, res) => {
    try {
        const r = await svc.changePassword(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('修改密码失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '修改密码服务暂时不可用' }, error));
    }
});

router.post('/verifyPassword', ...wxAuthenticated, async (req, res) => {
    try {
        const r = await svc.verifyPassword(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('验证密码失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '验证密码服务暂时不可用' }, error));
    }
});

router.get('/addresses', authenticateToken, async (req, res) => {
    try {
        const r = await svc.listAddresses(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取地址列表失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取地址列表服务暂时不可用' }, error));
    }
});

router.get('/addresses/default', authenticateToken, async (req, res) => {
    try {
        const r = await svc.getAddressDefault(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取默认地址失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取默认地址服务暂时不可用' }, error));
    }
});

router.get('/addresses/:id', authenticateToken, async (req, res) => {
    try {
        const r = await svc.getAddressById(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取地址详情失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取地址详情服务暂时不可用' }, error));
    }
});

router.post('/addresses', authenticateToken, async (req, res) => {
    try {
        const r = await svc.createAddress(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('添加地址失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '添加地址服务暂时不可用' }, error));
    }
});

router.put('/addresses/:id', authenticateToken, async (req, res) => {
    try {
        const r = await svc.updateAddress(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('修改地址失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '修改地址服务暂时不可用' }, error));
    }
});

router.delete('/addresses/:id', authenticateToken, async (req, res) => {
    try {
        const r = await svc.deleteAddress(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('删除地址失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '删除地址服务暂时不可用' }, error));
    }
});

router.put('/addresses/:id/default', authenticateToken, async (req, res) => {
    try {
        const r = await svc.setAddressDefault(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('设置默认地址失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '设置默认地址服务暂时不可用' }, error));
    }
});

/** 高德地图地理编码代理（Key 仅存服务端；按 IP 限流，无需登录） */
router.get('/map/geocode', geocodeLimiter, async (req, res) => {
    try {
        const r = await mapGeocodeSvc.mapGeocode(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('地理编码失败', { err: error });
        return res.status(500).json(appendClientErrorDetail({ error: '地址解析失败' }, error));
    }
});

/** 买家：查询本人订单运单轨迹（小程序；需登录，与 admin 的 getPath 分离） */
router.post('/logistics/me/path', authenticateToken, async (req, res) => {
    try {
        const r = await logisticsSvc.getPathAsBuyer(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('买家查询运单轨迹失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '查询运单轨迹失败' }, error));
    }
});

/** 买家：获取本人订单运单数据/面单（小程序；需登录） */
router.post('/logistics/me/order', authenticateToken, async (req, res) => {
    try {
        const r = await logisticsSvc.getOrderAsBuyer(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('买家获取运单数据失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取运单数据失败' }, error));
    }
});

/** 顺丰开放平台：支持的快递产品（固定顺丰，需 admin） */
router.get('/logistics/deliveries', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.getAllDelivery();
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取快递公司列表失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取快递公司列表服务暂时不可用' }, error));
    }
});

/** 顺丰开放平台：生成运单（需 admin） */
router.post('/logistics/orders', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.addOrder(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('生成运单失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '生成运单服务暂时不可用' }, error));
    }
});

/** 微信物流消息：运力公司列表（需 admin） */
router.get('/logistics/delivery-list', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.getOpenMsgDeliveryList();
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取物流消息运力列表失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取运力列表服务暂时不可用' }, error));
    }
});

/** 手工填运单号发货（需 admin） */
router.post('/logistics/manual-shipment', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.addManualShipment(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('手工发货失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '手工发货服务暂时不可用' }, error));
    }
});

/** 补调 follow_waybill（需 admin） */
router.post('/logistics/follow-waybill', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.retryFollowWaybill(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('重试物流消息登记失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '物流消息登记服务暂时不可用' }, error));
    }
});

/** 按 waybill_token 查询物流消息轨迹（需 admin） */
router.post('/logistics/query-follow-trace', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.queryOpenMsgFollowTrace(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('查询物流消息轨迹失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '查询物流消息轨迹服务暂时不可用' }, error));
    }
});

/** 顺丰开放平台：查询运单轨迹（需 admin） */
router.post('/logistics/path', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.getPath(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('查询运单轨迹失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '查询运单轨迹服务暂时不可用' }, error));
    }
});

/** 顺丰开放平台：获取运单/面单数据（需 admin） */
router.post('/logistics/order/get', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.getOrder(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取运单数据失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取运单数据服务暂时不可用' }, error));
    }
});

/** 顺丰开放平台：订单确认（需 admin） */
router.post('/logistics/order/confirm', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.confirmOrder(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('订单确认失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '订单确认服务暂时不可用' }, error));
    }
});

/** 顺丰开放平台：时效标准及价格查询（需 admin） */
router.post('/logistics/query-deliver-tm', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.queryDeliverTm(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('时效价格查询失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '时效价格查询服务暂时不可用' }, error));
    }
});

/** 顺丰开放平台：取消运单（需 admin） */
router.post('/logistics/order/cancel', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.cancelOrder(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('取消运单失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '取消运单服务暂时不可用' }, error));
    }
});

/** 微信小程序：发货信息录入 uploadShippingInfo（需 admin；仅服务端调用微信 OpenAPI） */
router.post('/logistics/upload-shipping-info', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.uploadShippingInfo(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('微信发货信息录入失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '微信发货信息录入服务暂时不可用' }, error));
    }
});

/** 微信小程序：合单发货信息录入 uploadCombinedShippingInfo（需 admin；仅服务端调用微信 OpenAPI） */
router.post('/logistics/upload-combined-shipping-info', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.uploadCombinedShippingInfo(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('微信合单发货信息录入失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '微信合单发货信息录入服务暂时不可用' }, error));
    }
});

/** 微信小程序：查询订单发货状态 getOrder（需 admin；仅服务端调用微信 OpenAPI） */
router.post('/logistics/wechat-order/get', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.getWechatOrder(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('微信订单发货状态查询失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '微信订单发货状态查询服务暂时不可用' }, error));
    }
});

/** 微信小程序：查询订单列表 getOrderList（需 admin；仅服务端调用微信 OpenAPI） */
router.post('/logistics/wechat-order/list', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.getWechatOrderList(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('微信订单列表查询失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '微信订单列表查询服务暂时不可用' }, error));
    }
});

/** 微信小程序：确认收货提醒 notifyConfirmReceive（需 admin；仅服务端调用微信 OpenAPI） */
router.post('/logistics/wechat-order/notify-confirm-receive', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.notifyConfirmReceive(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('微信确认收货提醒失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '微信确认收货提醒服务暂时不可用' }, error));
    }
});

/** 微信小程序：消息跳转路径设置 setMsgJumpPath（需 admin；仅服务端调用微信 OpenAPI） */
router.post('/logistics/wechat-order/set-msg-jump-path', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.setMsgJumpPath(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('微信消息跳转路径设置失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '微信消息跳转路径设置服务暂时不可用' }, error));
    }
});

/** 微信小程序：查询是否已完成交易结算管理确认（需 admin；仅服务端调用微信 OpenAPI） */
router.post('/logistics/wechat-order/is-trade-management-completed', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await logisticsSvc.isTradeManagementConfirmationCompleted(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('微信交易结算管理确认查询失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '微信交易结算管理确认查询服务暂时不可用' }, error));
    }
});

/** 订阅消息：获取类目（需 admin） */
router.get('/subscribe-message/categories', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.getCategory();
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取订阅消息类目失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取订阅消息类目失败' }, error));
    }
});

/** 订阅消息：获取类目下的公共模板（需 admin） */
router.get('/subscribe-message/templates/public', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.getPubTemplateTitles(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取公共订阅模板失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取公共订阅模板失败' }, error));
    }
});

/** 订阅消息：获取模板标题下的关键词（需 admin） */
router.get('/subscribe-message/templates/public/:tid/keywords', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.getPubTemplateKeywords(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取订阅模板关键词失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取订阅模板关键词失败' }, error));
    }
});

/** 订阅消息：获取已有私有模板列表（需 admin） */
router.get('/subscribe-message/templates', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.getPrivateTemplates();
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取私有订阅模板失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取私有订阅模板失败' }, error));
    }
});

/** 订阅消息：选用公共模板到私有库（需 admin） */
router.post('/subscribe-message/templates', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.addTemplate(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('选用订阅模板失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '选用订阅模板失败' }, error));
    }
});

/** 订阅消息：删除私有模板（需 admin） */
router.delete('/subscribe-message/templates/:priTmplId', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.deleteTemplate(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('删除订阅模板失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '删除订阅模板失败' }, error));
    }
});

/** 订阅消息：发送订阅消息（需 admin） */
router.post('/subscribe-message/send', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.sendSubscribeMessage(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('发送订阅消息失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '发送订阅消息失败' }, error));
    }
});

/** 订阅消息：激活与更新服务卡片（需 admin） */
router.post('/subscribe-message/user-notify', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.setUserNotify(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('激活/更新服务卡片失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '激活/更新服务卡片失败' }, error));
    }
});

/** 订阅消息：更新服务卡片扩展信息（需 admin） */
router.post('/subscribe-message/user-notify/ext', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.setUserNotifyExt(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('更新服务卡片扩展信息失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '更新服务卡片扩展信息失败' }, error));
    }
});

/** 订阅消息：查询服务卡片状态（需 admin） */
router.post('/subscribe-message/user-notify/query', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeMessageSvc.getUserNotify(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('查询服务卡片状态失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '查询服务卡片状态失败' }, error));
    }
});

/** 订阅消息：补发场景列表（需 admin） */
router.get('/subscribe-message/resend/scenes', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = subscribeNotifySvc.getResendScenes();
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('获取订阅消息补发场景失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '获取补发场景失败' }, error));
    }
});

/** 订阅消息：按业务场景补发（需 admin） */
router.post('/subscribe-message/resend', authenticateToken, checkRole(['admin']), async (req, res) => {
    try {
        const r = await subscribeNotifySvc.resendSubscribeNotify(req);
        return res.status(r.status).json(r.body);
    } catch (error) {
        logger.error('订阅消息补发失败', { err: error });
        res.status(500).json(appendClientErrorDetail({ error: '订阅消息补发失败' }, error));
    }
});

router.use('/referral', referralRouter);

module.exports = router;
