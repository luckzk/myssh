import { useEffect, useState } from 'react'
import { accessApi } from '../../api/access'
import { Modal, toast } from '../../ui'

// 会话共享弹窗（对齐 demo SessionSharerModal）：生成只读观战链接。
export default function ShareModal({
  open,
  onClose,
  sessionId,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
}) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !sessionId) return
    setUrl('')
    setLoading(true)
    accessApi
      .share(sessionId)
      .then((r) => setUrl(location.origin + r.url))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [open, sessionId])

  const copy = () => {
    navigator.clipboard?.writeText(url).then(
      () => toast.success('已复制分享链接'),
      () => toast.warning('复制失败，请手动选择'),
    )
  }

  return (
    <Modal
      open={open}
      title="会话共享"
      width={560}
      onClose={onClose}
      footer={
        <button className="btn btn-light" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="alert alert-info" role="alert">
        <i className="bx bx-info-circle me-1" />
        持此链接的登录用户可<strong>只读观战</strong>本会话（实时同屏输出，<strong>无法输入</strong>）。会话结束链接失效。
      </div>
      {loading ? (
        <div className="text-muted">生成中…</div>
      ) : (
        <div className="input-group">
          <input className="form-control" readOnly value={url} />
          <button className="btn btn-primary" onClick={copy} disabled={!url}>
            <i className="bx bx-copy" /> 复制
          </button>
        </div>
      )}
    </Modal>
  )
}
