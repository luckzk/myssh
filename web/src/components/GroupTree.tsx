import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { assetApi, assetGroupApi, type Asset, type GroupNode } from '../api/resource'
import AssetIcon from './AssetIcon'
import GroupIcon from './GroupIcon'
import { confirm, toast, Modal, Field, TextInput } from '../ui'

// 资产分组树（对齐 conn_ssh 7.png）：全部 + 文件夹(chevron/计数) + 引导线 + 嵌套 + 资产叶子。

interface Props {
  selected: string
  onSelect: (groupId: string) => void
  onSelectAsset?: (assetId: string) => void // 点资产叶子：聚焦该资产（不选中父分组）
}

// 分组图标预设（boxicons 类名）+ 颜色调色板 + 默认。
const DEFAULT_ICON = 'bx-folder'
const DEFAULT_COLOR = '#e0a23b'
const GROUP_ICONS = [
  'bx-folder', 'bxs-folder', 'bx-folder-open', 'bx-server', 'bx-data', 'bx-cloud',
  'bx-network-chart', 'bx-cube', 'bx-globe', 'bx-shield', 'bx-lock-alt', 'bx-desktop',
  'bx-chip', 'bx-terminal', 'bx-buildings', 'bx-box', 'bx-package', 'bx-group',
  'bx-star', 'bx-flag', 'bx-code-block', 'bx-git-branch',
]
const GROUP_COLORS = ['#e0a23b', '#845adf', '#22c55e', '#3b82f6', '#ef4444', '#06b6d4', '#f97316', '#ec4899', '#9ca3af']

function editInTree(nodes: GroupNode[], key: string, patch: Partial<GroupNode>): GroupNode[] {
  return nodes.map((n) => (n.key === key ? { ...n, ...patch } : { ...n, children: n.children ? editInTree(n.children, key, patch) : n.children }))
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
  const [icon, setIcon] = useState(DEFAULT_ICON)
  const [iconColor, setIconColor] = useState(DEFAULT_COLOR)
  const fileRef = useRef<HTMLInputElement>(null)
  const isImage = icon.startsWith('data:')

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选同一文件
    if (!file) return
    if (file.size > 256 * 1024) return toast.warning('图标不能超过 256KB')
    const reader = new FileReader()
    reader.onload = () => setIcon(String(reader.result))
    reader.readAsDataURL(file)
  }

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

  const openDialog = (d: Dialog) => {
    setDialog(d)
    setName(d.node?.title ?? '')
    setIcon(d.node?.icon || DEFAULT_ICON)
    setIconColor(d.node?.iconColor || DEFAULT_COLOR)
  }
  const submitDialog = async () => {
    const v = name.trim()
    if (!v || !dialog) return setDialog(null)
    if (dialog.mode === 'rename' && dialog.node) await saveTree(editInTree(tree, dialog.node.key, { title: v, icon, iconColor }))
    else await saveTree(addToTree(tree, dialog.parentKey || '', { key: '', title: v, icon, iconColor }))
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
      <AssetIcon asset={a} size={14} color="#9aa1ac" />
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
          <GroupIcon icon={g.icon} color={g.iconColor} size={16} />
          <span className="text-truncate">{g.title}</span>
          <span className="gt-count">({countOf(g)})</span>
          <span className="gt-actions">
            <i className="bx bx-plus" title="新建子分组" onClick={(e) => { e.stopPropagation(); openDialog({ mode: 'child', parentKey: g.key }) }} />
            <i className="bx bx-edit-alt" title="编辑分组（名称/图标）" onClick={(e) => { e.stopPropagation(); openDialog({ mode: 'rename', node: g }) }} />
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
        title={dialog?.mode === 'rename' ? '编辑分组' : dialog?.mode === 'child' ? '新建子分组' : '新建分组'}
        onClose={() => setDialog(null)}
        onOk={submitDialog}
        okText={dialog?.mode === 'rename' ? '保存' : '创建'}
      >
        <Field label="分组名称" required>
          <div className="d-flex align-items-center gap-2">
            <span className="d-inline-flex align-items-center justify-content-center flex-shrink-0" style={{ width: 34, height: 34, borderRadius: 8, background: '#f5f6f7' }}>
              <GroupIcon icon={icon} color={iconColor} size={20} />
            </span>
            <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitDialog() }} placeholder="如：生产环境" />
          </div>
        </Field>
        <Field label="图标" extra="选预设图标或上传自定义图片（png/jpg/svg，≤256KB）">
          <div className="d-flex flex-wrap gap-1 mb-2">
            {GROUP_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => setIcon(ic)}
                className="d-inline-flex align-items-center justify-content-center"
                style={{
                  width: 32, height: 32, borderRadius: 6, cursor: 'pointer',
                  border: icon === ic ? '2px solid var(--primary-color, #845adf)' : '1px solid #e6e6e6',
                  background: icon === ic ? 'var(--primary01, rgba(132,90,223,.1))' : '#fff',
                }}
                title={ic}
              >
                <i className={`bx ${ic}`} style={{ color: iconColor, fontSize: 18 }} />
              </button>
            ))}
          </div>
          <div className="d-flex align-items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="d-none" onChange={onPickImage} />
            <button type="button" className="btn btn-light btn-sm" onClick={() => fileRef.current?.click()}><i className="bx bx-upload" /> 上传图标</button>
            {isImage && <><span className="text-success small"><i className="bx bx-check" /> 已用自定义图片</span><button type="button" className="btn btn-link btn-sm text-secondary p-0" onClick={() => setIcon(DEFAULT_ICON)}>移除</button></>}
          </div>
        </Field>
        {!isImage && (
          <Field label="颜色">
            <div className="d-flex flex-wrap gap-2">
              {GROUP_COLORS.map((cl) => (
                <button
                  key={cl}
                  type="button"
                  onClick={() => setIconColor(cl)}
                  style={{
                    width: 24, height: 24, borderRadius: '50%', cursor: 'pointer', background: cl,
                    border: iconColor === cl ? '2px solid #111' : '2px solid transparent',
                    boxShadow: iconColor === cl ? '0 0 0 2px #fff inset' : 'none',
                  }}
                  title={cl}
                />
              ))}
            </div>
          </Field>
        )}
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
