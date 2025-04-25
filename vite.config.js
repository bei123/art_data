import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.NODE_ENV === 'development' 
          ? 'http://localhost:2000'
          : 'https://api.wx.2000gallery.art:2000',
        changeOrigin: true,
        secure: false,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, '/api'),
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('代理请求:', {
              url: req.url,
              method: req.method,
              headers: req.headers
            });
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('代理响应:', {
              url: req.url,
              method: req.method,
              statusCode: proxyRes.statusCode,
              headers: proxyRes.headers
            });
          });
          proxy.on('error', (err, req, res) => {
            console.error('代理错误:', err);
          });
        }
      }
    }
  }
}) 