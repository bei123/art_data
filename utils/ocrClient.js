const ocr_api20210707 = require('@alicloud/ocr-api20210707');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');
const Credential = require('@alicloud/credentials');

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
        const request = new ocr_api20210707.RecognizeIdcardRequest({
            body: imageBuffer  // 直接传入图片buffer
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