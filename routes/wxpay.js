const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const jwt = require('jsonwebtoken');

// 微信支付V3配置
const WX_PAY_CONFIG = {
    appId: 'wx96a502c78c9156d0', // 小程序appid
    mchId: '1360639602', // 商户号
    key: 'e0v3TF5sgZS82fk1ylb4oNqczZbKqeYk', // API密钥
    serialNo: '34DF8EA1B52AD35997FF23DFAD7940574A1D6857', // 商户证书序列号
    privateKey: fs.readFileSync(path.join(__dirname, '../apiclient_key.pem')), // 商户私钥
    notifyUrl: 'https://api.wx.2000gallery.art:2000/api/wx/pay/notify', // 支付回调地址
    spbillCreateIp: '127.0.0.1' // 终端IP
};

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

// 验证签名
function verifySignV3(timestamp, nonceStr, body, signature) {
    const message = `${timestamp}\n${nonceStr}\n${body}\n`;
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(message);
    return verify.verify(WX_PAY_CONFIG.privateKey, signature, 'base64');
}

// 解密回调数据
function decryptCallbackData(associatedData, nonce, ciphertext) {
    const key = Buffer.from(WX_PAY_CONFIG.key, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64'));
    decipher.setAuthTag(Buffer.from(associatedData, 'base64'));
    let decrypted = decipher.update(Buffer.from(ciphertext, 'base64'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
}

// 统一下单接口
router.post('/unifiedorder', async (req, res) => {
    try {
        const { openid, total_fee, body, out_trade_no, cart_items } = req.body;

        if (!openid || !total_fee || !body || !out_trade_no || !cart_items) {
            return res.status(400).json({ error: '参数不完整' });
        }

        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 根据openid获取用户id
            const [users] = await connection.query(
                'SELECT id FROM wx_users WHERE openid = ?',
                [openid]
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

            // 校验所有商品
            for (const item of cart_items) {
                if (item.type === 'right') {
                    const [rights] = await connection.query(
                        'SELECT id, price, remaining_count, discount_amount FROM rights WHERE id = ? AND status = "onsale"',
                        [item.right_id]
                    );
                    if (!rights || rights.length === 0) {
                        await connection.rollback();
                        return res.status(404).json({ error: `商品ID ${item.right_id} 不存在或已下架` });
                    }
                    if (rights[0].remaining_count < item.quantity) {
                        await connection.rollback();
                        return res.status(400).json({ error: `商品ID ${item.right_id} 库存不足` });
                    }
                    // 验证价格
                    const itemPrice = parseFloat(item.price);
                    const dbPrice = parseFloat(rights[0].price);
                    if (Math.abs(itemPrice - dbPrice) > 0.01) {
                        await connection.rollback();
                        return res.status(400).json({
                            error: `商品ID ${item.right_id} 价格不匹配`,
                            detail: {
                                expected: dbPrice,
                                received: itemPrice
                            }
                        });
                    }
                } else if (item.type === 'artwork') {
                    const [artworks] = await connection.query(
                        'SELECT id, original_price, discount_price, stock FROM original_artworks WHERE id = ? AND is_on_sale = 1',
                        [item.artwork_id]
                    );
                    if (!artworks || artworks.length === 0) {
                        await connection.rollback();
                        return res.status(404).json({ error: `艺术品ID ${item.artwork_id} 不存在或已下架` });
                    }
                    if (artworks[0].stock < item.quantity) {
                        await connection.rollback();
                        return res.status(400).json({ error: `艺术品ID ${item.artwork_id} 库存不足` });
                    }
                    // 验证价格
                    const itemPrice = parseFloat(item.price);
                    const actualPrice = (artworks[0].discount_price && artworks[0].discount_price > 0 && artworks[0].discount_price < artworks[0].original_price)
                        ? artworks[0].discount_price
                        : artworks[0].original_price;
                    if (Math.abs(itemPrice - actualPrice) > 0.01) {
                        await connection.rollback();
                        return res.status(400).json({
                            error: `艺术品ID ${item.artwork_id} 价格不匹配`,
                            detail: {
                                expected: actualPrice,
                                received: itemPrice
                            }
                        });
                    }
                } else if (item.type === 'digital') {
                    const [digitals] = await connection.query(
                        'SELECT id, price FROM digital_artworks WHERE id = ?',
                        [item.digital_artwork_id]
                    );
                    if (!digitals || digitals.length === 0) {
                        await connection.rollback();
                        return res.status(404).json({ error: `数字艺术品ID ${item.digital_artwork_id} 不存在` });
                    }
                    // 验证价格
                    const itemPrice = parseFloat(item.price);
                    const dbPrice = parseFloat(digitals[0].price);
                    if (Math.abs(itemPrice - dbPrice) > 0.01) {
                        await connection.rollback();
                        return res.status(400).json({
                            error: `数字艺术品ID ${item.digital_artwork_id} 价格不匹配`,
                            detail: {
                                expected: dbPrice,
                                received: itemPrice
                            }
                        });
                    }
                } else {
                    await connection.rollback();
                    return res.status(400).json({ error: `不支持的商品类型: ${item.type}` });
                }
            }

            // 计算实际支付金额（考虑抵扣）
            const actualTotalFee = Math.max(0, total_fee - availableDiscount);

            // 创建订单
            const [orderResult] = await connection.query(
                'INSERT INTO orders (user_id, out_trade_no, total_fee, actual_fee, discount_amount, body) VALUES (?, ?, ?, ?, ?, ?)',
                [userId, out_trade_no, total_fee, actualTotalFee, availableDiscount, body]
            );

            const orderId = orderResult.insertId;

            // 创建订单项，支持三种类型
            const orderItems = cart_items.map(item => {
                if (item.type === 'right') {
                    return [orderId, 'right', item.right_id, null, null, item.quantity, parseFloat(item.price)];
                } else if (item.type === 'digital') {
                    return [orderId, 'digital', null, item.digital_artwork_id, null, item.quantity, parseFloat(item.price)];
                } else if (item.type === 'artwork') {
                    return [orderId, 'artwork', null, null, item.artwork_id, item.quantity, parseFloat(item.price)];
                }
            });
            await connection.query(
                'INSERT INTO order_items (order_id, type, right_id, digital_artwork_id, artwork_id, quantity, price) VALUES ?',
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
                description: body,
                out_trade_no: out_trade_no,
                notify_url: WX_PAY_CONFIG.notifyUrl,
                amount: {
                    total: actualTotalFee,
                    currency: 'CNY'
                },
                scene_info: {
                    payer_client_ip: WX_PAY_CONFIG.spbillCreateIp
                },
                payer: {
                    openid: openid
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
            error: '统一下单失败',
            detail: error.message
        });
    }
});

// 支付回调接口
router.post('/notify', async (req, res) => {
    try {
        // 获取回调数据
        const {
            id, // 通知ID
            create_time, // 通知创建时间
            event_type, // 通知类型
            resource_type, // 通知数据类型
            resource, // 通知数据
            summary // 回调摘要
        } = req.body;

        // 验证签名
        const timestamp = req.headers['wechatpay-timestamp'];
        const nonce = req.headers['wechatpay-nonce'];
        const signature = req.headers['wechatpay-signature'];
        const serial = req.headers['wechatpay-serial'];

        if (!verifySignV3(timestamp, nonce, JSON.stringify(req.body), signature)) {
            return res.status(401).json({
                code: 'FAIL',
                message: '签名验证失败'
            });
        }

        // 解密回调数据
        const decryptedData = decryptCallbackData(
            resource.associated_data,
            resource.nonce,
            resource.ciphertext
        );

        const callbackData = JSON.parse(decryptedData);

        // 处理支付结果
        if (callbackData.trade_state === 'SUCCESS') {
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
                // 更新订单状态
                await connection.query(
                    `UPDATE orders SET 
              transaction_id = ?,
              trade_type = ?,
              trade_state = ?,
              trade_state_desc = ?,
              success_time = ?
            WHERE out_trade_no = ?`,
                    [transaction_id, trade_type, trade_state, trade_state_desc, success_time, out_trade_no]
                );

                // 获取订单项
                const [orderItems] = await connection.query(
                    'SELECT * FROM order_items WHERE order_id = (SELECT id FROM orders WHERE out_trade_no = ?)',
                    [out_trade_no]
                );

                // 更新商品库存
                for (const item of orderItems) {
                    await connection.query(
                        'UPDATE rights SET remaining_count = remaining_count - ? WHERE id = ?',
                        [item.quantity, item.right_id]
                    );
                }

                await connection.commit();
                res.json({
                    code: 'SUCCESS',
                    message: 'OK'
                });
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }
        } else {
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

        if (!out_trade_no) {
            return res.status(400).json({ error: '缺少商户订单号' });
        }

        // 构建请求参数
        const params = {
            mchid: WX_PAY_CONFIG.mchId
        };

        // 生成签名所需的参数
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const method = 'POST';
        const url = `/v3/pay/transactions/out-trade-no/${out_trade_no}/close`;
        const bodyStr = JSON.stringify(params);

        // 生成签名
        const signature = generateSignV3(method, url, timestamp, nonceStr, bodyStr);

        // 发送请求到微信支付
        const response = await axios.post(
            `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${out_trade_no}/close`,
            params,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
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
        if (error.response) {
            res.status(error.response.status).json({
                success: false,
                error: error.response.data.message || '关闭订单失败'
            });
        } else {
            res.status(500).json({
                success: false,
                error: '关闭订单失败'
            });
        }
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
            notify_url,    // 退款结果回调url
            funds_account, // 退款资金来源
            amount         // 金额信息
        } = req.body;

        // 参数验证
        if (!out_refund_no || !amount || !amount.refund || !amount.total || !amount.currency) {
            return res.status(400).json({ error: '参数不完整' });
        }

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
                    out_refund_no,
                    transaction_id,
                    reason,
                    JSON.stringify(amount)
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
            error: '申请退款失败',
            detail: error.message
        });
    }
});

// 审批退款接口
router.post('/refund/approve', async (req, res) => {
    try {
        const { refund_id, approve, reject_reason } = req.body;

        if (!refund_id) {
            return res.status(400).json({ error: '缺少退款ID' });
        }

        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 获取退款申请信息
            const [refunds] = await connection.query(
                'SELECT * FROM refund_requests WHERE id = ? AND status = "PENDING"',
                [refund_id]
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
                    [refund_id]
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
                    notify_url: WX_PAY_CONFIG.notifyUrl + '/refund',
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
                            'User-Agent': 'axios/1.9.0'
                        }
                    }
                );

                if (response.status === 200) {
                    // 更新退款申请状态为处理中
                    await connection.query(
                        'UPDATE refund_requests SET status = "PROCESSING", wx_refund_id = ? WHERE id = ?',
                        [response.data.refund_id, refund_id]
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
                if (!reject_reason) {
                    await connection.rollback();
                    return res.status(400).json({ error: '拒绝退款必须提供原因' });
                }

                await connection.query(
                    'UPDATE refund_requests SET status = "REJECTED", reject_reason = ?, rejected_at = NOW() WHERE id = ?',
                    [reject_reason, refund_id]
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
            error: '处理退款申请失败',
            detail: error.message
        });
    }
});

// 获取退款申请列表
router.get('/refund/requests', async (req, res) => {
    try {
        const { status, page = 1, limit = 10 } = req.query;

        const offset = (page - 1) * limit;

        // 构建查询条件
        let query = 'SELECT * FROM refund_requests';
        let countQuery = 'SELECT COUNT(*) as total FROM refund_requests';
        let params = [];

        if (status) {
            query += ' WHERE status = ?';
            countQuery += ' WHERE status = ?';
            params.push(status);
        }

        // 添加排序和分页
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        // 执行查询
        const [refunds] = await db.query(query, params);
        const [[{ total }]] = await db.query(countQuery, status ? [status] : []);

        // 确保amount字段是有效的JSON字符串
        const formattedRefunds = refunds.map(refund => ({
            ...refund,
            amount: typeof refund.amount === 'string' ? refund.amount : JSON.stringify(refund.amount)
        }));

        res.json({
            success: true,
            data: formattedRefunds,
            total: parseInt(total),
            page: parseInt(page),
            limit: parseInt(limit)
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
        const [refunds] = await db.query(
            'SELECT * FROM refund_requests WHERE id = ?',
            [req.params.id]
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
        // 获取回调数据
        const {
            id, // 通知ID
            create_time, // 通知创建时间
            event_type, // 通知类型
            resource_type, // 通知数据类型
            resource, // 通知数据
            summary // 回调摘要
        } = req.body;

        // 验证签名
        const timestamp = req.headers['wechatpay-timestamp'];
        const nonce = req.headers['wechatpay-nonce'];
        const signature = req.headers['wechatpay-signature'];
        const serial = req.headers['wechatpay-serial'];

        if (!verifySignV3(timestamp, nonce, JSON.stringify(req.body), signature)) {
            return res.status(401).json({
                code: 'FAIL',
                message: '签名验证失败'
            });
        }

        // 解密回调数据
        const decryptedData = decryptCallbackData(
            resource.associated_data,
            resource.nonce,
            resource.ciphertext
        );

        const callbackData = JSON.parse(decryptedData);

        // 处理退款结果
        if (callbackData.refund_status === 'SUCCESS') {
            const {
                out_refund_no, // 商户退款单号
                out_trade_no, // 商户订单号
                refund_id, // 微信退款单号
                refund_status, // 退款状态
                success_time, // 退款成功时间
                amount // 金额信息
            } = callbackData;

            // TODO: 更新订单状态
            // 这里需要根据你的业务逻辑来处理退款状态更新
            // 例如：更新数据库中的订单状态为已退款

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

        if (!prepay_id) {
            return res.status(400).json({ error: '缺少prepay_id' });
        }

        // 构建签名参数
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const package = `prepay_id=${prepay_id}`;

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

        if (!out_trade_no) {
            return res.status(400).json({ error: '缺少商户订单号' });
        }

        // 生成签名所需的参数
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const method = 'GET';
        const url = `/v3/pay/transactions/out-trade-no/${out_trade_no}`;

        // 生成签名
        const signature = generateSignV3(method, url, timestamp, nonceStr, '');

        // 发送请求到微信支付
        const response = await axios.get(
            `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${out_trade_no}`,
            {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
                    'User-Agent': 'axios/1.9.0'
                }
            }
        );

        if (response.status === 200) {
            // 同时查询数据库中的订单信息
            const [orders] = await db.query(
                'SELECT * FROM orders WHERE out_trade_no = ?',
                [out_trade_no]
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
                    images: images.map(img =>
                        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
                    )
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
                error: '查询订单失败',
                detail: response.data
            });
        }
    } catch (error) {
        console.error('查询订单失败:', error);
        if (error.response) {
            res.status(error.response.status).json({
                success: false,
                error: '查询订单失败',
                detail: error.response.data
            });
        } else {
            res.status(500).json({
                success: false,
                error: '查询订单失败',
                detail: error.message
            });
        }
    }
});

// 根据用户ID查询订单列表接口
router.get('/orders', async (req, res) => {
    try {
        const {
            user_id,
            status,
            type,
            page = 1,
            limit = 10
        } = req.query;

        if (!user_id) {
            return res.status(400).json({ error: '缺少用户ID' });
        }

        // 查询用户是否存在
        const [users] = await db.query(
            'SELECT * FROM wx_users WHERE id = ?',
            [user_id]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        // 构建查询条件
        let query = 'SELECT * FROM orders WHERE user_id = ?';
        let countQuery = 'SELECT COUNT(*) as total FROM orders WHERE user_id = ?';
        let params = [user_id];
        let countParams = [user_id];

        if (status) {
            query += ' AND trade_state = ?';
            countQuery += ' AND trade_state = ?';
            params.push(status);
            countParams.push(status);
        }

        // 添加排序和分页
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        const offset = (page - 1) * limit;
        params.push(parseInt(limit), offset);

        // 执行查询
        const [orders] = await db.query(query, params);
        const [[{ total }]] = await db.query(countQuery, countParams);

        // 查询每个订单的订单项
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
            // 查询订单项
            let orderItemsQuery = `
          SELECT oi.*, 
            CASE 
              WHEN oi.type = 'right' THEN r.title
              WHEN oi.type = 'digital' THEN da.title
              WHEN oi.type = 'artwork' THEN oa.title
              ELSE NULL
            END as title,
            CASE 
              WHEN oi.type = 'right' THEN r.price
              WHEN oi.type = 'digital' THEN da.price
              WHEN oi.type = 'artwork' THEN oa.original_price
              ELSE NULL
            END as price,
            CASE 
              WHEN oi.type = 'right' THEN r.original_price
              WHEN oi.type = 'artwork' THEN oa.original_price
              ELSE NULL
            END as original_price,
            CASE 
              WHEN oi.type = 'right' THEN r.description
              WHEN oi.type = 'digital' THEN da.description
              WHEN oi.type = 'artwork' THEN oa.description
              ELSE NULL
            END as description,
            CASE 
              WHEN oi.type = 'right' THEN r.status
              ELSE NULL
            END as status,
            CASE 
              WHEN oi.type = 'right' THEN r.remaining_count
              ELSE NULL
            END as remaining_count,
            CASE
              WHEN oi.type = 'artwork' THEN oa.discount_price
              ELSE NULL
            END as discount_price,
            CASE 
              WHEN oi.type = 'digital' THEN da.image_url
              ELSE NULL
            END as digital_artwork_image_url,
            CASE 
              WHEN oi.type = 'artwork' THEN oa.image
              ELSE NULL
            END as original_artwork_image
          FROM order_items oi
          LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
          LEFT JOIN digital_artworks da ON oi.type = 'digital' AND oi.digital_artwork_id = da.id
          LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
          WHERE oi.order_id = ?
        `;

            const [orderItems] = await db.query(orderItemsQuery, [order.id]);

            // 查询订单项图片
            const orderItemsWithImages = await Promise.all(orderItems.map(async (item) => {
                let imagesQuery = '';
                let imageParams = [];

                switch (item.type) {
                    case 'right':
                        imagesQuery = 'SELECT image_url FROM right_images WHERE right_id = ?';
                        imageParams = [item.right_id];
                        break;
                    case 'digital':
                        // 数字艺术品直接使用digital_artwork_image_url
                        return {
                            ...item,
                            images: item.digital_artwork_image_url ? [item.digital_artwork_image_url] : []
                        };
                    case 'artwork':
                        // 原作商品直接使用original_artwork_image
                        return {
                            ...item,
                            images: item.original_artwork_image ? [item.original_artwork_image] : []
                        };
                    default:
                        return {
                            ...item,
                            images: []
                        };
                }

                const [images] = await db.query(imagesQuery, imageParams);
                return {
                    ...item,
                    images: images.map(img =>
                        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
                    )
                };
            }));

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
                    page: parseInt(page),
                    limit: parseInt(limit)
                }
            }
        });
    } catch (error) {
        console.error('查询订单列表失败:', error);
        if (error.response) {
            res.status(error.response.status).json({
                success: false,
                error: '查询订单列表失败',
                detail: error.response.data
            });
        } else {
            res.status(500).json({
                success: false,
                error: '查询订单列表失败',
                detail: error.message
            });
        }
    }
});

// 记录数字身份购买
router.post('/digital-identity/purchase', async (req, res) => {
    try {
        const { user_id, digital_artwork_id, discount_amount } = req.body;

        if (!user_id || !digital_artwork_id || !discount_amount) {
            return res.status(400).json({ error: '参数不完整' });
        }

        // 开始事务
        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            // 检查用户是否存在
            const [users] = await connection.query(
                'SELECT id FROM wx_users WHERE id = ?',
                [user_id]
            );

            if (!users || users.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '用户不存在' });
            }

            // 检查数字艺术品是否存在
            const [artworks] = await connection.query(
                'SELECT id FROM digital_artworks WHERE id = ?',
                [digital_artwork_id]
            );

            if (!artworks || artworks.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: '数字艺术品不存在' });
            }

            // 记录购买
            await connection.query(
                'INSERT INTO digital_identity_purchases (user_id, digital_artwork_id, discount_amount) VALUES (?, ?, ?)',
                [user_id, digital_artwork_id, discount_amount]
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
        const [purchases] = await db.query(`
        SELECT 
          dip.*,
          da.title as artwork_title,
          da.image_url as artwork_image
        FROM digital_identity_purchases dip
        JOIN digital_artworks da ON dip.digital_artwork_id = da.id
        WHERE dip.user_id = ?
        ORDER BY dip.purchase_date DESC
      `, [req.params.user_id]);

        res.json(purchases);
    } catch (error) {
        console.error('获取数字身份购买记录失败:', error);
        res.status(500).json({ error: '获取数字身份购买记录失败' });
    }
});


module.exports = router; 