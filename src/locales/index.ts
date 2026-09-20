/**
 * i18n 现状说明（重要：这里是**有意保留但未在产品界面上启用**，不是漏改）
 *
 * 现状：
 * - 插件已注册（main.ts 里 `app.use(i18n)`），语言包 zh-CN / en-US 各 ~200 行，
 *   已覆盖 common/nav/login/dashboard/devices/... 等命名空间。
 * - 但**没有任何一处界面真正用它**：
 *   1) 全部视图（含 Login.vue、ForceChangePassword.vue 两个门面页）都是硬编码中文，
 *      没有 `t()` 调用；el-message / ECharts formatter / 表格列名同样是中文常量；
 *   2) 唯一的 `useI18n()` 消费方是 ErrorBoundary.vue、useErrorHandler.ts、
 *      useRealTimeValidation.ts，而这三个文件从 main.ts 出发都不可达（死代码）；
 *   3) `setLocale()` / `getLocale()` 全仓库无调用点 —— 界面上没有任何语言切换入口，
 *      因此 en-US 即使被选中也无处生效（切换只影响内存里的 locale 值）。
 *
 * 为什么不“顺手启用”：
 * 只把 Login/ForceChangePassword 改成 t() 会出现“登录页英文、进主界面中文”的半截状态，
 * 且没有切换入口时 en-US 永远无法被用户看到，属于比现状更差的体验。
 *
 * 完整启用的前置条件（按代价排序）：
 * 1. 在顶栏（MainLayout.vue）加语言切换控件（调 setLocale/getLocale），否则一切无意义；
 * 2. 补全语言包缺失的命名空间（forceChangePassword、报警输出/工业4.0 等页面的文案），
 *    并把 ElMessage/后端错误文案（utils/error.ts）也改为走 t()；
 * 3. 逐视图把硬编码中文替换为 t()，包括表格列名、图表 label/formatter 文案；
 * 4. 增加一条“语言包键是否齐全”的单测，避免中英键漂移。
 *
 * 在上述 1~4 完成前，请保持本文件现状（索引 i18n 实例 + 语言包），
 * 不要删除语言包，也不要扩大 `t()` 的使用面，以免出现半翻译状态。
 */
import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import enUS from './en-US'

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

type Locale = keyof typeof messages

// 从localStorage读取语言设置，默认中文
// 存量值可能是已废弃/非法语言码（如 'zh'），直接用会让每条 t() 都走一遍 fallback 告警
const savedLocale = localStorage.getItem('scada_locale') as Locale
const initialLocale: Locale = savedLocale && savedLocale in messages ? savedLocale : 'zh-CN'

const i18n = createI18n({
  legacy: false, // 使用Composition API
  locale: initialLocale,
  fallbackLocale: 'zh-CN',
  messages,
})

export default i18n

/** 切换语言（当前无 UI 入口，见文件头说明） */
export function setLocale(locale: Locale) {
  i18n.global.locale.value = locale
  localStorage.setItem('scada_locale', locale)
}

/** 获取当前语言（当前无调用点，见文件头说明） */
export function getLocale(): string {
  return i18n.global.locale.value
}
