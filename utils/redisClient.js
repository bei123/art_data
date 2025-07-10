const redis = require('redis');

// 连接到本地 Redis 的第2个数据库（DB2）
const redisClient = redis.createClient({
  database: 2
});
redisClient.connect().catch(console.error);

module.exports = redisClient; 