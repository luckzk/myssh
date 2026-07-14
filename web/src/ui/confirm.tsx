import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Modal from './Modal'

// Promise 化确认弹窗，替代 antd Popconfirm / Modal.confirm。
// 用法：if (await confirm('确认删除？')) { ... }
export function confirm(
  message: string,
  opts: { title?: string; okText?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    const cleanup = (result: boolean) => {
      root.unmount()
      host.remove()
      resolve(result)
    }

    root.render(
      <Modal
        open
        width={420}
        title={opts.title ?? '确认'}
        onClose={() => cleanup(false)}
        footer={
          <>
            <button className="btn btn-light" onClick={() => cleanup(false)}>
              取消
            </button>
            <button
              className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => cleanup(true)}
            >
              {opts.okText ?? '确定'}
            </button>
          </>
        }
      >
        {message}
      </Modal>,
    )
  })
}

// 统一的输入弹窗（替代原生 window.prompt）。用法：const name = await prompt('新名称', { initial })
function PromptDialog({ message, initial, okText, placeholder, onDone }: {
  message: string; initial?: string; okText?: string; placeholder?: string; onDone: (v: string | null) => void
}) {
  const [v, setV] = useState(initial ?? '')
  return (
    <Modal
      open width={420} title="输入" onClose={() => onDone(null)}
      footer={
        <>
          <button className="btn btn-light" onClick={() => onDone(null)}>取消</button>
          <button className="btn btn-primary" disabled={!v.trim()} onClick={() => onDone(v.trim())}>{okText ?? '确定'}</button>
        </>
      }
    >
      <div style={{ marginBottom: 8, fontSize: 13 }}>{message}</div>
      <input autoFocus className="form-control" placeholder={placeholder} value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) onDone(v.trim()) }} />
    </Modal>
  )
}

export function prompt(message: string, opts: { initial?: string; okText?: string; placeholder?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const done = (v: string | null) => { root.unmount(); host.remove(); resolve(v) }
    root.render(<PromptDialog message={message} initial={opts.initial} okText={opts.okText} placeholder={opts.placeholder} onDone={done} />)
  })
}
