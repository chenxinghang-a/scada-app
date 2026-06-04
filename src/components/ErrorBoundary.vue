<template>
  <div v-if="hasError" class="error-boundary">
    <el-card class="error-card">
      <template #header>
        <div class="error-header">
          <el-icon :size="24" color="#f56c6c"><WarningFilled /></el-icon>
          <span>页面发生错误</span>
        </div>
      </template>

      <div class="error-content">
        <p class="error-message">{{ errorMessage }}</p>

        <div v-if="showDetails" class="error-details">
          <pre>{{ errorStack }}</pre>
        </div>

        <div class="error-actions">
          <el-button type="primary" @click="handleRetry">
            <el-icon><RefreshRight /></el-icon>
            重试
          </el-button>
          <el-button @click="handleGoHome">
            <el-icon><HomeFilled /></el-icon>
            返回首页
          </el-button>
          <el-button text @click="showDetails = !showDetails">
            {{ showDetails ? '隐藏详情' : '显示详情' }}
          </el-button>
        </div>
      </div>
    </el-card>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'
import { useRouter } from 'vue-router'
import { WarningFilled, RefreshRight, HomeFilled } from '@element-plus/icons-vue'

const router = useRouter()

const hasError = ref(false)
const errorMessage = ref('')
const errorStack = ref('')
const showDetails = ref(false)

// 捕获子组件错误
onErrorCaptured((err, instance, info) => {
  hasError.value = true
  errorMessage.value = err.message || '未知错误'
  errorStack.value = err.stack || ''

  // 上报错误（可选）
  console.error('[ErrorBoundary]', err, info)

  // 阻止错误继续传播
  return false
})

// 全局错误处理
function handleGlobalError(event: ErrorEvent) {
  hasError.value = true
  errorMessage.value = event.message || '未知错误'
  errorStack.value = event.error?.stack || ''
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  hasError.value = true
  errorMessage.value = event.reason?.message || '未处理的Promise错误'
  errorStack.value = event.reason?.stack || ''
}

// 监听全局错误
if (typeof window !== 'undefined') {
  window.addEventListener('error', handleGlobalError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
}

function handleRetry() {
  hasError.value = false
  errorMessage.value = ''
  errorStack.value = ''
  // 强制重新渲染
  window.location.reload()
}

function handleGoHome() {
  hasError.value = false
  router.push('/dashboard')
}
</script>

<style scoped>
.error-boundary {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
  padding: 20px;
}

.error-card {
  max-width: 600px;
  width: 100%;
}

.error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: bold;
}

.error-content {
  text-align: center;
}

.error-message {
  color: #606266;
  margin-bottom: 16px;
}

.error-details {
  background: #f5f7fa;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 16px;
  text-align: left;
  overflow-x: auto;
}

.error-details pre {
  margin: 0;
  font-size: 12px;
  color: #909399;
  white-space: pre-wrap;
  word-break: break-all;
}

.error-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}
</style>
