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

/**
 * 规范化 DEL 参数：支持 del('a','b')、del(['a','b'])，与 node-redis 多键删除一致
 */
function normalizeDelKeyArgs(args) {
    if (!args || args.length === 0) return [];
    if (args.length === 1 && Array.isArray(args[0])) {
        return args[0].flat().filter((k) => k != null && k !== '');
    }
    return args.flat().filter((k) => k != null && k !== '');
}

redisClient.del = async function (...args) {
    const keyList = normalizeDelKeyArgs(args);
    const startTime = Date.now();
    redisMetrics.totalRequests++;

    try {
        if (keyList.length === 0) {
            return 0;
        }
        const result = await originalDel(keyList);
        const responseTime = Date.now() - startTime;
        redisMetrics.responseTimes.push(responseTime);

        if (responseTime > 100) {
            const preview = keyList.length > 3 ? `${keyList.slice(0, 3).join(',')}...(${keyList.length} keys)` : keyList.join(',');
            console.warn(`Redis慢查询: ${responseTime}ms - DEL ${preview}`);
        }

        return result;
    } catch (error) {
        redisMetrics.errors++;
        console.error(`Redis DEL错误: ${error.message} - keys: ${keyList.length}`);
        throw error;
    }
};

/** SCAN 每次返回 key 数量 hint（避免 KEYS 阻塞） */
const SCAN_COUNT_DEFAULT = Math.min(1000, Math.max(50, parseInt(process.env.REDIS_SCAN_COUNT || '200', 10) || 200));

/**
 * 按 glob pattern 删除键（SCAN + 批量 DEL，生产环境勿用 KEYS）
 * @param {string} pattern 如 exhibitions:list:*、artworks:list*
 * @param {{ COUNT?: number }} [options]
 * @returns {Promise<number>} 删除的 key 数量（估算为本次 DEL 的 key 数之和）
 */
redisClient.scanDelByPattern = async function scanDelByPattern(pattern, options = {}) {
    const COUNT = options.COUNT || SCAN_COUNT_DEFAULT;
    let cursor = '0';
    let deleted = 0;
    try {
        do {
            const reply = await redisClient.scan(cursor, { MATCH: pattern, COUNT });
            cursor = String(reply.cursor);
            const keys = reply.keys || [];
            if (keys.length) {
                await redisClient.del(keys);
                deleted += keys.length;
            }
        } while (cursor !== '0');
    } catch (error) {
        console.error(`Redis scanDelByPattern 失败 pattern=${pattern}:`, error.message);
    }
    return deleted;
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

/**
 * 供负载均衡 / 编排探活：尝试连接并 PING，不暴露敏感配置。
 */
async function checkRedisHealth() {
    try {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
        const start = Date.now();
        await redisClient.ping();
        return { ok: true, latency_ms: Date.now() - start };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

redisClient.checkRedisHealth = checkRedisHealth;

// 连接Redis
redisClient.connect().catch(console.error);

module.exports = redisClient; 