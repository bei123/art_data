const ocr_api20210707 = require('@alicloud/ocr-api20210707');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const Credential = require('@alicloud/credentials');
const { Readable } = require('stream');

class OcrClient {
    static createClient() {
        const ocrId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID
        const ocrSecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET
        const ossId = process.env.OSS_ACCESS_KEY_ID
        const ossSecret = process.env.OSS_ACCESS_KEY_SECRET

        let accessKeyId
        let accessKeySecret
        if (ocrId && ocrSecret) {
            accessKeyId = ocrId
            accessKeySecret = ocrSecret
        } else if (!ocrId && !ocrSecret && ossId && ossSecret) {
            // 仅当 OCR 密钥整组缺失时，才完整回退到 OSS 密钥对
            accessKeyId = ossId
            accessKeySecret = ossSecret
        } else if (ocrId || ocrSecret) {
            throw new Error('ALIBABA_CLOUD_ACCESS_KEY_ID / SECRET 须成对配置，禁止与 OSS 密钥混用')
        } else {
            throw new Error('缺少阿里云访问密钥配置。请设置 ALIBABA_CLOUD_ACCESS_KEY_ID 和 ALIBABA_CLOUD_ACCESS_KEY_SECRET 环境变量')
        }
        
        // 使用环境变量创建凭证
        let credential = new Credential.default({
            type: 'access_key',
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