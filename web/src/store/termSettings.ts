import { useSyncExternalStore } from 'react'

// 终端偏好（系统设置 → 鼠标/键盘/外观）。localStorage 持久，跨标签页生效。
export interface TermSettings {
  selectionCopy: boolean // 选中即复制
  rightClickPaste: boolean // 右键粘贴
  interceptSearchHotkey: boolean // 拦截 Ctrl/Cmd+F → 打开终端搜索
  macOptionIsMeta: boolean // macOS Option 作为 Meta
  theme: string // 终端配色（THEMES 的 key）
  fontSize: number // 字号
  fontFamily: string // 字体
}

// 终端配色预设（xterm ITheme 子集）。
export const FONT_FAMILIES = [
  'Menlo, Consolas, "Courier New", monospace',
  '"JetBrains Mono", monospace',
  '"Fira Code", monospace',
  '"Cascadia Code", monospace',
  'Consolas, monospace',
]

export interface TermTheme {
  label: string
  theme: Record<string, string>
}
export const THEMES: Record<string, TermTheme> = {
  dark: { label: '暗色（默认）', theme: { background: '#1E1F22', foreground: '#d4d4d4', cursor: '#aeafad', selectionBackground: '#3a3d41' } },
  black: { label: '纯黑', theme: { background: '#000000', foreground: '#e0e0e0', cursor: '#ffffff', selectionBackground: '#444444' } },
  light: { label: '浅色', theme: { background: '#ffffff', foreground: '#2d2d2d', cursor: '#2d2d2d', selectionBackground: '#cfe3ff' } },
  dracula: { label: 'Dracula', theme: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f0', selectionBackground: '#44475a', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd' } },
  solarizedDark: { label: 'Solarized Dark', theme: { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642', green: '#859900', yellow: '#b58900', blue: '#268bd2', cyan: '#2aa198', red: '#dc322f' } },
  oneDark: { label: 'One Dark', theme: { background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: '#3e4451', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2' } },
}

const KEY = 'nt-term-settings'
const DEFAULTS: TermSettings = {
  selectionCopy: false,
  rightClickPaste: false,
  interceptSearchHotkey: true,
  macOptionIsMeta: true,
  theme: 'dark',
  fontSize: 14,
  fontFamily: FONT_FAMILIES[0],
}

export function getTermSettings(): TermSettings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => l())
}

export function setTermSettings(patch: Partial<TermSettings>) {
  const next = { ...getTermSettings(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  emit()
}

// 跨标签页同步
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) emit()
  })
}

// React 订阅（设置页/终端共用）
let cache = getTermSettings()
let cacheRaw = JSON.stringify(cache)
function getSnapshot(): TermSettings {
  const raw = localStorage.getItem(KEY) ?? ''
  if (raw !== cacheRaw) {
    cacheRaw = raw
    cache = getTermSettings()
  }
  return cache
}
export function useTermSettings(): TermSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSnapshot,
  )
}
