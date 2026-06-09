import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devProxyTarget = (env.VITE_DEV_PROXY_TARGET || 'http://localhost:2000').replace(/\/+$/, '')
  const proxyDebug = env.VITE_PROXY_DEBUG === 'true'

  const apiProxy = {
    target: devProxyTarget,
    changeOrigin: true,
    secure: false,
    ws: true
  }

  if (proxyDebug) {
    apiProxy.configure = (proxy) => {
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

  return {
    plugins: [
      vue(),
      tailwindcss(),
      Components({
        dts: false,
        resolvers: [ElementPlusResolver({ importStyle: 'css' })]
      })
    ],
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
      chunkSizeWarningLimit: 1000,
      target: 'es2020',
      cssCodeSplit: true
    },
    server: {
      port: 5173,
      historyApiFallback: true,
      proxy: {
        '/api': apiProxy
      }
    }
  }
})
