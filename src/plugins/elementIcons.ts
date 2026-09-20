/**
 * Element Plus 图标「显式白名单」全局注册。
 *
 * 为什么需要全局注册（而不是各组件自行 import）：
 * - 大量模板直接写 `<Monitor />`、`<Bell />` 等标签且**不 import**，依赖全局注册解析；
 * - 更隐蔽的是字符串形态：`<el-input prefix-icon="Lock">` 会由 el-input 内部
 *   调用 `resolveDynamicComponent('Lock')` 解析 —— 解析发生在 el-input 自己的
 *   渲染上下文里，组件的局部 import 无效，**只有全局注册才能解析成功**。
 *   若遗漏，Vue 只会打印 "Failed to resolve component" 并渲染成原生 <Lock> 空标签。
 *
 * 因此这里不用 `import * as ElementPlusIconsVue` 全量注册（那会拉入全部 293 个图标，
 * 使 icons-vue 无法 tree-shaking），而是只引入项目实际用到的图标。
 *
 * 新增图标时：在下方 import 与 GLOBAL_ICONS 白名单中各补一行即可。
 */
import type { App, Component } from 'vue'
import {
  ArrowDown,
  Bell,
  CaretRight,
  CircleCheckFilled,
  Cpu,
  DataAnalysis,
  DataLine,
  Download,
  Expand,
  Fold,
  Grid,
  HomeFilled,
  Lightning,
  Loading,
  Lock,
  Monitor,
  Odometer,
  Plus,
  Refresh,
  RefreshRight,
  Setting,
  Switch,
  SwitchButton,
  TrendCharts,
  User,
  UserFilled,
  WarningFilled,
} from '@element-plus/icons-vue'

/**
 * 全局图标白名单：键为模板/字符串中使用的组件名，值为图标组件。
 * 覆盖范围 = 全项目模板标签用法 ∪ 字符串 props ∪ router meta.icon 取值。
 */
export const GLOBAL_ICONS: Record<string, Component> = {
  ArrowDown,
  Bell,
  CaretRight,
  CircleCheckFilled,
  Cpu,
  DataAnalysis,
  DataLine,
  Download,
  Expand,
  Fold,
  Grid,
  HomeFilled,
  Lightning,
  Loading,
  Lock,
  Monitor,
  Odometer,
  Plus,
  Refresh,
  RefreshRight,
  Setting,
  Switch,
  SwitchButton,
  TrendCharts,
  User,
  UserFilled,
  WarningFilled,
}

/** 将白名单图标注册到 app 全局组件表。 */
export function registerGlobalIcons(app: App): void {
  for (const [name, component] of Object.entries(GLOBAL_ICONS)) {
    app.component(name, component)
  }
}
