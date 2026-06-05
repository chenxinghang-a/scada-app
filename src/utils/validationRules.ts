/**
 * 表单校验规则引擎
 * 提供可复用的校验规则，支持自定义规则组合。
 *
 * 用法:
 *   import { rules, createValidator } from '@/utils/validationRules'
 *   const { validate, errors } = createValidator({
 *     name: [rules.required(), rules.minLength(2), rules.maxLength(50)],
 *     port: [rules.required(), rules.port()],
 *     ip: [rules.required(), rules.ip()],
 *   })
 */

export interface ValidationRule {
  name: string
  validator: (value: any) => boolean | string
  message?: string
}

export interface ValidationResult {
  valid: boolean
  errors: Record<string, string[]>
}

/**
 * 预定义校验规则
 */
export const rules = {
  /** 必填 */
  required(message?: string): ValidationRule {
    return {
      name: 'required',
      validator: (v) => {
        if (v === null || v === undefined || v === '') return false
        if (Array.isArray(v) && v.length === 0) return false
        return true
      },
      message: message || '此字段为必填项',
    }
  },

  /** 最小长度 */
  minLength(min: number, message?: string): ValidationRule {
    return {
      name: 'minLength',
      validator: (v) => !v || String(v).length >= min,
      message: message || `最少${min}个字符`,
    }
  },

  /** 最大长度 */
  maxLength(max: number, message?: string): ValidationRule {
    return {
      name: 'maxLength',
      validator: (v) => !v || String(v).length <= max,
      message: message || `最多${max}个字符`,
    }
  }

  /** 数值范围 */
  range(min: number, max: number, message?: string): ValidationRule {
    return {
      name: 'range',
      validator: (v) => {
        if (v === '' || v === null || v === undefined) return true
        const num = Number(v)
        return !isNaN(num) && num >= min && num <= max
      },
      message: message || `数值范围: ${min}-${max}`,
    }
  }

  /** 端口号 */
  port(message?: string): ValidationRule {
    return {
      name: 'port',
      validator: (v) => {
        if (!v) return true
        const num = Number(v)
        return Number.isInteger(num) && num >= 1 && num <= 65535
      },
      message: message || '端口号: 1-65535',
    }
  }

  /** IP地址 */
  ip(message?: string): ValidationRule {
    return {
      name: 'ip',
      validator: (v) => {
        if (!v) return true
        // 支持IPv4和hostname
        const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/
        const hostname = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/
        if (ipv4.test(v)) {
          return v.split('.').every((p: string) => Number(p) >= 0 && Number(p) <= 255)
        }
        return hostname.test(v) || v === 'localhost'
      },
      message: message || '请输入有效的IP地址或主机名',
    }
  }

  /** 邮箱 */
  email(message?: string): ValidationRule {
    return {
      name: 'email',
      validator: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      message: message || '请输入有效的邮箱地址',
    }
  }

  /** 正则匹配 */
  pattern(regex: RegExp, message?: string): ValidationRule {
    return {
      name: 'pattern',
      validator: (v) => !v || regex.test(String(v)),
      message: message || '格式不正确',
    }
  }

  /** 自定义函数 */
  custom(fn: (v: any) => boolean | string, name: string = 'custom'): ValidationRule {
    return {
      name,
      validator: fn,
    }
  }

  /** 数字 */
  numeric(message?: string): ValidationRule {
    return {
      name: 'numeric',
      validator: (v) => v === '' || v === null || v === undefined || !isNaN(Number(v)),
      message: message || '请输入数字',
    }
  }

  /** 整数 */
  integer(message?: string): ValidationRule {
    return {
      name: 'integer',
      validator: (v) => {
        if (v === '' || v === null || v === undefined) return true
        const num = Number(v)
        return Number.isInteger(num)
      },
      message: message || '请输入整数',
    }
  }
}

/**
 * 创建表单校验器
 */
export function createValidator(schema: Record<string, ValidationRule[]>) {
  const errors = ref<Record<string, string[]>>({})
  const isValid = ref(true)

  function validate(data: Record<string, any>): boolean {
    const newErrors: Record<string, string[]> = {}
    let valid = true

    for (const [field, fieldRules] of Object.entries(schema)) {
      const value = data[field]
      const fieldErrors: string[] = []

      for (const rule of fieldRules) {
        const result = rule.validator(value)
        if (result === false) {
          fieldErrors.push(rule.message || `${field} 校验失败`)
          valid = false
        } else if (typeof result === 'string') {
          fieldErrors.push(result)
          valid = false
        }
      }

      if (fieldErrors.length > 0) {
        newErrors[field] = fieldErrors
      }
    }

    errors.value = newErrors
    isValid.value = valid
    return valid
  }

  function validateField(field: string, value: any): string[] {
    const fieldRules = schema[field] || []
    const fieldErrors: string[] = []

    for (const rule of fieldRules) {
      const result = rule.validator(value)
      if (result === false) {
        fieldErrors.push(rule.message || `${field} 校验失败`)
      } else if (typeof result === 'string') {
        fieldErrors.push(result)
      }
    }

    errors.value = { ...errors.value, [field]: fieldErrors }
    return fieldErrors
  }

  function clearErrors(field?: string) {
    if (field) {
      const { [field]: _, ...rest } = errors.value
      errors.value = rest
    } else {
      errors.value = {}
    }
  }

  function getFieldError(field: string): string | null {
    const fieldErrors = errors.value[field]
    return fieldErrors && fieldErrors.length > 0 ? fieldErrors[0] : null
  }

  return {
    errors,
    isValid,
    validate,
    validateField,
    clearErrors,
    getFieldError,
  }
}
