<template>
  <div v-if="hasError" class="error-boundary">
    <el-card class="error-card">
      <template #header>
        <div class="error-header">
          <el-icon :size="24" color="#f56c6c"><WarningFilled /></el-icon>
          <span>{{ t('errorBoundary.title') }}</span>
        </div>
      </template>

      <div class="error-content">
        <p class="error-message">{{ errorMessage }}</p>

        <div v-if="isRetrying" class="retry-status">
          <el-icon class="spin"><Loading /></el-icon>
          <span>{{ t('errorBoundary.retrying', { count: retryCount }) }}</span>
        </div>

        <div v-if="showDetails" class="error-details">
          <pre>{{ errorStack }}</pre>
        </div>

        <div class="error-actions">
          <el-button type="primary" :disabled="isRetrying" @click="handleRetry">
            <el-icon><RefreshRight /></el-icon>
            {{ isRetrying ? t('errorBoundary.retrying') : t('errorBoundary.retry') }}
          </el-button>
          <el-button @click="handleGoHome">
            <el-icon><HomeFilled /></el-icon>
            {{ t('errorBoundary.goHome') }}
          </el-button>
          <el-button text @click="showDetails = !showDetails">
            {{ showDetails ? t('errorBoundary.hideDetails') : t('errorBoundary.showDetails') }}
          </el-button>
        </div>
      </div>
    </el-card>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { WarningFilled, RefreshRight, HomeFilled, Loading } from '@element-plus/icons-vue'
import { useErrorLogger } from '@/composables/useErrorLogger'

const props = withDefaults(defineProps<{
  maxRetries?: number
  retryDelay?: number
  fallback?: () => any
}>(), {
  maxRetries: 3,
  retryDelay: 2000,
})

const router = useRouter()
const { t } = useI18n()
const { logError } = useErrorLogger()

const hasError = ref(false)
const errorMessage = ref('')
const errorStack = ref('')
const showDetails = ref(false)
const isRetrying = ref(false)
const retryCount = ref(0)
let retryTimer: ReturnType<typeof setTimeout> | null = null

// 捕获子组件错误
onErrorCaptured((err, instance, info) => {
  handleError(err, info)
  return false
})

function handleError(err: any, info?: string) {
  hasError.value = true
  errorMessage.value = err.message || t('errorBoundary.unknownError')
  errorStack.value = err.stack || ''

  // 上报错误
  logError({
    type: 'vue',
    message: err.message,
    stack: err.stack,
    component: info,
    timestamp: Date.now(),
  })

  console.error('[ErrorBoundary]', err, info)

  // 自动重试（指数退避）
  if (retryCount.value < props.maxRetries) {
    autoRetry()
  }
}

function autoRetry() {
  isRetrying.value = true
  const delay = props.retryDelay * Math.pow(2, retryCount.value)

  retryTimer = setTimeout(() => {
    retryCount.value++
    hasError.value = false
    errorMessage.value = ''
    errorStack.value = ''
    isRetrying.value = false
  }, delay)
}

// 全局错误处理
function handleGlobalError(event: ErrorEvent) {
  if (!hasError.value) {
    handleError(event.error || new Error(event.message))
  }
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  if (!hasError.value) {
    handleError(event.reason || new Error('未处理的Promise错误'))
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', handleGlobalError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
}

function handleRetry() {
  retryCount.value++
  hasError.value = false
  errorMessage.value = ''
  errorStack.value = ''
  isRetrying.value = false
}

function handleGoHome() {
  hasError.value = false
  router.push('/dashboard')
}

onUnmounted(() => {
  if (retryTimer) clearTimeout(retryTimer)
  if (typeof window !== 'undefined') {
    window.removeEventListener('error', handleGlobalError)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }
})
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

.retry-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #409eff;
  margin-bottom: 16px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
