import { useEffect, useRef, useState } from 'react'
import type { SearchAddon } from '@xterm/addon-search'

// 终端搜索浮层（对齐 demo renderSearchBox）：实时高亮 + n/总 + 上下跳 + 关闭。
export default function SearchBox({ search, onClose }: { search: SearchAddon | null; onClose: () => void }) {
  const [term, setTerm] = useState('')
  const [pos, setPos] = useState({ index: 0, count: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const d = search?.onDidChangeResults((r) => {
      // r: { resultIndex, resultCount }（0 基），UI 显示 1 基
      setPos({ index: r.resultCount === 0 ? 0 : r.resultIndex + 1, count: r.resultCount })
    })
    return () => d?.dispose()
  }, [search])

  const opts = { decorations: { matchOverviewRuler: '#f59e0b', activeMatchColorOverviewRuler: '#22c55e' } }
  const doSearch = (v: string) => {
    setTerm(v)
    if (v) search?.findNext(v, opts as any)
    else search?.clearDecorations()
  }
  const next = () => term && search?.findNext(term, opts as any)
  const prev = () => term && search?.findPrevious(term, opts as any)

  return (
    <div
      className="d-flex align-items-center gap-1 rounded shadow-sm px-2 py-1"
      style={{ background: '#2B2D30', border: '1px solid #3a3a3a', minWidth: 240 }}
    >
      <i className="bx bx-search text-secondary" />
      <input
        ref={inputRef}
        className="flex-grow-1 border-0 bg-transparent text-light"
        style={{ outline: 'none', fontSize: 13 }}
        placeholder="搜索终端…"
        value={term}
        onChange={(e) => doSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.shiftKey ? prev() : next())
          else if (e.key === 'Escape') onClose()
        }}
      />
      {pos.count > 0 && (
        <span className="text-secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          {pos.index}/{pos.count}
        </span>
      )}
      <button className="term-tool" style={{ width: 24, height: 24, fontSize: 14 }} title="上一个" onClick={prev}>
        <i className="bx bx-chevron-up" />
      </button>
      <button className="term-tool" style={{ width: 24, height: 24, fontSize: 14 }} title="下一个" onClick={next}>
        <i className="bx bx-chevron-down" />
      </button>
      <button className="term-tool" style={{ width: 24, height: 24, fontSize: 14 }} title="关闭" onClick={onClose}>
        <i className="bx bx-x" />
      </button>
    </div>
  )
}
