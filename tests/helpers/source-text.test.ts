/**
 * `tests/helpers/source-text.ts` 的单测 —— 重点证明**状态机版优于旧正则版**。
 *
 * 本文件的每一个"反例"断言，都对应仓库里曾真实存在的 4 份正则实现的一个失真。
 * 因此它不仅测"共享原语对不对"，还把"为什么要统一"钉成了可执行证据。
 */

import { describe, it, expect } from 'vitest'
import {
  stripComments,
  stripHtmlComments,
  stripCommentsAndStrings,
  skipString,
  matchParen,
  extractFunctionBody,
  extractBraceBlock,
} from '../helpers/source-text'

/** 旧正则实现（仓库里曾有 4 份，取最完备的一版）—— 仅用于**反例对照**。 */
function legacyStripByRegex(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('stripComments（状态机版）', () => {
  it('剥行注释与块注释（基本盘）', () => {
    expect(stripComments('a // 注释\nb')).toBe('a \nb')
    expect(stripComments('a /* 注释 */ b')).toBe('a  b')
  })

  it('保留字符串字面量里的 //（旧正则版的失真 #1）', () => {
    const src = "const s = 'a//b'"
    // 旧正则把字符串内容当注释删了 —— 记录这个失真
    expect(legacyStripByRegex(src)).toBe("const s = 'a")
    // 状态机版保留完整
    expect(stripComments(src)).toBe("const s = 'a//b'")
  })

  it('保留字符串字面量里的 /* */（旧正则版的失真 #2）', () => {
    const src = "const p = '/* not comment */'"
    expect(legacyStripByRegex(src)).toBe("const p = ''")
    expect(stripComments(src)).toBe("const p = '/* not comment */'")
  })

  it('保留 URL 里的 ://（旧正则靠 [^:] 启发式绕开，状态机是结构性的）', () => {
    const src = "fetch('https://example.com/x') // 真注释"
    expect(stripComments(src)).toBe("fetch('https://example.com/x') ")
  })

  it('处理转义引号，不把被转义的引号当字符串结束', () => {
    const src = "const s = 'it\\'s // not comment' // real"
    expect(stripComments(src)).toBe("const s = 'it\\'s // not comment' ")
  })

  it('模板字符串里的注释符号同样保留', () => {
    const src = 'const t = `a // b /* c */`'
    expect(stripComments(src)).toBe('const t = `a // b /* c */`')
  })

  it('选项 html:true 时连带剥 HTML 注释', () => {
    const src = '<!-- x -->a /* y */ b'
    expect(stripComments(src, { html: true })).toBe('a  b')
    // 不带选项时 HTML 注释保留（语义明确，不隐式做）
    expect(stripComments(src)).toContain('<!-- x -->')
  })
})

describe('stripCommentsAndStrings（纯代码骨架）', () => {
  it('字符串整体替换为 ""，标识符不再被字符串冒充', () => {
    const src = "console.log('spawn('); spawn(x)"
    const skeleton = stripCommentsAndStrings(src)
    // 字符串里的 'spawn(' 被抹掉，只剩真实调用
    expect(skeleton).not.toContain("'spawn('")
    expect(skeleton).toContain('spawn(x)')
  })

  it('同时剥注释', () => {
    expect(stripCommentsAndStrings('a /* c */ // d\nb')).toBe('a  \nb')
  })
})

describe('skipString', () => {
  it('跳过单引号/双引号/模板，支持转义', () => {
    expect(skipString("'abc' rest", 0)).toBe(5)
    expect(skipString(`"a\\"b" rest`, 0)).toBe(6)
    expect(skipString('`x` rest', 0)).toBe(3)
  })

  it('未闭合字符串返回长度（不抛）', () => {
    expect(skipString("'never closed", 0)).toBe("'never closed".length)
  })
})

describe('matchParen', () => {
  it('正确配对，跳过字符串/注释里的括号', () => {
    expect(matchParen('(a(b)c)', 0)).toBe(6)
    expect(matchParen("(')')", 0)).toBe(4) // 字符串里的 ) 不计入
    expect(matchParen('(a /* ) */ b)', 0)).toBe(12) // 注释里的 ) 不计入
  })

  it('不配平返回 -1', () => {
    expect(matchParen('(a', 0)).toBe(-1)
  })
})

describe('extractFunctionBody / extractBraceBlock', () => {
  const code = [
    'function setupUpdater() {',
    '  // 注释里提到 hasPublishConfig() 也不算数',
    '  if (!hasPublishConfig()) {',
    '    reportDisabled("x")',
    '    return',
    '  }',
    '  doReal()',
    '}',
  ].join('\n')

  it('抠出不含外层花括号的函数体', () => {
    const body = extractFunctionBody(code, 'setupUpdater')!
    expect(body).toContain('doReal()')
    expect(body).not.toContain('function setupUpdater')
  })

  it('⚠️ 返回的体含注释 —— 断言前必须再 stripComments（Bug 15 的教训）', () => {
    const body = extractFunctionBody(code, 'setupUpdater')!
    // 原始体里注释存在 → 直接 /\bhasPublishConfig\b/ 会被注释点亮（假绿隐患）
    expect(body).toContain('hasPublishConfig')
    // 剥注释后：真实调用仍在（本例里 if 就是真代码），但注释那一行已不在
    const stripped = stripComments(body)
    expect(stripped).toContain('hasPublishConfig')
    expect(stripped).not.toContain('注释里提到')
  })

  it('找不到函数返回 null', () => {
    expect(extractFunctionBody(code, 'nope')).toBeNull()
  })

  it('extractBraceBlock 跳过字符串/注释里的花括号', () => {
    expect(extractBraceBlock('{a{b}c}', 0)).toBe('a{b}c')
    expect(extractBraceBlock("{'{'}", 0)).toBe("'{'")
  })
})
