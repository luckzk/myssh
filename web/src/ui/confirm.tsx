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
