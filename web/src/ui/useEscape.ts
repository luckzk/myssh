import { useEffect } from 'react'

// 统一「按 Esc 关闭」：给自定义浮层用（ui/Modal 已内置 Esc，无需再用）。
// active=false 时不绑定——交互式视图（如容器 exec 终端）不该被 Esc 关闭。
export function useEscape(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEscape, active])
}
