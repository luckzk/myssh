import { useState } from 'react'
import { Modal, toast } from '../../ui'

export default function BroadcastModal({
  open,
  count,
  onClose,
  onSend,
}: {
  open: boolean
  count: number
  onClose: () => void
  onSend: (text: string) => void
}) {
  const [text, setText] = useState('')
  const [ack, setAck] = useState(false)
  const submit = () => {
    const value = text.trimEnd()
    if (!value) return toast.warning('请输入要广播的内容')
    if (!ack) return toast.warning('请先确认广播风险')
    onSend(value.endsWith('\r') || value.endsWith('\n') ? value : `${value}\r`)
    setText('')
    setAck(false)
    onClose()
  }
  return (
    <Modal open={open} title="广播输入" onClose={onClose} onOk={submit} okText="广播到全部 SSH tab" okDisabled={count === 0} dark width={560}>
      <div className="text-warning mb-2" style={{ fontSize: 13 }}>
        将向当前工作台内 {count} 个 SSH 终端同时发送输入。该动作适合批量执行一致命令，执行结果仍由各会话录像和命令日志记录。
      </div>
      <textarea
        className="form-control bg-dark text-light border-secondary"
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="例如：uptime"
        spellCheck={false}
        style={{ fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace', fontSize: 13 }}
      />
      <label className="d-flex align-items-center gap-2 mt-3" style={{ fontSize: 13 }}>
        <input type="checkbox" className="form-check-input m-0" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        我确认该输入会同时发送到多个在线 SSH 会话
      </label>
    </Modal>
  )
}
