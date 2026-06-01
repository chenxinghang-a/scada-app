<template>
  <div class="force-change-page">
    <div class="change-card">
      <div class="change-header">
        <h2>🔒 首次登录 - 请修改密码</h2>
        <p>为了您的账户安全，请修改初始密码后再继续使用</p>
      </div>
      <el-form :model="form" :rules="rules" ref="formRef" label-width="0" class="change-form">
        <el-form-item prop="newPassword">
          <el-input v-model="form.newPassword" type="password" show-password placeholder="新密码（至少6位）" size="large" prefix-icon="Lock" />
        </el-form-item>
        <el-form-item prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" show-password placeholder="确认新密码" size="large" prefix-icon="Lock" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" style="width:100%" :loading="loading" @click="submit">确认修改</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '@/api'
import type { FormInstance, FormRules } from 'element-plus'

const router = useRouter()
const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ newPassword: '', confirmPassword: '' })

const rules: FormRules = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少6位', trigger: 'blur' },
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

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await authApi.changePassword('', form.newPassword)
    localStorage.removeItem('scada_must_change_password')
    ElMessage.success('密码修改成功，请重新登录')
    localStorage.removeItem('auth_token')
    localStorage.removeItem('scada_refresh_token')
    localStorage.removeItem('scada_user')
    router.push('/login')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '密码修改失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.force-change-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
}
.change-card {
  background: #fff;
  border-radius: 12px;
  padding: 40px;
  width: 400px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.change-header { text-align: center; margin-bottom: 30px; }
.change-header h2 { margin: 0 0 8px; color: #1a1a2e; }
.change-header p { margin: 0; color: #909399; font-size: 14px; }
.change-form { margin-top: 20px; }
</style>
