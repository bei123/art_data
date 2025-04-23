const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: 'localhost',
    user: 'data',
    password: '5z24cJEiMd34jAtt',
    database: 'data',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool; 