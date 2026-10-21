/**
 * 写入结果的提示文案（纯函数，可单测）。
 *
 * 为什么单独抽出来
 * ----------------
 * 后端 `write_with_verification` 返回里带 `verified`：
 *   true  → 回读一致，设备确实接受了这个值；
 *   false → 回读不一致，**设备没接受**；
 *   null  → 没能回读（客户端不支持 / 通信失败）。
 *
 * 而控制页原先一律弹「写入成功」。于是：
 *   · 「写进去了但设备没接受」显示成功；
 *   · 「根本没验证」也显示成功。
 * 操作员据此判断现场状态 —— 这是安全相关的假成功，必须按 verified 区分。
 *
 * 抽成纯函数是为了有测试钉住：`verified === false` **绝不能**返回 success。
 */

export type WriteNoticeLevel = 'success' | 'warning' | 'info'

export interface WriteNotice {
  level: WriteNoticeLevel
  message: string
}

export function describeWriteResult(res: any): WriteNotice {
  const verified = res?.verified
  if (verified === false) {
    return {
      level: 'warning',
      message: String(res?.message || '写入已下发，但回读验证失败：设备未接受该值'),
    }
  }
  if (verified === null) {
    return {
      level: 'info',
      message: String(res?.message || '写入已下发，但无法回读验证'),
    }
  }
  // true 或后端没给这个字段（老版本 / 降级路径）→ 维持原来的成功提示
  return { level: 'success', message: '写入成功' }
}
