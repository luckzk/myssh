import { useSyncExternalStore } from 'react'
import { applyColorMode, getColorMode } from './colorMode'

// UI 主题注册表：将来新增主题只需在 THEMES 追加一项 + 一段 [data-ui-theme="<id>"] 作用域 CSS。
// id 'ynex' 为默认/原生主题（不设 data-ui-theme 属性，保持原 Ynex 观感完全不变）。
export interface ThemeDef {
  id: string
  name: string
  icon: string // boxicons 类名（不含 bx 前缀）
  desc?: string
  supportsDark?: boolean // 是否支持暗色模式（缺省视为 true）；扁平/黏土为浅色专用主题
  fontHref?: string // 该主题专属字体样式表（按需注入，仅切到此主题才加载）
}

export const THEMES: ThemeDef[] = [
  { id: 'ynex', name: '默认', icon: 'bx-palette', desc: '原生 Ynex，渐变 + 阴影', supportsDark: true },
  { id: 'flat', name: '扁平设计', icon: 'bx-square', desc: '纯色、无阴影、细线描边', supportsDark: false },
  {
    id: 'clay',
    name: '黏土',
    icon: 'bxs-cube',
    desc: '柔和 3D、圆润、粉彩',
    supportsDark: false,
    fontHref: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap',
  },
]

// 指定主题是否支持暗色（未知主题按支持处理）。
export function themeSupportsDark(id: string): boolean {
  const t = THEMES.find((x) => x.id === id)
  return t ? t.supportsDark !== false : true
}

// 按需注入主题专属字体（同一 href 只注入一次）。
const injectedFonts = new Set<string>()
export function ensureThemeFont(id: string) {
  const t = THEMES.find((x) => x.id === id)
  if (!t?.fontHref || injectedFonts.has(t.fontHref) || typeof document === 'undefined') return
  injectedFonts.add(t.fontHref)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = t.fontHref
  document.head.appendChild(link)
}

const KEY = 'nt-ui-theme'
const DEFAULT_THEME = 'ynex'

export function getUITheme(): string {
  try {
    const v = localStorage.getItem(KEY)
    return v && THEMES.some((t) => t.id === v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

// 应用到 <html>：默认主题移除属性，其它主题各自对应一个 [data-ui-theme="<id>"] 作用域。
export function applyUITheme(id: string) {
  ensureThemeFont(id)
  const el = document.documentElement
  if (id === DEFAULT_THEME) el.removeAttribute('data-ui-theme')
  else el.setAttribute('data-ui-theme', id)
}

const listeners = new Set<() => void>()

export function setUITheme(id: string) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
  applyUITheme(id)
  // 皮肤变更后重解析颜色模式：切到浅色专用主题会被钉为 light，切回默认主题恢复用户所选模式。
  applyColorMode(getColorMode())
  listeners.forEach((l) => l())
}

// 跨标签页同步
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      applyUITheme(getUITheme())
      listeners.forEach((l) => l())
    }
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// React 订阅：切换器读当前主题、驱动勾选态。
export function useUITheme(): string {
  return useSyncExternalStore(subscribe, getUITheme, () => DEFAULT_THEME)
}
