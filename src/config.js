// API配置
const API_BASE_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:2000'
  : 'https://api.wx.2000gallery.art:2000';

// 导出配置
export const CONFIG = {
  // 上传文件大小限制：5MB
  maxFileSize: 5 * 1024 * 1024,
  // 允许上传的文件类型
  allowedFileTypes: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  // 请求超时时间（毫秒）
  requestTimeout: 10000,
  // API相关配置
  api: {
    baseURL: API_BASE_URL,
    timeout: 10000,
    withCredentials: true
  }
};

export { API_BASE_URL }; 