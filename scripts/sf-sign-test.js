const crypto = require('crypto')
const { buildMsgDigest } = require('../services/sfExpressClient')

function javaUrlEncode(text) {
  return encodeURIComponent(text).replace(/%20/g, '+')
}

function digestRaw(msgData, timestamp, checkWord) {
  return crypto.createHash('md5').update(`${msgData}${timestamp}${checkWord}`, 'utf8').digest('base64')
}

function digestWith(encoder, msgData, timestamp, checkWord) {
  const toVerifyText = encoder(`${msgData}${timestamp}${checkWord}`)
  return crypto.createHash('md5').update(toVerifyText, 'utf8').digest('base64')
}

const cases = [
  ['{"language":"zh-CN","orderId":"QIAO-20200618-004"}', '1652410044726', 'cURqDC12jflwXdruegDudWwXBVSsQk7t', 'CGeNU/KaaJGUK+ZD8axtmA=='],
  ['{"language": "zh-CN", "orderId": "QIAO-20200618-004"}', '1652410044726', 'cURqDC12jflwXdruegDudWwXBVSsQk7t', null],
]

for (const [msgData, timestamp, checkWord, expected] of cases) {
  console.log('msgData', msgData)
  console.log('  uri :', digestWith(encodeURIComponent, msgData, timestamp, checkWord))
  console.log('  java:', digestWith(javaUrlEncode, msgData, timestamp, checkWord))
  console.log('  raw :', digestRaw(msgData, timestamp, checkWord))
  console.log('  client:', buildMsgDigest(msgData, timestamp, checkWord))
  if (expected) console.log('  want:', expected)
  console.log('---')
}
