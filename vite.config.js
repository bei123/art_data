import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

/** Rolldown/Vite 8+ 仅支持函数式 manualChunks */
const MANUAL_CHUNK_GROUPS = {
  'vue-vendor': ['vue-router', 'vue'],
  'element-plus': ['@element-plus/icons-vue', 'element-plus'],
  pinia: ['pinia'],
  utils: ['axios'],
  editor: ['@wangeditor/editor-for-vue', '@wangeditor/editor'],
  'image-utils': ['browser-image-compression'],
}

function resolveManualChunk(id) {
  if (!id.includes('node_modules')) return undefined

  for (const [chunkName, packages] of Object.entries(MANUAL_CHUNK_GROUPS)) {
    for (const pkg of packages) {
      const inPkg = id.includes(`/node_modules/${pkg}/`) || id.includes(`\\node_modules\\${pkg}\\`)
      if (inPkg) return chunkName
    }
  }

  return undefined
}

/** @vueuse/core 等依赖的 #__PURE__ 注释位置与 Rolldown 不兼容，等待上游修复前忽略 */
function shouldIgnoreRolldownPureAnnotationWarning(warning) {
  const code = String(warning.code ?? '')
  const message = String(warning.message ?? '')

  if (code === 'INVALID_ANNOTATION') return true
  if (message.includes('INVALID_ANNOTATION')) return true
  if (message.includes('contains an annotation that Rolldown cannot interpret')) return true
  if (message.includes('contains an annotation that Rollup cannot interpret')) return true

  return false
}

function handleRolldownWarning(warning, warn) {
  if (shouldIgnoreRolldownPureAnnotationWarning(warning)) return
  warn(warning)
}

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
        onwarn: handleRolldownWarning,
        output: {
          // 仅拆分前端实际依赖；勿把仅服务端使用的 @alicloud/*、ali-oss、sharp 写进来，否则会空 chunk 并触发 Node polyfill 告警
          manualChunks: resolveManualChunk,
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
