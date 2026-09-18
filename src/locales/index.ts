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

// 切换语言
export function setLocale(locale: Locale) {
  i18n.global.locale.value = locale
  localStorage.setItem('scada_locale', locale)
}

// 获取当前语言
export function getLocale(): string {
  return i18n.global.locale.value
}
