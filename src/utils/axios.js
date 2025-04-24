import axios from 'axios';
import { API_BASE_URL } from '../config';
import { ElMessage } from 'element-plus';
import router from '../router';

const instance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  validateStatus: function (status) {
    return status >= 200 && status < 500;
  }
});

// 请求拦截器
instance.interceptors.request.use(
  config => {
    console.log('发送请求:', {
      url: config.url,
      method: config.method,
      headers: config.headers,
      data: config.data
    });
    
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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
    console.log('收到响应:', {
      status: response.status,
      headers: response.headers,
      data: response.data
    });
    
    // 处理特定的状态码
    if (response.status === 405) {
      ElMessage.error('请求方法不被允许，请检查API配置');
      return Promise.reject(new Error('Method Not Allowed'));
    }
    
    return response;
  },
  error => {
    console.error('响应错误:', error);
    if (error.response) {
      switch (error.response.status) {
        case 401:
          localStorage.removeItem('token');
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