const fs = require('fs');
const path = require('path');

// 证书序列号与公钥内容的映射
const certs = {
  '0113606396022025041900441636000800': fs.readFileSync(path.join(__dirname, '../pub_key.pem'), 'utf8')
};

function getWechatpayPublicKey(serialNo) {
  return certs[serialNo];
}

module.exports = { getWechatpayPublicKey }; 