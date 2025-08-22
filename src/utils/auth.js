import axios from './axios';

// 认证相关的API调用工具

// 用户登录
export const login = async (username, password) => {
  try {
    const response = await axios.post('/api/auth/login', {
      username,
      password
    });
    
    if (response.data.success) {
      // 保存token到localStorage
      localStorage.setItem('token', response.data.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.data.user));
      
      // 设置axios默认headers
      axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.data.token}`;
    }
    
    return response.data;
  } catch (error) {
    console.error('登录失败:', error);
    throw error;
  }
};

// 用户注册
export const register = async (username, email, password) => {
  try {
    const response = await axios.post('/api/auth/register', {
      username,
      email,
      password
    });
    
    if (response.data.success) {
      // 保存token到localStorage
      localStorage.setItem('token', response.data.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.data));
      
      // 设置axios默认headers
      axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.data.token}`;
    }
    
    return response.data;
  } catch (error) {
    console.error('注册失败:', error);
    throw error;
  }
};

// 获取当前用户信息
export const getCurrentUser = async () => {
  try {
    const response = await axios.get('/api/auth/me');
    return response.data;
  } catch (error) {
    console.error('获取用户信息失败:', error);
    throw error;
  }
};

// 用户登出
export const logout = async () => {
  try {
    const response = await axios.post('/api/auth/logout');
    
    // 清除本地存储
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    // 清除axios默认headers
    delete axios.defaults.headers.common['Authorization'];
    
    return response.data;
  } catch (error) {
    console.error('登出失败:', error);
    // 即使API调用失败，也要清除本地存储
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
    throw error;
  }
};

// 刷新token
export const refreshToken = async () => {
  try {
    const response = await axios.post('/api/auth/refresh');
    
    if (response.data.success) {
      // 更新token
      localStorage.setItem('token', response.data.data.token);
      localStorage.setItem('user', JSON.stringify(response.data.data.user));
      
      // 更新axios默认headers
      axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.data.token}`;
    }
    
    return response.data;
  } catch (error) {
    console.error('刷新token失败:', error);
    throw error;
  }
};

// 检查用户是否已登录
export const isAuthenticated = () => {
  const token = localStorage.getItem('token');
  const user = localStorage.getItem('user');
  
  if (!token || !user) {
    return false;
  }
  
  try {
    const userData = JSON.parse(user);
    return userData && userData.id;
  } catch (error) {
    console.error('解析用户信息失败:', error);
    return false;
  }
};

// 获取当前用户信息（从localStorage）
export const getCurrentUserFromStorage = () => {
  try {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return null;
  }
};

// 获取token（从localStorage）
export const getToken = () => {
  return localStorage.getItem('token');
};

// 设置axios拦截器，自动添加token
export const setupAuthInterceptor = () => {
  // 请求拦截器
  axios.interceptors.request.use(
    (config) => {
      const token = getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // 响应拦截器
  axios.interceptors.response.use(
    (response) => {
      return response;
    },
    async (error) => {
      const originalRequest = error.config;
      
      // 如果是401错误且不是刷新token的请求
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        
        try {
          // 尝试刷新token
          await refreshToken();
          
          // 重新发送原始请求
          const token = getToken();
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return axios(originalRequest);
        } catch (refreshError) {
          // 刷新失败，清除用户信息并跳转到登录页
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          delete axios.defaults.headers.common['Authorization'];
          
          // 跳转到登录页
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
      }
      
      return Promise.reject(error);
    }
  );
};

// 初始化认证状态
export const initAuth = () => {
  const token = getToken();
  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }
  
  setupAuthInterceptor();
};

// 检查用户权限
export const hasRole = (requiredRoles) => {
  const user = getCurrentUserFromStorage();
  if (!user) {
    return false;
  }
  
  if (Array.isArray(requiredRoles)) {
    return requiredRoles.includes(user.role);
  }
  
  return user.role === requiredRoles;
};

// 检查是否为管理员
export const isAdmin = () => {
  return hasRole(['admin', 'super_admin']);
};

// 检查是否为超级管理员
export const isSuperAdmin = () => {
  return hasRole('super_admin');
};

// 管理员功能：获取用户会话列表
export const getUserSessions = async () => {
  try {
    const response = await axios.get('/api/auth/sessions');
    return response.data;
  } catch (error) {
    console.error('获取会话列表失败:', error);
    throw error;
  }
};

// 管理员功能：强制下线用户
export const forceLogoutUser = async (userId) => {
  try {
    const response = await axios.post(`/api/auth/force-logout/${userId}`);
    return response.data;
  } catch (error) {
    console.error('强制下线用户失败:', error);
    throw error;
  }
};
