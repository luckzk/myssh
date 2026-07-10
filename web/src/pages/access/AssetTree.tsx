import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { assetApi, assetGroupApi, type Asset, type GroupNode } from '../../api/resource'
import GroupIcon from '../../components/GroupIcon'
import AssetIcon from '../../components/AssetIcon'

// 协议 → 图标 + 徽章色（对齐 demo：SSH 绿 / RDP 紫 / VNC 黄 / Telnet 蓝）
const PROTO: Record<string, { icon: string; color: string }> = {
  ssh: { icon: 'bx-terminal', color: 'success' },
  rdp: { icon: 'bx-windows', color: 'primary' },
  vnc: { icon: 'bx-desktop', color: 'warning' },
  telnet: { icon: 'bx-chip', color: 'info' },
}

function defaultOpen(a: Asset) {
  const graphical = a.protocol === 'rdp' || a.protocol === 'vnc'
  const base = graphical ? '/graphics' : '/term'
  window.open(`${base}/${a.id}?name=${encodeURIComponent(a.name)}`, '_blank')
}

interface Props {
  currentAssetId?: string
  onOpen?: (asset: Asset) => void // 工作台内：开内部 tab；缺省回退新标签
}

// 左侧资源树（暗色，对齐 demo）：搜索 + 按分组展示资产 + 协议徽章，点击连接。
export default function AssetTree({ currentAssetId, onOpen }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [kw, setKw] = useState('')

  const qc = useQueryClient()
  const { data: assets = [], isFetching } = useQuery({ queryKey: ['assets-all'], queryFn: assetApi.list })
  const { data: groups = [] } = useQuery({ queryKey: ['asset-groups'], queryFn: assetGroupApi.tree })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['assets-all'] })
    qc.invalidateQueries({ queryKey: ['asset-groups'] })
  }

  const open = onOpen ?? defaultOpen
  const q = kw.trim().toLowerCase()
  const match = (a: Asset) => !q || a.name.toLowerCase().includes(q) || (a.ip || '').toLowerCase().includes(q)

  const byGroup = useMemo(() => {
    const m: Record<string, Asset[]> = {}
    for (const a of assets) if (match(a)) (m[a.groupId || ''] ??= []).push(a)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, q])

  const isOpen = (k: string) => (q ? true : openGroups[k] !== false) // 搜索时强制展开
  const toggle = (k: string) => setOpenGroups((s) => ({ ...s, [k]: !isOpen(k) }))

  // 递归资产计数（本组 + 子组）
  const countOf = (g: GroupNode): number => (byGroup[g.key]?.length ?? 0) + (g.children ?? []).reduce((s, c) => s + countOf(c), 0)

  const renderAsset = (a: Asset, nested: boolean) => {
    const p = PROTO[a.protocol] ?? { icon: 'bx-server', color: 'secondary' }
    return (
      <div
        key={a.id}
        className={`at-item d-flex align-items-center gap-2 ${nested ? 'atree-line' : ''}`}
        style={{ background: a.id === currentAssetId ? '#34363a' : undefined }}
        title={`${a.name} (${a.ip})`}
        onClick={() => open(a)}
      >
        <AssetIcon asset={a} size={16} color="#9ca3af" />
        <span className="flex-grow-1 text-truncate" style={{ fontSize: 13 }}>{a.name}</span>
        <span className={`badge bg-${p.color}-transparent text-${p.color}`} style={{ fontSize: 9 }}>{a.protocol.toUpperCase()}</span>
      </div>
    )
  }

  const renderGroup = (g: GroupNode, depth: number) => {
    const items = byGroup[g.key] ?? []
    const childHas = (g.children ?? []).some((c) => (byGroup[c.key] ?? []).length > 0)
    if (q && items.length === 0 && !childHas) return null // 搜索时隐藏空分组
    const hasKids = (g.children?.length ?? 0) > 0 || items.length > 0
    return (
      <div key={g.key}>
        <div className={`at-group d-flex align-items-center gap-1 ${depth > 0 ? 'atree-line' : ''}`} onClick={() => toggle(g.key)}>
          <i className={`bx ${isOpen(g.key) ? 'bx-chevron-down' : 'bx-chevron-right'}`} style={{ color: '#9ca3af', visibility: hasKids ? 'visible' : 'hidden' }} />
          <GroupIcon icon={g.icon} color={g.iconColor} size={15} />
          <span className="flex-grow-1 text-truncate" style={{ fontSize: 13 }}>{g.title}</span>
          <span className="text-muted" style={{ fontSize: 11 }}>{countOf(g)}</span>
        </div>
        {isOpen(g.key) && hasKids && (
          <div className="atree-children">
            {g.children?.map((c) => renderGroup(c, depth + 1))}
            {items.map((a) => renderAsset(a, true))}
          </div>
        )}
      </div>
    )
  }

  const ungrouped = byGroup[''] ?? []

  if (collapsed) {
    return (
      <div style={{ width: 36, background: '#1E1F22', borderRight: '1px solid #34363a' }} className="d-flex flex-column align-items-center py-2">
        <button className="term-tool" title="展开资源树" onClick={() => setCollapsed(false)}>
          <i className="bx bx-sidebar" />
        </button>
      </div>
    )
  }

  return (
    <div style={{ width: 240, background: '#1E1F22', borderRight: '1px solid #34363a', color: '#d4d4d4', flexShrink: 0, overflowY: 'auto' }} className="d-flex flex-column">
      <div className="d-flex align-items-center justify-content-between px-3 py-2" style={{ borderBottom: '1px solid #34363a' }}>
        <span className="fw-medium" style={{ color: '#e5e7eb' }}>资源</span>
        <div className="d-flex align-items-center gap-1">
          <button className="term-tool" style={{ width: 28, height: 28, fontSize: 16 }} title="刷新资源列表" onClick={refresh}>
            <i className={`bx bx-refresh${isFetching ? ' bx-spin' : ''}`} />
          </button>
          <button className="term-tool" style={{ width: 28, height: 28, fontSize: 16 }} title="折叠" onClick={() => setCollapsed(true)}>
            <i className="bx bx-chevrons-left" />
          </button>
        </div>
      </div>
      {/* 资源搜索 */}
      <div className="px-2 py-2" style={{ borderBottom: '1px solid #34363a' }}>
        <div className="input-group input-group-sm">
          <span className="input-group-text bg-dark border-secondary text-secondary"><i className="bx bx-search" /></span>
          <input
            className="form-control form-control-sm bg-dark text-light border-secondary"
            placeholder="搜索资产 / IP"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
          />
          {kw && (
            <button className="btn btn-sm btn-dark border-secondary" onClick={() => setKw('')}><i className="bx bx-x" /></button>
          )}
        </div>
      </div>
      <div className="py-1">
        {groups.map((g) => renderGroup(g, 0))}
        {ungrouped.length > 0 && (
          <div>
            <div className="at-group d-flex align-items-center gap-1" onClick={() => toggle('__ungrouped')}>
              <i className={`bx ${isOpen('__ungrouped') ? 'bx-chevron-down' : 'bx-chevron-right'}`} style={{ color: '#9ca3af' }} />
              <i className="bx bx-folder" style={{ color: '#9ca3af' }} />
              <span className="flex-grow-1" style={{ fontSize: 13 }}>未分组</span>
              <span className="text-muted" style={{ fontSize: 11 }}>{ungrouped.length}</span>
            </div>
            {isOpen('__ungrouped') && (
              <div className="atree-children">{ungrouped.map((a) => renderAsset(a, true))}</div>
            )}
          </div>
        )}
        {assets.filter(match).length === 0 && <div className="text-muted px-3 py-2" style={{ fontSize: 12 }}>{q ? '无匹配资产' : '暂无资产'}</div>}
      </div>
    </div>
  )
}
