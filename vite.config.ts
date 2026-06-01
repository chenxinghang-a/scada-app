import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

// 移除 crossorigin 属性 — file:// 协议下会导致模块加载失败
function removeCrossorigin(): import('vite').Plugin {
  return {
    name: 'remove-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '')
    },
  }
}

export default defineConfig({
  plugins: [vue(), removeCrossorigin()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(`v${pkg.version}`),
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    host: 'localhost',
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5000', ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020',
    modulePreload: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // 精细化 chunk 分割 — 避免单个 vendor 过大
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Vue 核心
            if (id.includes('vue/') || id.includes('vue-router') || id.includes('pinia')) return 'vendor-vue'
            // Element Plus 按需拆分
            if (id.includes('element-plus')) return 'vendor-element'
            if (id.includes('@element-plus/icons-vue')) return 'vendor-icons'
            // ECharts 单独拆
            if (id.includes('echarts')) {
              // ECharts 核心和渲染器放一起，图表类型按需加载
              if (id.includes('/chart/') || id.includes('/components/')) return 'vendor-echarts-charts'
              return 'vendor-echarts-core'
            }
            // 其他第三方
            return 'vendor-other'
          }
        },
        // 文件名带内容 hash — 长期缓存
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  css: {
    // CSS 代码分割
    modules: { localsConvention: 'camelCase' },
  },
})
