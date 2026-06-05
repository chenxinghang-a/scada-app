/**
 * 实时表单校验 Composable
 * 失焦即时反馈 + 输入防抖验证
 *
 * 用法:
 *   const { errors, validate, validateField, clearErrors } = useRealTimeValidation(rules)
 */

import { ref, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

interface ValidationRule {
  required?: boolean
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  min?: number
  max?: number
  custom?: (value: any) => string | null
}

interface ValidationRules {
  [field: string]: ValidationRule[]
}

export function useRealTimeValidation(rules: ValidationRules) {
  const { t } = useI18n()
  const errors = reactive<Record<string, string[]>>({})
  const touched = reactive<Record<string, boolean>({})
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function validateField(field: string, value: any): string[] {
    const fieldRules = rules[field] || []
    const fieldErrors: string[] = []

    for (const rule of fieldRules) {
      if (rule.required && (value === undefined || value === null || value === '')) {
        fieldErrors.push(t('validation.required', { field }))
        continue
      }

      if (value === undefined || value === null || value === '') continue

      if (rule.minLength && String(value).length < rule.minLength) {
        fieldErrors.push(t('validation.minLength', { field, min: rule.minLength }))
      }

      if (rule.maxLength && String(value).length > rule.maxLength) {
        fieldErrors.push(t('validation.maxLength', { field, max: rule.maxLength }))
      }

      if (rule.pattern && !rule.pattern.test(String(value))) {
        fieldErrors.push(t('validation.pattern', { field }))
      }

      if (rule.min !== undefined && Number(value) < rule.min) {
        fieldErrors.push(t('validation.min', { field, min: rule.min }))
      }

      if (rule.max !== undefined && Number(value) > rule.max) {
        fieldErrors.push(t('validation.max', { field, max: rule.max }))
      }

      if (rule.custom) {
        const customError = rule.custom(value)
        if (customError) fieldErrors.push(customError)
      }
    }

    errors[field] = fieldErrors
    return fieldErrors
  }

  function validate(data: Record<string, any>): boolean {
    let valid = true
    for (const field of Object.keys(rules)) {
      const fieldErrors = validateField(field, data[field])
      if (fieldErrors.length > 0) valid = false
    }
    return valid
  }

  function validateOnBlur(field: string, value: any) {
    touched[field] = true
    validateField(field, value)
  }

  function validateOnChange(field: string, value: any, delay: number = 300) {
    if (!touched[field]) return

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      validateField(field, value)
    }, delay)
  }

  function clearErrors(field?: string) {
    if (field) {
      errors[field] = []
    } else {
      for (const key of Object.keys(errors)) {
        errors[key] = []
      }
    }
  }

  function clearTouched() {
    for (const key of Object.keys(touched)) {
      touched[key] = false
    }
  }

  function reset() {
    clearErrors()
    clearTouched()
  }

  const hasErrors = computed(() => {
    return Object.values(errors).some(e => e.length > 0)
  })

  return {
    errors,
    touched,
    hasErrors,
    validate,
    validateField,
    validateOnBlur,
    validateOnChange,
    clearErrors,
    clearTouched,
    reset,
  }
}
