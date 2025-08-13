const mysql = require('mysql2/promise');
require('dotenv').config();

// 数据库配置 - 性能优化版本
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'data',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'data',
    waitForConnections: true,
    connectionLimit: 20,        // 增加连接数
    queueLimit: 10,             // 限制队列长度，避免内存问题
    acquireTimeout: 60000,      // 获取连接超时时间
    timeout: 60000,             // 查询超时时间
    reconnect: true,            // 自动重连
    charset: 'utf8mb4',         // 字符集
    // 连接池优化
    enableKeepAlive: true,      // 启用连接保活
    keepAliveInitialDelay: 0,   // 立即开始保活
    // 查询优化
    multipleStatements: false,  // 禁用多语句查询，提高安全性
    dateStrings: true,          // 日期作为字符串返回，避免时区问题
    // 性能优化
    supportBigNumbers: true,    // 支持大数字
    bigNumberStrings: true,     // 大数字作为字符串返回
    // 连接优化
    acquireTimeout: 60000,      // 获取连接超时
    timeout: 60000,             // 查询超时
    reconnect: true,            // 自动重连
    // 查询缓存
    queryFormat: function (query, values) {
        if (!values) return query;
        return query.replace(/\:(\w+)/g, function (txt, key) {
            if (values.hasOwnProperty(key)) {
                return this.escape(values[key]);
            }
            return txt;
        }.bind(this));
    }
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
        threadId: pool.threadId,
        connectionLimit: pool.config.connectionLimit,
        queueLimit: pool.config.queueLimit,
        // 注意：mysql2 不直接暴露这些属性，这里只是示例
    };
};

// 定期清理连接池
setInterval(() => {
    pool.end((err) => {
        if (err) {
            console.error('连接池清理失败:', err);
        } else {
            console.log('连接池已清理');
        }
    });
}, 24 * 60 * 60 * 1000); // 24小时清理一次

module.exports = {
    pool,
    query,
    getConnection,
    getPoolStatus
}; 