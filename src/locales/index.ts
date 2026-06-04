import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import enUS from './en-US'

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

// 从localStorage读取语言设置，默认中文
const savedLocale = localStorage.getItem('scada_locale') || 'zh-CN'

const i18n = createI18n({
  legacy: false, // 使用Composition API
  locale: savedLocale,
  fallbackLocale: 'zh-CN',
  messages,
})

export default i18n

// 切换语言
export function setLocale(locale: string) {
  i18n.global.locale.value = locale
  localStorage.setItem('scada_locale', locale)
}

// 获取当前语言
export function getLocale(): string {
  return i18n.global.locale.value
}
