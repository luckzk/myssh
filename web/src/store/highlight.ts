import type { HighlightRule } from './termSettings'

// 关键字高亮：在写入 xterm 前，用 ANSI 前景色包裹命中的关键字。
// 仅对「非转义序列」的文本片段生效，避免破坏程序自身的 ANSI 着色。

const ESC_SPLIT = /(\x1b\[[0-9;]*m)/
const RESET_FG = '\x1b[39m'

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// #rrggbb → SGR 真彩前景色。
function sgr(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return ''
  const n = parseInt(m[1], 16)
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`
}

export type Highlighter = (text: string) => string

// compileHighlighter 预编译规则为一个应用函数（规则变更时重建）。
export function compileHighlighter(enabled: boolean, rules: HighlightRule[]): Highlighter {
  const compiled = (enabled ? rules : [])
    .map((r) => {
      if (!r.pattern || !r.color) return null
      try {
        const src = r.regex ? r.pattern : `\\b${escapeRe(r.pattern)}\\b`
        const open = sgr(r.color)
        return open ? { re: new RegExp(src, 'gi'), open } : null
      } catch {
        return null // 非法正则忽略该规则
      }
    })
    .filter(Boolean) as { re: RegExp; open: string }[]

  if (compiled.length === 0) return (t) => t

  return (text: string) => {
    if (text.indexOf('\x1b') === -1) {
      // 无转义序列：整段都是普通文本，直接处理
      return applyRules(text, compiled)
    }
    const tokens = text.split(ESC_SPLIT)
    for (let i = 0; i < tokens.length; i += 2) {
      // 偶数下标为普通文本，奇数为 ANSI 转义序列（保持原样）
      if (tokens[i]) tokens[i] = applyRules(tokens[i], compiled)
    }
    return tokens.join('')
  }
}

function applyRules(seg: string, compiled: { re: RegExp; open: string }[]): string {
  for (const c of compiled) {
    c.re.lastIndex = 0
    seg = seg.replace(c.re, (m) => c.open + m + RESET_FG)
  }
  return seg
}
