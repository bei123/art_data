const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'data',
    password: process.env.DB_PASSWORD || '5z24cJEiMd34jAtt',
    database: process.env.DB_NAME || 'data',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// 测试数据库连接
const testConnection = async () => {
    try {
        const connection = await pool.getConnection();
        console.log('数据库连接成功');
        connection.release();
    } catch (error) {
        console.error('数据库连接失败:', error);
        process.exit(1);
    }
};

// 执行查询的包装函数
const query = async (sql, params) => {
    try {
        const [results] = await pool.query(sql, params);
        return results;
    } catch (error) {
        console.error('数据库查询错误:', error);
        throw error;
    }
};

// 初始化时测试连接
testConnection();

module.exports = {
    pool,
    query
}; 