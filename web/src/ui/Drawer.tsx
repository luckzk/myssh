import { type ReactNode } from 'react'

// 右侧抽屉（offcanvas 风格，不依赖 bootstrap JS）。dark=暗色（与终端统一）。
export default function Drawer({
  open,
  onClose,
  title,
  width = 420,
  dark = false,
  extra,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  width?: number
  dark?: boolean
  extra?: ReactNode
  children: ReactNode
}) {
  if (!open) return null
  const panelStyle = dark
    ? { background: '#1E1F22', color: '#d4d4d4' }
    : { background: '#fff' }
  return (
    <>
      <div
        className="offcanvas-backdrop fade show"
        style={{ position: 'fixed', inset: 0, zIndex: 1044 }}
        onClick={onClose}
      />
      <div
        className="d-flex flex-column"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width,
          maxWidth: '100vw',
          zIndex: 1045,
          boxShadow: '-8px 0 24px rgba(0,0,0,0.30)',
          ...panelStyle,
        }}
      >
        <div
          className="d-flex align-items-center justify-content-between px-3 py-2"
          style={{ borderBottom: `1px solid ${dark ? '#34363a' : '#eee'}`, background: dark ? '#2B2D30' : undefined }}
        >
          <h6 className="mb-0" style={dark ? { color: '#e5e7eb' } : undefined}>{title}</h6>
          <div className="d-flex align-items-center gap-2">
            {extra}
            <button className={`btn-close${dark ? ' btn-close-white' : ''}`} onClick={onClose} />
          </div>
        </div>
        <div className="flex-grow-1 overflow-auto p-3">{children}</div>
      </div>
    </>
  )
}
