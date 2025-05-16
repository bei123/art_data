const ocr_api20210707 = require('@alicloud/ocr-api20210707');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const Credential = require('@alicloud/credentials');
const { Readable } = require('stream');

class OcrClient {
    static createClient() {
        let credential = new Credential.default();
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