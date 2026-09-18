import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import i18n from './locales'
import { installErrorLogger } from './composables/useErrorLogger'
// 样式引入顺序：设计令牌(变量) → 全局基础 → 主题(深色) → 响应式
import './styles/design-tokens.css'
import './assets/style.css'
import './styles/dark-mode.css'
import './styles/responsive.css'

// 安装全局错误日志上报
installErrorLogger()

const app = createApp(App)

// 注册所有 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.use(i18n)
app.use(ElementPlus, { locale: zhCn })

app.mount('#app')
