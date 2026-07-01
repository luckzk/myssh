import { useEffect, useState } from 'react'

// 轻量 toast，替代 antd message。用法：toast.success('已保存') / toast.error('失败')
export type ToastType = 'success' | 'error' | 'info' | 'warning'
interface ToastItem {
  id: number
  type: ToastType
  text: string
}

let seq = 1
let push: ((t: ToastItem) => void) | null = null

function emit(type: ToastType, text: string) {
  const item = { id: seq++, type, text }
  if (push) push(item)
}

export const toast = {
  success: (t: string) => emit('success', t),
  error: (t: string) => emit('error', t),
  info: (t: string) => emit('info', t),
  warning: (t: string) => emit('warning', t),
}

const ICONS: Record<ToastType, string> = {
  success: 'bx-check-circle',
  error: 'bx-x-circle',
  info: 'bx-info-circle',
  warning: 'bx-error',
}
const COLORS: Record<ToastType, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-info',
  warning: 'text-warning',
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    push = (item) => {
      setItems((cur) => [...cur, item])
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== item.id)), 3000)
    }
    return () => {
      push = null
    }
  }, [])

  return (
    <div
      className="toast-container position-fixed top-0 end-0 p-3"
      style={{ zIndex: 2000 }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="toast show align-items-center border-0 mb-2"
          role="alert"
          style={{ minWidth: 260 }}
        >
          <div className="d-flex align-items-center">
            <div className="toast-body d-flex align-items-center gap-2">
              <i className={`bx ${ICONS[t.type]} ${COLORS[t.type]} fs-5`} />
              <span>{t.text}</span>
            </div>
            <button
              type="button"
              className="btn-close me-2 m-auto"
              onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
