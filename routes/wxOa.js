const express = require('express')
const logger = require('../utils/logger')
const {
  handleOaCallbackVerify,
  handleOaCallbackPost,
} = require('../services/wxCardEventService')

const router = express.Router()

/**
 * 服务号服务器配置回调
 * GET  URL 验证；POST 消息 / 卡券事件
 */
router.get('/callback', (req, res) => {
  try {
    const echo = handleOaCallbackVerify(req.query || {})
    res.status(200).type('text/plain').send(echo)
  } catch (err) {
    logger.warn('服务号回调 URL 验证失败', {
      code: err.code,
      err: err.message,
      query: {
        signature: req.query?.signature ? '[set]' : '',
        msg_signature: req.query?.msg_signature ? '[set]' : '',
        encrypt_type: req.query?.encrypt_type || '',
      },
    })
    res.status(403).type('text/plain').send('invalid signature')
  }
})

router.post('/callback', async (req, res) => {
  try {
    const bodyText = typeof req.body === 'string'
      ? req.body
      : (req.rawBody ? req.rawBody.toString('utf8') : '')

    const result = await handleOaCallbackPost({
      query: req.query || {},
      bodyText,
    })

    logger.info('服务号回调已接收', {
      eventType: result.eventType,
      logId: result.id,
      processStatus: result.processStatus,
      cardId: result.cardId || null,
    })

    // 微信要求尽快返回 success
    res.status(200).type('text/plain').send('success')
  } catch (err) {
    logger.error('服务号回调处理失败', { code: err.code, err: err.message })
    if (
      err.code === 'OA_SIGNATURE_INVALID' ||
      err.code === 'OA_MSG_SIGNATURE_INVALID' ||
      err.code === 'OA_ENCRYPT_MISSING' ||
      err.code === 'OA_AES_KEY_MISSING'
    ) {
      return res.status(403).type('text/plain').send('invalid signature')
    }
    if (err.code === 'OA_CALLBACK_DISABLED' || err.code === 'OA_CALLBACK_NOT_CONFIGURED') {
      return res.status(503).type('text/plain').send('callback unavailable')
    }
    // 返回 success 避免微信无限重试非签名类瞬时错误；已尽量落库
    return res.status(200).type('text/plain').send('success')
  }
})

module.exports = router
