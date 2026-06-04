<template>
  <el-container class="layout-container">
    <!-- 侧边栏 -->
    <el-aside :width="appStore.sidebarCollapsed ? '64px' : '220px'" class="layout-aside">
      <div class="logo" :class="{ collapsed: appStore.sidebarCollapsed }">
        <el-icon :size="28"><Monitor /></el-icon>
        <span v-show="!appStore.sidebarCollapsed" class="logo-text">SmartSCADA</span>
      </div>

      <el-menu
        :default-active="currentRoute"
        :collapse="appStore.sidebarCollapsed"
        router
        background-color="#1d1e1f"
        text-color="#bfcbd9"
        active-text-color="#409eff"
        class="sidebar-menu"
      >
        <el-menu-item index="/dashboard" v-if="canAccess(['admin','engineer','operator','viewer'])">
          <el-icon><Odometer /></el-icon>
          <template #title>仪表盘</template>
        </el-menu-item>
        <el-menu-item index="/devices" v-if="canAccess(['admin','engineer'])">
          <el-icon><Monitor /></el-icon>
          <template #title>设备管理</template>
        </el-menu-item>
        <el-menu-item index="/control" v-if="canAccess(['admin','engineer'])">
          <el-icon><Switch /></el-icon>
          <template #title>设备控制</template>
        </el-menu-item>
        <el-menu-item index="/history" v-if="canAccess(['admin','engineer','operator','viewer'])">
          <el-icon><DataLine /></el-icon>
          <template #title>历史数据</template>
        </el-menu-item>
        <el-menu-item index="/alarms" v-if="canAccess(['admin','engineer','operator','viewer'])">
          <el-icon><Bell /></el-icon>
          <template #title>报警管理</template>
        </el-menu-item>
        <el-menu-item index="/alarm-output" v-if="canAccess(['admin','engineer'])">
          <el-icon><Lightning /></el-icon>
          <template #title>报警输出</template>
        </el-menu-item>
        <el-menu-item index="/industry40" v-if="canAccess(['admin','engineer','operator','viewer'])">
          <el-icon><Cpu /></el-icon>
          <template #title>工业4.0</template>
        </el-menu-item>
        <el-menu-item index="/screen" v-if="canAccess(['admin','engineer','operator','viewer'])">
          <el-icon><Monitor /></el-icon>
          <template #title>数据大屏</template>
        </el-menu-item>
        <el-menu-item index="/config" v-if="canAccess(['admin'])">
          <el-icon><Setting /></el-icon>
          <template #title>系统配置</template>
        </el-menu-item>
        <el-menu-item index="/users" v-if="canAccess(['admin'])">
          <el-icon><User /></el-icon>
          <template #title>用户管理</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <!-- 主内容区 -->
    <el-container>
      <!-- 顶部栏 -->
      <el-header class="layout-header">
        <div class="header-left">
          <el-icon
            class="collapse-btn"
            :size="20"
            @click="appStore.toggleSidebar"
          >
            <Fold v-if="!appStore.sidebarCollapsed" />
            <Expand v-else />
          </el-icon>

          <!-- 面包屑导航 -->
          <el-breadcrumb separator="/" class="ml-12 breadcrumb-nav">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item>{{ currentTitle }}</el-breadcrumb-item>
          </el-breadcrumb>

          <!-- 模拟模式标签 -->
          <el-tag v-if="appStore.simulationMode" type="warning" size="small" effect="dark" class="ml-12">
            模拟模式
          </el-tag>
          <el-tag v-else type="success" size="small" effect="dark" class="ml-12">
            实时模式
          </el-tag>
        </div>

        <div class="header-right">
          <!-- 系统状态 -->
          <el-badge :value="appStore.activeAlarmCount" :hidden="appStore.activeAlarmCount === 0" :max="99">
            <el-icon :size="18" class="header-icon"><Bell /></el-icon>
          </el-badge>

          <el-tooltip :content="appStore.backendOnline ? '后端在线' : (appStore.connectionRetries <= 2 ? '正在连接...' : '后端离线')" placement="bottom">
            <el-icon :size="18" class="header-icon system-status-dot" :class="{ online: appStore.backendOnline, connecting: !appStore.backendOnline && appStore.connectionRetries <= 2 }">
              <CircleCheckFilled />
            </el-icon>
          </el-tooltip>

          <!-- 用户菜单 -->
          <el-dropdown trigger="click" @command="handleUserCommand">
            <span class="user-dropdown">
              <el-icon><UserFilled /></el-icon>
              <span>{{ authStore.displayName }}</span>
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>
                  <small>{{ authStore.roleName }}</small>
                </el-dropdown-item>
                <el-dropdown-item v-if="authStore.isAdmin" divided command="users">用户管理</el-dropdown-item>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item divided command="logout" class="text-danger">
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 页面内容 -->
      <el-main class="layout-main">
        <!-- 后端连接中遮罩 -->
        <div v-if="!appStore.backendOnline && appStore.connectionRetries <= 2 && !appStore.backendFirstCheck" class="connecting-overlay">
          <div class="connecting-content">
            <div class="connecting-spinner"></div>
            <div class="connecting-text">正在连接后端服务...</div>
            <div class="connecting-sub">端口 5000 · 请稍候</div>
          </div>
        </div>
        <!-- 后端离线提示（非首次连接） -->
        <el-alert v-if="!appStore.backendOnline && appStore.connectionRetries > 2" title="后端服务离线" type="warning" description="部分功能可能不可用，请检查后端服务是否正常运行。" show-icon :closable="false" style="margin-bottom:12px" />
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const appStore = useAppStore()

// 角色权限检查（响应式 — 基于 store 而非 localStorage）
const userRole = computed(() => authStore.user?.role || '')
function canAccess(roles: string[]): boolean {
  return !!userRole.value && roles.includes(userRole.value)
}

const currentRoute = computed(() => route.path)
const currentTitle = computed(() => {
  const titles: Record<string, string> = {
    '/dashboard': '仪表盘',
    '/devices': '设备管理',
    '/control': '设备控制',
    '/history': '历史数据',
    '/alarms': '报警管理',
    '/alarm-output': '报警输出',
    '/industry40': '工业4.0',
    '/screen': '数据大屏',
    '/config': '系统配置',
    '/users': '用户管理',
  }
  return titles[route.path] || ''
})

let statusTimer: ReturnType<typeof setInterval>
let idleTimer: ReturnType<typeof setTimeout>
let lastActivityTime = 0
let cleanupBackendListener: (() => void) | null = null
const IDLE_TIMEOUT = 15 * 60 * 1000 // 15分钟空闲超时（对齐原项目）
const ACTIVITY_THROTTLE = 5000 // 5秒节流，避免mousemove每秒触发60+次

// 重置空闲计时器
function resetIdleTimer() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(handleIdleTimeout, IDLE_TIMEOUT)
}

// 空闲超时处理
let idleDialogVisible = false
async function handleIdleTimeout() {
  if (idleDialogVisible) return
  idleDialogVisible = true
  try {
    await ElMessageBox.confirm('会话已空闲15分钟，是否继续使用？', '会话超时', {
      confirmButtonText: '继续使用',
      cancelButtonText: '退出登录',
      type: 'warning',
    })
    idleDialogVisible = false
    resetIdleTimer()
  } catch (err: any) {
    idleDialogVisible = false
    if (err === 'cancel' || err?.message === 'cancel') {
      await authStore.logout()
      router.push('/login')
    }
  }
}

// 监听用户活动（带节流）
const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']
function handleActivity() {
  const now = Date.now()
  if (now - lastActivityTime < ACTIVITY_THROTTLE) return
  lastActivityTime = now
  resetIdleTimer()
}

onMounted(async () => {
  // 验证登录状态
  // verify 返回: true=有效, false=token无效(已logout), 'error'=网络问题(保留token)
  const verifyResult = await authStore.verify()
  if (verifyResult === false) {
    // token 确认无效，跳登录页
    router.push('/login')
    return
  }
  // verifyResult === 'error' 时不做任何操作，保留当前登录状态
  // 获取系统状态
  appStore.fetchSystemStatus()
  // 定时刷新状态
  statusTimer = setInterval(() => {
    appStore.fetchSystemStatus()
  }, 10000)
  // 启动空闲超时检测
  resetIdleTimer()
  activityEvents.forEach(event => document.addEventListener(event, handleActivity))
  // 监听 Electron 后端状态变更（实时推送）
  const win = window as any
  if (win.electronAPI?.onBackendStatusChanged) {
    cleanupBackendListener = win.electronAPI.onBackendStatusChanged((data: { healthy: boolean }) => {
      appStore.backendOnline = data.healthy
    })
  }
})

onUnmounted(() => {
  clearInterval(statusTimer)
  clearTimeout(idleTimer)
  activityEvents.forEach(event => document.removeEventListener(event, handleActivity))
  if (cleanupBackendListener) { cleanupBackendListener(); cleanupBackendListener = null }
})

async function handleUserCommand(command: string) {
  switch (command) {
    case 'users':
      router.push('/users')
      break
    case 'password':
      changePassword()
      break
    case 'logout':
      await authStore.logout()
      router.push('/login')
      break
  }
}

async function changePassword() {
  try {
    const { value: oldPwd } = await ElMessageBox.prompt('请输入旧密码', '修改密码', {
      inputType: 'password',
      confirmButtonText: '下一步',
      cancelButtonText: '取消',
    })
    if (!oldPwd) return

    const { value: newPwd } = await ElMessageBox.prompt('请输入新密码（至少8位，含大小写字母和数字）', '修改密码', {
      inputType: 'password',
      confirmButtonText: '确认修改',
      cancelButtonText: '取消',
      inputValidator: (val) => {
        if (!val || val.length < 8) return '密码长度至少8位'
        if (!/[A-Z]/.test(val)) return '密码必须包含大写字母'
        if (!/[a-z]/.test(val)) return '密码必须包含小写字母'
        if (!/[0-9]/.test(val)) return '密码必须包含数字'
        return true
      },
    })
    if (!newPwd) return

    const { authApi } = await import('@/api')
    const data = await authApi.changePassword(oldPwd, newPwd)
    if (data.success) {
      ElMessage.success('密码修改成功，请重新登录')
      // 原项目要求：密码修改后撤销所有token
      await authStore.logout()
      router.push('/login')
    } else {
      ElMessage.error(data.message || '修改失败')
    }
  } catch {
    // 用户取消
  }
}
</script>

<style scoped>
.layout-container {
  height: 100vh;
}

.layout-aside {
  background-color: #1d1e1f;
  transition: width 0.3s;
  overflow: hidden;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #409eff;
  font-size: 20px;
  font-weight: bold;
  border-bottom: 1px solid #2d2d2d;
  white-space: nowrap;
}

.logo.collapsed .logo-text {
  display: none;
}

.sidebar-menu {
  border-right: none;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.layout-header {
  background: #fff;
  border-bottom: 1px solid #e6e6e6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 60px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 18px;
}

.collapse-btn {
  cursor: pointer;
  color: #666;
}
.collapse-btn:hover {
  color: #409eff;
}

.header-icon {
  cursor: pointer;
  color: #666;
}
.header-icon:hover {
  color: #409eff;
}

.system-status-dot {
  color: #909399;
}
.system-status-dot.online {
  color: #67c23a;
}
.system-status-dot.connecting {
  color: #e6a23c;
  animation: pulse-connecting 1.5s ease-in-out infinite;
}
@keyframes pulse-connecting {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.user-dropdown {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #333;
}

.layout-main {
  background: #f5f7fa;
  padding: 20px;
  overflow-y: auto;
}

.ml-12 {
  margin-left: 12px;
}

.text-danger {
  color: #f56c6c;
}

.breadcrumb-nav {
  font-size: 13px;
}

.breadcrumb-nav :deep(.el-breadcrumb__inner) {
  color: #909399;
}

.breadcrumb-nav :deep(.el-breadcrumb__inner.is-link:hover) {
  color: #409eff;
}

.breadcrumb-nav :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: #303133;
  font-weight: 600;
}

.connecting-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255,255,255,0.92);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}
.connecting-content {
  text-align: center;
}
.connecting-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #e5e7eb;
  border-top-color: #409eff;
  border-radius: 50%;
  margin: 0 auto 16px;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg) } }
.connecting-text {
  font-size: 16px;
  color: #303133;
  font-weight: 600;
  margin-bottom: 6px;
}
.connecting-sub {
  font-size: 13px;
  color: #909399;
}
</style>
