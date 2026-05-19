/**
 * 对外可访问的 API、OSS 等基础地址（与业务环境变量集中于此）
 * 可在 .env 中覆盖：PUBLIC_API_BASE_URL、OSS_PUBLIC_ORIGIN
 */
require('dotenv').config();

function trimTrailingSlash(s) {
  return String(s || '').replace(/\/+$/, '');
}

function normalizeOrigin(url, fallback) {
  const t = trimTrailingSlash(url || fallback);
  return t || fallback;
}

const NODE_ENV = process.env.NODE_ENV || 'development';

const defaultPublicApi =
  NODE_ENV === 'production'
    ? 'https://api.wx.2000gallery.art'
    : 'http://localhost:2000';

/** 对外 API 根（无尾斜杠），用于拼接 /uploads、支付回调、搜索响应里的绝对地址等 */
const PUBLIC_API_BASE_URL = normalizeOrigin(
  process.env.PUBLIC_API_BASE_URL,
  defaultPublicApi
);

/** OSS 自定义域名根（无尾斜杠），须与实际上传返回的 URL 域名一致 */
const OSS_PUBLIC_ORIGIN = normalizeOrigin(
  process.env.OSS_PUBLIC_ORIGIN,
  'https://wx.oss.2000gallery.art'
);

let OSS_PUBLIC_HOST = 'wx.oss.2000gallery.art';
try {
  const withScheme = OSS_PUBLIC_ORIGIN.startsWith('http')
    ? OSS_PUBLIC_ORIGIN
    : `https://${OSS_PUBLIC_ORIGIN}`;
  OSS_PUBLIC_HOST = new URL(withScheme).hostname;
} catch (_) {
  OSS_PUBLIC_HOST = 'wx.oss.2000gallery.art';
}

/**
 * 管理端/接口允许的「图片 URL」：本地上传路径或 OSS 公开域名
 * （与各路由原 validateImageUrl 行为一致，域名随 OSS_PUBLIC_ORIGIN）
 */
function validatePublicImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('/uploads/')) return true;
  if (url.startsWith(`${OSS_PUBLIC_ORIGIN}/`)) return true;
  try {
    return new URL(url).hostname === OSS_PUBLIC_HOST;
  } catch {
    return false;
  }
}

module.exports = {
  PUBLIC_API_BASE_URL,
  OSS_PUBLIC_ORIGIN,
  OSS_PUBLIC_HOST,
  validatePublicImageUrl,
};
