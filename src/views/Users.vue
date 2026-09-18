<template>
  <div class="users-page">
    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div class="panel stat-card">
        <div class="metric-label">用户总数</div>
        <div class="metric-value">{{ users.length }}<span class="metric-unit">人</span></div>
      </div>
      <div class="panel stat-card">
        <div class="metric-label">管理员</div>
        <div class="metric-value stat-value--danger">{{ adminCount }}<span class="metric-unit">人</span></div>
      </div>
      <div class="panel stat-card">
        <div class="metric-label">工程师</div>
        <div class="metric-value stat-value--warning">{{ engineerCount }}<span class="metric-unit">人</span></div>
      </div>
      <div class="panel stat-card">
        <div class="metric-label">操作员</div>
        <div class="metric-value stat-value--success">{{ operatorCount }}<span class="metric-unit">人</span></div>
      </div>
      <div class="panel stat-card">
        <div class="metric-label">观察者</div>
        <div class="metric-value stat-value--muted">{{ viewerCount }}<span class="metric-unit">人</span></div>
      </div>
    </div>

    <!-- 用户列表 -->
    <section class="panel">
      <div class="panel__header">
        <span>用户管理</span>
        <el-button type="primary" size="small" @click="showAddDialog">添加用户</el-button>
      </div>
      <div class="panel__body panel__body--flush">
        <el-table :data="users" stripe v-loading="loading" class="data-table">
          <el-table-column label="用户" min-width="220">
            <template v-slot:default="{ row }">
              <div class="user-cell">
                <el-avatar :size="34" class="user-avatar">{{ (row.display_name || row.username || '?')[0] }}</el-avatar>
                <div>
                  <div class="user-name">{{ row.display_name || row.username }}</div>
                  <div class="user-id mono">{{ row.username }}</div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="role" label="角色" width="130">
            <template v-slot:default="{ row }">
              <span class="tag" :class="roleTag(row.role)">{{ roleLabel(row.role) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="260" align="right">
            <template v-slot:default="{ row }">
              <div class="row-actions">
                <el-button type="primary" link size="small" @click="editUser(row)">编辑</el-button>
                <el-button type="warning" link size="small" @click="resetPassword(row)" :disabled="row.username === 'admin'">重置密码</el-button>
                <span class="row-actions__sep" aria-hidden="true"></span>
                <el-popconfirm
                  title="删除后该用户将无法登录，确定删除？"
                  confirm-button-text="删除"
                  cancel-button-text="取消"
                  confirm-button-type="danger"
                  width="240"
                  :disabled="row.username === 'admin'"
                  @confirm="deleteUser(row.username)"
                >
                  <template v-slot:reference>
                    <el-button link size="small" class="btn-danger-link" :disabled="row.username === 'admin'">删除</el-button>
                  </template>
                </el-popconfirm>
              </div>
            </template>
          </el-table-column>
          <template v-slot:empty>
            <el-empty description="暂无用户" :image-size="80" />
          </template>
        </el-table>
      </div>
    </section>

    <!-- 操作日志 -->
    <section class="panel">
      <div class="panel__header">
        <span>操作日志</span>
        <span class="panel__meta">最近 {{ logs.length }} 条</span>
      </div>
      <div class="panel__body panel__body--flush">
        <el-table :data="logs" max-height="320" v-loading="logsLoading" class="data-table">
          <el-table-column prop="timestamp" label="时间" width="190">
            <template v-slot:default="{ row }"><span class="mono">{{ new Date(row.timestamp).toLocaleString() }}</span></template>
          </el-table-column>
          <el-table-column prop="username" label="用户" width="130">
            <template v-slot:default="{ row }"><span class="mono">{{ row.username }}</span></template>
          </el-table-column>
          <el-table-column prop="action" label="操作" width="130">
            <template v-slot:default="{ row }">
              <span class="tag" :class="actionTag(row.action)">{{ actionLabel(row.action) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="detail" label="详情" show-overflow-tooltip />
          <template v-slot:empty>
            <el-empty description="暂无操作日志" :image-size="80" />
          </template>
        </el-table>
      </div>
    </section>

    <!-- 添加/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑用户' : '添加用户'" width="480px">
      <el-form :model="form" label-width="90px" class="user-form">
        <el-form-item label="用户名">
          <el-input v-model="form.username" :disabled="isEdit" placeholder="登录账号，创建后不可修改" />
        </el-form-item>
        <el-form-item v-if="!isEdit" label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="至少8位，含大小写字母和数字" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.display_name" placeholder="显示在界面上，如 张三" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width:100%">
            <el-option label="管理员" value="admin"><span>管理员</span><span class="role-hint">完全访问权限</span></el-option>
            <el-option label="工程师" value="engineer"><span>工程师</span><span class="role-hint">设备管理+数据导出</span></el-option>
            <el-option label="操作员" value="operator"><span>操作员</span><span class="role-hint">读取+报警确认</span></el-option>
            <el-option label="观察者" value="viewer"><span>观察者</span><span class="role-hint">只读权限</span></el-option>
          </el-select>
        </el-form-item>
      </el-form>
      <template v-slot:footer>
        <el-button :disabled="saving" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { authApi } from '@/api'
import { showActionError } from '@/utils/error'

interface User { username: string; display_name: string; role: string }

const users = ref<User[]>([])
const logs = ref<any[]>([])
const loading = ref(false)
const logsLoading = ref(false)
const dialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const form = reactive({ username: '', password: '', display_name: '', role: 'viewer' })

// 角色统计（computed避免模板中重复filter）
const adminCount = computed(() => users.value.filter(u => u.role === 'admin').length)
const engineerCount = computed(() => users.value.filter(u => u.role === 'engineer').length)
const operatorCount = computed(() => users.value.filter(u => u.role === 'operator').length)
const viewerCount = computed(() => users.value.filter(u => u.role === 'viewer').length)

// 角色 → 标签样式/显示名（模板中多处复用，避免重复三元）
const ROLE_MAP: Record<string, { label: string; tag: string }> = {
  admin: { label: '管理员', tag: 'tag--danger' },
  engineer: { label: '工程师', tag: 'tag--warning' },
  operator: { label: '操作员', tag: 'tag--success' },
  viewer: { label: '观察者', tag: 'tag--offline' },
}

function roleLabel(role: string) {
  return ROLE_MAP[role]?.label || role
}

function roleTag(role: string) {
  return ROLE_MAP[role]?.tag || 'tag--offline'
}

function actionTag(action: string) {
  if (action === 'login') return 'tag--success'
  if (action === 'login_failed') return 'tag--danger'
  if (action === 'delete_user') return 'tag--danger'
  return 'tag--info'
}

onMounted(() => { refreshUsers(); refreshLogs() })

async function refreshUsers() {
  loading.value = true
  try { const data = await authApi.getUsers(); users.value = data.users || [] } catch (e: any) { console.warn('[Users] 加载失败:', e?.message || e) }
  finally { loading.value = false }
}

async function refreshLogs() {
  logsLoading.value = true
  try { const data = await authApi.getLogs({ per_page: 50 }) as any; logs.value = data.logs || data.items || [] } catch (e: any) { console.warn('[Users] 加载失败:', e?.message || e) }
  finally { logsLoading.value = false }
}

function showAddDialog() {
  isEdit.value = false
  Object.assign(form, { username: '', password: '', display_name: '', role: 'viewer' })
  dialogVisible.value = true
}

function editUser(user: User) {
  isEdit.value = true
  Object.assign(form, { ...user, password: '' })
  dialogVisible.value = true
}

async function saveUser() {
  if (saving.value) return
  if (!isEdit.value) {
    if (!form.username.trim()) { ElMessage.warning('请输入用户名'); return }
    if (!form.password || form.password.length < 8) { ElMessage.warning('密码长度至少8位'); return }
    if (!/[A-Z]/.test(form.password)) { ElMessage.warning('密码必须包含大写字母'); return }
    if (!/[a-z]/.test(form.password)) { ElMessage.warning('密码必须包含小写字母'); return }
    if (!/[0-9]/.test(form.password)) { ElMessage.warning('密码必须包含数字'); return }
  }
  saving.value = true
  try {
    if (isEdit.value) {
      await authApi.updateUser(form.username, { display_name: form.display_name, role: form.role })
    } else {
      await authApi.register(form)
    }
    ElMessage.success(isEdit.value ? '用户已更新' : '用户已添加')
    dialogVisible.value = false
    refreshUsers()
  } catch (e: any) { showActionError(isEdit.value ? '更新用户' : '添加用户', e) }
  finally { saving.value = false }
}

async function deleteUser(username: string) {
  try { await authApi.deleteUser(username); ElMessage.success('用户已删除'); refreshUsers() } catch (e: any) { showActionError('删除用户', e) }
}

async function resetPassword(user: User) {
  try {
    const { value: newPwd } = await ElMessageBox.prompt(`为 ${user.username} 设置新密码`, '重置密码', {
      inputType: 'password',
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      customClass: 'pwd-reset',
      inputValidator: (val) => {
        if (!val || val.length < 8) return '密码长度至少8位'
        if (!/[A-Z]/.test(val)) return '密码必须包含大写字母'
        if (!/[a-z]/.test(val)) return '密码必须包含小写字母'
        if (!/[0-9]/.test(val)) return '密码必须包含数字'
        return true
      },
    })
    if (!newPwd) return
    await authApi.updateUser(user.username, { password: newPwd })
    ElMessage.success(`用户 ${user.username} 密码已重置`)
  } catch (e: any) {
    // 取消不提示；但接口/校验失败必须反馈，之前被静默吞掉会让人误以为改密成功
    if (e === 'cancel' || e === 'close') return
    showActionError('重置密码', e)
  }
}

function actionLabel(action: string) {
  const map: Record<string, string> = { login: '登录', login_failed: '登录失败', register: '注册', change_password: '改密', update_user: '更新用户', delete_user: '删除用户' }
  return map[action] || action
}
</script>

<style scoped>
.users-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--bg-page);
  color: var(--text-primary);
}

.panel__meta {
  font-size: var(--font-xs);
  font-weight: var(--weight-normal);
  color: var(--text-muted);
}

.panel__body--flush { padding: 0; }

/* ===== 统计卡 ===== */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-4);
}

.stat-card {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.stat-value--danger { color: var(--color-danger); }
.stat-value--warning { color: var(--color-warning); }
.stat-value--success { color: var(--color-success); }
.stat-value--muted { color: var(--text-secondary); }

/* ===== 表格 ===== */
.data-table { width: 100%; }

.data-table :deep(.el-table__header th.el-table__cell) {
  background: var(--bg-sunken);
  color: var(--text-secondary);
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  height: 44px;
}

.data-table :deep(.el-table__body td.el-table__cell) {
  font-size: var(--font-sm);
  color: var(--text-primary);
  padding: var(--space-3) 0;
}

.user-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.user-avatar {
  background: var(--color-brand);
  color: var(--text-inverse);
  font-weight: var(--weight-semibold);
  flex: none;
}

.user-name {
  font-size: var(--font-base);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.user-id {
  font-size: var(--font-xs);
  color: var(--text-muted);
}

/* ===== 行操作分组 ===== */
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  white-space: nowrap;
}

.row-actions__sep {
  width: 1px;
  height: 14px;
  background: var(--border-base);
  flex: none;
}

.btn-danger-link { color: var(--color-danger); }

.btn-danger-link:hover {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

/* ===== 表单 ===== */
.user-form :deep(.el-form-item__label) {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.user-form :deep(.el-form-item) { margin-bottom: var(--space-4); }

.role-hint {
  margin-left: var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-sm);
  color: var(--text-secondary);
}
</style>

<!-- 重置密码确认框：MessageBox 挂载在 body 下，scoped 无法命中，故单独声明并限定类名 -->
<style>
.pwd-reset .el-message-box__title {
  font-size: var(--font-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

.pwd-reset .el-message-box__content {
  font-size: var(--font-base);
  color: var(--text-primary);
}

.pwd-reset .el-message-box__input .el-input__inner {
  font-family: var(--font-mono);
}
</style>
