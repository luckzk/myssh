import { useEffect, useMemo, useRef, useState } from 'react'
import type { Asset } from '../../api/resource'
import AssetIcon from '../../components/AssetIcon'
import { useEscape } from '../../ui'

// 命令面板（Ctrl/⌘+K）：快速搜资产并回车连接。↑↓ 选，Enter 连，Esc 关。
export default function CommandPalette({ open, assets, onClose, onPick }: {
  open: boolean
  assets: Asset[]
  onClose: () => void
  onPick: (a: Asset) => void
}) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEscape(onClose, open)
  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0) } }, [open])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s ? assets.filter((a) => a.name.toLowerCase().includes(s) || (a.ip || '').toLowerCase().includes(s) || (a.protocol || '').includes(s)) : assets
    return list.slice(0, 50)
  }, [assets, q])
  useEffect(() => { setIdx(0) }, [q])
  useEffect(() => { listRef.current?.querySelector('[data-active="1"]')?.scrollIntoView({ block: 'nearest' }) }, [idx])

  if (!open) return null

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { const a = filtered[idx]; if (a) { onPick(a); onClose() } }
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,.5)' }} onClick={onClose} />
      <div className="rounded shadow d-flex flex-column" style={{ position: 'fixed', top: '12vh', left: '50%', transform: 'translateX(-50%)', zIndex: 1301, width: 560, maxWidth: '92vw', maxHeight: '70vh', background: '#1E1F22', border: '1px solid #34363a', color: '#e5e7eb', overflow: 'hidden' }}>
        <div className="d-flex align-items-center px-3 gap-2" style={{ height: 48, borderBottom: '1px solid #34363a', flexShrink: 0 }}>
          <i className="bx bx-search" style={{ color: '#845adf', fontSize: 18 }} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="搜索资产名 / IP / 协议，回车连接…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#e5e7eb', fontSize: 15 }} />
          <kbd style={{ fontSize: 10, background: '#34363a', padding: '2px 6px', borderRadius: 4, color: '#9ca3af' }}>Esc</kbd>
        </div>
        <div ref={listRef} style={{ overflowY: 'auto', minHeight: 0 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>无匹配资产</div>
          ) : filtered.map((a, i) => (
            <div key={a.id} data-active={i === idx ? '1' : '0'}
              className="d-flex align-items-center gap-2 px-3"
              style={{ height: 40, cursor: 'pointer', background: i === idx ? '#2b2140' : undefined, borderLeft: i === idx ? '2px solid #845adf' : '2px solid transparent' }}
              onMouseEnter={() => setIdx(i)} onClick={() => { onPick(a); onClose() }}>
              <AssetIcon asset={a} size={16} color="#9ca3af" />
              <span className="text-truncate" style={{ fontSize: 14 }}>{a.name}</span>
              <span className="text-truncate" style={{ fontSize: 12, color: '#6b7280' }}>{a.ip}</span>
              <span className="ms-auto badge bg-secondary-transparent text-secondary" style={{ fontSize: 9 }}>{(a.protocol || '').toUpperCase()}</span>
              {i === idx && <span style={{ fontSize: 11, color: '#845adf' }}>↵ 连接</span>}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
