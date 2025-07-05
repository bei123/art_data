const mysql = require('mysql2/promise');
require('dotenv').config();

// 数据库配置
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'data',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'data',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
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

// 执行查询的包装函数
const query = async (sql, params) => {
    try {
        console.log('执行SQL查询:', sql);
        console.log('查询参数:', params);
        const results = await pool.query(sql, params);
        console.log('查询结果:', results[0]);
        return results;
    } catch (error) {
        console.error('数据库查询错误:', error);
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

module.exports = {
    pool,
    query,
    getConnection
}; 