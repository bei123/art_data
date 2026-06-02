function trimTrailingSlash(s) {
  return String(s || '').replace(/\/+$/, '');
}

const env = import.meta.env;

/**
 * 解析浏览器访问的后端 API 根（无尾斜杠）。
 * - `same-origin` / `/` / 空字符串：与当前页面同源，请求走 `/api`（需 Nginx 反代到 Node）
 * - 未配置时：开发用 localhost:2000，生产默认 https://api.wx.2000gallery.art
 */
function resolveApiBaseUrl() {
  const raw = env.VITE_PUBLIC_API_BASE_URL ?? env.VITE_API_BASE_URL;
  if (raw === 'same-origin' || raw === '/' || raw === '.') return '';
  if (raw != null && String(raw).trim() !== '') return trimTrailingSlash(raw);
  if (env.MODE === 'development') return 'http://localhost:2000';
  return 'https://api.wx.2000gallery.art';
}

const API_BASE_URL = resolveApiBaseUrl();

/** axios baseURL：同源时为 `/api`，否则为 `{API_BASE_URL}/api` */
export function getApiClientBaseUrl() {
  return API_BASE_URL ? `${API_BASE_URL}/api` : '/api';
}

/** OSS 自定义域名根（无尾斜杠），用于判断展示用绝对图链 */
const OSS_PUBLIC_ORIGIN = trimTrailingSlash(env.VITE_OSS_PUBLIC_ORIGIN || 'https://wx.oss.2000gallery.art');

let OSS_PUBLIC_HOST = 'wx.oss.2000gallery.art';
try {
  const withScheme = OSS_PUBLIC_ORIGIN.startsWith('http')
    ? OSS_PUBLIC_ORIGIN
    : `https://${OSS_PUBLIC_ORIGIN}`;
  OSS_PUBLIC_HOST = new URL(withScheme).hostname;
} catch {
  OSS_PUBLIC_HOST = 'wx.oss.2000gallery.art';
}

export function isOssPublicUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith(`${OSS_PUBLIC_ORIGIN}/`)) return true;
  try {
    return new URL(url).hostname === OSS_PUBLIC_HOST;
  } catch {
    return false;
  }
}

/** 相对路径或 OSS 外链 → 可展示的绝对/根相对 URL */
export function resolvePublicAssetUrl(url) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('http')) return url;
  const path = url.startsWith('/') ? url : `/${url}`;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

// 导出配置
export const CONFIG = {
  // 上传文件大小限制：5MB
  maxFileSize: 50 * 1024 * 1024,
  // 允许上传的文件类型
  allowedFileTypes: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  // 请求超时时间（毫秒）
  requestTimeout: 30000,
  // Token相关配置
  token: {
    // token过期时间（小时）
    expiryHours: 24,
    // 过期前提醒时间（分钟）
    warningMinutes: 5,
    // 检查间隔（秒）
    checkIntervalSeconds: 60,
    // 警告检查间隔（秒）
    warningCheckIntervalSeconds: 30
  },
  // API相关配置
  api: {
    baseURL: API_BASE_URL,
    clientBaseURL: getApiClientBaseUrl(),
    timeout: 30000,
    withCredentials: true,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  }
};

export { API_BASE_URL, OSS_PUBLIC_ORIGIN, OSS_PUBLIC_HOST };
