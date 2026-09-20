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
    // 保持 Vite 默认清理行为（它只删自己 outDir 里的旧 chunk，量小、不触发
    // 环境的批量删除保护）。**不要**把它当成"整体清空 dist" 的开关来用：
    // electron-builder 的 files 配置依赖 `dist/` 这个固定路径，改目录会让打包找不到前端。
    // 如需彻底隔离，用 `vite build --outDir dist-<tag>`（见 package.json 的 build:iso）。
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020',
    modulePreload: false,
    chunkSizeWarningLimit: 800,
    // Tree-shaking优化
    commonjsOptions: {
      include: [/node_modules/],
      extensions: ['.js', '.cjs'],
    },
    rollupOptions: {
      output: {
        // 精细化 chunk 分割 — 避免单个 vendor 过大
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Element Plus 图标必须最先判断：'@element-plus/icons-vue' 的路径同时命中
            // 下面两条更宽的规则 —— 'vue/'（"icons-vue/dist/..." 含有 "vue/"）和
            // 'element-plus'。放后面会让 vendor-icons 分支永远不可达，图标被塞进
            // vendor-vue，既拉大首屏关键路径，也让 vendor-vue 体积无法解释。
            if (id.includes('@element-plus/icons-vue')) return 'vendor-icons'
            // Vue 核心
            if (id.includes('vue/') || id.includes('vue-router') || id.includes('pinia')) return 'vendor-vue'
            if (id.includes('element-plus')) return 'vendor-element'
            // ECharts 单独拆
            if (id.includes('echarts')) {
              // ECharts 核心和渲染器放一起，图表类型按需加载
              if (id.includes('/chart/') || id.includes('/components/')) return 'vendor-echarts-charts'
              return 'vendor-echarts-core'
            }
            // Socket.IO单独拆
            if (id.includes('socket.io')) return 'vendor-socketio'
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
