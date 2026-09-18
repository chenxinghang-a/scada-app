<template>
  <div class="login-page">
    <main class="login-card">
      <!-- 品牌区 -->
      <header class="login-brand">
        <span class="login-logo" aria-hidden="true">
          <el-icon :size="30"><Monitor /></el-icon>
        </span>
        <h1 class="login-title">SmartSCADA</h1>
        <p class="login-subtitle">工业数据采集与监控系统</p>
      </header>

      <!-- 表单区 -->
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="handleLogin"
        class="login-form"
      >
        <el-form-item prop="username" label="用户名">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            :prefix-icon="User"
            size="large"
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-form-item prop="password" label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            size="large"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <p v-if="errorMsg" class="login-error" role="alert">{{ errorMsg }}</p>

        <el-form-item class="login-submit">
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            @click="handleLogin"
            class="login-btn"
          >
            {{ loading ? '登录中...' : '登 录' }}
          </el-button>
        </el-form-item>
      </el-form>

      <!-- 页脚区 -->
      <footer class="login-footer">
        <div class="footer-info">
          <el-icon :size="14"><Monitor /></el-icon>
          <span>SmartSCADA {{ appVersion }}</span>
        </div>
        <div v-if="isDev" class="footer-hint">默认账号: admin / admin123</div>
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'
import { ElMessage, type FormInstance } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const isDev = import.meta.env.DEV
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v1.0.0'

const router = useRouter()
const authStore = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const errorMsg = ref('')

const form = reactive({
  username: '',
  password: '',
})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    // 登录时不校验密码复杂度，复杂度规则仅在注册/改密时强制
  ],
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  errorMsg.value = ''
  try {
    const data = await authStore.login(form.username, form.password)
    if (!data) {
      errorMsg.value = '登录响应异常，请稍后重试'
      ElMessage.error('登录响应异常')
      return
    }
    if (data.success) {
      // 检查是否需要强制改密
      if (data.must_change_password) {
        localStorage.setItem('scada_must_change_password', 'true')
        ElMessage.warning('首次登录请修改密码')
        router.push('/force-change-password')
      } else {
        // 清除可能残留的强制改密标志
        localStorage.removeItem('scada_must_change_password')
        ElMessage.success('登录成功')
        const redirect = router.currentRoute.value.query.redirect as string
        const safeRedirect = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard'
        router.push(safeRedirect)
      }
    } else {
      errorMsg.value = '登录失败，请检查用户名和密码'
      ElMessage.error('登录失败')
    }
  } catch (err: any) {
    const msg = err?.response?.data?.error || '登录失败，请检查用户名和密码'
    errorMsg.value = msg
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--bg-page);
  color: var(--text-primary);
}

.login-card {
  width: 100%;
  max-width: 420px;
  padding: var(--space-8) var(--space-6) var(--space-6);
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

/* ===== 品牌区 ===== */
.login-brand {
  text-align: center;
  margin-bottom: var(--space-8);
}

.login-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-brand-soft);
  color: var(--color-brand);
  border: 1px solid var(--border-base);
}

.login-title {
  margin: 0 0 var(--space-2);
  font-size: var(--font-2xl);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.02em;
  color: var(--text-primary);
}

.login-subtitle {
  margin: 0;
  font-size: var(--font-sm);
  color: var(--text-muted);
}

/* ===== 表单区 ===== */
.login-form :deep(.el-form-item) {
  margin-bottom: var(--space-5);
}

.login-form :deep(.el-form-item__label) {
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  padding-bottom: var(--space-2);
  line-height: var(--leading-tight);
}

.login-form :deep(.el-input__wrapper) {
  border-radius: var(--radius-md);
  padding: 4px 14px;
  background: var(--bg-surface);
  box-shadow: 0 0 0 1px var(--border-strong) inset;
}

.login-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--color-brand) inset;
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 2px var(--color-brand) inset;
}

.login-form :deep(.el-input__inner) {
  height: 46px;
  font-size: var(--font-base);
  color: var(--text-primary);
}

.login-form :deep(.el-input__inner::placeholder) {
  color: var(--text-disabled);
}

/* 校验错误：更明确的危险色与字号 */
.login-form :deep(.el-form-item__error) {
  font-size: var(--font-xs);
  color: var(--color-danger);
  padding-top: var(--space-1);
}

.login-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-4);
  padding: var(--space-3);
  font-size: var(--font-sm);
  line-height: var(--leading-base);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
}

.login-submit { margin-bottom: var(--space-2); }

.login-submit :deep(.el-form-item__content) { display: block; }

.login-btn {
  width: 100%;
  height: 46px;
  font-size: var(--font-lg);
  font-weight: var(--weight-semibold);
  border-radius: var(--radius-md);
  letter-spacing: 0.2em;
}

/* ===== 页脚区 ===== */
.login-footer {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-base);
  text-align: center;
}

.footer-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-sm);
}

.footer-hint {
  margin-top: var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-xs);
  font-family: var(--font-mono);
}
</style>
