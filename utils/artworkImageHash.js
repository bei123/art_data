const sharp = require('sharp')

const HASH_WIDTH = 9
const HASH_HEIGHT = 8

function hammingDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Number.MAX_SAFE_INTEGER
  let distance = 0
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) distance += 1
  }
  return distance
}

/**
 * 8x9 灰度差分哈希（dHash），用于相近构图/作品的粗匹配
 */
async function computeDifferenceHashFromBuffer(buffer) {
  if (!buffer || !buffer.length) return ''

  const { data } = await sharp(buffer)
    .rotate()
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let hash = ''
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let col = 0; col < HASH_WIDTH - 1; col++) {
      const left = data[row * HASH_WIDTH + col]
      const right = data[row * HASH_WIDTH + col + 1]
      hash += left < right ? '1' : '0'
    }
  }
  return hash
}

function confidenceFromDistance(distance, bitCount = HASH_WIDTH * (HASH_HEIGHT - 1)) {
  if (!Number.isFinite(distance) || distance < 0) return 0
  const clamped = Math.min(bitCount, distance)
  return Math.max(0, Math.min(1, 1 - clamped / bitCount))
}

module.exports = {
  HASH_WIDTH,
  HASH_HEIGHT,
  hammingDistance,
  computeDifferenceHashFromBuffer,
  confidenceFromDistance,
}
