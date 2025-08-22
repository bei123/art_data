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

    // 添加调试日志
    console.log('发送请求:', {
      url: config.url,
      method: config.method,
      headers: config.headers,
      data: config.data,
      baseURL: config.baseURL,
      withCredentials: config.withCredentials
    });
    
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
    // 添加调试日志
    console.log('收到响应:', {
      status: response.status,
      statusText: response.statusText,
      data: response.data,
      headers: response.headers,
      config: {
        url: response.config.url,
        method: response.config.method,
        baseURL: response.config.baseURL,
        withCredentials: response.config.withCredentials
      }
    });

    // 如果响应数据是空数组，添加警告日志
    if (Array.isArray(response.data) && response.data.length === 0) {
      console.warn('警告: 响应数据是空数组');
    }

    return response.data;
  },
  error => {
    console.error('响应错误:', {
      message: error.message,
      config: error.config,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      } : null
    });

    if (error.response) {
      const { status, data } = error.response;
      if (status === 401 || status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        router.push('/login');
        ElMessage.error('登录已过期或无权限，请重新登录');
      } else {
        ElMessage.error(data?.error || '操作失败');
      }
    } else if (error.request) {
      console.error('请求未收到响应:', error.request);
      ElMessage.error('网络请求失败，请检查网络连接');
    } else {
      console.error('请求配置错误:', error.message);
      ElMessage.error('请求配置错误');
    }
    return Promise.reject(error);
  }
);

export default instance; 