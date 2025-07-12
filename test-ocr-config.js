// 测试OCR配置脚本
require('dotenv').config();

console.log('=== 阿里云OCR配置测试 ===');

// 检查环境变量
const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;

console.log('Access Key ID:', accessKeyId ? '已设置' : '未设置');
console.log('Access Key Secret:', accessKeySecret ? '已设置' : '未设置');

if (!accessKeyId || !accessKeySecret) {
    console.error('❌ 错误: 缺少阿里云访问密钥配置');
    console.log('请设置以下环境变量:');
    console.log('- ALIBABA_CLOUD_ACCESS_KEY_ID');
    console.log('- ALIBABA_CLOUD_ACCESS_KEY_SECRET');
    console.log('或者使用OSS的配置:');
    console.log('- OSS_ACCESS_KEY_ID');
    console.log('- OSS_ACCESS_KEY_SECRET');
    process.exit(1);
}

console.log('✅ 阿里云访问密钥配置正确');

// 测试OCR客户端创建
try {
    const OcrClient = require('./utils/ocrClient');
    const client = OcrClient.createClient();
    console.log('✅ OCR客户端创建成功');
} catch (error) {
    console.error('❌ OCR客户端创建失败:', error.message);
    process.exit(1);
}

// 测试二要素核验客户端创建
try {
    const Dytnsapi20200217 = require('@alicloud/dytnsapi20200217');
    const OpenApi = require('@alicloud/openapi-client');
    const Credential = require('@alicloud/credentials');
    
    let credential = new Credential.default({
        accessKeyId: accessKeyId,
        accessKeySecret: accessKeySecret,
    });
    let config = new OpenApi.Config({
        credential: credential,
    });
    config.endpoint = 'dytnsapi.aliyuncs.com';
    const client = new Dytnsapi20200217.default(config);
    console.log('✅ 二要素核验客户端创建成功');
} catch (error) {
    console.error('❌ 二要素核验客户端创建失败:', error.message);
    process.exit(1);
}

console.log('🎉 所有配置测试通过！'); 