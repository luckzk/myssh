import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { assetApi, assetGroupApi, type Asset, type GroupNode } from '../api/resource'
import { confirm, toast, Modal, Field, TextInput } from '../ui'

// 资产分组树（对齐 conn_ssh 7.png）：全部 + 文件夹(chevron/计数) + 引导线 + 嵌套 + 资产叶子。

interface Props {
  selected: string
  onSelect: (groupId: string) => void
  onSelectAsset?: (assetId: string) => void // 点资产叶子：聚焦该资产（不选中父分组）
}

function renameInTree(nodes: GroupNode[], key: string, title: string): GroupNode[] {
  return nodes.map((n) => (n.key === key ? { ...n, title } : { ...n, children: n.children ? renameInTree(n.children, key, title) : n.children }))
}
function addToTree(nodes: GroupNode[], parentKey: string, node: GroupNode): GroupNode[] {
  if (!parentKey) return [...nodes, node]
  return nodes.map((n) =>
    n.key === parentKey ? { ...n, children: [...(n.children ?? []), node] } : { ...n, children: n.children ? addToTree(n.children, parentKey, node) : n.children },
  )
}

type Dialog = { mode: 'new' | 'child' | 'rename'; parentKey?: string; node?: GroupNode }

export default function GroupTree({ selected, onSelect, onSelectAsset }: Props) {
  const qc = useQueryClient()
  const { data: tree = [] } = useQuery({ queryKey: ['asset-groups'], queryFn: assetGroupApi.tree })
  const { data: assets = [] } = useQuery({ queryKey: ['assets-all'], queryFn: assetApi.list })

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [activeAsset, setActiveAsset] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [name, setName] = useState('')

  // 直属分组的资产
  const byGroup = useMemo(() => {
    const m: Record<string, Asset[]> = {}
    for (const a of assets) (m[a.groupId || ''] ??= []).push(a)
    return m
  }, [assets])

  // 递归资产计数（本组 + 所有子组）
  const countOf = (g: GroupNode): number => (byGroup[g.key]?.length ?? 0) + (g.children ?? []).reduce((s, c) => s + countOf(c), 0)

  const refresh = () => qc.invalidateQueries({ queryKey: ['asset-groups'] })
  const saveTree = async (next: GroupNode[]) => {
    try {
      await assetGroupApi.save(next)
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const isOpen = (k: string) => expanded[k] !== false // 默认展开
  const toggle = (k: string) => setExpanded((s) => ({ ...s, [k]: !isOpen(k) }))

  const openDialog = (d: Dialog, initial = '') => { setDialog(d); setName(initial) }
  const submitDialog = async () => {
    const v = name.trim()
    if (!v || !dialog) return setDialog(null)
    if (dialog.mode === 'rename' && dialog.node) await saveTree(renameInTree(tree, dialog.node.key, v))
    else await saveTree(addToTree(tree, dialog.parentKey || '', { key: '', title: v }))
    setDialog(null)
  }
  const del = async (node: GroupNode) => {
    if (!(await confirm(`删除分组「${node.title}」？其下资产将归为「全部」。`, { danger: true, okText: '删除' }))) return
    try {
      await assetGroupApi.remove(node.key)
      if (selected === node.key) onSelect('')
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const renderLeaf = (a: Asset) => (
    <div
      key={a.id}
      className={`gt-leaf gt-line ${activeAsset === a.id ? 'active' : ''}`}
      title={`${a.name}（${a.ip}）`}
      onClick={() => { setActiveAsset(a.id); onSelectAsset?.(a.id) }}
    >
      <span style={{ width: 14, flexShrink: 0 }} />
      <i className="bx bx-window-alt" style={{ color: '#9aa1ac', fontSize: 14 }} />
      <span className="text-truncate">{a.name}</span>
    </div>
  )

  const renderGroup = (g: GroupNode, depth: number) => {
    const childGroups = g.children ?? []
    const leaves = byGroup[g.key] ?? []
    const hasKids = childGroups.length > 0 || leaves.length > 0
    const open = isOpen(g.key)
    return (
      <div key={g.key}>
        <div
          className={`gt-row ${depth > 0 ? 'gt-line' : ''} ${selected === g.key && !activeAsset ? 'active' : ''}`}
          onClick={() => { setActiveAsset(''); onSelect(g.key) }}
        >
          {hasKids ? (
            <i
              className={`bx ${open ? 'bx-chevron-down' : 'bx-chevron-right'} gt-chev`}
              onClick={(e) => { e.stopPropagation(); toggle(g.key) }}
            />
          ) : (
            <span className="gt-chev" />
          )}
          <i className="bx bx-folder" style={{ color: '#e0a23b', flexShrink: 0 }} />
          <span className="text-truncate">{g.title}</span>
          <span className="gt-count">({countOf(g)})</span>
          <span className="gt-actions">
            <i className="bx bx-plus" title="新建子分组" onClick={(e) => { e.stopPropagation(); openDialog({ mode: 'child', parentKey: g.key }) }} />
            <i className="bx bx-edit-alt" title="重命名" onClick={(e) => { e.stopPropagation(); openDialog({ mode: 'rename', node: g }, g.title) }} />
            <i className="bx bx-trash" title="删除" onClick={(e) => { e.stopPropagation(); del(g) }} />
          </span>
        </div>
        {open && hasKids && (
          <div className="gt-children">
            {childGroups.map((c) => renderGroup(c, depth + 1))}
            {leaves.map(renderLeaf)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-2">
        <span className="fw-medium">分组</span>
        <button className="btn btn-sm btn-primary-light" onClick={() => openDialog({ mode: 'new' })}>
          <i className="bx bx-plus" /> 新建
        </button>
      </div>

      {/* 全部 */}
      <div className={`gt-row ${selected === '' && !activeAsset ? 'active' : ''}`} onClick={() => { setActiveAsset(''); onSelect('') }}>
        <span className="gt-chev" />
        <i className="bx bx-layer" style={{ color: '#9aa1ac', flexShrink: 0 }} />
        <span>全部</span>
        <span className="gt-count">({assets.length})</span>
      </div>

      {tree.map((g) => renderGroup(g, 0))}
      {tree.length === 0 && <div className="text-muted small px-2 py-2">暂无分组，点「新建」</div>}

      <Modal
        open={!!dialog}
        width={420}
        title={dialog?.mode === 'rename' ? '重命名分组' : dialog?.mode === 'child' ? '新建子分组' : '新建分组'}
        onClose={() => setDialog(null)}
        onOk={submitDialog}
        okText={dialog?.mode === 'rename' ? '保存' : '创建'}
      >
        <Field label="分组名称" required>
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitDialog() }} placeholder="如：生产环境" />
        </Field>
      </Modal>
    </div>
  )
}

// 把分组树扁平化为下拉选项（含层级缩进），供表单选择所属分组。
export function flattenGroups(nodes: GroupNode[], depth = 0): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  for (const n of nodes) {
    out.push({ value: n.key, label: ' '.repeat(depth * 2) + n.title })
    if (n.children) out.push(...flattenGroups(n.children, depth + 1))
  }
  return out
}
