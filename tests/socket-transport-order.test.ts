import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * socket.io transports 顺序守卫（2026-10-10 实时数据通道缺陷）
 *
 * 缺陷：`transports: ['websocket', 'polling']`（websocket 优先）时，client 会反复
 * 尝试「直连 websocket」→ 服务端 400（`Invalid websocket upgrade`——本后端要求
 * 先 polling 握手拿 sid 再升级）→ 且 **client 不降级** —— 实时通道永远连不上。
 * 实测（E2E 全程）：6 次 socket 请求全部 `transport=websocket` + 400、**0 次 polling**；
 * 表现 = 性能监控「未连接」/ 数据大屏 0/0 / 报警输出停在「同步中」。
 *
 * 修复：polling 优先（= socket.io 默认顺序 `['polling','websocket']`）。
 * 本守卫防止后人（含 AI）再把它"优化"回 websocket 优先。
 */

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(e.name)) out.push(p)
  }
  return out
}

describe('socket.io transports 顺序（实时通道守卫）', () => {
  const files = walk(SRC)
  const hits: Array<{ file: string; arr: string }> = []
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8')
    for (const m of src.matchAll(/transports:\s*\[([^\]]*)\]/g)) {
      hits.push({ file: f, arr: m[1] })
    }
  }

  it('★ 回归：任何 transports 数组首位必须是 polling（websocket 首位 → 直连被 400 且不降级）', () => {
    expect(
      hits.length,
      'src 下没扫到任何 transports 配置 —— 守卫在空转（扫描逻辑/目录结构变了？）',
    ).toBeGreaterThan(0)
    for (const h of hits) {
      const first = (h.arr.split(',')[0] || '').trim().replace(/['"]/g, '')
      expect(
        first,
        `${path.relative(ROOT, h.file)} 的 transports 首位是 "${first}" —— 必须 polling 优先`,
      ).toBe('polling')
    }
  })

  it('正向对照：三个 socket 视图仍存在、仍有 io( 调用、且都以 polling 开头', () => {
    const must = [
      'src/views/Dashboard.vue',
      'src/views/Screen.vue',
      'src/views/AlarmOutput.vue',
    ]
    for (const rel of must) {
      const p = path.join(ROOT, rel)
      expect(fs.existsSync(p), `${rel} 不存在（若已重构，请更新本守卫的文件清单）`).toBe(true)
      const src = fs.readFileSync(p, 'utf8')
      expect(/io\(/.test(src), `${rel} 里没有 io( 调用（守卫目标漂移了？）`).toBe(true)
      expect(
        /transports:\s*\[\s*'polling'/.test(src),
        `${rel} 的 transports 未以 polling 开头`,
      ).toBe(true)
    }
  })
})
