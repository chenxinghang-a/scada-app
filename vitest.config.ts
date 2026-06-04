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
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
})
