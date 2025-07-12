const ocr_api20210707 = require('@alicloud/ocr-api20210707');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const Credential = require('@alicloud/credentials');
const { Readable } = require('stream');

class OcrClient {
    static createClient() {
        // 检查必要的环境变量
        const accessKeyId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
        const accessKeySecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;
        
        if (!accessKeyId || !accessKeySecret) {
            throw new Error('缺少阿里云访问密钥配置。请设置 ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET 环境变量');
        }
        
        // 使用环境变量创建凭证
        let credential = new Credential.default({
            accessKeyId: accessKeyId,
            accessKeySecret: accessKeySecret,
        });
        
        let config = new OpenApi.Config({
            credential: credential,
        });
        config.endpoint = `ocr-api.cn-hangzhou.aliyuncs.com`;
        return new ocr_api20210707.default(config);
    }

    static async recognizeIdCard(imageBuffer) {
        const client = this.createClient();
        // 将Buffer转为Node.js的Readable Stream
        const stream = new Readable();
        stream.push(imageBuffer);
        stream.push(null);
        const request = new ocr_api20210707.RecognizeIdcardRequest({
            body: stream
        });
        const runtime = new Util.RuntimeOptions({});
        try {
            const response = await client.recognizeIdcardWithOptions(request, runtime);
            return response.body;
        } catch (error) {
            console.error('身份证识别失败:', error);
            throw error;
        }
    }
}

module.exports = OcrClient; 