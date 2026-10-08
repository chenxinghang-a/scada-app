<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
import { onMounted, onErrorCaptured } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { reportVueError } from '@/composables/useErrorLogger'

// ⚠️ 这个钩子**必须真的存在**。
//    `useErrorLogger.installErrorLogger()` 里明确写着：
//      「Vue 错误由 App.vue 的 onErrorCaptured 处理，这里处理全局 JS 错误」
//    而 round 197 之前这里**根本没有 onErrorCaptured**，
//    `ErrorBoundary.vue`（唯一实现了 onErrorCaptured 的地方）也从未被挂载
//    → **Vue 组件异常完全不被上报**：既不进 ErrorBoundary，
//    也不会冒泡到 window.onerror（Vue 3 默认只 console.error，
//    除非设了 app.config.errorHandler）。整类错误静默丢失。
//    守卫：tests/components/component-wiring.test.ts
onErrorCaptured((err, _instance, info) => {
  reportVueError(err instanceof Error ? err : new Error(String(err)), info)
  // 不返回 false —— 保持 Vue 默认行为（继续冒泡），不改变既有表现
})

// Vue 挂载成功，移除 loading 动画
onMounted(() => {
  const win = window as any
  if (typeof win.__removeLoading === 'function') {
    win.__removeLoading()
  }
})
</script>

<style>
html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', '微软雅黑', Arial, sans-serif;
}
</style>
