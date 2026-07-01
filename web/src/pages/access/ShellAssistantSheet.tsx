import { Drawer } from '../../ui'

// AI 助手 —— 占位（不接任何后端/模型）。对齐 demo ShellAssistantSheet 的位置，功能后续接入。
export default function ShellAssistantSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} dark title="AI 助手" width={420}>
      <div className="text-center py-5" style={{ color: '#9ca3af' }}>
        <i className="bx bx-bot" style={{ fontSize: 48 }} />
        <div className="mt-3 fw-medium" style={{ color: '#e5e7eb' }}>AI 命令助手</div>
        <div className="mt-1" style={{ fontSize: 13 }}>功能即将上线，敬请期待。</div>
      </div>
      <div className="input-group mt-3">
        <input className="form-control bg-dark text-light border-secondary" placeholder="描述你想执行的操作…（占位）" disabled />
        <button className="btn btn-primary" disabled>
          生成
        </button>
      </div>
    </Drawer>
  )
}
