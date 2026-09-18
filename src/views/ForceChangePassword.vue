<template>
  <div class="change-page">
    <main class="change-card">
      <header class="change-brand">
        <span class="change-logo" aria-hidden="true">
          <el-icon :size="28"><Lock /></el-icon>
        </span>
        <h1 class="change-title">修改初始密码</h1>
        <p class="change-subtitle">为了账户安全，首次登录需修改初始密码后才能继续使用</p>
      </header>

      <el-form :model="form" :rules="rules" ref="formRef" label-position="top" class="change-form">
        <el-form-item prop="newPassword" label="新密码">
          <el-input v-model="form.newPassword" type="password" show-password placeholder="请输入新密码" size="large" prefix-icon="Lock" />
        </el-form-item>

        <!-- 密码规则实时提示：避免提交后才知道不合规 -->
        <ul class="rule-list">
          <li v-for="r in passwordRules" :key="r.label" class="rule-item" :class="{ 'rule-item--ok': r.ok }">
            <span class="rule-dot" aria-hidden="true"></span>
            <span>{{ r.label }}</span>
          </li>
        </ul>

        <el-form-item prop="confirmPassword" label="确认新密码">
          <el-input v-model="form.confirmPassword" type="password" show-password placeholder="请再次输入新密码" size="large" prefix-icon="Lock" />
        </el-form-item>

        <p v-if="errorMsg" class="change-error" role="alert">{{ errorMsg }}</p>

        <el-form-item class="change-submit">
          <el-button type="primary" size="large" class="change-btn" :loading="loading" @click="submit">确认修改</el-button>
        </el-form-item>
      </el-form>

      <footer class="change-footer">
        <span>修改成功后将退出登录，请使用新密码重新登录</span>
      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Lock } from '@element-plus/icons-vue'
import { authApi } from '@/api'
import { useAuthStore } from '@/stores/auth'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const authStore = useAuthStore()
const formRef = ref<FormInstance>()
const loading = ref(false)
const errorMsg = ref('')
const form = reactive({ newPassword: '', confirmPassword: '' })

const rules: FormRules = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码长度至少8位', trigger: 'blur' },
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (!value) return callback()
        if (!/[A-Z]/.test(value)) return callback(new Error('密码必须包含大写字母'))
        if (!/[a-z]/.test(value)) return callback(new Error('密码必须包含小写字母'))
        if (!/[0-9]/.test(value)) return callback(new Error('密码必须包含数字'))
        callback()
      },
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (value !== form.newPassword) callback(new Error('两次密码不一致'))
        else callback()
      },
      trigger: 'blur',
    },
  ],
}

// 规则提示状态（仅呈现，校验仍由上面的 rules 决定）
const passwordRules = computed(() => {
  const v = form.newPassword
  return [
    { label: '至少 8 位字符', ok: v.length >= 8 },
    { label: '包含大写字母', ok: /[A-Z]/.test(v) },
    { label: '包含小写字母', ok: /[a-z]/.test(v) },
    { label: '包含数字', ok: /[0-9]/.test(v) },
  ]
})

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  errorMsg.value = ''
  try {
    // 获取当前用户名（从 store 或 localStorage）
    let username = ''
    try {
      const stored = JSON.parse(localStorage.getItem('scada_user') || '{}')
      username = stored.username || ''
    } catch { /* ignore */ }
    if (!username) {
      errorMsg.value = '无法获取用户名，请重新登录'
      ElMessage.error('无法获取用户名，请重新登录')
      router.push('/login')
      return
    }
    await authApi.forceChangePassword(username, form.newPassword)
    localStorage.removeItem('scada_must_change_password')
    ElMessage.success('密码修改成功，请重新登录')
    // 用 store logout 统一清理（含 Pinia ref + localStorage + cookie）
    await authStore.logout()
    router.push('/login')
  } catch (e: any) {
    const msg = e?.response?.data?.error || '密码修改失败'
    errorMsg.value = msg
    ElMessage.error(msg)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.change-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--bg-page);
  color: var(--text-primary);
}

.change-card {
  width: 100%;
  max-width: 440px;
  padding: var(--space-8) var(--space-6) var(--space-6);
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

/* ===== 头部 ===== */
.change-brand {
  text-align: center;
  margin-bottom: var(--space-6);
}

.change-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--space-3);
  border-radius: var(--radius-lg);
  background: var(--color-warning-soft);
  color: var(--color-warning);
  border: 1px solid var(--border-base);
}

.change-title {
  margin: 0 0 var(--space-2);
  font-size: var(--font-xl);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

.change-subtitle {
  margin: 0;
  font-size: var(--font-sm);
  line-height: var(--leading-base);
  color: var(--text-muted);
}

/* ===== 表单 ===== */
.change-form :deep(.el-form-item) { margin-bottom: var(--space-4); }

.change-form :deep(.el-form-item__label) {
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
  color: var(--text-secondary);
  padding-bottom: var(--space-2);
  line-height: var(--leading-tight);
}

.change-form :deep(.el-input__wrapper) {
  border-radius: var(--radius-md);
  padding: 4px 14px;
  background: var(--bg-surface);
  box-shadow: 0 0 0 1px var(--border-strong) inset;
}

.change-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--color-brand) inset;
}

.change-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 2px var(--color-brand) inset;
}

.change-form :deep(.el-input__inner) {
  height: 46px;
  font-size: var(--font-base);
  color: var(--text-primary);
}

.change-form :deep(.el-input__inner::placeholder) { color: var(--text-disabled); }

.change-form :deep(.el-form-item__error) {
  font-size: var(--font-xs);
  color: var(--color-danger);
  padding-top: var(--space-1);
}

/* ===== 规则提示 ===== */
.rule-list {
  list-style: none;
  margin: 0 0 var(--space-5);
  padding: var(--space-3);
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-2) var(--space-3);
  background: var(--bg-sunken);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
}

.rule-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.rule-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--color-offline);
  flex: none;
}

.rule-item--ok { color: var(--color-success); }
.rule-item--ok .rule-dot { background: var(--color-success); }

/* ===== 错误提示 ===== */
.change-error {
  margin: 0 0 var(--space-3);
  padding: var(--space-3);
  font-size: var(--font-sm);
  line-height: var(--leading-base);
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
}

.change-submit { margin-bottom: var(--space-2); }

.change-submit :deep(.el-form-item__content) { display: block; }

.change-btn {
  width: 100%;
  height: 46px;
  font-size: var(--font-lg);
  font-weight: var(--weight-semibold);
  border-radius: var(--radius-md);
}

/* ===== 页脚 ===== */
.change-footer {
  margin-top: var(--space-3);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-base);
  text-align: center;
  font-size: var(--font-xs);
  color: var(--text-muted);
}
</style>
