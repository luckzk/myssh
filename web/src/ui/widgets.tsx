import { type ReactNode } from 'react'

// 状态/标签徽章。color 对应 Bootstrap 语义色。
export function Badge({
  children,
  color = 'primary',
  soft = true,
}: {
  children: ReactNode
  color?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'light' | 'dark'
  soft?: boolean
}) {
  // Ynex 提供 bg-*-transparent 的浅色徽章
  const cls = soft ? `bg-${color}-transparent text-${color}` : `bg-${color}`
  return <span className={`badge ${cls}`}>{children}</span>
}

// 加载占位
export function Spinner({ center }: { center?: boolean }) {
  const sp = <span className="spinner-border text-primary" role="status" />
  if (!center) return sp
  return (
    <div className="d-flex justify-content-center align-items-center p-5">{sp}</div>
  )
}

// 空状态
export function Empty({ text = '暂无数据' }: { text?: string }) {
  return (
    <div className="text-center text-muted py-5">
      <i className="bx bx-folder-open fs-1 d-block mb-2 opacity-50" />
      {text}
    </div>
  )
}
