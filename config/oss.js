require('dotenv').config();
const OSS = require('ali-oss');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const path = require('path');

// 检查必要的环境变量
const requiredEnvVars = ['OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET', 'OSS_REGION'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    console.error('缺少必要的环境变量:', missingEnvVars.join(', '));
    throw new Error('缺少必要的环境变量');
}

/**
 * 检查是否在阿里云 ECS 环境中
 * @returns {Promise<boolean>}
 */
const checkIsInAliyunECS = async () => {
    return new Promise((resolve) => {
        const req = http.get('http://100.100.100.200/latest/meta-data/', {
            timeout: 2000
        }, (res) => {
            resolve(res.statusCode === 200);
        });

        req.on('error', () => {
            resolve(false);
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
    });
};

/**
 * 获取合适的 OSS endpoint
 * @returns {Promise<string>}
 */
const getOSSEndpoint = async () => {
    const isInECS = await checkIsInAliyunECS();
    const region = process.env.OSS_REGION;

    if (isInECS) {
        console.log('检测到阿里云 ECS 环境，使用内网 endpoint');
        return `https://oss-${region}-internal.aliyuncs.com`;
    } else {
        console.log('未检测到阿里云 ECS 环境，使用公网 endpoint');
        return `https://oss-${region}.aliyuncs.com`;
    }
};

// 创建 OSS 客户端
let client = null;

/**
 * 初始化 OSS 客户端
 */
const initOSSClient = async () => {
    const endpoint = await getOSSEndpoint();
    client = new OSS({
        accessKeyId: process.env.OSS_ACCESS_KEY_ID,
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
        bucket: process.env.OSS_BUCKET,
        region: process.env.OSS_REGION,
        endpoint: endpoint,
        secure: true,
        timeout: 60000,
        headers: {
            'x-oss-security-token': process.env.OSS_SECURITY_TOKEN,
        }
    });

    // 测试连接
    try {
        await client.listBuckets();
        console.log('OSS 连接成功，使用 endpoint:', endpoint);
    } catch (err) {
        console.error('OSS 连接失败:', err);
        throw err;
    }
};

/**
 * 生成唯一的文件名
 * @param {string} originalName - 原始文件名
 * @param {string} [prefix=''] - 可选的文件名前缀
 * @returns {string} - 生成的文件名
 */
const generateUniqueFileName = (originalName, prefix = '') => {
    const ext = path.extname(originalName).toLowerCase();
    const timestamp = Date.now();
    const randomString = uuidv4().substring(0, 8);
    return `${prefix}${timestamp}-${randomString}${ext}`;
};

/**
 * 上传文件到 OSS
 * @param {Buffer|Object} file - 文件内容或文件对象
 * @param {string} [prefix=''] - 可选的文件名前缀
 * @returns {Promise<Object>} - 返回包含 url、name 和 size 的对象
 */
const uploadToOSS = async (file, prefix = '') => {
    try {
        // 确保 client 已初始化
        if (!client) {
            await initOSSClient();
        }

        const ossPath = generateUniqueFileName(file.originalname, prefix);
        
        // 上传文件，添加服务器端加密配置
        const result = await client.put(ossPath, file.buffer, {
            headers: {
                'x-oss-server-side-encryption': 'AES256',
                'Cache-Control': 'max-age=31536000',
                'Content-Disposition': 'inline'
            }
        });

        // 生成公开访问的 URL（使用自定义域名）
        const downloadUrl = `https://wx.oss.2000gallery.art/${ossPath}`;

        return {
            url: downloadUrl,
            name: ossPath,
            size: file.size
        };
    } catch (error) {
        console.error('上传到 OSS 失败:', error);
        throw error;
    }
};

/**
 * 从 OSS 删除文件
 * @param {string} ossPath - OSS 文件路径
 * @returns {Promise<void>}
 */
const deleteFromOSS = async (ossPath) => {
    try {
        // 确保 client 已初始化
        if (!client) {
            await initOSSClient();
        }

        await client.delete(ossPath);
    } catch (error) {
        console.error('从 OSS 删除文件失败:', error);
        throw error;
    }
};

// 初始化时立即检查环境并创建客户端
initOSSClient().catch(console.error);

module.exports = {
    client,
    uploadToOSS,
    deleteFromOSS,
    generateUniqueFileName
}; 