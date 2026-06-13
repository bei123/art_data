const logger = require('../utils/logger');

function adminResult(status, body) {
    return { ok: status >= 200 && status < 400, status, body };
}
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const logisticsService = require('./logisticsService');
const { PUBLIC_API_BASE_URL } = require('../config/publicEnv');
const redisClient = require('../utils/redisClient');
const LOCK_EXPIRE = 30; // 30秒
const CALLBACK_EXPIRE = 600; // 10分钟
const { getWechatpayPublicKey } = require('../utils/wechatpayCerts');
const {
    assertWechatOutTradeNo,
    wechatPayOutTradeNoQueryUrl,
    wechatPayOutTradeNoCloseUrl,
} = require('../utils/safeOutboundUrl');
const { ensureOrderItemsQrCodeColumns } = require('../utils/orderItemsSchema');
const {
    DIGITAL_ITEM_JOIN_SQL,
    DIGITAL_ITEM_SELECT_SQL,
    parseDigitalArtworkId,
    fetchDigitalArtworkById,
    fetchDigitalArtworksByIds,
    hasEnoughDigitalStock,
    isDigitalArtworkPurchasable,
    adjustDigitalArtworkStock,
    ensureDigitalArtworkIdColumns,
    resolveSubmittedDigitalPriceYuan,
} = require('../utils/digitalArtworkResolver');
const { clearRightsInventoryCaches } = require('./rightsService');
const {
    fireSubscribeNotify,
    notifyOrderPaid,
    schedulePaymentPendingReminder,
    cancelPaymentPendingReminder,
    notifyOrderCancelled,
    notifyRefundSuccess,
    notifyVirtualDeliveryPreparing,
    notifyVirtualDeliveryShipped,
} = require('./subscribeMessageNotify');

const REDIS_PHYSICAL_CATEGORIES_LIST_KEY = 'physical_categories:list';
const REDIS_PAY_INVENTORY_FULFILLED_PREFIX = 'pay:inventory:fulfilled:';
const REDIS_REFUND_INVENTORY_RESTORED_PREFIX = 'refund:inventory:restored:';
const INVENTORY_FLAG_EXPIRE_SEC = 60 * 60 * 24 * 90;

async function loadOrderItemsForInventory(outTradeNo, connection = null) {
    const runner = connection || db;
    const [orderItems] = await runner.query(`
        SELECT oi.type, oi.quantity, oi.right_id, oi.artwork_id, oi.digital_artwork_id, oi.order_id
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.out_trade_no = ?
    `, [outTradeNo]);
    return orderItems || [];
}

async function applyOrderItemsInventoryDelta({ orderItems, mode, connection = null }) {
    const runner = connection || db;
    const rightIds = [];
    const artworkIds = [];
    const digitalIds = [];

    for (const item of orderItems) {
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) continue;

        if (item.type === 'right' && item.right_id) {
            if (mode === 'deduct') {
                await runner.query(
                    'UPDATE rights SET remaining_count = GREATEST(remaining_count - ?, 0) WHERE id = ?',
                    [qty, item.right_id]
                );
            } else {
                await runner.query(
                    'UPDATE rights SET remaining_count = remaining_count + ? WHERE id = ?',
                    [qty, item.right_id]
                );
            }
            rightIds.push(item.right_id);
            continue;
        }

        if (item.type === 'artwork' && item.artwork_id) {
            if (mode === 'deduct') {
                await runner.query(
                    'UPDATE original_artworks SET stock = GREATEST(stock - ?, 0) WHERE id = ?',
                    [qty, item.artwork_id]
                );
            } else {
                await runner.query(
                    'UPDATE original_artworks SET stock = stock + ? WHERE id = ?',
                    [qty, item.artwork_id]
                );
            }
            artworkIds.push(item.artwork_id);
            continue;
        }

        if (item.type === 'digital' && item.digital_artwork_id) {
            await adjustDigitalArtworkStock({
                connection,
                id: item.digital_artwork_id,
                delta: mode === 'deduct' ? -qty : qty,
            });
            digitalIds.push(item.digital_artwork_id);
        }
    }

    return { rightIds, artworkIds, digitalIds };
}

async function recordDigitalIdentityPurchases({ outTradeNo, userId, orderItems, connection = null }) {
    const runner = connection || db;
    const digitalItems = (orderItems || []).filter((item) => item.type === 'digital');
    if (!digitalItems.length || !userId) return;

    for (const item of digitalItems) {
        await runner.query(
            'INSERT INTO digital_identity_purchases (user_id, digital_artwork_id, discount_amount, purchase_date, order_id) VALUES (?, ?, ?, NOW(), ?)',
            [userId, item.digital_artwork_id, 0, item.order_id]
        );
    }
}

async function removeDigitalIdentityPurchasesByOrderIds(orderIds, connection = null) {
    if (!orderIds?.length) return;
    const runner = connection || db;
    await runner.query('DELETE FROM digital_identity_purchases WHERE order_id IN (?)', [orderIds]);
}

async function clearInventoryRelatedCaches({ rightIds = [], artworkIds = [], digitalIds = [] }) {
    await clearRightsInventoryCaches({ rightIds });
    if (artworkIds.length > 0) {
        await clearPhysicalCategoriesCache();
    }
    if (digitalIds.length > 0) {
        logger.info('digital inventory cache refresh skipped', { digitalIds });
    }
}

async function fulfillPaidOrderInventory(outTradeNo, options = {}) {
    const cleanOutTradeNo = String(outTradeNo || '').trim();
    if (!cleanOutTradeNo) return { skipped: true, reason: 'missing_out_trade_no' };

    const inventoryKey = `${REDIS_PAY_INVENTORY_FULFILLED_PREFIX}${cleanOutTradeNo}`;
    const alreadyFulfilled = await redisClient.get(inventoryKey);
    if (alreadyFulfilled) return { skipped: true, reason: 'already_fulfilled' };

    const ownsConnection = !options.connection;
    const connection = options.connection || await db.getConnection();

    try {
        if (ownsConnection) await connection.beginTransaction();

        const [orders] = await connection.query(
            'SELECT id, user_id, trade_state FROM orders WHERE out_trade_no = ? LIMIT 1',
            [cleanOutTradeNo]
        );
        if (!orders.length || orders[0].trade_state !== 'SUCCESS') {
            if (ownsConnection) await connection.rollback();
            return { skipped: true, reason: 'not_success' };
        }

        const orderItems = await loadOrderItemsForInventory(cleanOutTradeNo, connection);
        const affected = await applyOrderItemsInventoryDelta({ orderItems, mode: 'deduct', connection });
        await recordDigitalIdentityPurchases({
            outTradeNo: cleanOutTradeNo,
            userId: orders[0].user_id,
            orderItems,
            connection,
        });

        if (ownsConnection) await connection.commit();
        await redisClient.setEx(inventoryKey, INVENTORY_FLAG_EXPIRE_SEC, '1');
        await clearInventoryRelatedCaches(affected);
        return { ok: true, affected };
    } catch (error) {
        if (ownsConnection) await connection.rollback();
        logger.error('fulfillPaidOrderInventory failed', { err: error, out_trade_no: cleanOutTradeNo });
        throw error;
    } finally {
        if (ownsConnection) connection.release();
    }
}

async function emitPaymentSuccessSubscribeNotifies({ outTradeNo, transactionId, payTime }) {
    const cleanOutTradeNo = String(outTradeNo || '').trim();
    if (!cleanOutTradeNo) return { skipped: true, reason: 'missing_out_trade_no' };

    let paidResult;
    try {
        paidResult = await notifyOrderPaid({ outTradeNo: cleanOutTradeNo });
    } catch (err) {
        logger.warn('支付成功订阅消息异常', { outTradeNo: cleanOutTradeNo, err: err?.message || err });
        paidResult = { ok: false, error: err?.message || err };
    }

    if (paidResult?.skipped) {
        logger.info('支付成功订阅消息跳过', { outTradeNo: cleanOutTradeNo, reason: paidResult.reason });
    } else if (paidResult?.ok === false) {
        logger.warn('支付成功订阅消息未送达', {
            outTradeNo: cleanOutTradeNo,
            errcode: paidResult.error?.errcode,
            error: paidResult.error?.error || paidResult.error?.errmsg || paidResult.error,
        });
    } else {
        logger.info('支付成功订阅消息已发送', { outTradeNo: cleanOutTradeNo });
    }

    fireSubscribeNotify(
        notifyVirtualDeliveryPreparing({
            outTradeNo: cleanOutTradeNo,
            transactionId,
            payTime,
        }),
        'virtualDeliveryPreparing',
    );

    return paidResult;
}

async function restoreRefundedOrderInventory(outTradeNo, options = {}) {
    const cleanOutTradeNo = String(outTradeNo || '').trim();
    if (!cleanOutTradeNo) return { skipped: true, reason: 'missing_out_trade_no' };

    const inventoryKey = `${REDIS_REFUND_INVENTORY_RESTORED_PREFIX}${cleanOutTradeNo}`;
    const alreadyRestored = await redisClient.get(inventoryKey);
    if (alreadyRestored) return { skipped: true, reason: 'already_restored' };

    const ownsConnection = !options.connection;
    const connection = options.connection || await db.getConnection();

    try {
        if (ownsConnection) await connection.beginTransaction();

        const orderItems = await loadOrderItemsForInventory(cleanOutTradeNo, connection);
        const affected = await applyOrderItemsInventoryDelta({ orderItems, mode: 'restore', connection });

        const orderIds = [...new Set(orderItems.map((item) => item.order_id).filter(Boolean))];
        await removeDigitalIdentityPurchasesByOrderIds(orderIds, connection);

        if (ownsConnection) await connection.commit();
        await redisClient.setEx(inventoryKey, INVENTORY_FLAG_EXPIRE_SEC, '1');
        await clearInventoryRelatedCaches(affected);
        return { ok: true, affected };
    } catch (error) {
        if (ownsConnection) await connection.rollback();
        logger.error('restoreRefundedOrderInventory failed', { err: error, out_trade_no: cleanOutTradeNo });
        throw error;
    } finally {
        if (ownsConnection) connection.release();
    }
}

// 清理实物分类相关缓存
async function clearPhysicalCategoriesCache() {
    try {
        const n = await redisClient.scanDelByPattern(`${REDIS_PHYSICAL_CATEGORIES_LIST_KEY}*`);
        if (n > 0) logger.info(`Cleared ${n} physical categories cache keys (SCAN)`);
    } catch (error) {
        logger.error('Error clearing physical categories cache', { err: error });
    }
}


// 微信支付V3配置
const WX_PAY_CONFIG = {
    appId: process.env.WX_APPID, // 小程序appid
    mchId: process.env.WX_PAY_MCH_ID, // 商户号
    key: process.env.WX_PAY_KEY, // API密钥
    serialNo: process.env.WX_PAY_SERIAL_NO, // 商户证书序列号
    publicKeyId: process.env.WX_PUB_ID, // 微信支付公钥ID
    privateKey: fs.readFileSync(path.join(__dirname, '../ssl/apiclient_key.pem')), // 商户私钥
    notifyUrl: `${PUBLIC_API_BASE_URL}/api/wx/pay/notify`, // 支付回调地址
    notify_url: `${PUBLIC_API_BASE_URL}/api/wx/pay/refund/notify`, // 退款回调地址

    spbillCreateIp: '127.0.0.1' // 终端IP
};
// 检查必要的环境变量
if (!WX_PAY_CONFIG.key) {
    logger.error('错误: 缺少必要的环境变量 WX_PAY_KEY');
    process.exit(1);
}

// 生成随机字符串
function generateNonceStr() {
    return Math.random().toString(36).substring(2, 17);
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

// 解密回调数据
function decryptCallbackData(associatedData, nonce, ciphertext) {
    const key = Buffer.from(WX_PAY_CONFIG.key, 'utf8'); // 32字节明文
    const nonceBuf = Buffer.from(nonce, 'utf8'); // 修正：nonce直接用utf8编码
    const data = Buffer.from(ciphertext, 'base64');
    const authTag = data.subarray(data.length - 16);
    const encrypted = data.subarray(0, data.length - 16);

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

async function unifiedOrder(req) {
    try {
        await ensureDigitalArtworkIdColumns();

        const { openid, total_fee, body, out_trade_no, cart_items, address_id } = req.body;

        // 输入验证
        if (!openid || typeof openid !== 'string' || openid.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的openid' });
        }

        if (!total_fee || isNaN(parseFloat(total_fee)) || parseFloat(total_fee) <= 0) {
            return adminResult(400, { error: '缺少有效的支付金额' });
        }

        if (!body || typeof body !== 'string' || body.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的商品描述' });
        }

        if (body.length > 128) {
            return adminResult(400, { error: '商品描述长度不能超过128个字符' });
        }

        if (!out_trade_no || typeof out_trade_no !== 'string' || out_trade_no.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的订单号' });
        }

        if (out_trade_no.length > 64) {
            return adminResult(400, { error: '订单号长度不能超过64个字符' });
        }

        if (!cart_items || !Array.isArray(cart_items) || cart_items.length === 0) {
            return adminResult(400, { error: '缺少有效的购物车商品' });
        }

        if (cart_items.length > 20) {
            return adminResult(400, { error: '购物车商品数量不能超过20个' });
        }

        // 验证地址ID（可选，但建议提供）
        if (address_id && (isNaN(parseInt(address_id)) || parseInt(address_id) <= 0)) {
            return adminResult(400, { error: '地址ID格式无效' });
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
                return adminResult(404, { error: '用户不存在' });
            }

            const userId = users[0].id;

            // 检查订单状态，允许未完成订单重复支付
            const [existingOrders] = await connection.query(
                'SELECT id, trade_state, user_id FROM orders WHERE out_trade_no = ?',
                [cleanOutTradeNo]
            );

            if (existingOrders.length > 0) {
                const existingOrder = existingOrders[0];

                // 如果订单已支付成功，不允许重复支付
                if (existingOrder.trade_state === 'SUCCESS') {
                    await connection.rollback();
                    return adminResult(400, { error: '订单已支付成功，不能重复支付' });
                }

                // 如果订单已退款，不允许重复支付
                if (existingOrder.trade_state === 'REFUND') {
                    await connection.rollback();
                    return adminResult(400, { error: '订单已退款，不能重复支付' });
                }

                // 检查是否是同一用户的订单
                if (existingOrder.user_id !== userId) {
                    await connection.rollback();
                    return adminResult(403, { error: '只能支付自己的订单' });
                }

                // 如果是同一用户的未完成订单，允许重复支付，但需要幂等性锁防止并发
                const lockKey = `pay:order:lock:${cleanOutTradeNo}:${userId}`;
                const lock = await redisClient.set(lockKey, '1', { NX: true, EX: LOCK_EXPIRE });
                if (!lock) {
                    await connection.rollback();
                    return adminResult(429, { error: '订单正在处理中，请勿重复提交' });
                }
            } else {
                // 新订单，使用原有的幂等性锁
                const lockKey = `pay:order:lock:${cleanOutTradeNo}`;
                const lock = await redisClient.set(lockKey, '1', { NX: true, EX: LOCK_EXPIRE });
                if (!lock) {
                    await connection.rollback();
                    return adminResult(429, { error: '订单正在处理中，请勿重复提交' });
                }
            }

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
                    const parsedDigital = parseDigitalArtworkId(item.digital_artwork_id);
                    if (!parsedDigital.error) {
                        item.digital_artwork_id = parsedDigital.id;
                        digitalIds.push(parsedDigital.id);
                    }
                }
            });

            // 批量查询商品信息
            const goodsMap = new Map();

            // 批量查询rights
            if (rightIds.length > 0) {
                const [rights] = await connection.query(
                    'SELECT id, price, discount_price, remaining_count FROM rights WHERE id IN (?) AND status = "onsale"',
                    [rightIds]
                );
                rights.forEach(right => {
                    goodsMap.set(`right_${right.id}`, right);
                });
            }

            // 批量查询artworks
            if (artworkIds.length > 0) {
                const [artworks] = await connection.query(
                    `SELECT oa.id, oa.original_price, oa.discount_price, oa.stock
                     FROM original_artworks oa
                     INNER JOIN artists a ON a.id = oa.artist_id
                     WHERE oa.id IN (?) AND oa.is_on_sale = 1
                       AND COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1`,
                    [artworkIds]
                );
                artworks.forEach(artwork => {
                    goodsMap.set(`artwork_${artwork.id}`, artwork);
                });
            }

            // 批量查询 digitals（本地表 + 外部同步表）
            if (digitalIds.length > 0) {
                const digitalsMap = await fetchDigitalArtworksByIds(digitalIds, connection);
                digitalsMap.forEach((digital, id) => {
                    goodsMap.set(`digital_${id}`, digital);
                });
            }

            // 校验所有商品
            for (const item of cart_items) {
                if (item.type === 'digital') {
                    const parsedDigital = parseDigitalArtworkId(item.digital_artwork_id);
                    if (parsedDigital.error) {
                        await connection.rollback();
                        return adminResult(400, { error: parsedDigital.error });
                    }
                    item.digital_artwork_id = parsedDigital.id;
                }

                const key = `${item.type}_${item.type === 'right' ? item.right_id : item.type === 'artwork' ? item.artwork_id : item.digital_artwork_id}`;
                const goods = goodsMap.get(key);

                if (!goods) {
                    await connection.rollback();
                    return adminResult(404, { error: `商品ID ${item.type === 'right' ? item.right_id : item.type === 'artwork' ? item.artwork_id : item.digital_artwork_id} 不存在或已下架` });
                }

                if (item.type === 'digital' && !isDigitalArtworkPurchasable(goods)) {
                    await connection.rollback();
                    return adminResult(404, { error: `数字艺术品ID ${item.digital_artwork_id} 不存在或已下架` });
                }

                // 验证库存
                if (item.type === 'right' && goods.remaining_count < item.quantity) {
                    await connection.rollback();
                    return adminResult(400, { error: `商品ID ${item.right_id} 库存不足` });
                }
                if (item.type === 'artwork' && goods.stock < item.quantity) {
                    await connection.rollback();
                    return adminResult(400, { error: `艺术品ID ${item.artwork_id} 库存不足` });
                }
                if (item.type === 'digital' && !hasEnoughDigitalStock(goods, item.quantity)) {
                    await connection.rollback();
                    return adminResult(400, { error: `数字艺术品ID ${item.digital_artwork_id} 库存不足` });
                }

                // 验证价格
                const itemPrice = parseFloat(item.price);
                let dbPrice;
                if (item.type === 'right') {
                    // 判断是否享受优惠价
                    let effectivePrice = parseFloat(goods.price);
                    if (goods.discount_price && parseFloat(goods.discount_price) > 0) {
                        // 查询权益的优惠资格所需数字资产列表
                        const [eligible] = await connection.query(
                            'SELECT digital_artwork_id FROM right_discount_eligibles WHERE right_id = ?',
                            [item.right_id]
                        );
                        if (eligible && eligible.length > 0) {
                            // 查询用户是否拥有其中任一数字资产
                            const eligibleIds = eligible.map(e => e.digital_artwork_id);
                            if (eligibleIds.length > 0) {
                                const [owned] = await connection.query(
                                    'SELECT 1 FROM digital_identity_purchases WHERE user_id = ? AND digital_artwork_id IN (?) LIMIT 1',
                                    [userId, eligibleIds]
                                );
                                if (owned && owned.length > 0) {
                                    effectivePrice = parseFloat(goods.discount_price);
                                }
                            }
                        }
                    }
                    dbPrice = effectivePrice;
                } else if (item.type === 'digital') {
                    dbPrice = parseFloat(goods.price);
                    if (!Number.isFinite(dbPrice)) dbPrice = 0;
                    itemPrice = resolveSubmittedDigitalPriceYuan(itemPrice, dbPrice);
                    item.price = itemPrice;
                } else if (item.type === 'artwork') {
                    dbPrice = (goods.discount_price && goods.discount_price > 0 && goods.discount_price < goods.original_price)
                        ? goods.discount_price
                        : goods.original_price;
                }

                if (Math.abs(itemPrice - dbPrice) > 0.01) {
                    await connection.rollback();
                    return adminResult(400, {
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

            let orderId;

            // 检查是否已存在订单
            if (existingOrders.length > 0) {
                // 更新已存在的订单
                orderId = existingOrders[0].id;
                await connection.query(
                    'UPDATE orders SET total_fee = ?, actual_fee = ?, discount_amount = ?, body = ?, updated_at = NOW() WHERE id = ?',
                    [cleanTotalFee, actualTotalFee, availableDiscount, cleanBody, orderId]
                );

                // 删除旧的订单项
                await connection.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
            } else {
                // 创建新订单
                const [orderResult] = await connection.query(
                    'INSERT INTO orders (user_id, out_trade_no, total_fee, actual_fee, discount_amount, body, trade_state, trade_state_desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [userId, cleanOutTradeNo, cleanTotalFee, actualTotalFee, availableDiscount, cleanBody, 'NOTPAY', '订单未支付']
                );
                orderId = orderResult.insertId;
            }

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
                schedulePaymentPendingReminder({ outTradeNo: cleanOutTradeNo, orderId }).catch((err) => {
                    logger.warn('待付款提醒排期失败', { outTradeNo: cleanOutTradeNo, err: err?.message || err });
                });
                return adminResult(200, {
                    success: true,
                    data: response.data
                });
            } else {
                await connection.rollback();
                return adminResult(400, {
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
        logger.error('统一下单失败', { err: error });
        return adminResult(500, {
            error: '统一下单失败'
        });
    }
}

async function singleOrder(req) {
    try {
        await ensureDigitalArtworkIdColumns();

        const { openid, type, quantity, price, body, out_trade_no, right_id, digital_artwork_id, artwork_id, address_id } = req.body;

        // 输入验证
        if (!openid || typeof openid !== 'string' || openid.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的openid' });
        }
        if (!type || !['right', 'digital', 'artwork'].includes(type)) {
            return adminResult(400, { error: 'type 必须是 right、digital 或 artwork' });
        }
        if (!quantity || isNaN(parseInt(quantity)) || parseInt(quantity) <= 0) {
            return adminResult(400, { error: '缺少有效的商品数量' });
        }
        if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
            return adminResult(400, { error: '缺少有效的商品价格' });
        }
        if (!body || typeof body !== 'string' || body.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的商品描述' });
        }
        if (body.length > 128) {
            return adminResult(400, { error: '商品描述长度不能超过128个字符' });
        }
        if (!out_trade_no || typeof out_trade_no !== 'string' || out_trade_no.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的订单号' });
        }
        if (out_trade_no.length > 64) {
            return adminResult(400, { error: '订单号长度不能超过64个字符' });
        }

        // 只允许一个商品id
        if (type === 'right' && (!right_id || isNaN(parseInt(right_id)))) {
            return adminResult(400, { error: '缺少有效的商品ID' });
        }
        if (type === 'artwork' && (!artwork_id || isNaN(parseInt(artwork_id)))) {
            return adminResult(400, { error: '缺少有效的商品ID' });
        }
        const parsedDigitalId = type === 'digital' ? parseDigitalArtworkId(digital_artwork_id) : null;
        if (type === 'digital' && parsedDigitalId.error) {
            return adminResult(400, { error: parsedDigitalId.error });
        }

        // 验证地址ID（可选，但建议提供）
        if (address_id && (isNaN(parseInt(address_id)) || parseInt(address_id) <= 0)) {
            return adminResult(400, { error: '地址ID格式无效' });
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
                return adminResult(404, { error: '用户不存在' });
            }
            const userId = users[0].id;

            // 检查订单状态，允许未完成订单重复支付
            const [existingOrders] = await connection.query(
                'SELECT id, trade_state, user_id FROM orders WHERE out_trade_no = ?',
                [cleanOutTradeNo]
            );

            if (existingOrders.length > 0) {
                const existingOrder = existingOrders[0];

                // 如果订单已支付成功，不允许重复支付
                if (existingOrder.trade_state === 'SUCCESS') {
                    await connection.rollback();
                    return adminResult(400, { error: '订单已支付成功，不能重复支付' });
                }

                // 如果订单已退款，不允许重复支付
                if (existingOrder.trade_state === 'REFUND') {
                    await connection.rollback();
                    return adminResult(400, { error: '订单已退款，不能重复支付' });
                }

                // 检查是否是同一用户的订单
                if (existingOrder.user_id !== userId) {
                    await connection.rollback();
                    return adminResult(403, { error: '只能支付自己的订单' });
                }

                // 如果是同一用户的未完成订单，允许重复支付，但需要幂等性锁防止并发
                const lockKey = `pay:order:lock:${cleanOutTradeNo}:${userId}`;
                const lock = await redisClient.set(lockKey, '1', { NX: true, EX: LOCK_EXPIRE });
                if (!lock) {
                    await connection.rollback();
                    return adminResult(429, { error: '订单正在处理中，请勿重复提交' });
                }
            } else {
                // 新订单，使用原有的幂等性锁
                const lockKey = `pay:order:lock:${cleanOutTradeNo}`;
                const lock = await redisClient.set(lockKey, '1', { NX: true, EX: LOCK_EXPIRE });
                if (!lock) {
                    await connection.rollback();
                    return adminResult(429, { error: '订单正在处理中，请勿重复提交' });
                }
            }

            // 获取用户可用的抵扣金额
            const [discounts] = await connection.query(`
                SELECT SUM(dip.discount_amount) as total_discount
                FROM digital_identity_purchases dip
                WHERE dip.user_id = ? AND dip.discount_amount > 0
            `, [userId]);
            const availableDiscount = discounts[0].total_discount || 0;

            // 校验商品
            let itemId, dbPrice, stock, actualPrice;
            let unitPriceYuan = cleanPrice;
            if (cleanType === 'right') {
                itemId = parseInt(right_id);
                const [rights] = await connection.query(
                    'SELECT id, price, discount_price, remaining_count FROM rights WHERE id = ? AND status = "onsale"',
                    [itemId]
                );
                if (!rights || rights.length === 0) {
                    await connection.rollback();
                    return adminResult(404, { error: `商品ID ${itemId} 不存在或已下架` });
                }
                if (rights[0].remaining_count < cleanQuantity) {
                    await connection.rollback();
                    return adminResult(400, { error: `商品ID ${itemId} 库存不足` });
                }
                // 计算有效价格（若满足资格则使用优惠价）
                let effectivePrice = parseFloat(rights[0].price);
                if (rights[0].discount_price && parseFloat(rights[0].discount_price) > 0) {
                    const [eligible] = await connection.query(
                        'SELECT digital_artwork_id FROM right_discount_eligibles WHERE right_id = ?',
                        [itemId]
                    );
                    if (eligible && eligible.length > 0) {
                        const eligibleIds = eligible.map(e => e.digital_artwork_id);
                        if (eligibleIds.length > 0) {
                            const [owned] = await connection.query(
                                'SELECT 1 FROM digital_identity_purchases WHERE user_id = ? AND digital_artwork_id IN (?) LIMIT 1',
                                [userId, eligibleIds]
                            );
                            if (owned && owned.length > 0) {
                                effectivePrice = parseFloat(rights[0].discount_price);
                            }
                        }
                    }
                }
                dbPrice = effectivePrice;
                if (Math.abs(cleanPrice - dbPrice) > 0.01) {
                    await connection.rollback();
                    return adminResult(400, {
                        error: `商品ID ${itemId} 价格不匹配`,
                        detail: { expected: dbPrice, received: cleanPrice }
                    });
                }
            } else if (cleanType === 'artwork') {
                itemId = parseInt(artwork_id);
                const [artworks] = await connection.query(
                    `SELECT oa.id, oa.original_price, oa.discount_price, oa.stock
                     FROM original_artworks oa
                     INNER JOIN artists a ON a.id = oa.artist_id
                     WHERE oa.id = ? AND oa.is_on_sale = 1
                       AND COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1`,
                    [itemId]
                );
                if (!artworks || artworks.length === 0) {
                    await connection.rollback();
                    return adminResult(404, { error: `艺术品ID ${itemId} 不存在或已下架` });
                }
                if (artworks[0].stock < cleanQuantity) {
                    await connection.rollback();
                    return adminResult(400, { error: `艺术品ID ${itemId} 库存不足` });
                }
                actualPrice = (artworks[0].discount_price && artworks[0].discount_price > 0 && artworks[0].discount_price < artworks[0].original_price)
                    ? artworks[0].discount_price
                    : artworks[0].original_price;
                if (Math.abs(cleanPrice - actualPrice) > 0.01) {
                    await connection.rollback();
                    return adminResult(400, {
                        error: `艺术品ID ${itemId} 价格不匹配`,
                        detail: { expected: actualPrice, received: cleanPrice }
                    });
                }
            } else if (cleanType === 'digital') {
                itemId = parsedDigitalId.id;
                const digital = await fetchDigitalArtworkById(itemId, connection);
                if (!digital || !isDigitalArtworkPurchasable(digital)) {
                    await connection.rollback();
                    return adminResult(404, { error: `数字艺术品ID ${itemId} 不存在或已下架` });
                }
                if (!hasEnoughDigitalStock(digital, cleanQuantity)) {
                    await connection.rollback();
                    return adminResult(400, { error: `数字艺术品ID ${itemId} 库存不足` });
                }
                dbPrice = parseFloat(digital.price);
                if (!Number.isFinite(dbPrice)) dbPrice = 0;
                unitPriceYuan = resolveSubmittedDigitalPriceYuan(cleanPrice, dbPrice);
                if (Math.abs(unitPriceYuan - dbPrice) > 0.01) {
                    await connection.rollback();
                    return adminResult(400, {
                        error: `数字艺术品ID ${itemId} 价格不匹配`,
                        detail: { expected: dbPrice, received: cleanPrice }
                    });
                }
            }

            // 计算实际支付金额（考虑抵扣）
            const total_fee = unitPriceYuan * cleanQuantity;
            const actualTotalFee = Math.max(0, total_fee - availableDiscount);

            let orderId;

            // 检查是否已存在订单
            if (existingOrders.length > 0) {
                // 更新已存在的订单
                orderId = existingOrders[0].id;
                await connection.query(
                    'UPDATE orders SET total_fee = ?, actual_fee = ?, discount_amount = ?, body = ?, updated_at = NOW() WHERE id = ?',
                    [total_fee, actualTotalFee, availableDiscount, cleanBody, orderId]
                );

                // 删除旧的订单项
                await connection.query('DELETE FROM order_items WHERE order_id = ?', [orderId]);
            } else {
                // 创建新订单
                const [orderResult] = await connection.query(
                    'INSERT INTO orders (user_id, out_trade_no, total_fee, actual_fee, discount_amount, body, trade_state, trade_state_desc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [userId, cleanOutTradeNo, total_fee, actualTotalFee, availableDiscount, cleanBody, 'NOTPAY', '订单未支付']
                );
                orderId = orderResult.insertId;
            }

            // 创建订单项
            let orderItem;
            if (cleanType === 'right') {
                orderItem = [orderId, 'right', itemId, null, null, cleanQuantity, cleanPrice, address_id || null];
            } else if (cleanType === 'digital') {
                orderItem = [orderId, 'digital', null, itemId, null, cleanQuantity, unitPriceYuan, address_id || null];
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
                schedulePaymentPendingReminder({ outTradeNo: cleanOutTradeNo, orderId }).catch((err) => {
                    logger.warn('待付款提醒排期失败', { outTradeNo: cleanOutTradeNo, err: err?.message || err });
                });
                return adminResult(200, {
                    success: true,
                    data: response.data
                });
            } else {
                await connection.rollback();
                return adminResult(400, {
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
        logger.error('单商品下单失败', { err: error });
        return adminResult(500, {
            error: '单商品下单失败'
        });
    }
}

async function payNotify(req) {
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
            logger.error('回调body解析失败', { body_preview: String(body).slice(0, 500) });
            return adminResult(400, { code: 'FAIL', message: '回调数据解析失败' });
        }
        // 获取回调数据
        const { resource } = parsed;
        // 验证必要字段
        if (!resource || !resource.associated_data || !resource.nonce || !resource.ciphertext) {
            logger.error('回调数据格式错误', { has_resource: !!resource });
            return adminResult(400, { code: 'FAIL', message: '回调数据格式错误' });
        }
        // 验签
        const timestamp = req.headers['wechatpay-timestamp'];
        const nonce = req.headers['wechatpay-nonce'];
        const signature = req.headers['wechatpay-signature'];
        const serial = req.headers['wechatpay-serial'];
        if (!verifyWechatpaySignature({ serial, signature, timestamp, nonce, body })) {
            logger.error('签名验证失败', { serial, signature_len: signature ? String(signature).length : 0 });
            return adminResult(401, { code: 'FAIL', message: '签名验证失败' });
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
            logger.error('解密回调数据失败', { err: e });
            return adminResult(400, { code: 'FAIL', message: '解密失败' });
        }
        let callbackData;
        try {
            callbackData = JSON.parse(decryptedData);
        } catch (e) {
            logger.error('解析解密数据失败', { decrypted_preview: typeof decryptedData === 'string' ? decryptedData.slice(0, 300) : 'non-string' });
            return adminResult(400, { code: 'FAIL', message: '回调数据解析失败' });
        }
        // 处理支付结果
        if (callbackData.trade_state === 'SUCCESS') {
            const out_trade_no_early = callbackData.out_trade_no;
            const callbackKey = `pay:callback:${out_trade_no_early}`;
            const callbackProcessed = await redisClient.get(callbackKey);
            if (callbackProcessed) {
                await cancelPaymentPendingReminder(out_trade_no_early).catch((err) => {
                    logger.warn('重复回调取消待付款提醒失败', { outTradeNo: out_trade_no_early, err: err?.message || err });
                });
                await emitPaymentSuccessSubscribeNotifies({
                    outTradeNo: out_trade_no_early,
                    transactionId: callbackData.transaction_id,
                    payTime: callbackData.success_time,
                }).catch((err) => {
                    logger.warn('重复回调补发支付成功通知失败', { outTradeNo: out_trade_no_early, err: err?.message || err });
                });
                return adminResult(200, { code: 'SUCCESS', message: '重复回调，已忽略' });
            }

            console.log('支付成功回调数据:', callbackData);
            const {
                out_trade_no,
                transaction_id,
                trade_type,
                trade_state,
                trade_state_desc,
                success_time,
            } = callbackData;

            const connection = await db.getConnection();
            await connection.beginTransaction();
            let affected = { rightIds: [], artworkIds: [], digitalIds: [] };
            let shouldFulfillInventory = false;
            try {
                const [orders] = await connection.query(
                    'SELECT trade_state, user_id FROM orders WHERE out_trade_no = ? FOR UPDATE',
                    [out_trade_no]
                );
                if (orders.length > 0 && orders[0].trade_state === 'REFUND') {
                    console.log('订单已退款，不再覆盖为SUCCESS:', out_trade_no);
                    await connection.commit();
                    await redisClient.setEx(callbackKey, CALLBACK_EXPIRE, '1');
                    return adminResult(200, { code: 'SUCCESS', message: '订单已退款，不再覆盖' });
                }

                const userId = orders[0]?.user_id;

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

                const inventoryKey = `${REDIS_PAY_INVENTORY_FULFILLED_PREFIX}${out_trade_no}`;
                const inventoryDone = await redisClient.get(inventoryKey);
                if (!inventoryDone) {
                    const orderItems = await loadOrderItemsForInventory(out_trade_no, connection);
                    affected = await applyOrderItemsInventoryDelta({ orderItems, mode: 'deduct', connection });
                    await recordDigitalIdentityPurchases({
                        outTradeNo: out_trade_no,
                        userId,
                        orderItems,
                        connection,
                    });
                    shouldFulfillInventory = true;
                    console.log('支付回调库存扣减完成', { out_trade_no, rights: affected.rightIds.length });
                }

                await connection.commit();
                if (shouldFulfillInventory) {
                    await redisClient.setEx(inventoryKey, INVENTORY_FLAG_EXPIRE_SEC, '1');
                    await clearInventoryRelatedCaches(affected);
                }
                await redisClient.setEx(callbackKey, CALLBACK_EXPIRE, '1');
                console.log('支付回调处理完成');

                await cancelPaymentPendingReminder(out_trade_no).catch((err) => {
                    logger.warn('取消待付款提醒排期失败', { outTradeNo: out_trade_no, err: err?.message || err });
                });
                await emitPaymentSuccessSubscribeNotifies({
                    outTradeNo: out_trade_no,
                    transactionId: transaction_id,
                    payTime: success_time,
                });

                return adminResult(200, {
                    code: 'SUCCESS',
                    message: 'OK'
                });
            } catch (error) {
                await connection.rollback();
                logger.error('支付回调处理事务失败', { err: error });
                throw error;
            } finally {
                connection.release();
            }
        } else {
            console.warn('支付未成功，trade_state:', callbackData.trade_state);
            return adminResult(200, {
                code: 'FAIL',
                message: callbackData.trade_state_desc || '支付失败'
            });
        }
    } catch (error) {
        logger.error('支付回调处理失败', { err: error });
        return adminResult(500, {
            code: 'FAIL',
            message: '处理失败'
        });
    }
}

async function closeOrder(req) {
    try {
        const { out_trade_no } = req.body;

        // 输入验证
        if (!out_trade_no || typeof out_trade_no !== 'string' || out_trade_no.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的商户订单号' });
        }

        if (out_trade_no.length > 64) {
            return adminResult(400, { error: '商户订单号长度不能超过64个字符' });
        }

        let cleanOutTradeNo;
        try {
            cleanOutTradeNo = assertWechatOutTradeNo(out_trade_no);
        } catch {
            return adminResult(400, { error: '商户订单号格式无效' });
        }

        const params = {
            mchid: WX_PAY_CONFIG.mchId
        };

        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const method = 'POST';
        const url = `/v3/pay/transactions/out-trade-no/${cleanOutTradeNo}/close`;
        const bodyStr = JSON.stringify(params);

        const signature = generateSignV3(method, url, timestamp, nonceStr, bodyStr);

        const response = await axios.post(
            wechatPayOutTradeNoCloseUrl(cleanOutTradeNo),
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
            cancelPaymentPendingReminder(cleanOutTradeNo).catch((err) => {
                logger.warn('取消待付款提醒排期失败', { outTradeNo: cleanOutTradeNo, err: err?.message || err });
            });
            fireSubscribeNotify(
                notifyOrderCancelled({ outTradeNo: cleanOutTradeNo, reason: '订单已关闭' }),
                'orderCancelled',
            );
            return adminResult(200, {
                success: true,
                message: '订单关闭成功'
            });
        } else {
            return adminResult(400, {
                success: false,
                error: '订单关闭失败'
            });
        }
    } catch (error) {
        logger.error('关闭订单失败', { err: error });
        return adminResult(500, {
            success: false,
            error: '关闭订单失败'
        });
    }
}

async function refund(req) {
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
            return adminResult(400, { error: '缺少有效的退款单号' });
        }

        if (out_refund_no.length > 64) {
            return adminResult(400, { error: '退款单号长度不能超过64个字符' });
        }

        if (!amount || typeof amount !== 'object') {
            return adminResult(400, { error: '缺少有效的金额信息' });
        }

        if (!amount.refund || isNaN(parseFloat(amount.refund)) || parseFloat(amount.refund) <= 0) {
            return adminResult(400, { error: '缺少有效的退款金额' });
        }

        if (!amount.total || isNaN(parseFloat(amount.total)) || parseFloat(amount.total) <= 0) {
            return adminResult(400, { error: '缺少有效的订单总金额' });
        }

        if (!amount.currency || typeof amount.currency !== 'string' || amount.currency !== 'CNY') {
            return adminResult(400, { error: '缺少有效的货币类型' });
        }

        if (parseFloat(amount.refund) > parseFloat(amount.total)) {
            return adminResult(400, { error: '退款金额不能超过订单总金额' });
        }

        if (reason && (typeof reason !== 'string' || reason.length > 80)) {
            return adminResult(400, { error: '退款原因长度不能超过80个字符' });
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

            return adminResult(200, {
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
        logger.error('申请退款失败', { err: error });
        return adminResult(500, {
            success: false,
            error: '申请退款失败'
        });
    }
}

function buildWechatApiHeaders(method, urlPath, body = '') {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = generateNonceStr();
    const signature = generateSignV3(method, urlPath, timestamp, nonceStr, body);
    return {
        timestamp,
        nonceStr,
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
            'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
            'User-Agent': 'axios/1.9.0',
        },
    };
}

function normalizeWxRefundPathSegment(value) {
    return String(value || '').trim();
}

async function fetchWxRefundByPathSegment(pathSegment) {
    const segment = normalizeWxRefundPathSegment(pathSegment);
    if (!segment) return { data: null, notFound: false };

    const urlPath = `/v3/refund/domestic/refunds/${segment}`;
    const { headers } = buildWechatApiHeaders('GET', urlPath, '');

    try {
        const response = await axios.get(`https://api.mch.weixin.qq.com${urlPath}`, { headers });
        if (response.status === 200) return { data: response.data, notFound: false };
    } catch (error) {
        const status = error?.response?.status;
        const wxError = error?.response?.data;
        if (status === 404) {
            return { data: null, notFound: true, wxError };
        }
        logger.warn('查询微信退款单失败', {
            path_segment: segment,
            status,
            err: wxError || error?.message,
        });
    }
    return { data: null, notFound: false };
}

async function fetchWxRefundForRow(refundRow) {
    const outRefundNo = normalizeWxRefundPathSegment(refundRow?.out_refund_no);
    if (outRefundNo) {
        const byOutRefundNo = await fetchWxRefundByPathSegment(outRefundNo);
        if (byOutRefundNo.data) return byOutRefundNo;
        if (!byOutRefundNo.notFound && !byOutRefundNo.data) return byOutRefundNo;

        const wxRefundId = normalizeWxRefundPathSegment(refundRow?.wx_refund_id);
        if (wxRefundId) {
            const byWxRefundId = await fetchWxRefundByPathSegment(wxRefundId);
            if (byWxRefundId.data) return byWxRefundId;
            if (byWxRefundId.notFound) return { data: null, notFound: true };
            return byWxRefundId;
        }

        if (byOutRefundNo.notFound) return { data: null, notFound: true };
    }
    return { data: null, notFound: false };
}

async function markRefundPendingRetry(refundRow, reason) {
    await db.query(
        `UPDATE refund_requests
         SET status = 'PENDING',
             wx_refund_id = NULL,
             reject_reason = ?,
             rejected_at = NULL,
             approved_at = NULL
         WHERE id = ? AND status = 'PROCESSING'`,
        [reason, refundRow.id]
    );
}

async function completeRefundSuccess({ out_refund_no, out_trade_no, wx_refund_id }) {
    const callbackKey = `refund:callback:${out_refund_no}`;
    if (await redisClient.get(callbackKey)) {
        return { alreadyDone: true };
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
        const inventoryKey = `${REDIS_REFUND_INVENTORY_RESTORED_PREFIX}${out_trade_no}`;
        const inventoryDone = await redisClient.get(inventoryKey);
        let affected = { rightIds: [], artworkIds: [], digitalIds: [] };

        if (!inventoryDone) {
            const orderItems = await loadOrderItemsForInventory(out_trade_no, connection);
            affected = await applyOrderItemsInventoryDelta({ orderItems, mode: 'restore', connection });
            const orderIds = [...new Set(orderItems.map((item) => item.order_id).filter(Boolean))];
            await removeDigitalIdentityPurchasesByOrderIds(orderIds, connection);
        }

        await connection.query(
            `UPDATE refund_requests SET status = 'SUCCESS', wx_refund_id = ? WHERE out_refund_no = ?`,
            [wx_refund_id, out_refund_no]
        );
        await connection.query(
            `UPDATE orders SET trade_state = 'REFUND', trade_state_desc = '已退款' WHERE out_trade_no = ?`,
            [out_trade_no]
        );

        await connection.commit();

        if (!inventoryDone) {
            await redisClient.setEx(inventoryKey, INVENTORY_FLAG_EXPIRE_SEC, '1');
            await clearInventoryRelatedCaches(affected);
        }
        await redisClient.setEx(callbackKey, CALLBACK_EXPIRE, '1');
        fireSubscribeNotify(
            notifyRefundSuccess({ outTradeNo: out_trade_no, outRefundNo: out_refund_no }),
            'refundResult',
        );
        return { alreadyDone: false };
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

async function markRefundFailed({ out_refund_no, wx_refund_id }) {
    await db.query(
        `UPDATE refund_requests SET status = 'FAILED', wx_refund_id = COALESCE(?, wx_refund_id) WHERE out_refund_no = ?`,
        [wx_refund_id || null, out_refund_no]
    );
}

async function syncRefundStatusFromWechat(refundRow) {
    if (!refundRow || refundRow.status !== 'PROCESSING') {
        return { refund: refundRow, didSync: false };
    }

    const lookup = await fetchWxRefundForRow(refundRow);
    if (lookup.notFound) {
        const reason = '微信侧未找到退款单，请重新审批提交';
        await markRefundPendingRetry(refundRow, reason);
        return {
            refund: {
                ...refundRow,
                status: 'PENDING',
                wx_refund_id: null,
                reject_reason: reason,
            },
            didSync: true,
        };
    }

    const wxRefund = lookup.data;
    if (!wxRefund?.status) {
        return { refund: refundRow, didSync: false };
    }

    const wxRefundId = wxRefund.refund_id || refundRow.wx_refund_id || null;
    if (wxRefund.status === 'SUCCESS') {
        await completeRefundSuccess({
            out_refund_no: refundRow.out_refund_no,
            out_trade_no: wxRefund.out_trade_no || refundRow.out_trade_no,
            wx_refund_id: wxRefundId,
        });
        return {
            refund: { ...refundRow, status: 'SUCCESS', wx_refund_id: wxRefundId },
            didSync: true,
        };
    }

    if (wxRefund.status === 'CLOSED' || wxRefund.status === 'ABNORMAL') {
        await markRefundFailed({ out_refund_no: refundRow.out_refund_no, wx_refund_id: wxRefundId });
        return {
            refund: { ...refundRow, status: 'FAILED', wx_refund_id: wxRefundId },
            didSync: true,
        };
    }

    return { refund: refundRow, didSync: false };
}

async function refundApprove(req) {
    try {
        const { refund_id, approve, reject_reason } = req.body;

        // 输入验证
        if (!refund_id || isNaN(parseInt(refund_id)) || parseInt(refund_id) <= 0) {
            return adminResult(400, { error: '缺少有效的退款ID' });
        }

        if (typeof approve !== 'boolean') {
            return adminResult(400, { error: '缺少有效的审批结果' });
        }

        if (!approve && (!reject_reason || typeof reject_reason !== 'string' || reject_reason.trim().length === 0)) {
            return adminResult(400, { error: '拒绝退款必须提供原因' });
        }

        if (reject_reason && reject_reason.length > 200) {
            return adminResult(400, { error: '拒绝原因长度不能超过200个字符' });
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
                return adminResult(404, { error: '退款申请不存在或已处理' });
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
                    logger.error('解析退款金额失败', { err: error });
                    await connection.rollback();
                    return adminResult(500, {
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

                let transactionId = refund.transaction_id || null;
                if (!transactionId && refund.out_trade_no) {
                    const [orderRows] = await connection.query(
                        'SELECT transaction_id FROM orders WHERE out_trade_no = ? LIMIT 1',
                        [refund.out_trade_no]
                    );
                    transactionId = orderRows[0]?.transaction_id || null;
                    if (transactionId) {
                        await connection.query(
                            'UPDATE refund_requests SET transaction_id = ? WHERE id = ?',
                            [transactionId, cleanRefundId]
                        );
                    }
                }

                if (transactionId) {
                    params.transaction_id = transactionId;
                } else if (refund.out_trade_no) {
                    params.out_trade_no = refund.out_trade_no;
                } else {
                    await connection.rollback();
                    return adminResult(400, {
                        success: false,
                        error: '缺少微信支付订单号或商户订单号，无法发起退款',
                    });
                }

                const requestBody = JSON.stringify(params);
                const { headers } = buildWechatApiHeaders('POST', '/v3/refund/domestic/refunds', requestBody);

                const response = await axios.post(
                    'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds',
                    params,
                    { headers }
                );

                if (response.status === 200) {
                    const wxRefundId = response.data?.refund_id || null;
                    const wxStatus = response.data?.status || 'PROCESSING';

                    if (wxStatus === 'SUCCESS') {
                        await connection.query(
                            'UPDATE refund_requests SET status = "SUCCESS", wx_refund_id = ? WHERE id = ?',
                            [wxRefundId, cleanRefundId]
                        );
                        await connection.commit();

                        await completeRefundSuccess({
                            out_refund_no: refund.out_refund_no,
                            out_trade_no: response.data?.out_trade_no || refund.out_trade_no,
                            wx_refund_id: wxRefundId,
                        });

                        return adminResult(200, {
                            success: true,
                            data: {
                                status: 'SUCCESS',
                                message: '退款已完成',
                            },
                        });
                    }

                    if (wxStatus === 'CLOSED' || wxStatus === 'ABNORMAL') {
                        await connection.query(
                            'UPDATE refund_requests SET status = "FAILED", wx_refund_id = ? WHERE id = ?',
                            [wxRefundId, cleanRefundId]
                        );
                        await connection.commit();
                        return adminResult(200, {
                            success: true,
                            data: {
                                status: 'FAILED',
                                message: '微信退款失败',
                            },
                        });
                    }

                    await connection.query(
                        'UPDATE refund_requests SET status = "PROCESSING", wx_refund_id = ? WHERE id = ?',
                        [wxRefundId, cleanRefundId]
                    );

                    await connection.commit();
                    return adminResult(200, {
                        success: true,
                        data: {
                            status: 'PROCESSING',
                            message: '退款申请已批准，正在处理中',
                        },
                    });
                }

                await connection.rollback();
                return adminResult(400, {
                    success: false,
                    error: '退款申请处理失败',
                });
            } else {
                // 拒绝退款申请
                await connection.query(
                    'UPDATE refund_requests SET status = "REJECTED", reject_reason = ?, rejected_at = NOW() WHERE id = ?',
                    [cleanRejectReason, cleanRefundId]
                );

                await connection.commit();
                return adminResult(200, {
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
        const wxErr = error?.response?.data;
        logger.error('处理退款申请失败', { err: wxErr || error });
        const wxHint = wxErr?.message || wxErr?.code;
        return adminResult(500, {
            success: false,
            error: wxHint ? `处理退款申请失败：${wxHint}` : '处理退款申请失败',
        });
    }
}

async function listRefundRequests(req) {
    try {
        const { status, page = 1, limit = 10 } = req.query;

        // 输入验证
        if (page && (isNaN(parseInt(page)) || parseInt(page) <= 0)) {
            return adminResult(400, { error: '页码必须是正整数' });
        }

        if (limit && (isNaN(parseInt(limit)) || parseInt(limit) <= 0 || parseInt(limit) > 100)) {
            return adminResult(400, { error: '每页数量必须在1-100之间' });
        }

        if (status && !['PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'SUCCESS', 'FAILED'].includes(status)) {
            return adminResult(400, { error: '无效的状态值' });
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

        const syncedRefunds = await Promise.all(
            (refunds || []).map(async (refund) => {
                if (refund.status !== 'PROCESSING') return refund;
                const { refund: synced } = await syncRefundStatusFromWechat(refund);
                return synced;
            })
        );

        const formattedRefunds = syncedRefunds.map((refund) => ({
            ...refund,
            amount: typeof refund.amount === 'string' ? refund.amount : JSON.stringify(refund.amount),
        }));

        return adminResult(200, {
            success: true,
            data: formattedRefunds,
            total: parseInt(total),
            page: cleanPage,
            limit: cleanLimit
        });
    } catch (error) {
        logger.error('获取退款申请列表失败', { err: error });
        return adminResult(500, {
            success: false,
            error: '获取退款申请列表失败'
        });
    }
}

async function getRefundRequestById(req) {
    try {
        // 输入验证
        const refundId = req.params.id;
        if (!refundId || isNaN(parseInt(refundId)) || parseInt(refundId) <= 0) {
            return adminResult(400, { error: '无效的退款申请ID' });
        }

        const cleanRefundId = parseInt(refundId);

        const [refunds] = await db.query(
            'SELECT * FROM refund_requests WHERE id = ?',
            [cleanRefundId]
        );

        if (!refunds || refunds.length === 0) {
            return adminResult(404, { error: '退款申请不存在' });
        }

        const { refund: syncedRefund } = await syncRefundStatusFromWechat(refunds[0]);

        return adminResult(200, {
            success: true,
            data: syncedRefund,
        });
    } catch (error) {
        logger.error('获取退款申请详情失败', { err: error });
        return adminResult(500, {
            success: false,
            error: '获取退款申请详情失败'
        });
    }
}

async function refundNotify(req) {
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
            logger.error('【退款回调】回调body解析失败', { body_preview: String(body).slice(0, 500) });
            return adminResult(400, { code: 'FAIL', message: '回调数据解析失败' });
        }
        const { resource } = parsed;
        if (!resource || !resource.associated_data || !resource.nonce || !resource.ciphertext) {
            logger.error('【退款回调】回调数据格式错误', { has_resource: !!resource });
            return adminResult(400, { code: 'FAIL', message: '回调数据格式错误' });
        }
        // 验签
        const timestamp = req.headers['wechatpay-timestamp'];
        const nonce = req.headers['wechatpay-nonce'];
        const signature = req.headers['wechatpay-signature'];
        const serial = req.headers['wechatpay-serial'];
        const verifyResult = verifyWechatpaySignature({ serial, signature, timestamp, nonce, body });
        console.log('【退款回调】验签结果:', verifyResult);
        if (!verifyResult) {
            logger.error('【退款回调】签名验证失败', { serial, signature_len: signature ? String(signature).length : 0 });
            return adminResult(401, { code: 'FAIL', message: '签名验证失败' });
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
            logger.error('【退款回调】解密回调数据失败', { err: e });
            return adminResult(400, { code: 'FAIL', message: '解密失败' });
        }
        let callbackData;
        try {
            callbackData = JSON.parse(decryptedData);
            console.log('【退款回调】最终业务数据:', callbackData);
        } catch (e) {
            logger.error('【退款回调】解析解密数据失败', { decrypted_preview: typeof decryptedData === 'string' ? decryptedData.slice(0, 300) : 'non-string' });
            return adminResult(400, { code: 'FAIL', message: '回调数据解析失败' });
        }
        // 处理退款结果
        if (callbackData.refund_status === 'SUCCESS') {
            console.log('【退款回调】退款成功回调数据:', callbackData);
            await completeRefundSuccess({
                out_refund_no: callbackData.out_refund_no,
                out_trade_no: callbackData.out_trade_no,
                wx_refund_id: callbackData.refund_id,
            });
            return adminResult(200, { code: 'SUCCESS', message: 'OK' });
        }

        if (callbackData.refund_status === 'CLOSED' || callbackData.refund_status === 'ABNORMAL') {
            await markRefundFailed({
                out_refund_no: callbackData.out_refund_no,
                wx_refund_id: callbackData.refund_id,
            });
        }

        return adminResult(200, {
            code: 'SUCCESS',
            message: callbackData.refund_status || 'OK',
        });
    } catch (error) {
        logger.error('退款回调处理失败', { err: error });
        return adminResult(500, {
            code: 'FAIL',
            message: '处理失败'
        });
    }
}

async function signPay(req) {
    try {
        const { prepay_id } = req.body;

        // 输入验证
        if (!prepay_id || typeof prepay_id !== 'string' || prepay_id.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的prepay_id' });
        }

        if (prepay_id.length > 64) {
            return adminResult(400, { error: 'prepay_id长度不能超过64个字符' });
        }

        const cleanPrepayId = prepay_id.trim();

        // 构建签名参数
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const wxPayPackage = `prepay_id=${cleanPrepayId}`;

        // 构建签名串
        const signStr = `${WX_PAY_CONFIG.appId}\n${timestamp}\n${nonceStr}\n${wxPayPackage}\n`;

        // 生成签名
        const sign = crypto.createSign('RSA-SHA256');
        sign.update(signStr);
        const signature = sign.sign(WX_PAY_CONFIG.privateKey, 'base64');

        // 返回支付参数
        return adminResult(200, {
            timeStamp: timestamp,
            nonceStr: nonceStr,
            package: wxPayPackage,
            signType: 'RSA',
            paySign: signature
        });
    } catch (error) {
        logger.error('生成支付签名失败', { err: error });
        return adminResult(500, { error: '生成支付签名失败' });
    }
}

async function queryOrder(req) {
    try {
        const { out_trade_no } = req.query;

        // 输入验证
        if (!out_trade_no || typeof out_trade_no !== 'string' || out_trade_no.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的商户订单号' });
        }

        if (out_trade_no.length > 64) {
            return adminResult(400, { error: '商户订单号长度不能超过64个字符' });
        }

        let cleanOutTradeNo;
        try {
            cleanOutTradeNo = assertWechatOutTradeNo(out_trade_no);
        } catch {
            return adminResult(400, { error: '商户订单号格式无效' });
        }

        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const method = 'GET';
        const url = `/v3/pay/transactions/out-trade-no/${cleanOutTradeNo}`;

        const signature = generateSignV3(method, url, timestamp, nonceStr, '');

        const response = await axios.get(
            wechatPayOutTradeNoQueryUrl(cleanOutTradeNo),
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
                return adminResult(404, { error: '订单不存在' });
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

            return adminResult(200, {
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
            return adminResult(400, {
                success: false,
                error: '查询订单失败'
            });
        }
    } catch (error) {
        logger.error('查询订单失败', { err: error });
        return adminResult(500, {
            success: false,
            error: '查询订单失败'
        });
    }
}

function getOrderStatusType(tradeState) {
    switch (tradeState) {
        case 'NOTPAY':
            return 'pending';
        case 'PAYERROR':
            return 'payment_failed';
        case 'SUCCESS':
            return 'completed';
        case 'CLOSED':
            return 'closed';
        case 'REVOKED':
            return 'cancelled';
        case 'REFUND':
            return 'refunded';
        default:
            return 'unknown';
    }
}

function getOrderStatusText(tradeState) {
    switch (tradeState) {
        case 'NOTPAY':
            return '未支付';
        case 'PAYERROR':
            return '支付失败';
        case 'SUCCESS':
            return '支付成功';
        case 'CLOSED':
            return '已关闭';
        case 'REVOKED':
            return '已撤销';
        case 'REFUND':
            return '转入退款';
        default:
            return '未知状态';
    }
}

function resolveListStatusFilter(status) {
    if (!status || status === 'all') return null;
    const map = {
        pending: ['NOTPAY', 'PAYERROR'],
        NOTPAY: ['NOTPAY'],
        completed: ['SUCCESS'],
        SUCCESS: ['SUCCESS'],
        cancelled: ['CLOSED', 'REVOKED'],
        closed: ['CLOSED'],
        CLOSED: ['CLOSED'],
        REVOKED: ['REVOKED'],
        refunded: ['REFUND'],
        REFUND: ['REFUND'],
    };
    return map[status] || null;
}

function mapListItemImage(item) {
    if (item.type === 'right') return item.right_image_url || null;
    if (item.type === 'digital') return item.digital_image_url || null;
    if (item.type === 'artwork') return item.artwork_image || null;
    return null;
}

function mapListItemTitle(item) {
    if (item.type === 'right') return item.right_title || '';
    if (item.type === 'digital') return item.digital_title || '';
    if (item.type === 'artwork') return item.artwork_title || '';
    return '';
}

async function fetchListOrderItemsByOrderIds(orderIds) {
    if (!orderIds.length) return new Map();

    const placeholders = orderIds.map(() => '?').join(', ');
    const [orderItems] = await db.query(`
        SELECT
            oi.order_id,
            oi.type,
            oi.quantity,
            oi.price,
            r.title as right_title,
            ri.image_url as right_image_url,
            ${DIGITAL_ITEM_SELECT_SQL},
            oa.title as artwork_title,
            oa.image as artwork_image
        FROM order_items oi
        LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
        LEFT JOIN right_images ri ON oi.type = 'right' AND oi.right_id = ri.right_id
        ${DIGITAL_ITEM_JOIN_SQL}
        LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
        WHERE oi.order_id IN (${placeholders})
        ORDER BY oi.id ASC
    `, orderIds);

    const itemsByOrderId = new Map();
    for (const item of orderItems) {
        const bucket = itemsByOrderId.get(item.order_id) || [];
        bucket.push({
            type: item.type,
            title: mapListItemTitle(item),
            image: mapListItemImage(item),
            quantity: item.quantity,
            price: Number(item.price) || 0,
        });
        itemsByOrderId.set(item.order_id, bucket);
    }
    return itemsByOrderId;
}

async function fetchLatestRefundStatusByOutTradeNos(outTradeNos) {
    if (!outTradeNos.length) return new Map();

    const placeholders = outTradeNos.map(() => '?').join(', ');
    const [rows] = await db.query(`
        SELECT out_trade_no, status, wx_refund_id, created_at
        FROM refund_requests
        WHERE out_trade_no IN (${placeholders})
        ORDER BY id DESC
    `, outTradeNos);

    const refundByOutTradeNo = new Map();
    for (const row of rows) {
        if (!refundByOutTradeNo.has(row.out_trade_no)) {
            refundByOutTradeNo.set(row.out_trade_no, {
                status: row.status,
                wx_refund_id: row.wx_refund_id || null,
                created_at: row.created_at,
            });
        }
    }
    return refundByOutTradeNo;
}

function buildOrderStatusFields(tradeState, tradeStateDesc) {
    const state = tradeState || 'UNKNOWN';
    const displayText = tradeStateDesc || getOrderStatusText(state);
    return {
        pay_status: {
            trade_state: state,
            trade_state_desc: displayText,
        },
        order_status: {
            type: getOrderStatusType(state),
            text: displayText,
        },
    };
}

async function refreshListOrdersPaymentState(orders) {
    const needSync = orders.filter((order) => order.trade_state === 'NOTPAY' || order.trade_state === 'PAYERROR');
    if (needSync.length === 0) return;

    await Promise.all(needSync.map((order) => syncOrderTradeStateFromWechat(order)));
}

function filterOrdersByStatus(orders, statusStates) {
    if (!statusStates?.length) return orders;
    return orders.filter((order) => statusStates.includes(order.trade_state));
}

function mapOrderToListCard(order, items, refundStatus) {
    const statusFields = buildOrderStatusFields(order.trade_state, order.trade_state_desc);
    return {
        out_trade_no: order.out_trade_no,
        created_at: toIsoOrNull(order.created_at),
        total_fee: Number(order.total_fee) || 0,
        ...statusFields,
        refund_status: refundStatus || null,
        items,
    };
}

async function listOrders(req) {
    try {
        const {
            user_id: queryUserId,
            status,
            page = 1,
            limit = 10,
        } = req.query;

        const validStatusTypes = [
            'all',
            'pending',
            'completed',
            'cancelled',
            'closed',
            'refunded',
            'NOTPAY',
            'SUCCESS',
            'CLOSED',
            'REVOKED',
            'REFUND',
        ];

        if (page && (isNaN(parseInt(page)) || parseInt(page) <= 0)) {
            return adminResult(400, { error: '页码必须是正整数' });
        }

        if (limit && (isNaN(parseInt(limit)) || parseInt(limit) <= 0 || parseInt(limit) > 100)) {
            return adminResult(400, { error: '每页数量必须在1-100之间' });
        }

        if (status && !validStatusTypes.includes(String(status).trim())) {
            return adminResult(400, {
                error: '无效的订单状态类型，支持的类型：all, pending, completed, cancelled, closed, refunded, NOTPAY, SUCCESS, CLOSED, REVOKED, REFUND',
            });
        }

        const authUserId = req.user?.id;
        if (!authUserId) {
            return adminResult(401, { error: '未登录' });
        }

        if (queryUserId) {
            const parsedQueryUserId = parseInt(queryUserId, 10);
            if (isNaN(parsedQueryUserId) || parsedQueryUserId <= 0) {
                return adminResult(400, { error: '无效的用户ID' });
            }
            if (parsedQueryUserId !== Number(authUserId)) {
                return adminResult(403, { error: '无权查看其他用户订单' });
            }
        }

        const cleanUserId = Number(authUserId);
        const cleanPage = parseInt(page, 10);
        const cleanLimit = parseInt(limit, 10);
        const cleanStatus = status ? String(status).trim() : 'all';
        const statusStates = resolveListStatusFilter(cleanStatus);

        const whereParts = ['user_id = ?'];
        const whereParams = [cleanUserId];
        if (statusStates?.length) {
            whereParts.push(`trade_state IN (${statusStates.map(() => '?').join(', ')})`);
            whereParams.push(...statusStates);
        }

        const whereSql = whereParts.join(' AND ');
        const offset = (cleanPage - 1) * cleanLimit;

        const [[orders], [[{ total }]]] = await Promise.all([
            db.query(
                `SELECT id, out_trade_no, created_at, total_fee, trade_state, trade_state_desc
                 FROM orders FORCE INDEX (idx_orders_user_id)
                 WHERE ${whereSql}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [...whereParams, cleanLimit, offset]
            ),
            db.query(
                `SELECT COUNT(*) as total
                 FROM orders FORCE INDEX (idx_orders_user_id)
                 WHERE ${whereSql}`,
                whereParams
            ),
        ]);

        await refreshListOrdersPaymentState(orders);
        const visibleOrders = filterOrdersByStatus(orders, statusStates);

        const orderIds = visibleOrders.map((order) => order.id);
        const [itemsByOrderId, refundByOutTradeNo] = await Promise.all([
            fetchListOrderItemsByOrderIds(orderIds),
            fetchLatestRefundStatusByOutTradeNos(visibleOrders.map((order) => order.out_trade_no)),
        ]);

        const orderCards = visibleOrders.map((order) => mapOrderToListCard(
            order,
            itemsByOrderId.get(order.id) || [],
            refundByOutTradeNo.get(order.out_trade_no) || null
        ));

        const totalCount = Number(total);
        const hasMore = cleanPage * cleanLimit < totalCount;

        return adminResult(200, {
            success: true,
            data: {
                orders: orderCards,
                pagination: {
                    page: cleanPage,
                    limit: cleanLimit,
                    total: totalCount,
                    has_more: hasMore,
                },
            },
        });
    } catch (error) {
        logger.error('查询订单列表失败', { err: error });
        return adminResult(500, {
            success: false,
            error: '查询订单列表失败',
        });
    }
}

// 数字身份购买记录在支付成功回调中处理，这里移除单独的接口

async function digitalIdentityPurchases(req) {
    try {
        await ensureOrderItemsQrCodeColumns();

        // 输入验证
        const userId = req.params.user_id;
        if (!userId || isNaN(parseInt(userId)) || parseInt(userId) <= 0) {
            return adminResult(400, { error: '无效的用户ID' });
        }

        const cleanUserId = parseInt(userId);

        const [purchases] = await db.query(`
             SELECT 
                 dip.id,
                 dip.user_id,
                 dip.digital_artwork_id,
                 dip.discount_amount,
                 dip.purchase_date,
                 dip.order_id,
                 COALESCE(da.title, dae.title) as artwork_title,
                 COALESCE(da.image_url, dae.image_url) as artwork_image,
                 o.out_trade_no as order_no,
                 o.trade_state as order_trade_state,
                 oi.id as order_item_id,
                 oi.delivery_qr_code_url,
                 oi.delivery_qr_code_at
             FROM digital_identity_purchases dip
             LEFT JOIN digital_artworks da ON CAST(dip.digital_artwork_id AS CHAR) = CAST(da.id AS CHAR)
             LEFT JOIN digital_artworks_external dae ON CAST(dip.digital_artwork_id AS CHAR) = dae.id
             LEFT JOIN orders o ON dip.order_id = o.id
             LEFT JOIN order_items oi ON oi.order_id = dip.order_id
               AND oi.type = 'digital'
               AND oi.digital_artwork_id = dip.digital_artwork_id
             WHERE dip.user_id = ?
             ORDER BY dip.purchase_date DESC
         `, [cleanUserId]);

        const result = (purchases || []).map((row) => {
            const fulfillment = buildDigitalItemFulfillment({
                tradeState: row.order_trade_state,
                qrCodeUrl: row.delivery_qr_code_url,
                qrCodeAt: row.delivery_qr_code_at,
            });
            return {
                id: row.id,
                user_id: row.user_id,
                digital_artwork_id: row.digital_artwork_id,
                discount_amount: row.discount_amount,
                purchase_date: row.purchase_date,
                order_id: row.order_id,
                order_item_id: row.order_item_id,
                artwork_title: row.artwork_title,
                artwork_image: row.artwork_image,
                order_no: row.order_no,
                qr_code_url: fulfillment.qr_code_url,
                qr_code_uploaded_at: fulfillment.qr_code_uploaded_at,
                fulfillment_status: fulfillment.status,
                fulfillment_hint: fulfillment.hint,
            };
        });

        return adminResult(200, result);
    } catch (error) {
        logger.error('获取数字身份购买记录失败', { err: error });
        return adminResult(500, { error: '获取数字身份购买记录失败' });
    }
}

function sanitizeOrderSearchKeyword(raw) {
    if (raw == null || typeof raw !== 'string') return '';
    const t = raw.trim().slice(0, 100);
    if (!t) return '';
    // 去掉 LIKE 通配符与反斜杠，避免恶意/误用模式匹配整表
    return t.replace(/[%_\\]/g, '');
}

async function adminOrders(req) {
    try {
        await ensureOrderItemsQrCodeColumns();

        const {
            status,
            type,
            keyword,
            page = 1,
            limit = 20
        } = req.query;

        if (page && (isNaN(parseInt(page)) || parseInt(page) <= 0)) {
            return adminResult(400, { error: '页码必须是正整数' });
        }

        if (limit && (isNaN(parseInt(limit)) || parseInt(limit) <= 0 || parseInt(limit) > 100)) {
            return adminResult(400, { error: '每页数量必须在1-100之间' });
        }

        if (status && !['SUCCESS', 'REFUND', 'CLOSED', 'REVOKED', 'PAYERROR', 'NOTPAY'].includes(status)) {
            return adminResult(400, { error: '无效的订单状态' });
        }

        const cleanType = type && String(type).trim() ? String(type).trim() : null;
        if (cleanType && !['right', 'digital', 'artwork'].includes(cleanType)) {
            return adminResult(400, { error: '无效的商品类型' });
        }

        // 清理输入
        const cleanPage = parseInt(page);
        const cleanLimit = parseInt(limit);
        const cleanStatus = status ? status.trim() : null;
        const cleanKeyword = sanitizeOrderSearchKeyword(keyword != null ? String(keyword) : '');

        // 构建查询条件（列表与计数使用相同 JOIN / WHERE，保证分页 total 一致）
        const fromSql = `
            FROM orders o
            LEFT JOIN wx_users u ON o.user_id = u.id
        `;
        const whereParts = [];
        const whereParams = [];

        if (cleanStatus) {
            whereParts.push('o.trade_state = ?');
            whereParams.push(cleanStatus);
        }

        if (cleanType) {
            whereParts.push(
                'EXISTS (SELECT 1 FROM order_items oi_f WHERE oi_f.order_id = o.id AND oi_f.type = ?)'
            );
            whereParams.push(cleanType);
        }

        if (cleanKeyword) {
            const likeVal = `%${cleanKeyword}%`;
            const idClause = /^\d+$/.test(cleanKeyword) ? ' OR o.user_id = ?' : '';
            whereParts.push(`(
                o.out_trade_no LIKE ?
                OR (o.transaction_id IS NOT NULL AND o.transaction_id LIKE ?)
                OR (u.nickname IS NOT NULL AND u.nickname LIKE ?)
                OR (o.body IS NOT NULL AND o.body LIKE ?)${idClause}
            )`);
            whereParams.push(likeVal, likeVal, likeVal, likeVal);
            if (idClause) whereParams.push(parseInt(cleanKeyword, 10));
        }

        const whereSql = whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : '';

        let query = `
            SELECT o.*, u.nickname as user_nickname, u.avatar as user_avatar
            ${fromSql}
            ${whereSql}
        `;
        let countQuery = `SELECT COUNT(*) as total ${fromSql} ${whereSql}`;
        const params = [...whereParams];
        const countParams = [...whereParams];

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
                     oi.address_id,
                     oi.delivery_qr_code_url,
                     oi.delivery_qr_code_at,
                     r.title as right_title,
                     r.price as right_price,
                     r.original_price as right_original_price,
                     r.description as right_description,
                     r.status as right_status,
                     r.remaining_count as right_remaining_count,
                     ri.image_url as right_image_url,
                     ${DIGITAL_ITEM_SELECT_SQL},
                    oa.title as artwork_title,
                    oa.original_price as artwork_original_price,
                    oa.discount_price as artwork_discount_price,
                    oa.description as artwork_description,
                    oa.image as artwork_image,
                    wa.receiver_name,
                    wa.receiver_phone,
                    wa.province,
                    wa.city,
                    wa.district,
                    wa.detail_address,
                    wa.is_default
                FROM order_items oi
                LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
                LEFT JOIN right_images ri ON oi.type = 'right' AND oi.right_id = ri.right_id
                ${DIGITAL_ITEM_JOIN_SQL}
                LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
                LEFT JOIN wx_user_addresses wa ON oi.address_id = wa.id
                WHERE oi.order_id = ?
            `, [order.id]);

            // 处理订单项数据
            const orderItemsWithImages = orderItems.map(item => {
                let processedItem = {
                    id: item.id,
                    type: item.type,
                    right_id: item.right_id != null ? item.right_id : null,
                    digital_artwork_id: item.digital_artwork_id != null ? item.digital_artwork_id : null,
                    artwork_id: item.artwork_id != null ? item.artwork_id : null,
                    quantity: item.quantity,
                    price: item.price,
                    address_id: item.address_id,
                    ...mapDigitalItemQrFields(item),
                    address: item.address_id ? {
                        id: item.address_id,
                        receiver_name: item.receiver_name,
                        receiver_phone: item.receiver_phone,
                        province: item.province,
                        city: item.city,
                        district: item.district,
                        detail_address: item.detail_address,
                        is_default: item.is_default === 1,
                        full_address: `${item.province} ${item.city} ${item.district} ${item.detail_address}`
                    } : null
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
                    const digitalFulfillment = buildDigitalItemFulfillment({
                        tradeState: order.trade_state,
                        qrCodeUrl: item.delivery_qr_code_url,
                        qrCodeAt: item.delivery_qr_code_at,
                    });
                    processedItem = {
                        ...processedItem,
                        title: item.digital_title,
                        description: item.digital_description,
                        images: item.digital_image_url ? [item.digital_image_url] : [],
                        fulfillment: digitalFulfillment,
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

                return {
                    ...processedItem,
                    business_ids: {
                        right_id: processedItem.right_id,
                        digital_artwork_id: processedItem.digital_artwork_id,
                        artwork_id: processedItem.artwork_id,
                    },
                };
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
                logger.error('查询微信支付状态失败', { err: error });
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

        return adminResult(200, {
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
        logger.error('管理员查询订单列表失败', { err: error });
        return adminResult(500, {
            success: false,
            error: '管理员查询订单列表失败'
        });
    }
}

async function checkRepayable(req) {
    try {
        const { out_trade_no, openid } = req.query;

        // 输入验证
        if (!out_trade_no || typeof out_trade_no !== 'string' || out_trade_no.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的商户订单号' });
        }

        if (!openid || typeof openid !== 'string' || openid.trim().length === 0) {
            return adminResult(400, { error: '缺少有效的openid' });
        }

        if (out_trade_no.length > 64) {
            return adminResult(400, { error: '商户订单号长度不能超过64个字符' });
        }

        const cleanOutTradeNo = out_trade_no.trim();
        const cleanOpenid = openid.trim();

        // 查询订单信息
        const [orders] = await db.query(`
            SELECT o.*, u.id as user_id 
            FROM orders o 
            JOIN wx_users u ON o.user_id = u.id 
            WHERE o.out_trade_no = ? AND u.openid = ?
        `, [cleanOutTradeNo, cleanOpenid]);

        if (orders.length === 0) {
            return adminResult(404, {
                error: '订单不存在或不属于当前用户',
                repayable: false,
                reason: '订单不存在'
            });
        }

        const order = orders[0];

        // 检查订单状态
        if (order.trade_state === 'SUCCESS') {
            return adminResult(200, {
                repayable: false,
                reason: '订单已支付成功，不能重复支付',
                order_status: 'SUCCESS',
                order_info: {
                    out_trade_no: order.out_trade_no,
                    total_fee: order.total_fee,
                    actual_fee: order.actual_fee,
                    trade_state: order.trade_state,
                    success_time: order.success_time
                }
            });
        }

        if (order.trade_state === 'REFUND') {
            return adminResult(200, {
                repayable: false,
                reason: '订单已退款，不能重复支付',
                order_status: 'REFUND',
                order_info: {
                    out_trade_no: order.out_trade_no,
                    total_fee: order.total_fee,
                    actual_fee: order.actual_fee,
                    trade_state: order.trade_state
                }
            });
        }

        // 查询订单项信息
        const [orderItems] = await db.query(`
             SELECT 
                 oi.*,
                 r.title as right_title,
                 r.price as right_price,
                 r.original_price as right_original_price,
                 r.description as right_description,
                 r.status as right_status,
                 r.remaining_count as right_remaining_count,
                 ri.image_url as right_image_url,
                 ${DIGITAL_ITEM_SELECT_SQL},
                oa.title as artwork_title,
                oa.original_price as artwork_original_price,
                oa.discount_price as artwork_discount_price,
                oa.description as artwork_description,
                oa.image as artwork_image,
                oa.stock as artwork_stock
            FROM order_items oi
            LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
            LEFT JOIN right_images ri ON oi.type = 'right' AND oi.right_id = ri.right_id
            ${DIGITAL_ITEM_JOIN_SQL}
            LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
            WHERE oi.order_id = ?
        `, [order.id]);

        // 检查商品库存和状态
        const stockCheck = orderItems.map(item => {
            if (item.type === 'right') {
                return {
                    type: 'right',
                    id: item.right_id,
                    title: item.right_title,
                    available: item.right_status === 'onsale' && item.right_remaining_count >= item.quantity,
                    stock: item.right_remaining_count,
                    required: item.quantity,
                    status: item.right_status
                };
            } else if (item.type === 'artwork') {
                return {
                    type: 'artwork',
                    id: item.artwork_id,
                    title: item.artwork_title,
                    available: item.artwork_stock >= item.quantity,
                    stock: item.artwork_stock,
                    required: item.quantity
                };
            } else if (item.type === 'digital') {
                return {
                    type: 'digital',
                    id: item.digital_artwork_id,
                    title: item.digital_title,
                    available: item.digital_batch_quantity >= item.quantity,
                    stock: item.digital_batch_quantity,
                    required: item.quantity
                };
            }
        });

        const unavailableItems = stockCheck.filter(item => !item.available);

        if (unavailableItems.length > 0) {
            return adminResult(200, {
                repayable: false,
                reason: '部分商品库存不足或已下架',
                unavailable_items: unavailableItems,
                order_status: order.trade_state || 'NOTPAY',
                order_info: {
                    out_trade_no: order.out_trade_no,
                    total_fee: order.total_fee,
                    actual_fee: order.actual_fee,
                    trade_state: order.trade_state
                }
            });
        }

        // 可以重复支付
        return adminResult(200, {
            repayable: true,
            reason: '订单可以重复支付',
            order_status: order.trade_state || 'NOTPAY',
            order_info: {
                out_trade_no: order.out_trade_no,
                total_fee: order.total_fee,
                actual_fee: order.actual_fee,
                trade_state: order.trade_state,
                created_at: order.created_at,
                updated_at: order.updated_at
            },
            items: orderItems.map(item => ({
                id: item.id,
                sku_id: item.sku_id = item.type === 'right' ? item.right_id : item.type === 'digital' ? item.digital_artwork_id : item.artwork_id,
                type: item.type,
                quantity: item.quantity,
                price: item.price,
                title: item.type === 'right' ? item.right_title :
                    item.type === 'digital' ? item.digital_title :
                        item.artwork_title,
                description: item.type === 'right' ? item.right_description :
                    item.type === 'digital' ? item.digital_description :
                        item.artwork_description,
                image: item.type === 'right' ? item.right_image_url :
                    item.type === 'digital' ? item.digital_image_url :
                        item.artwork_image
            }))
        });

    } catch (error) {
        logger.error('检查订单重复支付状态失败', { err: error });
        return adminResult(500, {
            success: false,
            error: '检查订单重复支付状态失败'
        });
    }
}

const TRADE_TYPE_LABEL_MAP = {
    JSAPI: '小程序/公众号支付',
    NATIVE: '扫码支付',
    APP: 'APP支付',
    MICROPAY: '付款码支付',
    MWEB: 'H5支付',
};

function tradeTypeLabel(code) {
    if (!code) return null;
    return TRADE_TYPE_LABEL_MAP[code] || String(code);
}

function bankTypeDisplay(code) {
    if (!code) return null;
    if (code === 'OTHERS' || code === 'OTHER') return '其他/余额等';
    return String(code);
}

function parseRefundAmountJson(amountRaw) {
    if (!amountRaw) return { refund_yuan: null, total_yuan: null };
    try {
        const a = typeof amountRaw === 'string' ? JSON.parse(amountRaw) : amountRaw;
        const refundFen = a.refund != null ? Number(a.refund) : null;
        const totalFen = a.total != null ? Number(a.total) : null;
        return {
            refund_yuan: refundFen != null && !Number.isNaN(refundFen) ? Math.round(refundFen) / 100 : null,
            total_yuan: totalFen != null && !Number.isNaN(totalFen) ? Math.round(totalFen) / 100 : null,
        };
    } catch {
        return { refund_yuan: null, total_yuan: null };
    }
}

function toIsoOrNull(d) {
    if (d == null) return null;
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
    if (Number.isNaN(t)) return null;
    return new Date(t).toISOString();
}

function maskOpenid(openid) {
    if (!openid || typeof openid !== 'string') return null;
    const s = openid.trim();
    if (s.length <= 8) return '***';
    return `${s.slice(0, 3)}***${s.slice(-4)}`;
}

function parseJsonColumn(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(String(raw));
    } catch {
        return null;
    }
}

function mapShipmentRowFromDb(row) {
    return {
        id: row.id,
        delivery_id: row.delivery_id,
        waybill_id: row.waybill_id,
        wechat_order_id: row.wechat_order_id,
        biz_id: row.biz_id,
        service_type: row.service_type,
        service_name: row.service_name,
        use_insured: row.use_insured,
        insured_value_fen: row.insured_value_fen,
        add_source: row.add_source != null ? Number(row.add_source) : 0,
        wx_appid: row.wx_appid != null ? String(row.wx_appid) : null,
        waybill_data: parseJsonColumn(row.waybill_data_json) || [],
        company_name: row.company_name,
        status: row.status,
        created_at: toIsoOrNull(row.created_at),
        updated_at: toIsoOrNull(row.updated_at),
    };
}

function buildDigitalItemFulfillment({ tradeState, tradeStateDesc, qrCodeUrl, qrCodeAt }) {
    const state = tradeState || 'UNKNOWN';
    const hasQrCode = Boolean(qrCodeUrl && String(qrCodeUrl).trim());
    const isPaid = state === 'SUCCESS';

    let status = 'unknown';
    let statusLabel = '未知状态';
    let hint = tradeStateDesc || '订单状态未知，请稍后重试或联系客服。';

    if (state === 'NOTPAY') {
        status = 'awaiting_payment';
        statusLabel = '待支付';
        hint = '支付成功后，管理员将上传藏品二维码。';
    } else if (state === 'PAYERROR') {
        status = 'payment_failed';
        statusLabel = '支付失败';
        hint = tradeStateDesc || '支付未完成，请重新下单或联系客服。';
    } else if (state === 'SUCCESS') {
        status = hasQrCode ? 'delivered' : 'awaiting_qr_code';
        statusLabel = hasQrCode ? '已交付' : '待上传二维码';
        hint = hasQrCode
            ? '请使用下方二维码完成数字藏品领取。'
            : '支付成功，管理员正在准备交付二维码，请稍后查看。';
    } else if (state === 'CLOSED') {
        status = 'closed';
        statusLabel = '已关闭';
        hint = tradeStateDesc || '订单已关闭，无法继续支付。';
    } else if (state === 'REVOKED') {
        status = 'cancelled';
        statusLabel = '已撤销';
        hint = tradeStateDesc || '订单已撤销。';
    } else if (state === 'REFUND') {
        status = 'refunded';
        statusLabel = '已退款';
        hint = tradeStateDesc || '订单已退款。';
    }

    return {
        type: 'digital_qr_code',
        status,
        status_label: statusLabel,
        qr_code_url: isPaid && hasQrCode ? String(qrCodeUrl).trim() : null,
        qr_code_uploaded_at: hasQrCode ? toIsoOrNull(qrCodeAt) : null,
        hint,
    };
}

function mapDigitalItemQrFields(itemRow) {
    const qrCodeUrl = itemRow.delivery_qr_code_url || null;
    const qrCodeAt = itemRow.delivery_qr_code_at || null;
    return {
        delivery_qr_code_url: qrCodeUrl,
        delivery_qr_code_at: toIsoOrNull(qrCodeAt),
        qr_code_url: qrCodeUrl,
        qr_code_uploaded_at: toIsoOrNull(qrCodeAt),
    };
}

function mapShipmentsForBuyer(shipments) {
    if (!Array.isArray(shipments)) return [];
    return shipments.map((s) => {
        const row = {
            id: s.id,
            delivery_id: s.delivery_id,
            waybill_id: s.waybill_id,
            service_type: s.service_type,
            service_name: s.service_name,
            waybill_data: s.waybill_data,
            company_name: s.company_name,
            created_at: s.created_at,
            use_insured: s.use_insured,
            insured_value_fen: s.insured_value_fen,
        };
        if (s.wechat_path) row.wechat_path = s.wechat_path;
        if (s.wechat_path_error) row.wechat_path_error = s.wechat_path_error;
        return row;
    });
}

function buildPhysicalItemLogistics(primaryShipment, includeWechatPath, options = {}) {
    const audience = options.audience === 'buyer' ? 'buyer' : 'admin';
    if (!primaryShipment) {
        return {
            waybill_id: null,
            delivery_id: null,
            company_name: null,
            hint: audience === 'buyer'
                ? '商家发货后将在此展示运单与物流进度。'
                : '尚未生成微信运单；可在订单管理「物流」中发货。',
        };
    }
    const out = {
        shipment_id: primaryShipment.id,
        waybill_id: primaryShipment.waybill_id,
        delivery_id: primaryShipment.delivery_id,
        company_name: primaryShipment.company_name,
        wechat_order_id: primaryShipment.wechat_order_id,
        biz_id: primaryShipment.biz_id,
        service_type: primaryShipment.service_type,
        service_name: primaryShipment.service_name,
        use_insured: primaryShipment.use_insured,
        insured_value_fen: primaryShipment.insured_value_fen,
        add_source: primaryShipment.add_source,
        wx_appid: primaryShipment.wx_appid,
        waybill_data: primaryShipment.waybill_data,
        shipment_created_at: primaryShipment.created_at,
    };
    if (audience === 'buyer') {
        delete out.wechat_order_id;
        delete out.biz_id;
        delete out.wx_appid;
        delete out.add_source;
    }
    if (includeWechatPath) {
        if (primaryShipment.wechat_path) out.wechat_path = primaryShipment.wechat_path;
        if (primaryShipment.wechat_path_error) out.wechat_path_error = primaryShipment.wechat_path_error;
    }
    return out;
}

/**
 * 订单详情：admin 用库表主键 id；buyer 用商户订单号 out_trade_no + 本人 user_id（小程序/H5）
 */
async function orderDetailForActor(req, options = {}) {
    await ensureOrderItemsQrCodeColumns();

    const mode = options.mode === 'buyer' ? 'buyer' : 'admin';

    let buyerId = null;
    if (mode === 'buyer') {
        buyerId = Number(req.user?.id);
        if (req.user?.id == null || Number.isNaN(buyerId) || buyerId <= 0) {
            return adminResult(401, { success: false, error: '请先登录' });
        }
    }

    let outTradeNo = '';
    let adminNumericId = null;
    if (mode === 'buyer') {
        const fromOpt = options.out_trade_no != null ? String(options.out_trade_no).trim() : '';
        const fromQuery = req.query?.out_trade_no != null ? String(req.query.out_trade_no).trim() : '';
        outTradeNo = fromOpt || fromQuery;
        if (!outTradeNo || outTradeNo.length > 64) {
            return adminResult(400, { success: false, error: '缺少或无效的订单号（请传 out_trade_no）' });
        }
    } else {
        const rawId = req.params.id;
        adminNumericId = parseInt(String(rawId), 10);
        if (!rawId || Number.isNaN(adminNumericId) || adminNumericId <= 0) {
            return adminResult(400, { success: false, error: '无效的订单 ID' });
        }
    }

    try {
        let orderSql = `SELECT o.*, u.nickname AS user_nickname, u.avatar AS user_avatar
             FROM orders o
             LEFT JOIN wx_users u ON o.user_id = u.id
             WHERE `;
        const orderParams = [];
        if (mode === 'buyer') {
            orderSql += 'o.out_trade_no = ? AND o.user_id = ?';
            orderParams.push(outTradeNo, buyerId);
        } else {
            orderSql += 'o.id = ?';
            orderParams.push(adminNumericId);
        }
        orderSql += ' LIMIT 1';
        const [orderRows] = await db.query(orderSql, orderParams);
        if (!orderRows || orderRows.length === 0) {
            const notFoundMsg = mode === 'buyer' ? '订单不存在或无权查看' : '订单不存在';
            return adminResult(404, { success: false, error: notFoundMsg });
        }
        const order = orderRows[0];
        const internalOrderId = order.id;
        const syncedPayment = await syncOrderTradeStateFromWechat(order);
        const effectiveTradeState = syncedPayment.tradeState;
        const effectiveTradeStateDesc = syncedPayment.tradeStateDesc;
        const wxPay = syncedPayment.wxPay;

        const includeWechatPath = req.query && (
            req.query.include_wechat_path === '1'
            || req.query.include_wechat_path === 'true'
            || req.query.include_wechat_path === 'yes'
        );

        let shipmentRows = [];
        try {
            const [rows] = await db.query(
                `SELECT id, order_id, delivery_id, waybill_id, wechat_order_id, biz_id, service_type, service_name,
                use_insured, insured_value_fen, add_source, wx_appid, waybill_data_json, company_name, status, created_at, updated_at
                FROM order_shipments WHERE order_id = ? AND status = 'active' ORDER BY id DESC`,
                [internalOrderId]
            );
            shipmentRows = rows || [];
        } catch (shipErr) {
            logger.warn('order_shipments 查询失败；未建表执行 001，缺列执行 002：sql/migrations/001_order_shipments.sql / 002_order_shipments_add_source_wx_appid.sql', {
                err: shipErr,
                internalOrderId,
            });
            shipmentRows = [];
        }

        const shipments = shipmentRows.map((row) => mapShipmentRowFromDb(row));

        if (includeWechatPath && shipments.length > 0) {
            for (let i = 0; i < shipments.length; i += 1) {
                const pathBody = {
                    internal_order_id: internalOrderId,
                    delivery_id: shipments[i].delivery_id,
                    waybill_id: shipments[i].waybill_id,
                    add_source: shipments[i].add_source === 2 ? 2 : 0,
                };
                if (shipments[i].add_source === 2 && shipments[i].wx_appid) {
                    pathBody.wx_appid = shipments[i].wx_appid;
                }
                const r = await logisticsService.getPath({ body: pathBody });
                if (r.ok && r.body) {
                    shipments[i].wechat_path = {
                        path_item_num: r.body.path_item_num,
                        path_item_list: r.body.path_item_list || [],
                    };
                } else {
                    shipments[i].wechat_path = null;
                    shipments[i].wechat_path_error = r.body || { error: 'getPath failed' };
                }
            }
        }

        const primaryShipment = shipments.length > 0 ? shipments[0] : null;

        const [orderItems] = await db.query(
            `SELECT
                oi.id,
                oi.type,
                oi.right_id,
                oi.digital_artwork_id,
                oi.artwork_id,
                oi.quantity,
                oi.price,
                oi.address_id,
                oi.delivery_qr_code_url,
                oi.delivery_qr_code_at,
                r.title AS right_title,
                r.description AS right_description,
                (SELECT ri.image_url FROM right_images ri WHERE ri.right_id = oi.right_id ORDER BY ri.id ASC LIMIT 1) AS right_image_url,
                ${DIGITAL_ITEM_SELECT_SQL},
                oa.title AS artwork_title,
                oa.description AS artwork_description,
                oa.image AS artwork_image,
                wa.receiver_name,
                wa.receiver_phone,
                wa.province,
                wa.city,
                wa.district,
                wa.detail_address,
                wa.is_default
            FROM order_items oi
            LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
            ${DIGITAL_ITEM_JOIN_SQL}
            LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
            LEFT JOIN wx_user_addresses wa ON oi.address_id = wa.id
            WHERE oi.order_id = ?
            ORDER BY oi.id ASC`,
            [internalOrderId]
        );

        let itemsSubtotalYuan = 0;
        const items = (orderItems || []).map((row) => {
            const qty = Number(row.quantity) > 0 ? Number(row.quantity) : 1;
            const linePrice = parseFloat(row.price);
            const lineTotal = (Number.isFinite(linePrice) ? linePrice : 0) * qty;
            itemsSubtotalYuan += lineTotal;

            const base = {
                id: row.id,
                type: row.type,
                right_id: row.right_id,
                digital_artwork_id: row.digital_artwork_id,
                artwork_id: row.artwork_id,
                quantity: qty,
                price: row.price,
                address_id: row.address_id,
                line_subtotal_yuan: Math.round(lineTotal * 100) / 100,
            };

            const addressSnapshot = row.address_id
                ? {
                    receiver_name: row.receiver_name,
                    receiver_phone: row.receiver_phone,
                    province: row.province,
                    city: row.city,
                    district: row.district,
                    detail_address: row.detail_address,
                    full_address: [row.province, row.city, row.district, row.detail_address].filter(Boolean).join(' '),
                    is_default: row.is_default === 1,
                }
                : null;

            let title = '';
            let description = '';
            let images = [];
            if (row.type === 'right') {
                title = row.right_title;
                description = row.right_description;
                images = row.right_image_url ? [row.right_image_url] : [];
            } else if (row.type === 'digital') {
                title = row.digital_title;
                description = row.digital_description;
                images = row.digital_image_url ? [row.digital_image_url] : [];
            } else if (row.type === 'artwork') {
                title = row.artwork_title;
                description = row.artwork_description;
                images = row.artwork_image ? [row.artwork_image] : [];
            }

            const digitalFulfillment = row.type === 'digital'
                ? buildDigitalItemFulfillment({
                    tradeState: effectiveTradeState,
                    tradeStateDesc: effectiveTradeStateDesc,
                    qrCodeUrl: row.delivery_qr_code_url,
                    qrCodeAt: row.delivery_qr_code_at,
                })
                : null;

            const logisticsPayload = row.type === 'right' || row.type === 'artwork'
                ? buildPhysicalItemLogistics(primaryShipment, includeWechatPath, { audience: mode })
                : null;

            return {
                ...base,
                ...mapDigitalItemQrFields(row),
                business_ids: {
                    right_id: row.right_id != null ? row.right_id : null,
                    digital_artwork_id: row.digital_artwork_id != null ? row.digital_artwork_id : null,
                    artwork_id: row.artwork_id != null ? row.artwork_id : null,
                },
                title,
                description,
                images,
                address_snapshot: addressSnapshot,
                fulfillment: {
                    address_snapshot: addressSnapshot,
                    logistics: logisticsPayload,
                    digital: digitalFulfillment,
                },
            };
        });

        const discountYuan = parseFloat(order.discount_amount) || 0;
        const totalFeeYuan = parseFloat(order.total_fee) || 0;
        const actualFeeYuan = parseFloat(order.actual_fee) || 0;
        const shippingFeeYuan = 0;

        const fee = {
            currency: 'CNY',
            items_subtotal_yuan: Math.round(itemsSubtotalYuan * 100) / 100,
            shipping_fee_yuan: shippingFeeYuan,
            shipping_note: '当前库表未单独记录运费，按 0 展示；若含运费请后续扩展字段。',
            discount_yuan: Math.round(discountYuan * 100) / 100,
            amount_payable_yuan: Math.round(actualFeeYuan * 100) / 100,
            amount_paid_yuan: effectiveTradeState === 'SUCCESS' ? Math.round(actualFeeYuan * 100) / 100 : null,
            order_total_before_discount_yuan: Math.round(totalFeeYuan * 100) / 100,
        };

        const payment = {
            transaction_id: wxPay?.transaction_id || order.transaction_id || null,
            trade_state: effectiveTradeState,
            trade_state_desc: effectiveTradeStateDesc,
            trade_type: wxPay?.trade_type || order.trade_type || null,
            trade_type_label: tradeTypeLabel(wxPay?.trade_type || order.trade_type),
            bank_type: wxPay?.bank_type || null,
            bank_type_display: bankTypeDisplay(wxPay?.bank_type),
            success_time: wxPay?.success_time || toIsoOrNull(order.success_time),
            amount_payer_total_fen: wxPay?.amount?.payer_total != null ? Number(wxPay.amount.payer_total) : null,
            amount_total_fen: wxPay?.amount?.total != null ? Number(wxPay.amount.total) : null,
            currency: wxPay?.amount?.currency || 'CNY',
            payer_openid_masked: maskOpenid(wxPay?.payer?.openid),
        };

        const [refundRows] = await db.query(
            'SELECT * FROM refund_requests WHERE out_trade_no = ? ORDER BY id ASC',
            [order.out_trade_no]
        );

        const refunds = (refundRows || []).map((r) => {
            const amt = parseRefundAmountJson(r.amount);
            return {
                id: r.id,
                out_refund_no: r.out_refund_no,
                wx_refund_id: r.wx_refund_id || null,
                status: r.status,
                reason: r.reason || null,
                reject_reason: r.reject_reason || null,
                refund_amount_yuan: amt.refund_yuan,
                order_total_snapshot_yuan: amt.total_yuan,
                created_at: toIsoOrNull(r.created_at),
                approved_at: toIsoOrNull(r.approved_at),
                rejected_at: toIsoOrNull(r.rejected_at),
                updated_at: toIsoOrNull(r.updated_at),
            };
        });

        const timeline = [];

        timeline.push({
            stage: 'ORDER_CREATED',
            at: toIsoOrNull(order.created_at),
            title: '订单创建',
            description: order.body || '—',
        });

        if (effectiveTradeState === 'NOTPAY' || effectiveTradeState === 'PAYERROR') {
            timeline.push({
                stage: 'AWAITING_PAYMENT',
                at: toIsoOrNull(order.updated_at),
                title: '待支付/待完成',
                description: effectiveTradeStateDesc || `当前状态：${effectiveTradeState}`,
            });
        }

        const paidAt = wxPay?.success_time || toIsoOrNull(order.success_time);
        if (paidAt && (effectiveTradeState === 'SUCCESS' || effectiveTradeState === 'REFUND')) {
            timeline.push({
                stage: 'PAID',
                at: paidAt,
                title: '支付成功',
                description: (wxPay?.transaction_id || order.transaction_id)
                    ? `微信订单号：${wxPay?.transaction_id || order.transaction_id}`
                    : '已支付',
            });
        }

        for (const r of refunds) {
            timeline.push({
                stage: 'REFUND_APPLIED',
                at: r.created_at,
                title: '退款申请',
                description: [r.out_refund_no, r.reason ? `原因：${r.reason}` : ''].filter(Boolean).join(' · ') || '—',
            });
            if (r.approved_at) {
                timeline.push({
                    stage: 'REFUND_APPROVED',
                    at: r.approved_at,
                    title: '退款已批准',
                    description: r.wx_refund_id ? `微信退款单：${r.wx_refund_id}` : `退款单 ${r.out_refund_no || ''}`,
                });
            }
            if (r.rejected_at) {
                timeline.push({
                    stage: 'REFUND_REJECTED',
                    at: r.rejected_at,
                    title: '退款已拒绝',
                    description: r.reject_reason || '—',
                });
            }
            if (r.status === 'SUCCESS') {
                timeline.push({
                    stage: 'REFUND_SUCCESS',
                    at: r.updated_at || r.approved_at,
                    title: '退款到账',
                    description: `约 ¥${r.refund_amount_yuan != null ? r.refund_amount_yuan : '—'}`,
                });
            }
            if (r.status === 'FAILED') {
                timeline.push({
                    stage: 'REFUND_FAILED',
                    at: r.updated_at,
                    title: '退款失败',
                    description: r.reject_reason || '见微信/银行返回',
                });
            }
        }

        if (effectiveTradeState === 'REFUND') {
            timeline.push({
                stage: 'ORDER_REFUNDED',
                at: toIsoOrNull(order.updated_at),
                title: '订单已退款',
                description: effectiveTradeStateDesc || '交易关闭或已退款',
            });
        }

        if (effectiveTradeState === 'CLOSED' || effectiveTradeState === 'REVOKED') {
            timeline.push({
                stage: 'ORDER_CLOSED',
                at: toIsoOrNull(order.updated_at),
                title: effectiveTradeState === 'REVOKED' ? '订单已撤销' : '订单已关闭',
                description: effectiveTradeStateDesc || '',
            });
        }

        timeline.sort((a, b) => {
            const ta = a.at ? new Date(a.at).getTime() : 0;
            const tb = b.at ? new Date(b.at).getTime() : 0;
            return ta - tb;
        });

        const shipmentsForResponse = mode === 'buyer' ? mapShipmentsForBuyer(shipments) : shipments;

        const orderPayload = {
            id: order.id,
            out_trade_no: order.out_trade_no,
            body: order.body,
            trade_state: effectiveTradeState,
            trade_state_desc: effectiveTradeStateDesc,
            created_at: toIsoOrNull(order.created_at),
            updated_at: toIsoOrNull(order.updated_at),
            user_nickname: order.user_nickname,
            user_avatar: order.user_avatar,
        };
        if (mode === 'admin') {
            orderPayload.user_id = order.user_id;
        }

        const statusFields = buildOrderStatusFields(effectiveTradeState, effectiveTradeStateDesc);
        const latestRefund = refunds.length > 0 ? refunds[refunds.length - 1] : null;
        const refundStatus = latestRefund
            ? {
                status: latestRefund.status,
                out_refund_no: latestRefund.out_refund_no,
                wx_refund_id: latestRefund.wx_refund_id,
                created_at: latestRefund.created_at,
            }
            : null;

        const listCompatibleItems = items.map((item) => ({
            type: item.type,
            title: item.title,
            image: item.images?.[0] || null,
            quantity: item.quantity,
            price: Number(item.price) || 0,
        }));

        const detailData = {
            out_trade_no: order.out_trade_no,
            created_at: toIsoOrNull(order.created_at),
            total_fee: Number(order.total_fee) || 0,
            ...statusFields,
            refund_status: refundStatus,
            items: listCompatibleItems,
            fee,
            payment,
            timeline,
            refunds,
            shipments: shipmentsForResponse,
            detail_items: items,
        };

        if (mode === 'buyer') {
            return adminResult(200, {
                success: true,
                data: {
                    ...detailData,
                    order: orderPayload,
                },
            });
        }

        return adminResult(200, {
            success: true,
            data: {
                ...detailData,
                order: orderPayload,
            },
        });
    } catch (error) {
        const errMsg = mode === 'buyer' ? '查询订单详情失败' : '管理员查询订单详情失败';
        logger.error(errMsg, { err: error, mode });
        return adminResult(500, { success: false, error: errMsg });
    }
}

async function adminOrderDetail(req) {
    return orderDetailForActor(req, { mode: 'admin' });
}

async function buyerOrderDetail(req) {
    return orderDetailForActor(req, { mode: 'buyer' });
}

function isValidQrCodeUrl(raw) {
    if (raw == null || typeof raw !== 'string') return false;
    const url = raw.trim();
    if (!url || url.length > 512) return false;
    return /^https?:\/\//i.test(url);
}

async function fetchWxPayOrderByOutTradeNo(outTradeNo) {
    const cleanOutTradeNo = String(outTradeNo || '').trim();
    if (!cleanOutTradeNo) return null;

    try {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const nonceStr = generateNonceStr();
        const method = 'GET';
        const pathUrl = `/v3/pay/transactions/out-trade-no/${cleanOutTradeNo}?mchid=${WX_PAY_CONFIG.mchId}`;
        const signature = generateSignV3(method, pathUrl, timestamp, nonceStr, '');
        const response = await axios.get(
            `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${cleanOutTradeNo}?mchid=${WX_PAY_CONFIG.mchId}`,
            {
                headers: {
                    Accept: 'application/json',
                    Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
                    'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
                    'User-Agent': 'axios/1.9.0',
                },
                timeout: 15000,
            }
        );
        if (response.status === 200) return response.data;
    } catch (err) {
        logger.warn('查询微信支付单失败', { err: err.message, out_trade_no: cleanOutTradeNo });
    }
    return null;
}

async function syncOrderTradeStateFromWechat(orderRow) {
    const dbState = orderRow?.trade_state || null;
    const dbDesc = orderRow?.trade_state_desc || null;
    const wxPay = await fetchWxPayOrderByOutTradeNo(orderRow?.out_trade_no);

    if (!wxPay?.trade_state) {
        return {
            order: orderRow,
            wxPay: null,
            tradeState: dbState,
            tradeStateDesc: dbDesc,
            didSync: false,
        };
    }

    if (dbState === 'REFUND') {
        return {
            order: orderRow,
            wxPay,
            tradeState: dbState,
            tradeStateDesc: dbDesc,
            didSync: false,
        };
    }

    const wxState = wxPay.trade_state;
    const wxDesc = wxPay.trade_state_desc || dbDesc;
    let didSync = false;

    if (wxState !== dbState && orderRow?.id) {
        const successTime = wxPay.success_time ? formatWechatTime(wxPay.success_time) : null;
        await db.query(
            `UPDATE orders SET
                transaction_id = COALESCE(?, transaction_id),
                trade_type = COALESCE(?, trade_type),
                trade_state = ?,
                trade_state_desc = ?,
                success_time = CASE WHEN ? IS NOT NULL THEN ? ELSE success_time END,
                updated_at = NOW()
             WHERE id = ? AND trade_state != 'REFUND'`,
            [
                wxPay.transaction_id || null,
                wxPay.trade_type || null,
                wxState,
                wxDesc,
                successTime,
                successTime,
                orderRow.id,
            ]
        );
        orderRow.trade_state = wxState;
        orderRow.trade_state_desc = wxDesc;
        if (wxPay.transaction_id) orderRow.transaction_id = wxPay.transaction_id;
        if (wxPay.trade_type) orderRow.trade_type = wxPay.trade_type;
        if (successTime) orderRow.success_time = successTime;
        didSync = true;
    }

    if (wxState === 'SUCCESS' && orderRow?.out_trade_no) {
        if (didSync || dbState === 'NOTPAY') {
            await cancelPaymentPendingReminder(orderRow.out_trade_no).catch((err) => {
                logger.warn('同步支付成功时取消待付款提醒失败', {
                    outTradeNo: orderRow.out_trade_no,
                    err: err?.message || err,
                });
            });
        }
        if (didSync) {
            await emitPaymentSuccessSubscribeNotifies({
                outTradeNo: orderRow.out_trade_no,
                transactionId: wxPay.transaction_id,
                payTime: wxPay.success_time,
            }).catch((err) => {
                logger.warn('同步支付成功通知失败', {
                    outTradeNo: orderRow.out_trade_no,
                    err: err?.message || err,
                });
            });
        }
        try {
            await fulfillPaidOrderInventory(orderRow.out_trade_no);
        } catch (inventoryErr) {
            logger.warn('同步支付成功后扣减库存失败', {
                err: inventoryErr,
                out_trade_no: orderRow.out_trade_no,
            });
        }
    }

    return {
        order: orderRow,
        wxPay,
        tradeState: wxState,
        tradeStateDesc: wxDesc,
        didSync,
    };
}

async function uploadDigitalItemQrCode(req) {
    try {
        await ensureOrderItemsQrCodeColumns();

        const orderId = parseInt(String(req.params.orderId), 10);
        const itemId = parseInt(String(req.params.itemId), 10);
        const { qr_code_url: qrCodeUrl } = req.body || {};

        if (!orderId || Number.isNaN(orderId) || orderId <= 0) {
            return adminResult(400, { success: false, error: '无效的订单 ID' });
        }
        if (!itemId || Number.isNaN(itemId) || itemId <= 0) {
            return adminResult(400, { success: false, error: '无效的订单项 ID' });
        }
        if (!isValidQrCodeUrl(qrCodeUrl)) {
            return adminResult(400, { success: false, error: '请提供有效的二维码图片 URL（http/https）' });
        }

        const cleanUrl = String(qrCodeUrl).trim();

        const [orders] = await db.query(
            `SELECT id, out_trade_no, transaction_id, trade_type, trade_state, trade_state_desc, success_time
             FROM orders WHERE id = ? LIMIT 1`,
            [orderId]
        );
        if (!orders.length) {
            return adminResult(404, { success: false, error: '订单不存在' });
        }

        const { tradeState: effectiveTradeState } = await syncOrderTradeStateFromWechat(orders[0]);
        if (effectiveTradeState !== 'SUCCESS') {
            return adminResult(400, { success: false, error: '仅支付成功的订单可上传交付二维码' });
        }

        const [items] = await db.query(
            `SELECT id, type, digital_artwork_id, delivery_qr_code_url
             FROM order_items
             WHERE id = ? AND order_id = ?
             LIMIT 1`,
            [itemId, orderId]
        );
        if (!items.length) {
            return adminResult(404, { success: false, error: '订单项不存在' });
        }
        if (items[0].type !== 'digital') {
            return adminResult(400, { success: false, error: '仅数字艺术品订单项支持上传二维码' });
        }

        await db.query(
            'UPDATE order_items SET delivery_qr_code_url = ?, delivery_qr_code_at = NOW() WHERE id = ? AND order_id = ?',
            [cleanUrl, itemId, orderId]
        );

        const fulfillment = buildDigitalItemFulfillment({
            tradeState: 'SUCCESS',
            qrCodeUrl: cleanUrl,
            qrCodeAt: new Date(),
        });

        fireSubscribeNotify(
            notifyVirtualDeliveryShipped({
                orderId,
                outTradeNo: orders[0].out_trade_no,
                orderItemId: itemId,
            }),
            'virtualDeliveryShipped',
        );

        return adminResult(200, {
            success: true,
            message: '二维码已保存',
            data: {
                order_id: orderId,
                order_item_id: itemId,
                digital_artwork_id: items[0].digital_artwork_id,
                qr_code_url: fulfillment.qr_code_url,
                qr_code_uploaded_at: fulfillment.qr_code_uploaded_at,
                fulfillment,
            },
        });
    } catch (error) {
        logger.error('上传数字艺术品交付二维码失败', { err: error });
        return adminResult(500, { success: false, error: '上传二维码失败' });
    }
}

module.exports = {
  unifiedOrder,
  singleOrder,
  payNotify,
  closeOrder,
  refund,
  refundApprove,
  listRefundRequests,
  getRefundRequestById,
  refundNotify,
  signPay,
  queryOrder,
  listOrders,
  digitalIdentityPurchases,
  adminOrders,
  checkRepayable,
  adminOrderDetail,
  buyerOrderDetail,
  uploadDigitalItemQrCode,
};

