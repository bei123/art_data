function trimTrailingSlash(s) {
  return String(s || '').replace(/\/+$/, '');
}

const env = import.meta.env;

/** 浏览器访问的后端 API 根（无尾斜杠），与 axios baseURL 拼接 /api 使用 */
const API_BASE_URL = trimTrailingSlash(
  env.VITE_PUBLIC_API_BASE_URL ||
    env.VITE_API_BASE_URL ||
    (env.MODE === 'development' ? 'http://localhost:2000' : 'https://api.wx.2000gallery.art:2000')
);

/** OSS 自定义域名根（无尾斜杠），用于判断展示用绝对图链 */
const OSS_PUBLIC_ORIGIN = trimTrailingSlash(env.VITE_OSS_PUBLIC_ORIGIN || 'https://wx.oss.2000gallery.art');

export function isOssPublicUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith(`${OSS_PUBLIC_ORIGIN}/`);
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
    timeout: 30000,
    withCredentials: true,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  }
};

export { API_BASE_URL, OSS_PUBLIC_ORIGIN };
