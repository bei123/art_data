const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const jwt = require('jsonwebtoken');
const BASE_URL = 'https://api.wx.2000gallery.art:2000';
const redisClient = require('../utils/redisClient');
const LOCK_EXPIRE = 30; // 30秒
const CALLBACK_EXPIRE = 600; // 10分钟
const { getWechatpayPublicKey } = require('../utils/wechatpayCerts');
const { authenticateToken } = require('../auth');


// 微信支付V3配置
const WX_PAY_CONFIG = {
    appId: process.env.WX_APPID, // 小程序appid
    mchId: process.env.WX_PAY_MCH_ID, // 商户号
      key: process.env.WX_PAY_KEY, // API密钥
  serialNo: process.env.WX_PAY_SERIAL_NO, // 商户证书序列号
  publicKeyId: process.env.WX_PUB_ID, // 微信支付公钥ID
  privateKey: fs.readFileSync(path.join(__dirname, '../ssl/apiclient_key.pem')), // 商户私钥
    notifyUrl: 'https://api.wx.2000gallery.art:2000/api/wx/pay/notify', // 支付回调地址
    notify_url:'https://api.wx.2000gallery.art:2000/api/wx/pay/refund/notify', // 退款回调地址

    spbillCreateIp: '127.0.0.1' // 终端IP
};
console.log('APIv3密钥:', JSON.stringify(WX_PAY_CONFIG.key), WX_PAY_CONFIG.key.length);

// 检查必要的环境变量
if (!WX_PAY_CONFIG.key) {
    console.error('错误: 缺少必要的环境变量 WX_PAY_KEY');
    process.exit(1);
}

// 生成随机字符串
function generateNonceStr() {
    return Math.random().toString(36).substr(2, 15);
}

// 生成签名
function generateSignV3(method, url, timestamp, nonceStr, body) {
    // 1. 构造签名串
    const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;

    // 2. 使用SHA256-RSA签名
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    const signature = sign.sign(WX_PAY_CONFIG.privateKey, 'base64');

    return signature;
}

// 替换验签函数
function verifyWechatpaySignature({ serial, signature, timestamp, nonce, body }) {
  const publicKey = getWechatpayPublicKey(serial);
  if (!publicKey) return false;
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(message);
  verify.end();
  return verify.verify(publicKey, signature, 'base64');
}
console.log('APIv3密钥:', JSON.stringify(WX_PAY_CONFIG.key), WX_PAY_CONFIG.key.length);
// 解密回调数据
function decryptCallbackData(associatedData, nonce, ciphertext) {
    const key = Buffer.from(WX_PAY_CONFIG.key, 'utf8'); // 32字节明文
    const nonceBuf = Buffer.from(nonce, 'utf8'); // 修正：nonce直接用utf8编码
    const data = Buffer.from(ciphertext, 'base64');
    const authTag = data.slice(data.length - 16);
    const encrypted = data.slice(0, data.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonceBuf);
    if (associatedData) {
        decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    }
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
}

// 新增：微信时间格式转换为 MySQL DATETIME
function formatWechatTime(isoString) {
    if (!isoString) return null;
    const date = new Date(isoString);
    const pad = n => n < 10 ? '0' + n : n;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// // 测试路由 - 验证路由是否正确注册
// router.get('/test', (req, res) => {
//     res.json({ message: '退款路由正常工作', timestamp: new Date().toISOString() });
// });

// 统一下单接口
router.post('/unifiedorder', async (req, res) => {
    try {
        const { openid, total_fee, body, out_trade_no, cart_items, address_id } = req.body;

        // 输入验证
        if (!openid || typeof openid !== 'string' || openid.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的openid' });
        }
        
        if (!total_fee || isNaN(parseFloat(total_fee)) || parseFloat(total_fee) <= 0) {
            return res.status(400).json({ error: '缺少有效的支付金额' });
        }
        
        if (!body || typeof body !== 'string' || body.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的商品描述' });
        }
        
        if (body.length > 128) {
            return res.status(400).json({ error: '商品描述长度不能超过128个字符' });
        }
        
        if (!out_trade_no || typeof out_trade_no !== 'string' || out_trade_no.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的订单号' });
        }
        
        if (out_trade_no.length > 64) {
            return res.status(400).json({ error: '订单号长度不能超过64个字符' });
        }
        
        if (!cart_items || !Array.isArray(cart_items) || cart_items.length === 0) {
            return res.status(400).json({ error: '缺少有效的购物车商品' });
        }
        
        if (cart_items.length > 20) {
            return res.status(400).json({ error: '购物车商品数量不能超过20个' });
        }
        
        // 验证地址ID（可选，但建议提供）
        if (address_id && (isNaN(parseInt(address_id)) || parseInt(address_id) <= 0)) {
            return res.status(400).json({ error: '地址ID格式无效' });
        }
        
        // 幂等性锁
        const lockKey = `pay:order:lock:${out_trade_no}`;
        const lock = await redisClient.set(lockKey, '1', { NX: true, EX: LOCK_EXPIRE });
        if (!lock) {
            return res.status(429).json({ error: '订单正在处理中，请勿重复提交' });
        }

        // 清理输入
        const cleanOpenid = openid.trim();
        const cleanTotalFee = parseFloat(total_fee);
        const cleanBody = body.trim();
        const cleanOutTradeNo = out_trade_no.trim();

        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 根据openid获取用户id
            const [users] = await connection.query(
                'SELECT id FROM wx_users WHERE openid = ?',
                [cleanOpenid]
            );

            if (!users || users.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '用户不存在' });
            }

            const userId = users[0].id;

            // 获取用户可用的抵扣金额
            const [discounts] = await connection.query(`
                SELECT COALESCE(SUM(dip.discount_amount), 0) as total_discount
                FROM digital_identity_purchases dip
                WHERE dip.user_id = ? AND dip.discount_amount > 0
            `, [userId]);

            const availableDiscount = discounts[0].total_discount || 0;

            // 分类商品ID，批量查询
            const rightIds = [];
            const artworkIds = [];
            const digitalIds = [];

            cart_items.forEach(item => {
                if (item.type === 'right') {
                    rightIds.push(item.right_id);
                } else if (item.type === 'artwork') {
                    artworkIds.push(item.artwork_id);
                } else if (item.type === 'digital') {
                    digitalIds.push(item.digital_artwork_id);
                }
            });

            // 批量查询商品信息
            const goodsMap = new Map();

            // 批量查询rights
            if (rightIds.length > 0) {
                const [rights] = await connection.query(
                    'SELECT id, price, remaining_count, discount_amount FROM rights WHERE id IN (?) AND status = "onsale"',
                    [rightIds]
                );
                rights.forEach(right => {
                    goodsMap.set(`right_${right.id}`, right);
                });
            }

            // 批量查询artworks
            if (artworkIds.length > 0) {
                const [artworks] = await connection.query(
                    'SELECT id, original_price, discount_price, stock FROM original_artworks WHERE id IN (?) AND is_on_sale = 1',
                    [artworkIds]
                );
                artworks.forEach(artwork => {
                    goodsMap.set(`artwork_${artwork.id}`, artwork);
                });
            }

            // 批量查询digitals
            if (digitalIds.length > 0) {
                const [digitals] = await connection.query(
                    'SELECT id, price FROM digital_artworks WHERE id IN (?)',
                    [digitalIds]
                );
                digitals.forEach(digital => {
                    goodsMap.set(`digital_${digital.id}`, digital);
                });
            }

            // 校验所有商品
            for (const item of cart_items) {
                const key = `${item.type}_${item.type === 'right' ? item.right_id : item.type === 'artwork' ? item.artwork_id : item.digital_artwork_id}`;
                const goods = goodsMap.get(key);

                if (!goods) {
                    await connection.rollback();
                    return res.status(404).json({ error: `商品ID ${item.type === 'right' ? item.right_id : item.type === 'artwork' ? item.artwork_id : item.digital_artwork_id} 不存在或已下架` });
                }

                // 验证库存
                if (item.type === 'right' && goods.remaining_count < item.quantity) {
                    await connection.rollback();
                    return res.status(400).json({ error: `商品ID ${item.right_id} 库存不足` });
                }
                if (item.type === 'artwork' && goods.stock < item.quantity) {
                    await connection.rollback();
                    return res.status(400).json({ error: `艺术品ID ${item.artwork_id} 库存不足` });
                }

                // 验证价格
                const itemPrice = parseFloat(item.price);
                let dbPrice;
                if (item.type === 'right' || item.type === 'digital') {
                    dbPrice = parseFloat(goods.price);
                } else if (item.type === 'artwork') {
                    dbPrice = (goods.discount_price && goods.discount_price > 0 && goods.discount_price < goods.original_price)
                        ? goods.discount_price
                        : goods.original_price;
                }

                if (Math.abs(itemPrice - dbPrice) > 0.01) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: `商品ID ${item.type === 'right' ? item.right_id : item.type === 'artwork' ? item.artwork_id : item.digital_artwork_id} 价格不匹配`,
                        detail: {
                            expected: dbPrice,
                            received: itemPrice
                        }
                    });
                }
            }

            // 计算实际支付金额（考虑抵扣）
            const actualTotalFee = Math.max(0, total_fee - availableDiscount);

            // 创建订单
            const [orderResult] = await connection.query(
                'INSERT INTO orders (user_id, out_trade_no, total_fee, actual_fee, discount_amount, body) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, cleanOutTradeNo, cleanTotalFee, actualTotalFee, availableDiscount, cleanBody]
            );

            const orderId = orderResult.insertId;

            // 创建订单项，支持三种类型
            const orderItems = cart_items.map(item => {
                if (item.type === 'right') {
                    return [orderId, 'right', item.right_id, null, null, item.quantity, parseFloat(item.price), address_id || null];
                } else if (item.type === 'digital') {
                    return [orderId, 'digital', null, item.digital_artwork_id, null, item.quantity, parseFloat(item.price), address_id || null];
                } else if (item.type === 'artwork') {
                    return [orderId, 'artwork', null, null, item.artwork_id, item.quantity, parseFloat(item.price), address_id || null];
                }
            });
            await connection.query(
                'INSERT INTO order_items (order_id, type, right_id, digital_artwork_id, artwork_id, quantity, price, address_id) VALUES ?',
                [orderItems]
            );

            // 如果使用了抵扣，更新抵扣记录
            if (availableDiscount > 0) {
                await connection.query(`
                    UPDATE digital_identity_purchases 
                    SET discount_amount = 0 
                    WHERE user_id = ? AND discount_amount > 0
                `, [userId]);
            }

            // 构建统一下单参数
            const params = {
                appid: WX_PAY_CONFIG.appId,
                mchid: WX_PAY_CONFIG.mchId,
                description: cleanBody,
                out_trade_no: cleanOutTradeNo,
                notify_url: WX_PAY_CONFIG.notifyUrl,
                amount: {
                    total: Math.round(actualTotalFee * 100), // 元转分
                    currency: 'CNY'
                },
                scene_info: {
                    payer_client_ip: WX_PAY_CONFIG.spbillCreateIp
                },
                payer: {
                    openid: cleanOpenid
                }
            };

            // 生成签名所需的参数
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const nonceStr = generateNonceStr();
            const method = 'POST';
            const url = '/v3/pay/transactions/jsapi';
            const bodyStr = JSON.stringify(params);

            // 生成签名
            const signature = generateSignV3(method, url, timestamp, nonceStr, bodyStr);

            // 发送请求到微信支付
            const response = await axios.post('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi', params, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
                    'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
                    'User-Agent': 'axios/1.9.0'
                }
            });

            if (response.status === 200) {
                await connection.commit();
                res.json({
                    success: true,
                    data: response.data
                });
            } else {
                await connection.rollback();
                res.status(400).json({
                    success: false,
                    error: '统一下单失败',
                    detail: response.data
                });
            }
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('统一下单失败:', error);
        res.status(500).json({
            error: '统一下单失败'
        });
    }
});

// 单商品下单接口
router.post('/singleorder', async (req, res) => {
    try {
        const { openid, type, quantity, price, body, out_trade_no, right_id, digital_artwork_id, artwork_id, address_id } = req.body;

        // 输入验证
        if (!openid || typeof openid !== 'string' || openid.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的openid' });
        }
        if (!type || !['right', 'digital', 'artwork'].includes(type)) {
            return res.status(400).json({ error: 'type 必须是 right、digital 或 artwork' });
        }
        if (!quantity || isNaN(parseInt(quantity)) || parseInt(quantity) <= 0) {
            return res.status(400).json({ error: '缺少有效的商品数量' });
        }
        if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
            return res.status(400).json({ error: '缺少有效的商品价格' });
        }
        if (!body || typeof body !== 'string' || body.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的商品描述' });
        }
        if (body.length > 128) {
            return res.status(400).json({ error: '商品描述长度不能超过128个字符' });
        }
        if (!out_trade_no || typeof out_trade_no !== 'string' || out_trade_no.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的订单号' });
        }
        if (out_trade_no.length > 64) {
            return res.status(400).json({ error: '订单号长度不能超过64个字符' });
        }

        // 只允许一个商品id
        if (
            (type === 'right' && (!right_id || isNaN(parseInt(right_id)))) ||
            (type === 'digital' && (!digital_artwork_id || isNaN(parseInt(digital_artwork_id)))) ||
            (type === 'artwork' && (!artwork_id || isNaN(parseInt(artwork_id))))
        ) {
            return res.status(400).json({ error: '缺少有效的商品ID' });
        }
        
        // 验证地址ID（可选，但建议提供）
        if (address_id && (isNaN(parseInt(address_id)) || parseInt(address_id) <= 0)) {
            return res.status(400).json({ error: '地址ID格式无效' });
        }

        // 幂等性锁
        const lockKey = `pay:order:lock:${out_trade_no}`;
        const lock = await redisClient.set(lockKey, '1', { NX: true, EX: LOCK_EXPIRE });
        if (!lock) {
            return res.status(429).json({ error: '订单正在处理中，请勿重复提交' });
        }

        // 清理输入
        const cleanOpenid = openid.trim();
        const cleanType = type;
        const cleanQuantity = parseInt(quantity);
        const cleanPrice = parseFloat(price);
        const cleanBody = body.trim();
        const cleanOutTradeNo = out_trade_no.trim();

        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 根据openid获取用户id
            const [users] = await connection.query(
                'SELECT id FROM wx_users WHERE openid = ?',
                [cleanOpenid]
            );
            if (!users || users.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '用户不存在' });
            }
            const userId = users[0].id;

            // 获取用户可用的抵扣金额
            const [discounts] = await connection.query(`
                SELECT SUM(dip.discount_amount) as total_discount
                FROM digital_identity_purchases dip
                WHERE dip.user_id = ? AND dip.discount_amount > 0
            `, [userId]);
            const availableDiscount = discounts[0].total_discount || 0;

            // 校验商品
            let itemId, dbPrice, stock, actualPrice;
            if (cleanType === 'right') {
                itemId = parseInt(right_id);
                const [rights] = await connection.query(
                    'SELECT id, price, remaining_count, discount_amount FROM rights WHERE id = ? AND status = "onsale"',
                    [itemId]
                );
                if (!rights || rights.length === 0) {
                    await connection.rollback();
                    return res.status(404).json({ error: `商品ID ${itemId} 不存在或已下架` });
                }
                if (rights[0].remaining_count < cleanQuantity) {
                    await connection.rollback();
                    return res.status(400).json({ error: `商品ID ${itemId} 库存不足` });
                }
                dbPrice = parseFloat(rights[0].price);
                if (Math.abs(cleanPrice - dbPrice) > 0.01) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: `商品ID ${itemId} 价格不匹配`,
                        detail: { expected: dbPrice, received: cleanPrice }
                    });
                }
            } else if (cleanType === 'artwork') {
                itemId = parseInt(artwork_id);
                const [artworks] = await connection.query(
                    'SELECT id, original_price, discount_price, stock FROM original_artworks WHERE id = ? AND is_on_sale = 1',
                    [itemId]
                );
                if (!artworks || artworks.length === 0) {
                    await connection.rollback();
                    return res.status(404).json({ error: `艺术品ID ${itemId} 不存在或已下架` });
                }
                if (artworks[0].stock < cleanQuantity) {
                    await connection.rollback();
                    return res.status(400).json({ error: `艺术品ID ${itemId} 库存不足` });
                }
                actualPrice = (artworks[0].discount_price && artworks[0].discount_price > 0 && artworks[0].discount_price < artworks[0].original_price)
                    ? artworks[0].discount_price
                    : artworks[0].original_price;
                if (Math.abs(cleanPrice - actualPrice) > 0.01) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: `艺术品ID ${itemId} 价格不匹配`,
                        detail: { expected: actualPrice, received: cleanPrice }
                    });
                }
            } else if (cleanType === 'digital') {
                itemId = parseInt(digital_artwork_id);
                const [digitals] = await connection.query(
                    'SELECT id, price FROM digital_artworks WHERE id = ?',
                    [itemId]
                );
                if (!digitals || digitals.length === 0) {
                    await connection.rollback();
                    return res.status(404).json({ error: `数字艺术品ID ${itemId} 不存在` });
                }
                dbPrice = parseFloat(digitals[0].price);
                if (Math.abs(cleanPrice - dbPrice) > 0.01) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: `数字艺术品ID ${itemId} 价格不匹配`,
                        detail: { expected: dbPrice, received: cleanPrice }
                    });
                }
            }

            // 计算实际支付金额（考虑抵扣）
            const total_fee = cleanPrice * cleanQuantity;
            const actualTotalFee = Math.max(0, total_fee - availableDiscount);

            // 创建订单
            const [orderResult] = await connection.query(
                'INSERT INTO orders (user_id, out_trade_no, total_fee, actual_fee, discount_amount, body) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, cleanOutTradeNo, total_fee, actualTotalFee, availableDiscount, cleanBody]
            );
            const orderId = orderResult.insertId;

            // 创建订单项
            let orderItem;
            if (cleanType === 'right') {
                orderItem = [orderId, 'right', itemId, null, null, cleanQuantity, cleanPrice, address_id || null];
            } else if (cleanType === 'digital') {
                orderItem = [orderId, 'digital', null, itemId, null, cleanQuantity, cleanPrice, address_id || null];
            } else if (cleanType === 'artwork') {
                orderItem = [orderId, 'artwork', null, null, itemId, cleanQuantity, cleanPrice, address_id || null];
            }
            await connection.query(
                'INSERT INTO order_items (order_id, type, right_id, digital_artwork_id, artwork_id, quantity, price, address_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                orderItem
            );

            // 如果使用了抵扣，更新抵扣记录
            if (availableDiscount > 0) {
                await connection.query(`
                    UPDATE digital_identity_purchases 
                    SET discount_amount = 0 
                    WHERE user_id = ? AND discount_amount > 0
                `, [userId]);
            }

            // 构建统一下单参数
            const params = {
                appid: WX_PAY_CONFIG.appId,
                mchid: WX_PAY_CONFIG.mchId,
                description: cleanBody,
                out_trade_no: cleanOutTradeNo,
                notify_url: WX_PAY_CONFIG.notifyUrl,
                amount: {
                    total: Math.round(actualTotalFee * 100), // 元转分
                    currency: 'CNY'
                },
                scene_info: {
                    payer_client_ip: WX_PAY_CONFIG.spbillCreateIp
                },
                payer: {
                    openid: cleanOpenid
                }
            };

            // 生成签名所需的参数
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const nonceStr = generateNonceStr();
            const method = 'POST';
            const url = '/v3/pay/transactions/jsapi';
            const bodyStr = JSON.stringify(params);

            // 生成签名
            const signature = generateSignV3(method, url, timestamp, nonceStr, bodyStr);

            // 发送请求到微信支付
            const response = await axios.post('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi', params, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
                    'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
                    'User-Agent': 'axios/1.9.0'
                }
            });

            if (response.status === 200) {
                await connection.commit();
                res.json({
                    success: true,
                    data: response.data
                });
            } else {
                await connection.rollback();
                res.status(400).json({
                    success: false,
                    error: '统一下单失败',
                    detail: response.data
                });
            }
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('单商品下单失败:', error);
        res.status(500).json({
            error: '单商品下单失败'
        });
    }
});

// 支付回调接口
router.post('/notify', async (req, res) => {
    try {
        // 获取原始body字符串
        const body = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
        // 日志：收到回调
        console.log('收到微信支付回调，原始body:', body);
        // 解析JSON
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch (e) {
            console.error('回调body解析失败:', body);
            return res.status(400).json({ code: 'FAIL', message: '回调数据解析失败' });
        }
        // 获取回调数据
        const { resource } = parsed;
        // 验证必要字段
        if (!resource || !resource.associated_data || !resource.nonce || !resource.ciphertext) {
            console.error('回调数据格式错误:', resource);
            return res.status(400).json({ code: 'FAIL', message: '回调数据格式错误' });
        }
        // 验签
        const timestamp = req.headers['wechatpay-timestamp'];
        const nonce = req.headers['wechatpay-nonce'];
        const signature = req.headers['wechatpay-signature'];
        const serial = req.headers['wechatpay-serial'];
        if (!verifyWechatpaySignature({ serial, signature, timestamp, nonce, body })) {
            console.error('签名验证失败:', { serial, signature });
            return res.status(401).json({ code: 'FAIL', message: '签名验证失败' });
        }
        // 解密回调数据
        let decryptedData;
        try {
            decryptedData = decryptCallbackData(
                resource.associated_data,
                resource.nonce,
                resource.ciphertext
            );
            console.log('解密后回调数据:', decryptedData);
        } catch (e) {
            console.error('解密回调数据失败:', e);
            return res.status(400).json({ code: 'FAIL', message: '解密失败' });
        }
        let callbackData;
        try {
            callbackData = JSON.parse(decryptedData);
        } catch (e) {
            console.error('解析解密数据失败:', decryptedData);
            return res.status(400).json({ code: 'FAIL', message: '回调数据解析失败' });
        }
        // 处理支付结果
        if (callbackData.trade_state === 'SUCCESS') {
            // 回调去重
            const callbackKey = `pay:callback:${callbackData.out_trade_no}`;
            const processed = await redisClient.set(callbackKey, '1', { NX: true, EX: CALLBACK_EXPIRE });
            if (!processed) {
                return res.json({ code: 'SUCCESS', message: '重复回调，已忽略' });
            }
            // 日志：支付成功回调
            console.log('支付成功回调数据:', callbackData);
            const {
                out_trade_no, // 商户订单号
                transaction_id, // 微信支付订单号
                trade_type, // 交易类型
                trade_state, // 交易状态
                trade_state_desc, // 交易状态描述
                success_time, // 支付完成时间
                amount // 订单金额
            } = callbackData;
            // 开始事务
            const connection = await db.getConnection();
            await connection.beginTransaction();
            try {
                // 更新订单状态前先判断是否已退款
                const [orders] = await connection.query(
                    'SELECT trade_state FROM orders WHERE out_trade_no = ?',
                    [out_trade_no]
                );
                if (orders.length > 0 && orders[0].trade_state === 'REFUND') {
                    console.log('订单已退款，不再覆盖为SUCCESS:', out_trade_no);
                    await connection.commit();
                    return res.json({ code: 'SUCCESS', message: '订单已退款，不再覆盖' });
                }
                // 只有不是REFUND才更新为SUCCESS
                await connection.query(
                    `UPDATE orders SET 
              transaction_id = ?,
              trade_type = ?,
              trade_state = ?,
              trade_state_desc = ?,
              success_time = ?
            WHERE out_trade_no = ?`,
                    [transaction_id, trade_type, trade_state, trade_state_desc, success_time ? formatWechatTime(success_time) : null, out_trade_no]
                );
                // 获取订单项
                const [orderItems] = await connection.query(`
                    SELECT oi.*, o.id as order_id
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.id
                    WHERE o.out_trade_no = ?
                `, [out_trade_no]);
                console.log('订单项:', orderItems);
                
                // 批量更新商品库存
                const rightUpdates = [];
                const artworkUpdates = [];
                
                for (const item of orderItems) {
                    if (item.type === 'right') {
                        rightUpdates.push([item.quantity, item.right_id]);
                    } else if (item.type === 'artwork') {
                        artworkUpdates.push([item.quantity, item.artwork_id]);
                    }
                }
                
                // 批量更新rights库存
                if (rightUpdates.length > 0) {
                    for (const [quantity, rightId] of rightUpdates) {
                        await connection.query(
                            'UPDATE rights SET remaining_count = remaining_count - ? WHERE id = ?',
                            [quantity, rightId]
                        );
                    }
                    console.log(`批量扣减right库存: ${rightUpdates.length}条记录`);
                }
                
                // 批量更新artworks库存
                if (artworkUpdates.length > 0) {
                    for (const [quantity, artworkId] of artworkUpdates) {
                        await connection.query(
                            'UPDATE original_artworks SET stock = stock - ? WHERE id = ?',
                            [quantity, artworkId]
                        );
                    }
                    console.log(`批量扣减artwork库存: ${artworkUpdates.length}条记录`);
                }
                await connection.commit();
                console.log('支付回调处理完成，库存已更新');
                res.json({
                    code: 'SUCCESS',
                    message: 'OK'
                });
            } catch (error) {
                await connection.rollback();
                console.error('支付回调处理事务失败:', error);
                throw error;
            } finally {
                connection.release();
            }
        } else {
            console.warn('支付未成功，trade_state:', callbackData.trade_state);
            res.json({
                code: 'FAIL',
                message: callbackData.trade_state_desc || '支付失败'
            });
        }
    } catch (error) {
        console.error('支付回调处理失败:', error);
        res.status(500).json({
            code: 'FAIL',
            message: '处理失败'
        });
    }
});

// 关闭订单接口
router.post('/close', async (req, res) => {
    try {
        const { out_trade_no } = req.body;

        // 输入验证
        if (!out_trade_no || typeof out_trade_no !== 'string' || out_trade_no.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的商户订单号' });
        }
        
        if (out_trade_no.length > 64) {
            return res.status(400).json({ error: '商户订单号长度不能超过64个字符' });
        }
        
        const cleanOutTradeNo = out_trade_no.trim();

        // 构建请求参数
        const params = {
            mchid: WX_PAY_CONFIG.mchId
        };

        // 生成签名所需的参数
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const method = 'POST';
        const url = `/v3/pay/transactions/out-trade-no/${cleanOutTradeNo}/close`;
        const bodyStr = JSON.stringify(params);

        // 生成签名
        const signature = generateSignV3(method, url, timestamp, nonceStr, bodyStr);

        // 发送请求到微信支付
        const response = await axios.post(
            `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${cleanOutTradeNo}/close`,
            params,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
                    'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
                    'User-Agent': 'axios/1.9.0'
                }
            }
        );

        if (response.status === 204) {
            res.json({
                success: true,
                message: '订单关闭成功'
            });
        } else {
            res.status(400).json({
                success: false,
                error: '订单关闭失败'
            });
        }
    } catch (error) {
        console.error('关闭订单失败:', error);
        res.status(500).json({
            success: false,
            error: '关闭订单失败'
        });
    }
});

// 申请退款接口
router.post('/refund', async (req, res) => {
    try {
        const {
            transaction_id, // 微信支付订单号
            out_trade_no,  // 商户订单号
            out_refund_no, // 商户退款单号
            reason,        // 退款原因
            amount         // 金额信息
        } = req.body;

        // 输入验证
        if (!out_refund_no || typeof out_refund_no !== 'string' || out_refund_no.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的退款单号' });
        }
        
        if (out_refund_no.length > 64) {
            return res.status(400).json({ error: '退款单号长度不能超过64个字符' });
        }
        
        if (!amount || typeof amount !== 'object') {
            return res.status(400).json({ error: '缺少有效的金额信息' });
        }
        
        if (!amount.refund || isNaN(parseFloat(amount.refund)) || parseFloat(amount.refund) <= 0) {
            return res.status(400).json({ error: '缺少有效的退款金额' });
        }
        
        if (!amount.total || isNaN(parseFloat(amount.total)) || parseFloat(amount.total) <= 0) {
            return res.status(400).json({ error: '缺少有效的订单总金额' });
        }
        
        if (!amount.currency || typeof amount.currency !== 'string' || amount.currency !== 'CNY') {
            return res.status(400).json({ error: '缺少有效的货币类型' });
        }
        
        if (parseFloat(amount.refund) > parseFloat(amount.total)) {
            return res.status(400).json({ error: '退款金额不能超过订单总金额' });
        }
        
        if (reason && (typeof reason !== 'string' || reason.length > 80)) {
            return res.status(400).json({ error: '退款原因长度不能超过80个字符' });
        }
        
        // 清理输入
        const cleanOutRefundNo = out_refund_no.trim();
        const cleanReason = reason ? reason.trim() : '';
        const cleanAmount = {
            refund: Math.round(parseFloat(amount.refund) * 100), // 元转分
            total: Math.round(parseFloat(amount.total) * 100),   // 元转分
            currency: amount.currency
        };

        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 创建退款申请记录
            const [refundResult] = await connection.query(
                `INSERT INTO refund_requests (
            out_trade_no,
        out_refund_no,
            transaction_id,
        reason,
            amount,
            status,
            created_at
          ) VALUES (?, ?, ?, ?, ?, 'PENDING', NOW())`,
                [
                    out_trade_no,
                    cleanOutRefundNo,
                    transaction_id,
                    cleanReason,
                    JSON.stringify(cleanAmount)
                ]
            );

            await connection.commit();

            res.json({
                success: true,
                data: {
                    refund_id: refundResult.insertId,
                    status: 'PENDING',
                    message: '退款申请已提交，等待审批'
                }
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('申请退款失败:', error);
        res.status(500).json({
            success: false,
            error: '申请退款失败'
        });
    }
});

// 审批退款接口
router.post('/refund/approve', async (req, res) => {
    try {
        const { refund_id, approve, reject_reason } = req.body;

        // 输入验证
        if (!refund_id || isNaN(parseInt(refund_id)) || parseInt(refund_id) <= 0) {
            return res.status(400).json({ error: '缺少有效的退款ID' });
        }
        
        if (typeof approve !== 'boolean') {
            return res.status(400).json({ error: '缺少有效的审批结果' });
        }
        
        if (!approve && (!reject_reason || typeof reject_reason !== 'string' || reject_reason.trim().length === 0)) {
            return res.status(400).json({ error: '拒绝退款必须提供原因' });
        }
        
        if (reject_reason && reject_reason.length > 200) {
            return res.status(400).json({ error: '拒绝原因长度不能超过200个字符' });
        }
        
        // 清理输入
        const cleanRefundId = parseInt(refund_id);
        const cleanRejectReason = reject_reason ? reject_reason.trim() : '';

        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 获取退款申请信息
            const [refunds] = await connection.query(
                'SELECT * FROM refund_requests WHERE id = ? AND status = "PENDING"',
                [cleanRefundId]
            );

            if (!refunds || refunds.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '退款申请不存在或已处理' });
            }

            const refund = refunds[0];

            if (approve) {
                // 更新退款申请状态为已批准
                await connection.query(
                    'UPDATE refund_requests SET status = "APPROVED", approved_at = NOW() WHERE id = ?',
                    [cleanRefundId]
                );

                // 确保amount是有效的JSON字符串
                let amountData;
                try {
                    amountData = typeof refund.amount === 'string' ? JSON.parse(refund.amount) : refund.amount;
                } catch (error) {
                    console.error('解析退款金额失败:', error);
                    await connection.rollback();
                    return res.status(500).json({
                        success: false,
                        error: '处理退款申请失败',
                        detail: '退款金额数据格式错误'
                    });
                }

                // 构建请求参数
                const params = {
                    out_refund_no: refund.out_refund_no,
                    reason: refund.reason,
                    notify_url: WX_PAY_CONFIG.notify_url, // 使用配置中的退款回调地址
                    funds_account: 'AVAILABLE',
                    amount: amountData
                };

                // 添加微信支付订单号或商户订单号
                if (refund.transaction_id) {
                    params.transaction_id = refund.transaction_id;
                } else if (refund.out_trade_no) {
                    params.out_trade_no = refund.out_trade_no;
                }

                // 生成签名
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const nonceStr = generateNonceStr();
                const signature = generateSignV3(
                    'POST',
                    '/v3/refund/domestic/refunds',
                    timestamp,
                    nonceStr,
                    JSON.stringify(params)
                );

                // 发送请求到微信支付
                const response = await axios.post(
                    'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds',
                    params,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
                            'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
                            'User-Agent': 'axios/1.9.0'
                        }
                    }
                );

                if (response.status === 200) {
                    // 更新退款申请状态为处理中
                    await connection.query(
                        'UPDATE refund_requests SET status = "PROCESSING", wx_refund_id = ? WHERE id = ?',
                        [response.data.refund_id, cleanRefundId]
                    );

                    await connection.commit();
                    res.json({
                        success: true,
                        data: {
                            status: 'PROCESSING',
                            message: '退款申请已批准，正在处理中'
                        }
                    });
                } else {
                    await connection.rollback();
                    res.status(400).json({
                        success: false,
                        error: '退款申请处理失败'
                    });
                }
            } else {
                // 拒绝退款申请
                await connection.query(
                    'UPDATE refund_requests SET status = "REJECTED", reject_reason = ?, rejected_at = NOW() WHERE id = ?',
                    [cleanRejectReason, cleanRefundId]
                );

                await connection.commit();
                res.json({
                    success: true,
                    data: {
                        status: 'REJECTED',
                        message: '退款申请已拒绝'
                    }
                });
            }
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('处理退款申请失败:', error);
        res.status(500).json({
            success: false,
            error: '处理退款申请失败'
        });
    }
});

// 获取退款申请列表
router.get('/refund/requests', async (req, res) => {
    try {
        const { status, page = 1, limit = 10 } = req.query;

        // 输入验证
        if (page && (isNaN(parseInt(page)) || parseInt(page) <= 0)) {
            return res.status(400).json({ error: '页码必须是正整数' });
        }
        
        if (limit && (isNaN(parseInt(limit)) || parseInt(limit) <= 0 || parseInt(limit) > 100)) {
            return res.status(400).json({ error: '每页数量必须在1-100之间' });
        }
        
        if (status && !['PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'SUCCESS', 'FAILED'].includes(status)) {
            return res.status(400).json({ error: '无效的状态值' });
        }
        
        // 清理输入
        const cleanPage = parseInt(page);
        const cleanLimit = parseInt(limit);
        const cleanStatus = status ? status.trim() : null;

        const offset = (cleanPage - 1) * cleanLimit;

        // 构建查询条件
        let query = 'SELECT * FROM refund_requests';
        let countQuery = 'SELECT COUNT(*) as total FROM refund_requests';
        let params = [];

        if (cleanStatus) {
            query += ' WHERE status = ?';
            countQuery += ' WHERE status = ?';
            params.push(cleanStatus);
        }

        // 添加排序和分页
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(cleanLimit, offset);

        // 执行查询
        const [refunds] = await db.query(query, params);
        const [[{ total }]] = await db.query(countQuery, cleanStatus ? [cleanStatus] : []);

        // 确保amount字段是有效的JSON字符串
        const formattedRefunds = refunds.map(refund => ({
            ...refund,
            amount: typeof refund.amount === 'string' ? refund.amount : JSON.stringify(refund.amount)
        }));

        res.json({
            success: true,
            data: formattedRefunds,
            total: parseInt(total),
            page: cleanPage,
            limit: cleanLimit
        });
    } catch (error) {
        console.error('获取退款申请列表失败:', error);
        res.status(500).json({
            success: false,
            error: '获取退款申请列表失败'
        });
    }
});

// 获取退款申请详情
router.get('/refund/requests/:id', async (req, res) => {
    try {
        // 输入验证
        const refundId = req.params.id;
        if (!refundId || isNaN(parseInt(refundId)) || parseInt(refundId) <= 0) {
            return res.status(400).json({ error: '无效的退款申请ID' });
        }
        
        const cleanRefundId = parseInt(refundId);
        
        const [refunds] = await db.query(
            'SELECT * FROM refund_requests WHERE id = ?',
            [cleanRefundId]
        );

        if (!refunds || refunds.length === 0) {
            return res.status(404).json({ error: '退款申请不存在' });
        }

        res.json({
            success: true,
            data: refunds[0]
        });
    } catch (error) {
        console.error('获取退款申请详情失败:', error);
        res.status(500).json({
            success: false,
            error: '获取退款申请详情失败'
        });
    }
});

// 退款回调接口
router.post('/refund/notify', async (req, res) => {
    try {
        console.log('【退款回调】收到微信退款回调请求');
        // 获取原始body字符串
        const body = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
        console.log('【退款回调】原始body:', body);
        // 解析JSON
        let parsed;
        try {
            parsed = JSON.parse(body);
            console.log('【退款回调】解析后的JSON:', parsed);
        } catch (e) {
            console.error('【退款回调】回调body解析失败:', body);
            return res.status(400).json({ code: 'FAIL', message: '回调数据解析失败' });
        }
        const { resource } = parsed;
        if (!resource || !resource.associated_data || !resource.nonce || !resource.ciphertext) {
            console.error('【退款回调】回调数据格式错误:', resource);
            return res.status(400).json({ code: 'FAIL', message: '回调数据格式错误' });
        }
        // 验签
        const timestamp = req.headers['wechatpay-timestamp'];
        const nonce = req.headers['wechatpay-nonce'];
        const signature = req.headers['wechatpay-signature'];
        const serial = req.headers['wechatpay-serial'];
        const verifyResult = verifyWechatpaySignature({ serial, signature, timestamp, nonce, body });
        console.log('【退款回调】验签结果:', verifyResult);
        if (!verifyResult) {
            console.error('【退款回调】签名验证失败:', { serial, signature });
            return res.status(401).json({ code: 'FAIL', message: '签名验证失败' });
        }
        // 解密回调数据
        let decryptedData;
        try {
            decryptedData = decryptCallbackData(
                resource.associated_data,
                resource.nonce,
                resource.ciphertext
            );
            console.log('【退款回调】解密后回调数据:', decryptedData);
        } catch (e) {
            console.error('【退款回调】解密回调数据失败:', e);
            return res.status(400).json({ code: 'FAIL', message: '解密失败' });
        }
        let callbackData;
        try {
            callbackData = JSON.parse(decryptedData);
            console.log('【退款回调】最终业务数据:', callbackData);
        } catch (e) {
            console.error('【退款回调】解析解密数据失败:', decryptedData);
            return res.status(400).json({ code: 'FAIL', message: '回调数据解析失败' });
        }
        // 处理退款结果
        if (callbackData.refund_status === 'SUCCESS') {
            // 回调去重
            const callbackKey = `refund:callback:${callbackData.out_refund_no}`;
            const processed = await redisClient.set(callbackKey, '1', { NX: true, EX: CALLBACK_EXPIRE });
            if (!processed) {
                console.log('【退款回调】重复回调，已忽略:', callbackData.out_refund_no);
                return res.json({ code: 'SUCCESS', message: '重复回调，已忽略' });
            }
            
            console.log('【退款回调】退款成功回调数据:', callbackData);
            const {
                out_refund_no, // 商户退款单号
                out_trade_no, // 商户订单号
                refund_id, // 微信退款单号
                refund_status, // 退款状态
                success_time, // 退款成功时间
                amount // 金额信息
            } = callbackData;

            // 更新订单项库存回补
            const connection = await db.getConnection();
            await connection.beginTransaction();
            try {
                // 查询订单项 - 使用JOIN优化
                const [orderItems] = await connection.query(`
                    SELECT oi.*, o.id as order_id
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.id
                    WHERE o.out_trade_no = ?
                `, [out_trade_no]);
                
                // 批量更新库存
                const rightUpdates = [];
                const artworkUpdates = [];
                
                for (const item of orderItems) {
                    if (item.type === 'right') {
                        rightUpdates.push([item.quantity, item.right_id]);
                    } else if (item.type === 'artwork') {
                        artworkUpdates.push([item.quantity, item.artwork_id]);
                    }
                }
                
                // 批量更新rights库存
                if (rightUpdates.length > 0) {
                    for (const [quantity, rightId] of rightUpdates) {
                        await connection.query(
                            'UPDATE rights SET remaining_count = remaining_count + ? WHERE id = ?',
                            [quantity, rightId]
                        );
                    }
                }
                
                // 批量更新artworks库存
                if (artworkUpdates.length > 0) {
                    for (const [quantity, artworkId] of artworkUpdates) {
                        await connection.query(
                            'UPDATE original_artworks SET stock = stock + ? WHERE id = ?',
                            [quantity, artworkId]
                        );
                    }
                }
                
                await connection.commit();
                console.log('【退款回调】库存回补完成');
                
                // 只更新refund_requests表的处理状态
                try {
                    await connection.query(
                        `UPDATE refund_requests SET 
                        status = 'SUCCESS',
                        wx_refund_id = ?,
                        updated_at = NOW()
                        WHERE out_refund_no = ?`,
                        [
                            refund_id,
                            out_refund_no
                        ]
                    );
                    // 新增：更新订单状态为已退款，并打印SQL执行结果
                    console.log('【退款回调】数据库查找订单号:', out_trade_no);
                    const [updateResult] = await connection.query(
                        `UPDATE orders SET trade_state = 'REFUND', trade_state_desc = '已退款', updated_at = NOW() WHERE out_trade_no = ?`,
                        [out_trade_no]
                    );
                    console.log('【退款回调】订单状态更新SQL结果:', updateResult);
                    console.log('【退款回调】退款申请状态和订单状态更新完成');
                } catch (updateError) {
                    console.error('【退款回调】更新退款申请或订单状态失败:', updateError);
                    // 不影响回调应答，只记录错误
                }
            } catch (err) {
                await connection.rollback();
                throw err;
            } finally {
                connection.release();
            }

            res.json({
                code: 'SUCCESS',
                message: 'OK'
            });
        } else {
            res.json({
                code: 'FAIL',
                message: callbackData.refund_status || '退款失败'
            });
        }
    } catch (error) {
        console.error('退款回调处理失败:', error);
        res.status(500).json({
            code: 'FAIL',
            message: '处理失败'
        });
    }
});

// 小程序调起支付签名接口
router.post('/sign', async (req, res) => {
    try {
        const { prepay_id } = req.body;

        // 输入验证
        if (!prepay_id || typeof prepay_id !== 'string' || prepay_id.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的prepay_id' });
        }
        
        if (prepay_id.length > 64) {
            return res.status(400).json({ error: 'prepay_id长度不能超过64个字符' });
        }
        
        const cleanPrepayId = prepay_id.trim();

        // 构建签名参数
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const package = `prepay_id=${cleanPrepayId}`;

        // 构建签名串
        const signStr = `${WX_PAY_CONFIG.appId}\n${timestamp}\n${nonceStr}\n${package}\n`;

        // 生成签名
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(signStr);
        const signature = sign.sign(WX_PAY_CONFIG.privateKey, 'base64');

        // 返回支付参数
        res.json({
            timeStamp: timestamp,
            nonceStr: nonceStr,
            package: package,
            signType: 'RSA',
            paySign: signature
        });
    } catch (error) {
        console.error('生成支付签名失败:', error);
        res.status(500).json({ error: '生成支付签名失败' });
    }
});

// 查询订单详情接口
router.get('/query', async (req, res) => {
    try {
        const { out_trade_no } = req.query;

        // 输入验证
        if (!out_trade_no || typeof out_trade_no !== 'string' || out_trade_no.trim().length === 0) {
            return res.status(400).json({ error: '缺少有效的商户订单号' });
        }
        
        if (out_trade_no.length > 64) {
            return res.status(400).json({ error: '商户订单号长度不能超过64个字符' });
        }
        
        const cleanOutTradeNo = out_trade_no.trim();

        // 生成签名所需的参数
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const method = 'GET';
        const url = `/v3/pay/transactions/out-trade-no/${cleanOutTradeNo}`;

        // 生成签名
        const signature = generateSignV3(method, url, timestamp, nonceStr, '');

        // 发送请求到微信支付
        const response = await axios.get(
            `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${cleanOutTradeNo}`,
            {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
                    'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
                    'User-Agent': 'axios/1.9.0'
                }
            }
        );

        if (response.status === 200) {
            // 同时查询数据库中的订单信息
            const [orders] = await db.query(
                'SELECT * FROM orders WHERE out_trade_no = ?',
                [cleanOutTradeNo]
            );

            if (orders.length === 0) {
                return res.status(404).json({ error: '订单不存在' });
            }

            const order = orders[0];

            // 查询订单项
            const [orderItems] = await db.query(
                `SELECT oi.*, r.title, r.price, r.original_price, r.description, r.status, r.remaining_count
           FROM order_items oi
           JOIN rights r ON oi.right_id = r.id
           WHERE oi.order_id = ?`,
                [order.id]
            );

            // 查询订单图片
            const orderItemsWithImages = await Promise.all(orderItems.map(async (item) => {
                const [images] = await db.query(
                    'SELECT image_url FROM right_images WHERE right_id = ?',
                    [item.right_id]
                );
                return {
                    ...item,
                    images: images.map(img => img.image_url || '')
                };
            }));

            res.json({
                success: true,
                data: {
                    ...response.data,
                    order_info: {
                        ...order,
                        items: orderItemsWithImages
                    }
                }
            });
        } else {
            res.status(400).json({
                success: false,
                error: '查询订单失败'
            });
        }
    } catch (error) {
        console.error('查询订单失败:', error);
        res.status(500).json({
            success: false,
            error: '查询订单失败'
        });
    }
});

// 根据用户ID查询订单列表接口
router.get('/orders', authenticateToken, async (req, res) => {
    try {
        const {
            user_id,
            status,
            type,
            page = 1,
            limit = 10
        } = req.query;

        // 订单状态分类函数
        const getOrderStatusType = (tradeState) => {
            switch (tradeState) {
                case 'NOTPAY':
                case 'PAYERROR':
                    return 'pending';
                case 'SUCCESS':
                    return 'completed';
                case 'CLOSED':
                case 'REVOKED':
                    return 'cancelled';
                case 'REFUND':
                    return 'refunded';
                default:
                    return 'unknown';
            }
        };

        const getOrderStatusText = (tradeState) => {
            switch (tradeState) {
                case 'NOTPAY':
                    return '待付款';
                case 'PAYERROR':
                    return '支付失败';
                case 'SUCCESS':
                    return '已完成';
                case 'CLOSED':
                    return '已关闭';
                case 'REVOKED':
                    return '已撤销';
                case 'REFUND':
                    return '已退款';
                default:
                    return '未知状态';
            }
        };

        // 输入验证
        if (!user_id || isNaN(parseInt(user_id)) || parseInt(user_id) <= 0) {
            return res.status(400).json({ error: '缺少有效的用户ID' });
        }
        
        if (page && (isNaN(parseInt(page)) || parseInt(page) <= 0)) {
            return res.status(400).json({ error: '页码必须是正整数' });
        }
        
        if (limit && (isNaN(parseInt(limit)) || parseInt(limit) <= 0 || parseInt(limit) > 100)) {
            return res.status(400).json({ error: '每页数量必须在1-100之间' });
        }
        
        // 定义有效的订单状态类型
        const validStatusTypes = ['all', 'pending', 'completed', 'cancelled', 'refunded'];
        
        if (status && !validStatusTypes.includes(status)) {
            return res.status(400).json({ error: '无效的订单状态类型，支持的类型：all, pending, completed, cancelled, refunded' });
        }
        
        // 清理输入
        const cleanUserId = parseInt(user_id);
        const cleanPage = parseInt(page);
        const cleanLimit = parseInt(limit);
        const cleanStatus = status ? status.trim() : null;

        // 查询用户是否存在
        const [users] = await db.query(
            'SELECT * FROM wx_users WHERE id = ?',
            [cleanUserId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 构建查询条件
        let query = 'SELECT * FROM orders WHERE user_id = ?';
        let countQuery = 'SELECT COUNT(*) as total FROM orders WHERE user_id = ?';
        let params = [cleanUserId];
        let countParams = [cleanUserId];

        // 根据状态类型映射到实际的微信支付状态
        if (cleanStatus && cleanStatus !== 'all') {
            let statusCondition = '';
            switch (cleanStatus) {
                case 'pending':
                    // 待付款：NOTPAY, PAYERROR
                    statusCondition = 'AND trade_state IN ("NOTPAY", "PAYERROR")';
                    break;
                case 'completed':
                    // 已完成：SUCCESS
                    statusCondition = 'AND trade_state = "SUCCESS"';
                    break;
                case 'cancelled':
                    // 已取消：CLOSED, REVOKED，或者 trade_state, trade_state_desc, trade_type 都为 null
                    statusCondition = 'AND (trade_state IN ("CLOSED", "REVOKED") OR (trade_state IS NULL AND trade_state_desc IS NULL AND trade_type IS NULL))';
                    break;
                case 'refunded':
                    // 已退款：REFUND
                    statusCondition = 'AND trade_state = "REFUND"';
                    break;
                default:
                    break;
            }
            
            if (statusCondition) {
                query += ' ' + statusCondition;
                countQuery += ' ' + statusCondition;
            }
        }

        // 添加排序和分页
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        const offset = (cleanPage - 1) * cleanLimit;
        params.push(cleanLimit, offset);

        // 执行查询
        const [orders] = await db.query(query, params);
        const [[{ total }]] = await db.query(countQuery, countParams);

        // 查询每个订单的订单项
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
            // 查询订单项 - 优化查询，避免复杂CASE WHEN
            const [orderItems] = await db.query(`
                SELECT 
                    oi.id,
                    oi.type,
                    oi.right_id,
                    oi.digital_artwork_id,
                    oi.artwork_id,
                    oi.quantity,
                    oi.price,
                    r.title as right_title,
                    r.price as right_price,
                    r.original_price as right_original_price,
                    r.description as right_description,
                    r.status as right_status,
                    r.remaining_count as right_remaining_count,
                    ri.image_url as right_image_url,
                    da.title as digital_title,
                    da.price as digital_price,
                    da.description as digital_description,
                    da.image_url as digital_image_url,
                    oa.title as artwork_title,
                    oa.original_price as artwork_original_price,
                    oa.discount_price as artwork_discount_price,
                    oa.description as artwork_description,
                    oa.image as artwork_image
                FROM order_items oi
                LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
                LEFT JOIN right_images ri ON oi.type = 'right' AND oi.right_id = ri.right_id
                LEFT JOIN digital_artworks da ON oi.type = 'digital' AND oi.digital_artwork_id = da.id
                LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
                WHERE oi.order_id = ?
            `, [order.id]);

            // 处理订单项数据
            const orderItemsWithImages = orderItems.map(item => {
                let processedItem = {
                    id: item.id,
                    type: item.type,
                    quantity: item.quantity,
                    price: item.price
                };

                // 根据类型设置相应的字段
                if (item.type === 'right') {
                    processedItem = {
                        ...processedItem,
                        title: item.right_title,
                        original_price: item.right_original_price,
                        description: item.right_description,
                        status: item.right_status,
                        remaining_count: item.right_remaining_count,
                        images: item.right_image_url ? [item.right_image_url] : []
                    };
                } else if (item.type === 'digital') {
                    processedItem = {
                        ...processedItem,
                        title: item.digital_title,
                        description: item.digital_description,
                        images: item.digital_image_url ? [item.digital_image_url] : []
                    };
                } else if (item.type === 'artwork') {
                    processedItem = {
                        ...processedItem,
                        title: item.artwork_title,
                        original_price: item.artwork_original_price,
                        discount_price: item.artwork_discount_price,
                        description: item.artwork_description,
                        images: item.artwork_image ? [item.artwork_image] : []
                    };
                }

                return processedItem;
            });

            // 查询微信支付订单状态
            try {
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const nonceStr = generateNonceStr();
                const method = 'GET';
                const url = `/v3/pay/transactions/out-trade-no/${order.out_trade_no}?mchid=${WX_PAY_CONFIG.mchId}`;
                const body = '';
                const signature = generateSignV3(method, url, timestamp, nonceStr, body);

                const response = await axios.get(
                    `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${order.out_trade_no}?mchid=${WX_PAY_CONFIG.mchId}`,
                    {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
                            'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
                            'User-Agent': 'axios/1.9.0'
                        }
                    }
                );

                const wxPayData = response.data;

                return {
                    ...order,
                    items: orderItemsWithImages,
                    order_status: {
                        type: getOrderStatusType(wxPayData.trade_state || order.trade_state),
                        text: getOrderStatusText(wxPayData.trade_state || order.trade_state)
                    },
                    pay_status: {
                        trade_state: wxPayData.trade_state || 'UNKNOWN',
                        trade_state_desc: wxPayData.trade_state_desc || '未知状态',
                        success_time: wxPayData.success_time || null,
                        amount: wxPayData.amount ? {
                            total: wxPayData.amount.total,
                            currency: wxPayData.amount.currency
                        } : null,
                        transaction_id: wxPayData.transaction_id || null
                    }
                };
            } catch (error) {
                console.error('查询微信支付状态失败:', error.response?.data || error.message);
                
                // 如果查询微信支付状态失败，返回数据库中的订单信息
                return {
                    ...order,
                    items: orderItemsWithImages,
                    order_status: {
                        type: getOrderStatusType(order.trade_state),
                        text: getOrderStatusText(order.trade_state)
                    },
                    pay_status: {
                        trade_state: order.trade_state || 'UNKNOWN',
                        trade_state_desc: order.trade_state_desc || '支付状态查询失败',
                        success_time: order.success_time || null,
                        amount: order.total_fee ? {
                            total: order.total_fee,
                            currency: 'CNY'
                        } : null,
                        transaction_id: order.transaction_id || null
                    }
                };
            }
        }));

        // 查询各状态订单数量统计
        const [statusStats] = await db.query(`
            SELECT 
                SUM(CASE WHEN trade_state IN ('NOTPAY', 'PAYERROR') THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN trade_state = 'SUCCESS' THEN 1 ELSE 0 END) as completed_count,
                SUM(CASE WHEN trade_state IN ('CLOSED', 'REVOKED') OR (trade_state IS NULL AND trade_state_desc IS NULL AND trade_type IS NULL) THEN 1 ELSE 0 END) as cancelled_count,
                SUM(CASE WHEN trade_state = 'REFUND' THEN 1 ELSE 0 END) as refunded_count,
                COUNT(*) as total_count
            FROM orders 
            WHERE user_id = ?
        `, [cleanUserId]);

        res.json({
            success: true,
            data: {
                orders: ordersWithItems,
                pagination: {
                    total: parseInt(total),
                    page: cleanPage,
                    limit: cleanLimit
                },
                statistics: {
                    pending: statusStats[0]?.pending_count || 0,
                    completed: statusStats[0]?.completed_count || 0,
                    cancelled: statusStats[0]?.cancelled_count || 0,
                    refunded: statusStats[0]?.refunded_count || 0,
                    total: statusStats[0]?.total_count || 0
                }
            }
        });
    } catch (error) {
        console.error('查询订单列表失败:', error);
        res.status(500).json({
            success: false,
            error: '查询订单列表失败'
        });
    }
});

// 记录数字身份购买
router.post('/digital-identity/purchase', async (req, res) => {
    try {
        const { user_id, digital_artwork_id, discount_amount } = req.body;

        // 输入验证
        if (!user_id || isNaN(parseInt(user_id)) || parseInt(user_id) <= 0) {
            return res.status(400).json({ error: '缺少有效的用户ID' });
        }
        
        if (!digital_artwork_id || isNaN(parseInt(digital_artwork_id)) || parseInt(digital_artwork_id) <= 0) {
            return res.status(400).json({ error: '缺少有效的数字艺术品ID' });
        }
        
        if (!discount_amount || isNaN(parseFloat(discount_amount)) || parseFloat(discount_amount) < 0) {
            return res.status(400).json({ error: '缺少有效的抵扣金额' });
        }
        
        // 清理输入
        const cleanUserId = parseInt(user_id);
        const cleanDigitalArtworkId = parseInt(digital_artwork_id);
        const cleanDiscountAmount = parseFloat(discount_amount);

        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 检查用户是否存在
            const [users] = await connection.query(
                'SELECT id FROM wx_users WHERE id = ?',
                [cleanUserId]
            );

            if (!users || users.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '用户不存在' });
            }

            // 检查数字艺术品是否存在
            const [artworks] = await connection.query(
                'SELECT id FROM digital_artworks WHERE id = ?',
                [cleanDigitalArtworkId]
            );

            if (!artworks || artworks.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '数字艺术品不存在' });
            }

            // 记录购买
            await connection.query(
                'INSERT INTO digital_identity_purchases (user_id, digital_artwork_id, discount_amount) VALUES (?, ?, ?)',
                [cleanUserId, cleanDigitalArtworkId, cleanDiscountAmount]
            );

            await connection.commit();
            res.json({ message: '购买记录创建成功' });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('记录数字身份购买失败:', error);
        res.status(500).json({ error: '记录数字身份购买失败' });
    }
});

// 获取用户的数字身份购买记录
router.get('/digital-identity/purchases/:user_id', async (req, res) => {
    try {
        // 输入验证
        const userId = req.params.user_id;
        if (!userId || isNaN(parseInt(userId)) || parseInt(userId) <= 0) {
            return res.status(400).json({ error: '无效的用户ID' });
        }
        
        const cleanUserId = parseInt(userId);
        
        const [purchases] = await db.query(`
            SELECT 
                dip.id,
                dip.user_id,
                dip.digital_artwork_id,
                dip.discount_amount,
                dip.purchase_date,
                da.title as artwork_title,
                da.image_url as artwork_image
            FROM digital_identity_purchases dip
            JOIN digital_artworks da ON dip.digital_artwork_id = da.id
            WHERE dip.user_id = ?
            ORDER BY dip.purchase_date DESC
        `, [cleanUserId]);

        res.json(purchases);
    } catch (error) {
        console.error('获取数字身份购买记录失败:', error);
        res.status(500).json({ error: '获取数字身份购买记录失败' });
    }
});

// 管理员查询所有订单接口
router.get('/admin/orders', authenticateToken, async (req, res) => {
    try {
        const {
            status,
            type,
            page = 1,
            limit = 20
        } = req.query;
        
        if (page && (isNaN(parseInt(page)) || parseInt(page) <= 0)) {
            return res.status(400).json({ error: '页码必须是正整数' });
        }
        
        if (limit && (isNaN(parseInt(limit)) || parseInt(limit) <= 0 || parseInt(limit) > 100)) {
            return res.status(400).json({ error: '每页数量必须在1-100之间' });
        }
        
        if (status && !['SUCCESS', 'REFUND', 'CLOSED', 'REVOKED', 'PAYERROR', 'NOTPAY'].includes(status)) {
            return res.status(400).json({ error: '无效的订单状态' });
        }
        
        // 清理输入
        const cleanPage = parseInt(page);
        const cleanLimit = parseInt(limit);
        const cleanStatus = status ? status.trim() : null;

        // 构建查询条件
        let query = `
            SELECT o.*, u.nickname as user_nickname, u.avatar as user_avatar
            FROM orders o
            LEFT JOIN wx_users u ON o.user_id = u.id
        `;
        let countQuery = 'SELECT COUNT(*) as total FROM orders o';
        let params = [];
        let countParams = [];

        // 添加状态筛选
        if (cleanStatus) {
            query += ' WHERE o.trade_state = ?';
            countQuery += ' WHERE o.trade_state = ?';
            params.push(cleanStatus);
            countParams.push(cleanStatus);
        }

        // 添加排序和分页
        query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
        const offset = (cleanPage - 1) * cleanLimit;
        params.push(cleanLimit, offset);

        // 执行查询
        const [orders] = await db.query(query, params);
        const [[{ total }]] = await db.query(countQuery, countParams);

        // 查询每个订单的订单项
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
            // 查询订单项
            const [orderItems] = await db.query(`
                SELECT 
                    oi.id,
                    oi.type,
                    oi.right_id,
                    oi.digital_artwork_id,
                    oi.artwork_id,
                    oi.quantity,
                    oi.price,
                    r.title as right_title,
                    r.price as right_price,
                    r.original_price as right_original_price,
                    r.description as right_description,
                    r.status as right_status,
                    r.remaining_count as right_remaining_count,
                    ri.image_url as right_image_url,
                    da.title as digital_title,
                    da.price as digital_price,
                    da.description as digital_description,
                    da.image_url as digital_image_url,
                    oa.title as artwork_title,
                    oa.original_price as artwork_original_price,
                    oa.discount_price as artwork_discount_price,
                    oa.description as artwork_description,
                    oa.image as artwork_image
                FROM order_items oi
                LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
                LEFT JOIN right_images ri ON oi.type = 'right' AND oi.right_id = ri.right_id
                LEFT JOIN digital_artworks da ON oi.type = 'digital' AND oi.digital_artwork_id = da.id
                LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
                WHERE oi.order_id = ?
            `, [order.id]);

            // 处理订单项数据
            const orderItemsWithImages = orderItems.map(item => {
                let processedItem = {
                    id: item.id,
                    type: item.type,
                    quantity: item.quantity,
                    price: item.price
                };

                // 根据类型设置相应的字段
                if (item.type === 'right') {
                    processedItem = {
                        ...processedItem,
                        title: item.right_title,
                        original_price: item.right_original_price,
                        description: item.right_description,
                        status: item.right_status,
                        remaining_count: item.right_remaining_count,
                        images: item.right_image_url ? [item.right_image_url] : []
                    };
                } else if (item.type === 'digital') {
                    processedItem = {
                        ...processedItem,
                        title: item.digital_title,
                        description: item.digital_description,
                        images: item.digital_image_url ? [item.digital_image_url] : []
                    };
                } else if (item.type === 'artwork') {
                    processedItem = {
                        ...processedItem,
                        title: item.artwork_title,
                        original_price: item.artwork_original_price,
                        discount_price: item.artwork_discount_price,
                        description: item.artwork_description,
                        images: item.artwork_image ? [item.artwork_image] : []
                    };
                }

                return processedItem;
            });

            // 查询微信支付订单状态
            try {
                const timestamp = Math.floor(Date.now() / 1000).toString();
                const nonceStr = generateNonceStr();
                const method = 'GET';
                const url = `/v3/pay/transactions/out-trade-no/${order.out_trade_no}?mchid=${WX_PAY_CONFIG.mchId}`;
                const body = '';
                const signature = generateSignV3(method, url, timestamp, nonceStr, body);

                const response = await axios.get(
                    `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${order.out_trade_no}?mchid=${WX_PAY_CONFIG.mchId}`,
                    {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
                            'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
                            'User-Agent': 'axios/1.9.0'
                        }
                    }
                );

                const wxPayData = response.data;
                return {
                    ...order,
                    items: orderItemsWithImages,
                    pay_status: {
                        trade_state: wxPayData.trade_state || 'UNKNOWN',
                        trade_state_desc: wxPayData.trade_state_desc || '未知状态',
                        success_time: wxPayData.success_time || null,
                        amount: wxPayData.amount ? {
                            total: wxPayData.amount.total,
                            currency: wxPayData.amount.currency
                        } : null,
                        transaction_id: wxPayData.transaction_id || null
                    }
                };
            } catch (error) {
                console.error('查询微信支付状态失败:', error.response?.data || error.message);
                // 如果查询微信支付状态失败，返回数据库中的订单信息
                return {
                    ...order,
                    items: orderItemsWithImages,
                    pay_status: {
                        trade_state: order.trade_state || 'UNKNOWN',
                        trade_state_desc: order.trade_state_desc || '支付状态查询失败',
                        success_time: order.success_time || null,
                        amount: order.total_fee ? {
                            total: order.total_fee,
                            currency: 'CNY'
                        } : null,
                        transaction_id: order.transaction_id || null
                    }
                };
            }
        }));

        res.json({
            success: true,
            data: {
                orders: ordersWithItems,
                pagination: {
                    total: parseInt(total),
                    page: cleanPage,
                    limit: cleanLimit
                }
            }
        });
    } catch (error) {
        console.error('管理员查询订单列表失败:', error);
        res.status(500).json({
            success: false,
            error: '管理员查询订单列表失败'
        });
    }
});


module.exports = router; 