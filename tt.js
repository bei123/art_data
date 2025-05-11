const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const app = express();

// 配置中间件
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 配置请求参数
const clientId = 'your_client_id';
const clientSecret = 'your_client_secret';
const appInfoStr = `${clientId}:${clientSecret}`;
const appInfo = Buffer.from(appInfoStr).toString('base64');

// 获取 token 的函数
async function getToken() {
    try {
        const response = await axios({
            method: 'post',
            url: 'https://yapi.licenseinfo.cn/mock/600/userApi/user/getToken',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            params: {
                appInfo: appInfo
            }
        });

        console.log('Token 获取成功：', response.data);
        return response.data;
    } catch (error) {
        console.error('获取 token 失败：', error.message);
        throw error;
    }
}

// 实名注册函数
async function realNameRegistration(token, userData) {
    try {
        const response = await axios({
            method: 'post',
            url: 'https://yapi.licenseinfo.cn/mock/600/userApi/external/user/real_name_registration/simplify/v3',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            data: userData
        });

        console.log('实名注册成功：', response.data);
        return response.data;
    } catch (error) {
        console.error('实名注册失败：', error.message);
        throw error;
    }
}

// 获取用户资产列表函数
async function getUserAssetsList(token, params) {
    try {
        const response = await axios({
            method: 'get',
            url: 'https://yapi.licenseinfo.cn/mock/600/assetsApi/pr/assets/list/count',
            headers: {
                'Authorization': `Bearer ${token}`
            },
            params: params
        });

        console.log('获取用户资产列表成功：', response.data);
        return response.data;
    } catch (error) {
        console.error('获取用户资产列表失败：', error.message);
        throw error;
    }
}

// 测试路由
app.get('/test-token', async (req, res) => {
    try {
        const tokenData = await getToken();
        res.json(tokenData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 实名注册测试路由
app.post('/test-registration', async (req, res) => {
    try {
        // 首先获取 token
        const tokenData = await getToken();
        
        // 准备注册数据
        const registrationData = {
            mobile: req.body.mobile,
            name: req.body.name,
            idCardNo: req.body.idCardNo,
            passCard: JSON.stringify({
                From_IP: req.body.ip || "127.0.0.1",
                From_Device: req.body.device || "PC",
                From_MAC: req.body.mac || "",
                From_OS: req.body.os || "Windows",
                From_ID: req.body.mobile,
                Invite_code: req.body.inviteCode || "",
                Timestamp: Date.now()
            }),
            channel: req.body.channel,
            type: req.body.type || "1", // 默认个人
            password: req.body.password,
            userChainCallbackUrl: req.body.callbackUrl,
            sex: req.body.sex,
            ethnic: req.body.ethnic,
            birthDate: req.body.birthDate,
            province: req.body.province,
            city: req.body.city,
            district: req.body.district,
            address: req.body.address,
            issueDate: req.body.issueDate,
            expirationDate: req.body.expirationDate,
            legalRepresentative: req.body.legalRepresentative,
            enterpriseType: req.body.enterpriseType,
            establishmentDate: req.body.establishmentDate,
            registeredCapital: req.body.registeredCapital,
            businessScope: req.body.businessScope,
            idCardBackUrl: req.body.idCardBackUrl,
            idCardFrontUrl: req.body.idCardFrontUrl,
            businessLicenseUrl: req.body.businessLicenseUrl
        };

        // 调用实名注册接口
        const result = await realNameRegistration(tokenData.access_token, registrationData);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 用户资产列表测试路由
app.get('/assets/list/count', async (req, res) => {
    try {
        // 首先获取 token
        const tokenData = await getToken();
        
        // 准备请求参数
        const params = {
            usn: req.query.usn,
            rightsType: req.query.rightsType,
            currentPage: req.query.currentPage || 1,
            pageSize: req.query.pageSize || 20
        };

        // 调用用户资产列表接口
        const result = await getUserAssetsList(tokenData.access_token, params);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 启动服务器
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
});
