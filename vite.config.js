import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devProxyTarget = (env.VITE_DEV_PROXY_TARGET || 'http://localhost:2000').replace(/\/+$/, '')

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // 将Vue相关库分离
            'vue-vendor': ['vue', 'vue-router'],
            // 将Element Plus分离
            'element-plus': ['element-plus'],
            // 将Pinia状态管理分离
            pinia: ['pinia'],
            // 将工具库分离
            utils: ['axios', 'uuid'],
            // 将阿里云相关库分离
            aliyun: [
              '@alicloud/credentials',
              '@alicloud/dytnsapi20200217',
              '@alicloud/ocr-api20210707',
              '@alicloud/openapi-client',
              '@alicloud/tea-console',
              '@alicloud/tea-typescript',
              '@alicloud/tea-util',
              'ali-oss'
            ],
            // 将编辑器相关库分离
            editor: ['@wangeditor/editor', '@wangeditor/editor-for-vue'],
            // 将图片处理相关库分离
            'image-utils': ['browser-image-compression', 'sharp']
          }
        }
      },
      // 调整chunk大小警告限制
      chunkSizeWarningLimit: 1000,
      // 启用代码分割
      target: 'es2015',
      // 启用CSS代码分割
      cssCodeSplit: true
    },
    server: {
      port: 5173,
      historyApiFallback: true,
      proxy: {
        '/api': {
          target: devProxyTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
          rewrite: (p) => p.replace(/^\/api/, '/api'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              console.log('代理请求:', {
                url: req.url,
                method: req.method,
                headers: req.headers
              })
            })
            proxy.on('proxyRes', (proxyRes, req) => {
              console.log('代理响应:', {
                url: req.url,
                method: req.method,
                statusCode: proxyRes.statusCode,
                headers: proxyRes.headers
              })
            })
            proxy.on('error', (err) => {
              console.error('代理错误:', err)
            })
          }
        }
      }
    }
  }
})
