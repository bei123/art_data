const redis = require('redis');

// Redis配置 - 性能优化版本
const redisConfig = {
    // 连接配置
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        connectTimeout: 10000,      // 连接超时
        lazyConnect: true,          // 延迟连接
        keepAlive: 30000,           // 保活时间
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                console.error('Redis重连失败次数过多，停止重连');
                return new Error('Redis重连失败');
            }
            return Math.min(retries * 100, 3000); // 指数退避，最大3秒
        }
    },
    // 数据库选择
    database: 2,
    // 连接池配置
    maxRetriesPerRequest: 3,        // 每个请求最大重试次数
    retryDelayOnFailover: 100,      // 故障转移重试延迟
    // 性能优化
    enableOfflineQueue: false,      // 禁用离线队列
    enableReadyCheck: true,         // 启用就绪检查
    // 内存优化
    maxMemoryPolicy: 'allkeys-lru', // 内存策略
    // 监控配置
    monitor: process.env.NODE_ENV === 'development'
};

// 创建Redis客户端
const redisClient = redis.createClient(redisConfig);

// 连接事件监听
redisClient.on('connect', () => {
    console.log('Redis连接已建立');
});

redisClient.on('ready', () => {
    console.log('Redis客户端已就绪');
});

redisClient.on('error', (err) => {
    console.error('Redis错误:', err);
});

redisClient.on('end', () => {
    console.log('Redis连接已关闭');
});

redisClient.on('reconnecting', () => {
    console.log('Redis正在重连...');
});

// 性能监控
const redisMetrics = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
    responseTimes: []
};

// 包装Redis方法，添加性能监控
const originalGet = redisClient.get.bind(redisClient);
const originalSet = redisClient.set.bind(redisClient);
const originalSetEx = redisClient.setEx.bind(redisClient);
const originalDel = redisClient.del.bind(redisClient);

redisClient.get = async function(key) {
    const startTime = Date.now();
    redisMetrics.totalRequests++;
    
    try {
        const result = await originalGet(key);
        const responseTime = Date.now() - startTime;
        redisMetrics.responseTimes.push(responseTime);
        
        if (result) {
            redisMetrics.cacheHits++;
        } else {
            redisMetrics.cacheMisses++;
        }
        
        // 记录慢查询
        if (responseTime > 100) {
            console.warn(`Redis慢查询: ${responseTime}ms - GET ${key}`);
        }
        
        return result;
    } catch (error) {
        redisMetrics.errors++;
        console.error(`Redis GET错误: ${error.message} - key: ${key}`);
        throw error;
    }
};

redisClient.set = async function(key, value) {
    const startTime = Date.now();
    redisMetrics.totalRequests++;
    
    try {
        const result = await originalSet(key, value);
        const responseTime = Date.now() - startTime;
        redisMetrics.responseTimes.push(responseTime);
        
        // 记录慢查询
        if (responseTime > 100) {
            console.warn(`Redis慢查询: ${responseTime}ms - SET ${key}`);
        }
        
        return result;
    } catch (error) {
        redisMetrics.errors++;
        console.error(`Redis SET错误: ${error.message} - key: ${key}`);
        throw error;
    }
};

redisClient.setEx = async function(key, ttl, value) {
    const startTime = Date.now();
    redisMetrics.totalRequests++;
    
    try {
        const result = await originalSetEx(key, ttl, value);
        const responseTime = Date.now() - startTime;
        redisMetrics.responseTimes.push(responseTime);
        
        // 记录慢查询
        if (responseTime > 100) {
            console.warn(`Redis慢查询: ${responseTime}ms - SETEX ${key}`);
        }
        
        return result;
    } catch (error) {
        redisMetrics.errors++;
        console.error(`Redis SETEX错误: ${error.message} - key: ${key}`);
        throw error;
    }
};

redisClient.del = async function(key) {
    const startTime = Date.now();
    redisMetrics.totalRequests++;
    
    try {
        const result = await originalDel(key);
        const responseTime = Date.now() - startTime;
        redisMetrics.responseTimes.push(responseTime);
        
        // 记录慢查询
        if (responseTime > 100) {
            console.warn(`Redis慢查询: ${responseTime}ms - DEL ${key}`);
        }
        
        return result;
    } catch (error) {
        redisMetrics.errors++;
        console.error(`Redis DEL错误: ${error.message} - key: ${key}`);
        throw error;
    }
};

// 获取性能统计
redisClient.getMetrics = function() {
    const avgResponseTime = redisMetrics.responseTimes.length > 0 
        ? redisMetrics.responseTimes.reduce((a, b) => a + b, 0) / redisMetrics.responseTimes.length 
        : 0;
    
    const hitRate = redisMetrics.totalRequests > 0 
        ? (redisMetrics.cacheHits / redisMetrics.totalRequests) * 100 
        : 0;
    
    return {
        totalRequests: redisMetrics.totalRequests,
        cacheHits: redisMetrics.cacheHits,
        cacheMisses: redisMetrics.cacheMisses,
        hitRate: hitRate.toFixed(2) + '%',
        errorRate: redisMetrics.totalRequests > 0 
            ? ((redisMetrics.errors / redisMetrics.totalRequests) * 100).toFixed(2) + '%'
            : '0%',
        avgResponseTime: avgResponseTime.toFixed(2) + 'ms',
        maxResponseTime: Math.max(...redisMetrics.responseTimes, 0) + 'ms'
    };
};

// 定期输出性能统计
setInterval(() => {
    const metrics = redisClient.getMetrics();
    console.log('Redis性能统计:', metrics);
}, 5 * 60 * 1000); // 每5分钟输出一次

// 连接Redis
redisClient.connect().catch(console.error);

module.exports = redisClient; 