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
          // 仅拆分前端实际依赖；勿把仅服务端使用的 @alicloud/*、ali-oss、sharp 写进来，否则会空 chunk 并触发 Node polyfill 告警
          manualChunks: {
            'vue-vendor': ['vue', 'vue-router'],
            'element-plus': ['element-plus', '@element-plus/icons-vue'],
            pinia: ['pinia'],
            utils: ['axios'],
            editor: ['@wangeditor/editor', '@wangeditor/editor-for-vue'],
            'image-utils': ['browser-image-compression']
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
