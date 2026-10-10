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
            // ⚠️ element-plus 必须排在 'vue/' **之前**（2026-10-09 白屏事故的根因修复）：
            // element-plus 内部有 es/utils/vue/** 这类路径，会被下面的 'vue/' 规则截走 →
            // 同一个库被拆进两个 chunk，形成循环依赖：
            //     vendor-vue ⇄ vendor-element （互有静态 import）
            // 于是初始化顺序错乱：element 的组件在**顶层**调用 defineComponent 时，
            // vue 的 isFunction 还处于 TDZ → 未捕获异常 →
            //     Uncaught ReferenceError: Cannot access 'isFunction' before initialization
            // → Vue 应用挂载失败 → **页面永久白屏**（所有静态闸门/单测都拦不住，
            //   现在由 tools/verify-dist-runtime.js 用真 Chromium 拦住）。
            if (id.includes('element-plus')) return 'vendor-element'
            // Vue 核心
            if (id.includes('vue/') || id.includes('vue-router') || id.includes('pinia')) return 'vendor-vue'
            // ⚠️ ECharts 全家（**含 zrender**）必须合进同一个 chunk（2026-10-10 事故③，与①②同族）：
            // 实测：拆成 charts/core 两个 chunk 后**互相 import**（图表类型要 core 的基类、
            // core 里也有模块要 charts 的组件）→ chunk 级循环 → 打开仪表盘（懒加载 charts
            // 那一刻）触发同一个 "__extends 基类 undefined" 崩溃：
            //     登录成功 → router.push('/dashboard') → 导航被中止 → **永远进不了系统**。
            // 另：zrender 路径不含 'echarts'，原来会掉进 vendor-other 再被拆一次（本循环的一部分），
            // 这里一并归拢。代价：图表包不再按需拆——换来的是任何加载时序都安全。
            if (id.includes('echarts') || id.includes('zrender')) return 'vendor-echarts'
            // ⚠️ Socket.IO 必须与「其它第三方」合并在同一 chunk（2026-10-10 灰白屏事故②）：
            // socket.io-client ⇄ lodash 工具（vendor-other）是**双向依赖**：
            //   other → socketio：取 Emitter 供某些类 extend；
            //   socketio → other：取 fromPairs/get/set 等工具函数。
            // 拆成两个 chunk = **chunk 级循环**；而 socketio 是被**懒加载视图**
            // （Login/Dashboard/…都会 import 它）引入的，和入口引入 other 的时机
            // 组合出不同的初始化顺序 —— 在坏顺序下 TS 编译产物里的
            //   __extends(Foo, Base) 拿到 undefined 的 Base，直接抛
            //   TypeError: Class extends value undefined is not a constructor or null
            // → Vue 应用挂载失败 → 灰白屏（实测：打包版必现，开发/测试环境偶发不现，极难查）。
            // 合并进同一 chunk 后，循环在 chunk **内部**由 rollup 保证顺序，任何加载时序都安全。
            if (id.includes('socket.io') || id.includes('engine.io')) return 'vendor-other'
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
