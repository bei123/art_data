import axios from 'axios';
import { API_BASE_URL, CONFIG } from '../config';
import { ElMessage } from 'element-plus';
import router from '../router';

// 创建axios实例
const instance = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: CONFIG.api.timeout,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  validateStatus: function (status) {
    return status >= 200 && status < 500;
  },
  withCredentials: true // 允许跨域请求携带凭证
});

// 请求拦截器
instance.interceptors.request.use(
  config => {
    // 确保在生产环境使用https
    if (process.env.NODE_ENV === 'production' && !config.url.startsWith('https://')) {
      config.url = config.url.replace('http://', 'https://');
    }

    // 检查 token 是否过期
    const token = localStorage.getItem('token');
    const tokenExpiry = localStorage.getItem('tokenExpiry');
    if (token) {
      if (tokenExpiry && Date.now() > parseInt(tokenExpiry)) {
        // token 已过期，清除并重定向到登录页面
        localStorage.removeItem('token');
        localStorage.removeItem('tokenExpiry');
        localStorage.removeItem('user');
        router.push('/login');
        return Promise.reject(new Error('Token expired'));
      }
      config.headers.Authorization = `Bearer ${token}`;
    }

    // 添加安全相关的请求头
    config.headers['X-Requested-With'] = 'XMLHttpRequest';
    config.headers['X-Content-Type-Options'] = 'nosniff';
    config.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';

    // 开发环境下打印请求信息
    if (process.env.NODE_ENV === 'development') {
      console.log('发送请求:', {
        url: config.url,
        method: config.method,
        baseURL: config.baseURL,
        headers: config.headers,
        data: config.data
      });
    }
    
    return config;
  },
  error => {
    console.error('请求错误:', error);
    return Promise.reject(error);
  }
);

// 响应拦截器
instance.interceptors.response.use(
  response => {
    // 开发环境下打印响应信息
    if (process.env.NODE_ENV === 'development') {
      console.log('收到响应:', {
        status: response.status,
        headers: response.headers,
        data: response.data,
        config: {
          url: response.config.url,
          baseURL: response.config.baseURL,
          method: response.config.method
        }
      });
    }
    
    // 处理特定的状态码
    if (response.status === 405) {
      ElMessage.error('请求方法不被允许，请检查API配置');
      return Promise.reject(new Error('Method Not Allowed'));
    }
    
    return response;
  },
  error => {
    // 详细的错误日志
    console.error('响应错误:', {
      message: error.message,
      config: error.config,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      } : null
    });

    if (error.response) {
      switch (error.response.status) {
        case 401:
          localStorage.removeItem('token');
          localStorage.removeItem('tokenExpiry');
          localStorage.removeItem('user');
          router.push('/login');
          ElMessage.error('登录已过期，请重新登录');
          break;
        case 403:
          ElMessage.error('没有权限执行此操作');
          break;
        case 405:
          ElMessage.error('请求方法不被允许，请检查API配置');
          break;
        case 429:
          ElMessage.error('请求过于频繁，请稍后再试');
          break;
        default:
          ElMessage.error(error.response.data?.error || '操作失败');
      }
    } else if (error.request) {
      ElMessage.error('网络请求失败，请检查网络连接');
    } else {
      ElMessage.error('请求配置错误: ' + error.message);
    }
    return Promise.reject(error);
  }
);

export default instance; 