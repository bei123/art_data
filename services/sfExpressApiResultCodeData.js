/**
 * 顺丰开放平台 API 公共返回码（apiResultCode）
 * @see 统一接入平台返回码说明
 */

function r(code, nameZh, suggestion) {
  return {
    code: String(code),
    nameZh: String(nameZh).trim(),
    suggestion: suggestion != null ? String(suggestion).trim() : '',
  }
}

const SF_API_RESULT_CODE_ROWS = [
  r(
    'A1000',
    '统一接入平台校验成功，调用后端服务成功',
    '表示接口调用正常；实际业务结果请查看 apiResultData 中的详细结果，不代表后端业务一定成功',
  ),
  r(
    'A1001',
    '必传参数不可为空',
    '请检查：1）必传字段是否填写；2）Content-Type 是否为 application/x-www-form-urlencoded；3）参数 key 是否含空格；4）参数是否经 URL 编码；5）msgData 是否为 JSON；6）整体是否为 form 表单',
  ),
  r(
    'A1002',
    '请求时效已过期',
    'OAuth2 场景下 accessToken 超过 2 小时，请重新调用 OAuth2 认证接口获取',
  ),
  r(
    'A1003',
    'IP无效',
    '顾客编码（partnerID）配置了 IP 校验，请解除校验或按绑定 IP 调用接口',
  ),
  r(
    'A1004',
    '无对应服务权限',
    '请检查：1）partnerID 是否在【API列表】关联对应接口；2）沙箱/正式环境是否与接口状态一致（测试中→沙箱，已上线→正式）；3）后台配置未生效可等待 2 分钟后重试',
  ),
  r(
    'A1005',
    '流量受控',
    '丰桥联调环境限流：单接口 30 次/s、3000 次/天；请勿压测，仅做功能联调',
  ),
  r(
    'A1006',
    '数字签名无效',
    '请检查：1）checkWord 是否正确；2）msgDigest 加签是否正确；3）参数是否含特殊字符（如 &）；4）是否为 form 表单；5）非 Java 语言注意特殊字符编码；6）可改用 OAuth2 Token 鉴权',
  ),
  r(
    'A1007',
    '重复请求',
    '下单接口 msgData 中 orderId 请勿重复使用，修改后重新调用',
  ),
  r('A1008', '数据解密失败', '特殊场景使用，如有出现请报障人工处理'),
  r('A1009', '目标服务异常或不可达', '接口下游服务异常，如有出现请报障人工处理'),
  r('A1010', '状态为沙箱测试', '老客户可能出现，新客户一般不会出现，如有出现请报障人工处理'),
  r('A1099', '系统异常', '接口服务异常，如有出现请报障人工处理'),
]

module.exports = {
  SF_API_RESULT_CODE_ROWS,
}
