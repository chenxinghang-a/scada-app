import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import router from './router'
import i18n from './locales'
import { installErrorLogger } from './composables/useErrorLogger'
import { registerGlobalIcons } from './plugins/elementIcons'
// 样式引入顺序：设计令牌(变量) → 全局基础 → 主题(深色) → 响应式
import './styles/design-tokens.css'
import './assets/style.css'
import './styles/dark-mode.css'
import './styles/responsive.css'

// 安装全局错误日志上报
installErrorLogger()

const app = createApp(App)

// 注册项目实际用到的 Element Plus 图标（显式白名单，见 plugins/elementIcons.ts）
// 不再遍历全量图标：全量注册会让 icons-vue 无法 tree-shaking，把 293 个图标全打进产物
registerGlobalIcons(app)

app.use(createPinia())
app.use(router)
app.use(i18n)
app.use(ElementPlus, { locale: zhCn })

app.mount('#app')
