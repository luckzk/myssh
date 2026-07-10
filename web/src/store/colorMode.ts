import { useSyncExternalStore } from 'react'
import { getUITheme, themeSupportsDark } from './theme'

// 颜色模式（与 UI 主题/皮肤正交）：明亮 / 暗色 / 跟随系统。
// 通过 Ynex 原生的 data-theme-mode / data-menu-styles / data-header-styles 三个属性生效。
export type ColorMode = 'light' | 'dark' | 'auto'

export interface ColorModeDef {
  id: ColorMode
  name: string
  icon: string // boxicons 类名
}

export const COLOR_MODES: ColorModeDef[] = [
  { id: 'light', name: '明亮', icon: 'bx-sun' },
  { id: 'dark', name: '暗色', icon: 'bx-moon' },
  { id: 'auto', name: '跟随系统', icon: 'bx-desktop' },
]

const KEY = 'nt-color-mode'
const DEFAULT_MODE: ColorMode = 'light'

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

// 把 'auto' 解析成实际的 light/dark。
export function resolveColorMode(m: ColorMode): 'light' | 'dark' {
  return m === 'auto' ? (systemPrefersDark() ? 'dark' : 'light') : m
}

export function getColorMode(): ColorMode {
  try {
    const v = localStorage.getItem(KEY) as ColorMode | null
    return v && COLOR_MODES.some((m) => m.id === v) ? v : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

// 应用到 <html>：三个 Ynex 属性同步为解析后的 light/dark。
// 当前皮肤为浅色专用主题（如扁平）时钉为 light，避免暗色文字色落到浅色底上不可见。
export function applyColorMode(m: ColorMode) {
  const resolved = themeSupportsDark(getUITheme()) ? resolveColorMode(m) : 'light'
  const el = document.documentElement
  el.setAttribute('data-theme-mode', resolved)
  el.setAttribute('data-menu-styles', resolved)
  el.setAttribute('data-header-styles', resolved)
}

const listeners = new Set<() => void>()

export function setColorMode(m: ColorMode) {
  try {
    localStorage.setItem(KEY, m)
  } catch {
    /* ignore */
  }
  applyColorMode(m)
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  // 跨标签页同步
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      applyColorMode(getColorMode())
      listeners.forEach((l) => l())
    }
  })
  // 跟随系统：仅当当前为 auto 时，系统明暗变化即时生效
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getColorMode() === 'auto') {
        applyColorMode('auto')
        listeners.forEach((l) => l())
      }
    })
  } catch {
    /* ignore（旧浏览器无 matchMedia）*/
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useColorMode(): ColorMode {
  return useSyncExternalStore(subscribe, getColorMode, () => DEFAULT_MODE)
}
