/**
 * Wespace / 外部 API 凭据：仅从请求头或环境变量读取，禁止源码内硬编码 fallback。
 */

function resolveWespaceBasicAuthorization(req) {
  if (req) {
    const fromDedicated =
      req.headers?.['x-external-authorization'] || req.headers?.['X-External-Authorization'];
    if (fromDedicated && String(fromDedicated).trim()) {
      return String(fromDedicated).trim();
    }

    const auth = req.headers?.authorization || req.headers?.Authorization;
    if (auth && String(auth).startsWith('Basic ')) {
      return String(auth).trim();
    }
  }

  const fromEnv = process.env.VERIFICATION_CODE_AUTHORIZATION;
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).trim();
  }

  return null;
}

function resolveExternalBearerAuthorization() {
  const raw = process.env.EXTERNAL_BEARER_TOKEN;
  if (!raw || !String(raw).trim()) return null;
  const token = String(raw).trim();
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}

function externalAuthNotConfiguredBody(message = '外部 API 凭据未配置') {
  return { code: 503, status: false, message };
}

module.exports = {
  resolveWespaceBasicAuthorization,
  resolveExternalBearerAuthorization,
  externalAuthNotConfiguredBody,
};
