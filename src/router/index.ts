import { createRouter, createWebHashHistory } from 'vue-router'
import MainLayout from '@/components/MainLayout.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
    },
    {
      path: '/force-change-password',
      name: 'ForceChangePassword',
      component: () => import('@/views/ForceChangePassword.vue'),
    },
    {
      path: '/screen',
      name: 'Screen',
      component: () => import('@/views/Screen.vue'),
      meta: { title: '数据大屏', screen: true },
    },
    {
      path: '/',
      component: MainLayout,
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('@/views/Dashboard.vue'),
          meta: { title: '仪表盘', icon: 'Odometer', roles: ['admin', 'engineer', 'operator', 'viewer'] },
        },
        {
          path: 'devices',
          name: 'Devices',
          component: () => import('@/views/Devices.vue'),
          meta: { title: '设备管理', icon: 'Monitor', roles: ['admin', 'engineer'] },
        },
        {
          path: 'control',
          name: 'Control',
          component: () => import('@/views/Control.vue'),
          meta: { title: '设备控制', icon: 'Switch', roles: ['admin', 'engineer'] },
        },
        {
          path: 'history',
          name: 'History',
          component: () => import('@/views/History.vue'),
          meta: { title: '历史数据', icon: 'DataLine', roles: ['admin', 'engineer', 'operator', 'viewer'] },
        },
        {
          path: 'alarms',
          name: 'Alarms',
          component: () => import('@/views/Alarms.vue'),
          meta: { title: '报警管理', icon: 'Bell', roles: ['admin', 'engineer', 'operator', 'viewer'] },
        },
        {
          path: 'alarm-output',
          name: 'AlarmOutput',
          component: () => import('@/views/AlarmOutput.vue'),
          meta: { title: '报警输出', icon: 'Lightning', roles: ['admin', 'engineer'] },
        },
        {
          path: 'industry40',
          name: 'Industry40',
          component: () => import('@/views/Industry40.vue'),
          meta: { title: '工业4.0', icon: 'Cpu', roles: ['admin', 'engineer', 'operator', 'viewer'] },
        },
        {
          path: 'config',
          name: 'Config',
          component: () => import('@/views/Config.vue'),
          meta: { title: '系统配置', icon: 'Setting', roles: ['admin'] },
        },
        {
          path: 'users',
          name: 'Users',
          component: () => import('@/views/Users.vue'),
          meta: { title: '用户管理', icon: 'User', roles: ['admin'] },
        },
        {
          path: 'performance',
          name: 'Performance',
          component: () => import('@/views/PerformanceMonitor.vue'),
          meta: { title: '性能监控', icon: 'TrendCharts', roles: ['admin', 'engineer'] },
        },
      ],
    },
  ],
})

// 路由守卫 - 检查登录状态 + 强制改密 + 角色权限
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('auth_token')
  const mustChangePwd = localStorage.getItem('scada_must_change_password')

  // 未登录 → 跳登录页
  if (to.path !== '/login' && to.path !== '/force-change-password' && !token) {
    next('/login')
    return
  }

  // 需要强制改密 → 只允许访问改密页面
  if (mustChangePwd === 'true' && to.path !== '/force-change-password' && to.path !== '/login') {
    next('/force-change-password')
    return
  }

  // 角色权限检查
  if (to.meta?.roles) {
    try {
      const user = JSON.parse(localStorage.getItem('scada_user') || '{}')
      const allowedRoles = to.meta.roles as string[]
      if (!user.role || !allowedRoles.includes(user.role)) {
        if (!token) {
          next('/login')
        } else {
          // 有 token 但角色不匹配 → 重定向到仪表盘（不放行未授权页面）
          next('/dashboard')
        }
        return
      }
    } catch {
      // JSON 解析失败 → user 缓存损坏，只清 user 不清 token，重定向到登录
      localStorage.removeItem('scada_user')
      next('/login')
      return
    }
  }

  next()
})

export default router
