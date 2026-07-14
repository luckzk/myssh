import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  title?: ReactNode
  onClose: () => void
  onOk?: () => void
  okText?: string
  cancelText?: string
  okLoading?: boolean
  okDisabled?: boolean
  footer?: ReactNode | null // null = 不渲染默认底部
  width?: number
  dark?: boolean
  children: ReactNode
}

// 受控 Bootstrap 模态（不依赖 bootstrap JS，自己渲染 backdrop）。替代 antd Modal。
export default function Modal({
  open,
  title,
  onClose,
  onOk,
  okText = '确定',
  cancelText = '取消',
  okLoading,
  okDisabled,
  footer,
  width = 520,
  dark = false,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const border = dark ? '1px solid #34363a' : undefined
  return (
    <>
      <div className="modal-backdrop fade show" onClick={onClose} />
      <div
        className="modal fade show d-block"
        tabIndex={-1}
        role="dialog"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className="modal-dialog modal-dialog-centered"
          style={{ maxWidth: width }}
        >
          <div className="modal-content" style={dark ? { background: '#1E1F22', color: '#d4d4d4', border } : undefined}>
            <div className="modal-header" style={dark ? { borderColor: '#34363a' } : undefined}>
              <h6 className="modal-title" style={dark ? { color: '#e5e7eb' } : undefined}>{title}</h6>
              <button type="button" className={`btn-close${dark ? ' btn-close-white' : ''}`} onClick={onClose} />
            </div>
            <div className="modal-body">{children}</div>
            {footer !== null && (
              <div className="modal-footer" style={dark ? { borderColor: '#34363a' } : undefined}>
                {footer ?? (
                  <>
                    <button type="button" className={`btn ${dark ? 'btn-secondary' : 'btn-light'}`} onClick={onClose}>
                      {cancelText}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={okLoading || okDisabled}
                      onClick={onOk}
                    >
                      {okLoading && (
                        <span className="spinner-border spinner-border-sm me-2" />
                      )}
                      {okText}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
