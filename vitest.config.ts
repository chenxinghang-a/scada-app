import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,js}'],
    exclude: ['tests/api-integration.test.ts'], // 集成测试需要后端
    // 零删除：把临时目录固定到仓库内，避免 vitest 每次运行滚动清理
    // 系统临时目录里的旧 run（量大时会触发环境的批量删除保护弹窗）。
    // 这个目录已在 .gitignore 里。
    cacheDir: '.vitest_cache',
    // 报告器精简，避免生成会被清理的中间文件
    reporters: ['default'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})
