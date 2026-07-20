import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import AssetTree from './AssetTree'
import TerminalView from './TerminalView'
import GraphicsView from './GraphicsView'
import DockerManager from '../docker/DockerManager'
import CommandPalette from './CommandPalette'
import { assetApi, type Asset } from '../../api/resource'
import BroadcastModal from './BroadcastModal'
import AssetIcon from '../../components/AssetIcon'
import { accountSessionApi, type LiveSession } from '../../api/session'
import { toast } from '../../ui'

// 两级 tab：外层「工作组」→ 组内分屏；每个分屏格有自己的横向终端标签，支持在格间拖拽。
interface Term {
  id: string
  assetId: string
  name: string
  protocol: string
  logo?: string
  os?: string
  distro?: string
  initCwd?: string
  sessionId?: string
}
type Layout = 'single' | 'two' | 'two-v' | 'grid' | 'grid-h' | 'grid-v'
interface Pane {
  termIds: string[]
  activeTermId: string
}
interface Group {
  id: string
  name: string
  terms: Term[]
  layout: Layout
  panes: Pane[]
  activePane: number
}

const SS_KEY = 'nt-workspace-tabs'
const NEW_TERM_EVENT = 'nt-open-terminal-at'
const OPEN_DOCKER_EVENT = 'nt-open-docker'
const BROADCAST_EVENT = 'nt-terminal-broadcast'
const PROTO_ICON: Record<string, string> = { ssh: 'bx-terminal', rdp: 'bx-windows', vnc: 'bx-desktop', telnet: 'bx-chip' }
// 每种布局的 [列数, 行数]；格数 = 列×行。
const GRID_DIM: Record<Layout, [number, number]> = {
  single: [1, 1],
  two: [2, 1], // 左右
  'two-v': [1, 2], // 上下
  grid: [2, 2], // 四宫格
  'grid-h': [4, 1], // 横向四分
  'grid-v': [1, 4], // 纵向四分
}
const PANE_COUNT: Record<Layout, number> = Object.fromEntries(
  Object.entries(GRID_DIM).map(([k, [c, r]]) => [k, c * r]),
) as Record<Layout, number>
const isGraphical = (p: string) => p === 'rdp' || p === 'vnc'
const isDocker = (p: string) => p === 'docker' // Docker 管理标签（非终端，无会话）
const uid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
const emptyPane = (): Pane => ({ termIds: [], activeTermId: '' })

// 归一化 panes：长度=分屏格数；剔除已删/重复；未分配的 term 放入第 0 格；修正 activeTermId。
function normalizePanes(terms: Term[], panes: Pane[], layout: Layout): Pane[] {
  const count = PANE_COUNT[layout]
  const valid = new Set(terms.map((t) => t.id))
  let work: Pane[] = (panes || []).map((p) => ({ termIds: (p.termIds || []).filter((id) => valid.has(id)), activeTermId: p.activeTermId }))
  if (work.length > count) {
    const extra = work.slice(count).flatMap((p) => p.termIds)
    work = work.slice(0, count)
    work[count - 1] = { ...work[count - 1], termIds: [...work[count - 1].termIds, ...extra] }
  }
  while (work.length < count) work.push(emptyPane())
  const seen = new Set<string>()
  work = work.map((p) => ({ ...p, termIds: p.termIds.filter((id) => (seen.has(id) ? false : (seen.add(id), true))) }))
  const unassigned = terms.filter((t) => !seen.has(t.id)).map((t) => t.id)
  if (unassigned.length) work[0] = { ...work[0], termIds: [...work[0].termIds, ...unassigned] }
  return work.map((p) => ({ ...p, activeTermId: p.termIds.includes(p.activeTermId) ? p.activeTermId : p.termIds[0] || '' }))
}

// 把一组 termId 轮流分配到 count 个格（切换布局时用）
function distribute(termIds: string[], count: number): Pane[] {
  const panes: Pane[] = Array.from({ length: count }, emptyPane)
  termIds.forEach((id, i) => panes[i % count].termIds.push(id))
  return panes.map((p) => ({ ...p, activeTermId: p.termIds[0] || '' }))
}

function makeGroup(name: string, terms: Term[] = []): Group {
  return { id: uid(), name, terms, layout: 'single', panes: normalizePanes(terms, [{ termIds: terms.map((t) => t.id), activeTermId: terms[0]?.id || '' }], 'single'), activePane: 0 }
}

// 按列数把第 i 格放到对应行列（行优先填充）。适配所有布局。
function cellStyle(i: number, layout: Layout): React.CSSProperties {
  const cols = GRID_DIM[layout][0]
  return { gridColumn: String((i % cols) + 1), gridRow: String(Math.floor(i / cols) + 1) }
}

// 读取并迁移 sessionStorage：兼容旧扁平 Tab[] 与上一版 panes:string[]。
function restoreState(): { groups: Group[]; activeGroupId: string } {
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (!raw) return { groups: [], activeGroupId: '' }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return { groups: [], activeGroupId: '' }
      const g = makeGroup('工作组1', parsed as Term[])
      return { groups: [g], activeGroupId: g.id }
    }
    const groups: Group[] = (parsed.groups || []).map((g: any) => {
      const layout: Layout = g.layout || 'single'
      const terms: Term[] = g.terms || []
      let panes: Pane[]
      if (Array.isArray(g.panes) && g.panes.length && typeof g.panes[0] === 'object') panes = g.panes
      else if (Array.isArray(g.panes)) panes = g.panes.filter(Boolean).map((id: string) => ({ termIds: [id], activeTermId: id }))
      else panes = []
      return { id: g.id, name: g.name, terms, layout, panes: normalizePanes(terms, panes, layout), activePane: g.activePane || 0 }
    })
    return { groups, activeGroupId: parsed.activeGroupId || groups[0]?.id || '' }
  } catch {
    return { groups: [], activeGroupId: '' }
  }
}

export default function AccessWorkspace() {
  const [sp] = useSearchParams()
  const [groups, setGroups] = useState<Group[]>([])
  const [activeGroupId, setActiveGroupId] = useState('')
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false) // 命令面板 Ctrl+K
  const [restorable, setRestorable] = useState<LiveSession[]>([])
  const { data: allAssets = [] } = useQuery({ queryKey: ['assets-all'], queryFn: assetApi.list })
  const [renaming, setRenaming] = useState('')
  const [dragOverPane, setDragOverPane] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null)
  const dragInfo = useRef<{ termId: string; fromGroupId: string } | null>(null)
  const groupSeq = useRef(1)

  useEffect(() => {
    const st = restoreState()
    let list = st.groups
    let gid = st.activeGroupId
    groupSeq.current = list.length || 1
    const openId = sp.get('open')
    if (openId) {
      const t: Term = { id: uid(), assetId: openId, name: sp.get('name') || openId, protocol: sp.get('protocol') || 'ssh' }
      // 新资源始终作为一个新的工作组打开（不并入已有工作组）
      const seq = (list.length || 0) + 1
      groupSeq.current = seq
      const g = makeGroup(`工作组${seq}`, [t])
      list = [...list, g]
      gid = g.id
      window.history.replaceState({}, '', '/access')
    }
    if (list.length === 0) { const g = makeGroup('工作组1'); list = [g]; gid = g.id; groupSeq.current = 1 }
    if (!gid || !list.find((g) => g.id === gid)) gid = list[0].id
    setGroups(list)
    setActiveGroupId(gid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (groups.length) sessionStorage.setItem(SS_KEY, JSON.stringify({ groups, activeGroupId }))
  }, [groups, activeGroupId])

  useEffect(() => {
    accountSessionApi.list().then((live) => {
      const st = restoreState()
      const openIds = new Set(st.groups.flatMap((g) => g.terms.map((t) => t.sessionId)).filter(Boolean))
      setRestorable(live.filter((s) => !openIds.has(s.id)))
    }).catch(() => {})
  }, [])

  const patchGroup = (gid: string, fn: (g: Group) => Partial<Group>) =>
    setGroups((gs) => gs.map((g) => (g.id === gid ? { ...g, ...fn(g) } : g)))

  const activeGroup = groups.find((g) => g.id === activeGroupId)
  const layout = activeGroup?.layout || 'single'
  const panes = activeGroup?.panes ?? []

  // 往组内加终端（进当前聚焦格）
  const withTerm = (g: Group, t: Term): Group => {
    const terms = [...g.terms, t]
    const base = g.panes.length ? g.panes : [emptyPane()]
    const ap = Math.min(g.activePane, base.length - 1)
    const p2 = base.map((p, i) => (i === ap ? { termIds: [...p.termIds, t.id], activeTermId: t.id } : p))
    return { ...g, terms, panes: normalizePanes(terms, p2, g.layout), activePane: ap }
  }
  const addTerm = (t: Term) => {
    setGroups((gs) => {
      let list = gs
      let gid = activeGroupId
      if (!list.find((g) => g.id === gid)) { groupSeq.current += 1; const ng = makeGroup(`工作组${groupSeq.current}`); list = [...list, ng]; gid = ng.id; setActiveGroupId(gid) }
      return list.map((g) => (g.id === gid ? withTerm(g, t) : g))
    })
  }
  const openAsset = (a: Asset) => addTerm({ id: uid(), assetId: a.id, name: a.name, protocol: a.protocol, logo: a.logo, os: a.os, distro: a.distro })

  // Ctrl/⌘+K 打开命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setCmdOpen((v) => !v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // 打开一个 Docker 管理标签（与终端标签同级，protocol=docker）；供侧边栏「扩大为标签」调用
  const openDockerTab = (assetId: string, name: string) => addTerm({ id: uid(), assetId, name: `${name} · Docker`, protocol: 'docker' })

  // 资产页「连接」跨窗口请求：在已打开的工作台里新建一个工作组，不重载、不断开已有终端。
  const openInNewGroup = (t: Term) => {
    groupSeq.current += 1
    const g = makeGroup(`工作组${groupSeq.current}`, [t])
    setGroups((gs) => [...gs, g])
    setActiveGroupId(g.id)
  }
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel('nt-access')
    bc.onmessage = (e) => {
      const d = e.data as { assetId?: string; name?: string; protocol?: string }
      if (!d?.assetId) return
      openInNewGroup({ id: uid(), assetId: d.assetId, name: d.name || d.assetId, protocol: d.protocol || 'ssh' })
      window.focus()
    }
    return () => bc.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onNewTerm = (e: Event) => {
      const d = (e as CustomEvent<{ assetId: string; name: string; cwd: string }>).detail
      if (d?.assetId) addTerm({ id: uid(), assetId: d.assetId, name: d.name, protocol: 'ssh', initCwd: d.cwd })
    }
    const onOpenDocker = (e: Event) => {
      const d = (e as CustomEvent<{ assetId: string; name: string }>).detail
      if (d?.assetId) openDockerTab(d.assetId, d.name)
    }
    window.addEventListener(NEW_TERM_EVENT, onNewTerm)
    window.addEventListener(OPEN_DOCKER_EVENT, onOpenDocker)
    return () => {
      window.removeEventListener(NEW_TERM_EVENT, onNewTerm)
      window.removeEventListener(OPEN_DOCKER_EVENT, onOpenDocker)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId])

  const setTermSession = (termId: string, sessionId: string) =>
    setGroups((gs) => gs.map((g) => ({ ...g, terms: g.terms.map((t) => (t.id === termId ? { ...t, sessionId } : t)) })))

  // ---- 分屏格操作 ----
  const setLayout = (l: Layout) => patchGroup(activeGroupId, (g) => {
    const ordered = [...g.panes.flatMap((p) => p.termIds), ...g.terms.filter((t) => !g.panes.some((p) => p.termIds.includes(t.id))).map((t) => t.id)]
    return { layout: l, panes: distribute(ordered, PANE_COUNT[l]), activePane: Math.min(g.activePane, PANE_COUNT[l] - 1) }
  })
  const activateInPane = (paneIdx: number, termId: string) => patchGroup(activeGroupId, (g) => ({
    panes: g.panes.map((p, i) => (i === paneIdx ? { ...p, activeTermId: termId } : p)),
    activePane: paneIdx,
  }))
  const focusPane = (i: number) => patchGroup(activeGroupId, () => ({ activePane: i }))
  // 拖拽结束/取消：清理所有拖拽态
  const endDrag = () => { dragInfo.current = null; setDraggingId(null); setDragOverGroup(null); setDragOverPane(null) }
  const onTermDragStart = (termId: string) => { dragInfo.current = { termId, fromGroupId: activeGroupId }; setDraggingId(termId) }
  // 把终端移到某个分屏格；若拖拽起始工作组≠当前工作组，则跨组迁移（终端连接保活，因 key=term.id 不变）。
  const moveTerm = (termId: string, toPane: number) => {
    const fromGid = dragInfo.current?.fromGroupId ?? activeGroupId
    const toGid = activeGroupId
    const cross = fromGid !== toGid
    setGroups((gs) => {
      const term = gs.find((g) => g.id === fromGid)?.terms.find((t) => t.id === termId)
      if (!term) return gs
      return gs.map((g) => {
        if (cross && g.id === fromGid) {
          const terms = g.terms.filter((t) => t.id !== termId)
          return { ...g, terms, panes: normalizePanes(terms, g.panes.map((p) => ({ ...p, termIds: p.termIds.filter((id) => id !== termId) })), g.layout) }
        }
        if (g.id === toGid) {
          const terms = cross ? [...g.terms, term] : g.terms
          const ps = g.panes.map((p) => ({ ...p, termIds: p.termIds.filter((id) => id !== termId) }))
          ps[toPane] = { termIds: [...ps[toPane].termIds, termId], activeTermId: termId }
          return { ...g, terms, panes: normalizePanes(terms, ps, g.layout), activePane: toPane }
        }
        return g
      })
    })
    endDrag()
  }

  // ---- 工作组操作 ----
  const newWorkGroup = () => { groupSeq.current += 1; const g = makeGroup(`工作组${groupSeq.current}`); setGroups((gs) => [...gs, g]); setActiveGroupId(g.id) }
  const closeGroup = (gid: string) => {
    setGroups((gs) => {
      const idx = gs.findIndex((g) => g.id === gid)
      let next = gs.filter((g) => g.id !== gid)
      if (next.length === 0) { groupSeq.current += 1; next = [makeGroup(`工作组${groupSeq.current}`)] }
      if (activeGroupId === gid) setActiveGroupId(next[Math.max(0, idx - 1)]?.id || next[0].id)
      return next
    })
  }
  const renameGroup = (gid: string, name: string) => patchGroup(gid, () => ({ name: name.trim() || '工作组' }))

  const closeTerm = (termId: string) => patchGroup(activeGroupId, (g) => {
    const terms = g.terms.filter((t) => t.id !== termId)
    return { terms, panes: normalizePanes(terms, g.panes.map((p) => ({ ...p, termIds: p.termIds.filter((id) => id !== termId) })), g.layout) }
  })

  const labelOf = (t: Term) => {
    const same = (activeGroup?.terms ?? []).filter((x) => x.assetId === t.assetId)
    return same.length <= 1 ? t.name : `${t.name} (${same.indexOf(t) + 1})`
  }
  const termById = (id: string) => activeGroup?.terms.find((t) => t.id === id)

  const groupSshTerms = (activeGroup?.terms ?? []).filter((t) => !isGraphical(t.protocol) && !isDocker(t.protocol))
  const activeAssetId = termById(panes[activeGroup?.activePane ?? 0]?.activeTermId || '')?.assetId

  const broadcast = (text: string) => {
    const targets = groupSshTerms.map((t) => t.id)
    window.dispatchEvent(new CustomEvent(BROADCAST_EVENT, { detail: { text, targets } }))
    toast.success(`已广播到当前工作组 ${targets.length} 个 SSH 终端`)
  }

  const restoreOne = (s: LiveSession) => { addTerm({ id: uid(), assetId: s.assetId, name: s.assetName, protocol: s.protocol, sessionId: s.id }); setRestorable((cur) => cur.filter((x) => x.id !== s.id)) }
  const restoreAll = () => { restorable.forEach(restoreOne); setRestorable([]) }
  const dropOne = async (s: LiveSession) => { try { await accountSessionApi.disconnect(s.id) } catch { /* ignore */ } setRestorable((cur) => cur.filter((x) => x.id !== s.id)) }

  const allTerms = groups.flatMap((g) => g.terms.map((t) => ({ g, t })))
  const paneOf = (gid: string, termId: string) => (gid === activeGroupId ? panes.findIndex((p) => p.termIds.includes(termId)) : -1)

  const paneDropProps = (i: number) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverPane(i) },
    onDragLeave: () => setDragOverPane((cur) => (cur === i ? null : cur)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) moveTerm(id, i) },
  })
  const paneOutline = (i: number, isActive: boolean) =>
    dragOverPane === i ? '2px dashed #845adf' : isActive && layout !== 'single' ? '1px solid #845adf' : undefined

  return (
    <div className="d-flex" style={{ height: '100vh', background: '#1E1F22' }}>
      <AssetTree currentAssetId={activeAssetId} onOpen={openAsset} />

      <div className="d-flex flex-column flex-grow-1" style={{ minWidth: 0 }}>
        {/* 工作组 tab 条 + 布局/广播（右） */}
        <div className="d-flex align-items-center" style={{ height: 36, flexShrink: 0, background: '#141517', borderBottom: '1px solid #2b2d30', overflowX: 'auto', overflowY: 'hidden' }}>
          {groups.map((g) => (
            <div
              key={g.id}
              className="d-flex align-items-center gap-2 px-3 h-100 flex-shrink-0"
              style={{ cursor: 'pointer', borderRight: '1px solid #2b2d30', color: activeGroupId === g.id ? '#fff' : '#8b909a', background: dragOverGroup === g.id ? '#2a2140' : activeGroupId === g.id ? '#191A1C' : 'transparent', boxShadow: dragOverGroup === g.id ? 'inset 0 -2px 0 #845adf' : undefined, whiteSpace: 'nowrap', transition: 'background .12s' }}
              onClick={() => setActiveGroupId(g.id)}
              onDoubleClick={() => setRenaming(g.id)}
              onDragOver={(e) => { if (dragInfo.current) { e.preventDefault(); setDragOverGroup(g.id); if (activeGroupId !== g.id) { setActiveGroupId(g.id); setDragOverPane(null) } } }}
              onDragLeave={() => setDragOverGroup((cur) => (cur === g.id ? null : cur))}
              title={dragInfo.current ? '拖到此处切换到该工作组，再放入某个分屏' : '双击重命名'}
            >
              <i className="bx bx-folder" style={{ fontSize: 14, color: activeGroupId === g.id ? '#845adf' : undefined }} />
              {renaming === g.id ? (
                <input autoFocus defaultValue={g.name} className="bg-dark text-light" style={{ fontSize: 13, width: 90, border: '1px solid #34363a', borderRadius: 4, padding: '0 4px' }} onClick={(e) => e.stopPropagation()} onBlur={(e) => { renameGroup(g.id, e.target.value); setRenaming('') }} onKeyDown={(e) => { if (e.key === 'Enter') { renameGroup(g.id, (e.target as HTMLInputElement).value); setRenaming('') } else if (e.key === 'Escape') setRenaming('') }} />
              ) : (
                <span style={{ fontSize: 13 }}>{g.name}</span>
              )}
              <span className="badge bg-secondary-transparent text-secondary" style={{ fontSize: 10 }}>{g.terms.length}</span>
              {groups.length > 1 && <i className="bx bx-x" style={{ fontSize: 15, opacity: 0.7 }} onClick={(e) => { e.stopPropagation(); closeGroup(g.id) }} />}
            </div>
          ))}
          <button className="term-tool flex-shrink-0" title="新建工作组" style={{ width: 30, height: 30 }} onClick={newWorkGroup}><i className="bx bx-plus" /></button>
          <div className="ms-auto d-flex align-items-center gap-1 px-2 flex-shrink-0" style={{ position: 'sticky', right: 0, background: '#141517' }}>
            <button className={`term-tool${layout === 'single' ? ' term-tool-active' : ''}`} title="单窗" onClick={() => setLayout('single')}><i className="bx bx-rectangle" /></button>
            <button className={`term-tool${layout === 'two' ? ' term-tool-active' : ''}`} title="左右分屏" onClick={() => setLayout('two')}><i className="bx bx-columns" /></button>
            <button className={`term-tool${layout === 'two-v' ? ' term-tool-active' : ''}`} title="上下分屏" onClick={() => setLayout('two-v')}><i className="bx bx-columns" style={{ transform: 'rotate(90deg)' }} /></button>
            <button className={`term-tool${layout === 'grid' ? ' term-tool-active' : ''}`} title="四宫格" onClick={() => setLayout('grid')}><i className="bx bx-grid-alt" /></button>
            <button className={`term-tool${layout === 'grid-h' ? ' term-tool-active' : ''}`} title="横向四分（四列）" onClick={() => setLayout('grid-h')}><i className="bx bx-menu" style={{ transform: 'rotate(90deg)' }} /></button>
            <button className={`term-tool${layout === 'grid-v' ? ' term-tool-active' : ''}`} title="纵向四分（四行）" onClick={() => setLayout('grid-v')}><i className="bx bx-menu" /></button>
            <button className="term-tool" title="广播输入（当前工作组）" onClick={() => setBroadcastOpen(true)} disabled={groupSshTerms.length === 0}><i className="bx bx-broadcast" /></button>
          </div>
        </div>

        {/* 分屏内容 */}
        <div style={{ flexGrow: 1, minHeight: 0, overflow: 'hidden', position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${GRID_DIM[layout][0]}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${GRID_DIM[layout][1]}, minmax(0, 1fr))`, gap: layout === 'single' ? 0 : 1, background: '#34363a' }}>
          {/* 空格占位（可拖入） */}
          {activeGroup && panes.map((pane, i) => (pane.termIds.length > 0 ? null : (
            <div key={`ph-${i}`} className="d-flex flex-column" style={{ ...cellStyle(i, layout), minWidth: 0, minHeight: 0, background: '#1E1F22', outline: paneOutline(i, activeGroup.activePane === i) }} onClick={() => focusPane(i)} {...paneDropProps(i)}>
              <PaneTabs paneIndex={i} pane={pane} terms={activeGroup.terms} labelOf={labelOf} draggingId={draggingId} onDragStartTerm={onTermDragStart} onDragEndTerm={endDrag} onActivate={activateInPane} onCloseTerm={closeTerm} onDropTerm={(id) => moveTerm(id, i)} />
              <div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted" style={{ fontSize: 13 }}>从左侧资源树连接，或把上方标签拖到此格</div>
            </div>
          )))}

          {/* 所有终端（保活）：按所在分屏格定位；仅所在格的活跃终端可见 */}
          {allTerms.map(({ g, t }) => {
            const pi = paneOf(g.id, t.id)
            const visible = pi >= 0 && panes[pi]?.activeTermId === t.id
            const style: React.CSSProperties = visible
              ? { ...cellStyle(pi, layout), position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, outline: paneOutline(pi, activeGroup?.activePane === pi) }
              : { position: 'absolute', inset: 0, display: 'none' }
            return (
              <div key={t.id} style={style} onClick={() => visible && focusPane(pi)} {...(visible ? paneDropProps(pi) : {})}>
                <div style={{ flexShrink: 0 }}>
                  {visible && activeGroup && (
                    <PaneTabs paneIndex={pi} pane={panes[pi]} terms={activeGroup.terms} labelOf={labelOf} draggingId={draggingId} onDragStartTerm={onTermDragStart} onDragEndTerm={endDrag} onActivate={activateInPane} onCloseTerm={closeTerm} onDropTerm={(id) => moveTerm(id, pi)} />
                  )}
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  {isDocker(t.protocol) ? (
                    <DockerManager assetId={t.assetId} assetName={t.name} mode="page" active={visible} />
                  ) : isGraphical(t.protocol) ? (
                    <GraphicsView assetId={t.assetId} name={t.name} active={visible} onClose={() => closeTerm(t.id)} />
                  ) : (
                    <TerminalView assetId={t.assetId} name={t.name} termId={t.id} compact initCwd={t.initCwd} existingSessionId={t.sessionId} onSession={(sid) => setTermSession(t.id, sid)} active={visible} onClose={() => closeTerm(t.id)} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <BroadcastModal open={broadcastOpen} count={groupSshTerms.length} onClose={() => setBroadcastOpen(false)} onSend={broadcast} />
      <CommandPalette open={cmdOpen} assets={allAssets} onClose={() => setCmdOpen(false)} onPick={openAsset} />

      {restorable.length > 0 && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.5)' }} onClick={() => setRestorable([])} />
          <div className="rounded shadow" style={{ position: 'fixed', top: '18vh', left: '50%', transform: 'translateX(-50%)', zIndex: 1201, width: 460, maxWidth: '92vw', background: '#1E1F22', border: '1px solid #34363a', color: '#e5e7eb' }}>
            <div className="d-flex align-items-center px-3" style={{ height: 46, borderBottom: '1px solid #34363a' }}>
              <i className="bx bx-history text-warning me-2" />
              <span style={{ fontSize: 14 }}>检测到 {restorable.length} 个未断开的会话</span>
              <button className="term-tool ms-auto" title="忽略" onClick={() => setRestorable([])}><i className="bx bx-x" /></button>
            </div>
            <div style={{ maxHeight: '46vh', overflow: 'auto' }}>
              {restorable.map((s) => (
                <div key={s.id} className="d-flex align-items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid #2b2d30' }}>
                  <i className={`bx ${PROTO_ICON[s.protocol] || 'bx-server'}`} />
                  <div className="flex-grow-1 text-truncate"><div style={{ fontSize: 13 }}>{s.assetName}</div><div className="text-muted" style={{ fontSize: 11 }}>{new Date(s.connectedAt).toLocaleString()}</div></div>
                  <button className="btn btn-sm btn-primary" onClick={() => restoreOne(s)}>恢复</button>
                  <button className="btn btn-sm btn-dark border-secondary" onClick={() => dropOne(s)}>断开</button>
                </div>
              ))}
            </div>
            <div className="d-flex justify-content-end gap-2 px-3 py-2" style={{ borderTop: '1px solid #34363a' }}>
              <button className="btn btn-sm btn-secondary" onClick={() => setRestorable([])}>忽略</button>
              <button className="btn btn-sm btn-primary" onClick={restoreAll}>全部恢复</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// 单个分屏格顶部的横向终端标签条（可点选、可关闭、可拖拽到其它格）。
function PaneTabs({ paneIndex, pane, terms, labelOf, draggingId, onDragStartTerm, onDragEndTerm, onActivate, onCloseTerm, onDropTerm }: {
  paneIndex: number
  pane: Pane
  terms: Term[]
  labelOf: (t: Term) => string
  draggingId: string | null
  onDragStartTerm: (termId: string) => void
  onDragEndTerm: () => void
  onActivate: (paneIndex: number, termId: string) => void
  onCloseTerm: (termId: string) => void
  onDropTerm: (termId: string) => void
}) {
  return (
    <div
      className="d-flex align-items-center nt-panestrip"
      style={{ height: 30, minHeight: 30, maxHeight: 30, boxSizing: 'border-box', flexShrink: 0, background: '#191A1C', borderBottom: '1px solid #34363a', overflowX: 'auto', overflowY: 'hidden' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) onDropTerm(id) }}
    >
      {pane.termIds.length === 0 && <span className="px-2 text-muted" style={{ fontSize: 12 }}>拖拽终端到此</span>}
      {pane.termIds.map((id) => {
        const t = terms.find((x) => x.id === id)
        if (!t) return null
        const act = pane.activeTermId === id
        const dragging = draggingId === id
        return (
          <div
            key={id}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; onDragStartTerm(id) }}
            onDragEnd={onDragEndTerm}
            onClick={(e) => { e.stopPropagation(); onActivate(paneIndex, id) }}
            className="d-flex align-items-center gap-1 px-2 h-100 flex-shrink-0"
            style={{ cursor: dragging ? 'grabbing' : 'pointer', opacity: dragging ? 0.45 : 1, borderRight: '1px solid #2b2d30', color: act ? '#fff' : '#9ca3af', background: act ? '#1E1F22' : 'transparent', borderBottom: act ? '2px solid #845adf' : '2px solid transparent', whiteSpace: 'nowrap', transition: 'opacity .12s' }}
            title="拖拽可移动到其它分屏，或拖到上方工作组标签跨组移动"
          >
            {isDocker(t.protocol) ? <i className="bx bxl-docker" style={{ fontSize: 15, color: '#2496ed' }} /> : <AssetIcon asset={t} size={14} />}
            <span style={{ fontSize: 12 }}>{labelOf(t)}</span>
            <i className="bx bx-x" style={{ fontSize: 14, opacity: 0.7 }} onClick={(e) => { e.stopPropagation(); onCloseTerm(id) }} />
          </div>
        )
      })}
    </div>
  )
}
