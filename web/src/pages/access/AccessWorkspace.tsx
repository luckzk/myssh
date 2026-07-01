import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AssetTree from './AssetTree'
import TerminalView from './TerminalView'
import GraphicsView from './GraphicsView'
import type { Asset } from '../../api/resource'

interface Tab {
  id: string // 唯一（每次打开新生成）→ 同一资产可重复打开多个 tab
  assetId: string
  name: string
  protocol: string
}

const SS_KEY = 'nt-workspace-tabs'
const PROTO_ICON: Record<string, string> = { ssh: 'bx-terminal', rdp: 'bx-windows', vnc: 'bx-desktop', telnet: 'bx-chip' }
const isGraphical = (p: string) => p === 'rdp' || p === 'vnc'
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

function restore(): Tab[] {
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

// 终端工作台：左资源树 + 内部多 tab（保活）。连接其他资产开内部 tab，不开新浏览器标签。
export default function AccessWorkspace() {
  const [sp] = useSearchParams()
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState('')

  // 初始化：恢复 sessionStorage + （首次）合并 ?open=；随后清掉 query 避免刷新重复打开
  useEffect(() => {
    const list = restore()
    const openId = sp.get('open')
    let activeId = list[0]?.id || ''
    if (openId) {
      const t: Tab = { id: uid(), assetId: openId, name: sp.get('name') || openId, protocol: sp.get('protocol') || 'ssh' }
      list.push(t)
      activeId = t.id
      window.history.replaceState({}, '', '/access')
    }
    setTabs(list)
    setActive(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 持久化
  useEffect(() => {
    sessionStorage.setItem(SS_KEY, JSON.stringify(tabs))
  }, [tabs])

  // 始终新开一个 tab（同一资产可重复打开多个会话）
  const openAsset = (a: Asset) => {
    const t: Tab = { id: uid(), assetId: a.id, name: a.name, protocol: a.protocol }
    setTabs((cur) => [...cur, t])
    setActive(t.id)
  }

  const activeAssetId = tabs.find((t) => t.id === active)?.assetId

  // 同一资产多 tab 时，标签加序号区分
  const labelOf = (t: Tab) => {
    const same = tabs.filter((x) => x.assetId === t.assetId)
    if (same.length <= 1) return t.name
    return `${t.name} (${same.indexOf(t) + 1})`
  }

  const closeTab = (id: string) => {
    setTabs((cur) => {
      const idx = cur.findIndex((t) => t.id === id)
      const next = cur.filter((t) => t.id !== id)
      if (active === id) setActive(next[Math.max(0, idx - 1)]?.id || '')
      return next
    })
  }

  return (
    <div className="d-flex" style={{ height: '100vh', background: '#1E1F22' }}>
      <AssetTree currentAssetId={activeAssetId} onOpen={openAsset} />

      <div className="d-flex flex-column flex-grow-1" style={{ minWidth: 0 }}>
        {/* Tab 栏 */}
        <div className="d-flex align-items-center" style={{ height: 36, background: '#191A1C', borderBottom: '1px solid #34363a', overflowX: 'auto' }}>
          {tabs.length === 0 && <span className="px-3 text-muted" style={{ fontSize: 13 }}>从左侧资源树选择资产连接</span>}
          {tabs.map((t) => (
            <div
              key={t.id}
              className="d-flex align-items-center gap-2 px-3 h-100"
              style={{
                cursor: 'pointer',
                borderRight: '1px solid #34363a',
                color: active === t.id ? '#fff' : '#9ca3af',
                background: active === t.id ? '#1E1F22' : 'transparent',
                borderBottom: active === t.id ? '2px solid #845adf' : '2px solid transparent',
                whiteSpace: 'nowrap',
              }}
              onClick={() => setActive(t.id)}
            >
              <i className={`bx ${PROTO_ICON[t.protocol] || 'bx-server'}`} style={{ fontSize: 14 }} />
              <span style={{ fontSize: 13 }}>{labelOf(t)}</span>
              <i
                className="bx bx-x"
                style={{ fontSize: 16, opacity: 0.7 }}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
              />
            </div>
          ))}
        </div>

        {/* Tab 内容：全部渲染，仅 active 可见（保活） */}
        <div style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}>
          {tabs.map((t) => (
            <div key={t.id} style={{ position: 'absolute', inset: 0, display: active === t.id ? 'block' : 'none' }}>
              {isGraphical(t.protocol) ? (
                <GraphicsView assetId={t.assetId} name={t.name} active={active === t.id} onClose={() => closeTab(t.id)} />
              ) : (
                <TerminalView assetId={t.assetId} name={t.name} active={active === t.id} onClose={() => closeTab(t.id)} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
