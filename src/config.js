// API配置
export const API_BASE_URL = process.env.NODE_ENV === 'development' 
  ? 'http://localhost:2000/api'
  : 'https://wx.ht.2000gallery.art/api';

// 其他配置
export const CONFIG = {
  // 上传文件大小限制：5MB
  maxFileSize: 5 * 1024 * 1024,
  // 允许上传的文件类型
  allowedFileTypes: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  // 请求超时时间（毫秒）
  requestTimeout: 10000
}; 