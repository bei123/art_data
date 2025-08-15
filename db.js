const mysql = require('mysql2/promise');
require('dotenv').config();

// 数据库配置 - 最简化版本（只使用MySQL2核心支持的选项）
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'data',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'data',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 10,
    charset: 'utf8mb4'
};

// 检查必要的环境变量
if (!process.env.DB_PASSWORD) {
    console.error('错误: 缺少必要的环境变量 DB_PASSWORD');
    process.exit(1);
}

console.log('Database configuration:', {
    ...dbConfig,
    password: '******' // 隐藏密码
});

// 创建连接池
const pool = mysql.createPool(dbConfig);

// 连接池事件监听
pool.on('connection', (connection) => {
    console.log('新的数据库连接已创建');
    
    // 设置连接级别的配置
    connection.query('SET SESSION sql_mode = "NO_ENGINE_SUBSTITUTION"');
    connection.query('SET SESSION wait_timeout = 28800');
    connection.query('SET SESSION interactive_timeout = 28800');
});

pool.on('acquire', (connection) => {
    console.log('连接已从连接池获取');
});

pool.on('release', (connection) => {
    console.log('连接已释放回连接池');
});

pool.on('enqueue', () => {
    console.log('等待可用的连接...');
});

// 测试连接
pool.getConnection()
    .then(connection => {
        console.log('数据库连接成功');
        // 测试查询
        return connection.query('SELECT 1')
            .then(([rows]) => {
                console.log('测试查询成功:', rows);
                connection.release();
            });
    })
    .catch(err => {
        console.error('数据库连接失败:', err);
    });

// 执行查询的包装函数 - 性能优化版本
const query = async (sql, params) => {
    const startTime = Date.now();
    try {
        // 检查连接池状态
        if (!pool || pool._closed) {
            console.error('连接池已关闭，尝试重新创建...');
            // 这里可以添加重新创建连接池的逻辑
            throw new Error('数据库连接池已关闭');
        }
        
        // 只在开发环境打印SQL
        if (process.env.NODE_ENV === 'development') {
            console.log('执行SQL查询:', sql.substring(0, 100) + (sql.length > 100 ? '...' : ''));
            console.log('查询参数:', params);
        }
        
        const results = await pool.query(sql, params);
        const queryTime = Date.now() - startTime;
        
        // 记录慢查询
        if (queryTime > 1000) {
            console.warn(`慢查询警告: ${queryTime}ms - ${sql.substring(0, 200)}...`);
        }
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`查询完成: ${queryTime}ms, 结果行数: ${results[0].length}`);
        }
        
        return results;
    } catch (error) {
        const queryTime = Date.now() - startTime;
        console.error(`数据库查询错误 (${queryTime}ms):`, error);
        console.error('SQL:', sql);
        console.error('参数:', params);
        
        // 如果是连接池关闭错误，提供更详细的错误信息
        if (error.message === 'Pool is closed.' || error.message.includes('Pool is closed')) {
            console.error('连接池已关闭，请检查数据库配置或重启应用');
        }
        
        throw error;
    }
};

// 获取连接的包装函数
const getConnection = async () => {
    try {
        return await pool.getConnection();
    } catch (error) {
        console.error('获取数据库连接失败:', error);
        throw error;
    }
};

// 获取连接池状态
const getPoolStatus = () => {
    return {
        isClosed: pool._closed || false,
        connectionLimit: pool.config.connectionLimit,
        queueLimit: pool.config.queueLimit,
        // 注意：mysql2 不直接暴露这些属性，这里只是示例
    };
};

// 检查连接池健康状态
const checkPoolHealth = async () => {
    try {
        if (pool._closed) {
            return { healthy: false, error: '连接池已关闭' };
        }
        
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        return { healthy: true };
    } catch (error) {
        return { healthy: false, error: error.message };
    }
};

// 定期清理连接池 - 修复版本
// 注意：不要在生产环境中定期关闭连接池，这会导致服务中断
// 如果需要定期清理，应该重新创建连接池而不是关闭它
/*
setInterval(() => {
    pool.end((err) => {
        if (err) {
            console.error('连接池清理失败:', err);
        } else {
            console.log('连接池已清理');
        }
    });
}, 24 * 60 * 60 * 1000); // 24小时清理一次
*/

// 优雅关闭处理
const gracefulShutdown = () => {
    console.log('正在关闭数据库连接池...');
    pool.end((err) => {
        if (err) {
            console.error('关闭连接池时出错:', err);
            process.exit(1);
        } else {
            console.log('数据库连接池已安全关闭');
            process.exit(0);
        }
    });
};

// 监听进程退出信号
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = {
    pool,
    query,
    getConnection,
    getPoolStatus,
    checkPoolHealth
}; 