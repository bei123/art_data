import axios from 'axios';
import { API_BASE_URL, CONFIG } from '../config';
import { ElMessage } from 'element-plus';
import router from '../router';

// 创建axios实例
const instance = axios.create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: CONFIG.api.timeout,
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: true
});

// 请求拦截器
instance.interceptors.request.use(
  config => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('发送请求:', {
        url: config.url,
        method: config.method,
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
    if (process.env.NODE_ENV === 'development') {
      console.log('收到响应:', {
        status: response.status,
        data: response.data,
        headers: response.headers
      });
    }
    return response.data;
  },
  error => {
    console.error('响应错误:', {
      message: error.message,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data
      } : null
    });

    if (error.response) {
      const { status, data } = error.response;
      switch (status) {
        case 401:
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          router.push('/login');
          ElMessage.error('登录已过期，请重新登录');
          break;
        case 403:
          ElMessage.error('没有权限执行此操作');
          break;
        default:
          ElMessage.error(data?.error || '操作失败');
      }
    } else {
      ElMessage.error('网络请求失败，请检查网络连接');
    }
    return Promise.reject(error);
  }
);

export default instance; 