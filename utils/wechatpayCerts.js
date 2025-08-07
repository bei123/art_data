const fs = require('fs');
const path = require('path');

// 支持多种公钥/证书配置
// key为微信支付平台证书序列号或公钥ID，value为公钥内容
const keys = {
  // 平台证书序列号（推荐）wechatpay_18A6B90BBC01A2FD6B37DA8EDD7A62C48C52DDDD.pem
  //'18A6B90BBC01A2FD6B37DA8EDD7A62C48C52DDDD': fs.readFileSync(path.join(__dirname, '../wechatpay_18A6B90BBC01A2FD6B37DA8EDD7A62C48C52DDDD.pem'), 'utf8'),
  // 微信支付公钥ID（从环境变量获取）
   [process.env.WX_PUB_ID]: fs.readFileSync(path.join(__dirname, '../ssl/pub_key.pem'), 'utf8'),
};

function getWechatpayPublicKey(serialOrKeyId) {
  return keys[serialOrKeyId];
}

module.exports = { getWechatpayPublicKey }; 