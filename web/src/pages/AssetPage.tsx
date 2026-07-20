import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assetApi, assetGroupApi, type Asset } from '../api/resource'
import { makeCrud } from '../api/crud'
import GroupTree, { flattenGroups } from '../components/GroupTree'
import GuacdModal from '../components/GuacdModal'
import AssetForm from './AssetForm'
import { authApi } from '../api/auth'
import AssetIcon from '../components/AssetIcon'
import { Card, PageHeader, DataTable, Badge, confirm, toast, type Column } from '../ui'

// 主机资产：列表 + 新增/编辑（多 Tab 对话框 AssetForm）+ 分组树 + guacd 网关。
export default function AssetPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 10 })
  const [groupId, setGroupId] = useState('')
  const [keyword, setKeyword] = useState('')
  const [focusAssetId, setFocusAssetId] = useState('')
  const [editing, setEditing] = useState<Asset | null>(null)
  const [open, setOpen] = useState(false)
  const [guacdOpen, setGuacdOpen] = useState(false)
  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('nt-asset-view') as any) || 'list')
  const setViewMode = (v: 'list' | 'grid') => { setView(v); localStorage.setItem('nt-asset-view', v) }

  const { data, isLoading } = useQuery({
    queryKey: ['assets', page, groupId, keyword, focusAssetId],
    queryFn: () =>
      assetApi.paging({
        ...page,
        groupId: groupId || undefined,
        keyword: keyword || undefined,
        assetId: focusAssetId || undefined,
      }),
  })

  // 分组树（表单下拉用）+ 全部 SSH 资产（guacd 选择用）
  const { data: account } = useQuery({ queryKey: ['account-wm'], queryFn: authApi.accountInfo })
  const isAdmin = account?.type === 'admin'
  const { data: groups = [] } = useQuery({ queryKey: ['asset-groups'], queryFn: assetGroupApi.tree })
  const { data: allAssets = [] } = useQuery({ queryKey: ['assets-all'], queryFn: assetApi.list })
  const groupOptions = [{ value: '', label: '（不分组）' }, ...flattenGroups(groups)]
  const sshAssets = allAssets.filter((a) => a.protocol === 'ssh')

  // SSH 网关/跳板机选项
  const { data: gateways } = useQuery({
    queryKey: ['ssh-gateways', 'all'],
    queryFn: () => makeCrud<any>('ssh-gateways').paging({ pageIndex: 1, pageSize: 100 }),
  })
  // 跳板候选：按文件夹（分组）组织的 SSH 资产 + SSH 网关（optgroup）
  const jumpGroups = (() => {
    const byFolder: Record<string, { value: string; label: string }[]> = {}
    for (const a of sshAssets) {
      const folder = a.groupFullName || '未分组'
      ;(byFolder[folder] ??= []).push({ value: a.id, label: `${a.name}（${a.ip}）` })
    }
    const groupsArr = Object.entries(byFolder).map(([label, options]) => ({ label, options }))
    const gws = (gateways?.items ?? []).map((g: any) => ({ value: g.id, label: `${g.name}（${g.ip || ''}）` }))
    if (gws.length) groupsArr.push({ label: 'SSH 网关', options: gws })
    return groupsArr
  })()

  const onSelectGroup = (gid: string) => {
    setGroupId(gid)
    setFocusAssetId('') // 切分组 → 取消资产聚焦
    setPage((p) => ({ ...p, pageIndex: 1 }))
  }
  const onSelectAsset = (id: string) => {
    setFocusAssetId(id) // 点资产 → 表格聚焦该资产（不改分组）
    setKeyword('')
    setPage((p) => ({ ...p, pageIndex: 1 }))
  }
  const onSearch = (v: string) => {
    setKeyword(v)
    setFocusAssetId('') // 搜索 → 取消资产聚焦，在当前分组范围内搜
    setPage((p) => ({ ...p, pageIndex: 1 }))
  }

  const remove = useMutation({
    mutationFn: (id: string) => assetApi.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['assets'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openForm = (rec?: Asset) => {
    setEditing(rec || null)
    setOpen(true)
  }

  const onDelete = async (id: string) => {
    if (await confirm('确认删除？', { danger: true, okText: '删除' })) {
      remove.mutate(id)
    }
  }

  // 连接：复用固定窗口名的工作台；空 URL 只聚焦、不导航（避免整页重载断开已有终端）。
  const connectAsset = (rec: Asset) => {
    const w = window.open('', 'nt-workspace')
    let fresh = !w
    try {
      fresh = fresh || !w!.location.href || w!.location.href === 'about:blank'
    } catch {
      fresh = false // 跨源无法读取 → 视为已存在的工作台
    }
    if (fresh && w) {
      const q = `open=${rec.id}&name=${encodeURIComponent(rec.name)}&protocol=${rec.protocol}`
      w.location.href = `/access?${q}`
    } else {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('nt-access')
        bc.postMessage({ assetId: rec.id, name: rec.name, protocol: rec.protocol })
        bc.close()
      }
      w?.focus()
    }
  }

  const columns: Column<Asset>[] = [
    { title: '名称', key: '__name', render: (_, r) => <span className="d-inline-flex align-items-center gap-2"><AssetIcon asset={r} size={16} />{r.name}</span> },
    { title: '协议', dataIndex: 'protocol', render: (v) => <Badge>{v}</Badge> },
    { title: '地址', key: 'addr', render: (_, r) => `${r.ip}:${r.port}` },
    { title: '账号', dataIndex: 'username' },
    {
      title: '分组',
      dataIndex: 'groupFullName',
      render: (v: string) => (v ? <Badge color="info">{v}</Badge> : <span className="text-muted">-</span>),
    },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (tags: string[]) => (
        <div className="d-flex gap-1 flex-wrap">
          {tags?.map((t) => (
            <Badge key={t} color="secondary">
              {t}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      title: '操作',
      key: '__act',
      render: (_, rec) => (
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-light" onClick={() => connectAsset(rec)}>
            <i className="bx bx-link-external" /> 连接
          </button>
          {isAdmin && (
            <>
              <button className="btn btn-sm btn-light" onClick={() => openForm(rec)}>
                <i className="bx bx-edit-alt" /> 编辑
              </button>
              <button className="btn btn-sm btn-danger-light" onClick={() => onDelete(rec.id)}>
                <i className="bx bx-trash" /> 删除
              </button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="主机资产"
        crumbs={['资源管理', '主机资产']}
        extra={
          isAdmin ? (
            <>
              <button className="btn btn-light" onClick={() => setGuacdOpen(true)}>
                <i className="bx bx-server" /> guacd 网关
              </button>
              <button className="btn btn-primary" onClick={() => openForm()}>
                <i className="bx bx-plus" /> 新增资产
              </button>
            </>
          ) : null
        }
      />
      <div className="row g-3">
        <div className="col-xl-3 col-lg-4">
          <Card>
            <GroupTree selected={groupId} onSelect={onSelectGroup} onSelectAsset={onSelectAsset} />
          </Card>
        </div>
        <div className="col-xl-9 col-lg-8">
          <Card>
            {/* 资源搜索：跨 名称/协议/地址/账号/分组/标签，范围=左侧所选分组；右侧列表/网格切换 */}
            <div className="d-flex align-items-center justify-content-between mb-3 gap-2">
              <div className="input-group" style={{ maxWidth: 460 }}>
                <span className="input-group-text bg-transparent">
                  <i className="bx bx-search" />
                </span>
                <input
                  className="form-control"
                  placeholder="搜索 名称 / 协议 / 地址 / 账号 / 分组 / 标签"
                  value={keyword}
                  onChange={(e) => onSearch(e.target.value)}
                />
                {keyword && (
                  <button className="btn btn-light" onClick={() => onSearch('')}>
                    <i className="bx bx-x" />
                  </button>
                )}
              </div>
              <div className="btn-group flex-shrink-0" role="group" aria-label="视图切换">
                <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-light'}`} title="列表视图" onClick={() => setViewMode('list')}><i className="bx bx-list-ul" /></button>
                <button className={`btn btn-sm ${view === 'grid' ? 'btn-primary' : 'btn-light'}`} title="网格视图" onClick={() => setViewMode('grid')}><i className="bx bx-grid-alt" /></button>
              </div>
            </div>
            {focusAssetId && (
              <div className="mb-2 fs-13">
                <span className="badge bg-info-transparent text-info">已聚焦单个资产</span>
                <a className="ms-2" href="#" onClick={(e) => { e.preventDefault(); setFocusAssetId('') }}>清除</a>
              </div>
            )}
            {view === 'list' ? (
              <DataTable
                columns={columns}
                dataSource={data?.items}
                loading={isLoading}
                rowKey="id"
                pagination={{
                  current: page.pageIndex,
                  pageSize: page.pageSize,
                  total: data?.total,
                  onChange: (pageIndex, pageSize) => setPage({ pageIndex, pageSize }),
                }}
              />
            ) : (
              <AssetGrid
                items={data?.items ?? []}
                loading={isLoading}
                isAdmin={isAdmin}
                onConnect={connectAsset}
                onEdit={openForm}
                onDelete={onDelete}
                page={page}
                total={data?.total ?? 0}
                onPage={(pageIndex) => setPage((p) => ({ ...p, pageIndex }))}
              />
            )}
          </Card>
        </div>
      </div>

      <GuacdModal open={guacdOpen} onClose={() => setGuacdOpen(false)} sshAssets={sshAssets} />

      <AssetForm
        open={open}
        editing={editing}
        groupOptions={groupOptions}
        jumpGroups={jumpGroups}
        onClose={() => setOpen(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['assets'] })
          qc.invalidateQueries({ queryKey: ['assets-all'] })
        }}
      />
    </>
  )
}

// AssetGrid 网格视图：带 OS/发行版大图标的资产卡片 + 简易分页。
function AssetGrid({ items, loading, isAdmin, onConnect, onEdit, onDelete, page, total, onPage }: {
  items: Asset[]; loading?: boolean; isAdmin?: boolean
  onConnect: (a: Asset) => void; onEdit: (a: Asset) => void; onDelete: (id: string) => void
  page: { pageIndex: number; pageSize: number }; total: number; onPage: (pageIndex: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(total / page.pageSize))
  if (loading) return <div className="text-center text-muted py-5">加载中…</div>
  if (items.length === 0) return <div className="text-center text-muted py-5">暂无资产</div>
  return (
    <>
      <div className="row g-3">
        {items.map((a) => (
          <div className="col-xxl-3 col-lg-4 col-md-6" key={a.id}>
            <div className="border rounded p-3 h-100 d-flex flex-column asset-grid-card">
              <div className="d-flex align-items-center gap-2 mb-2">
                <AssetIcon asset={a} size={26} />
                <div className="text-truncate">
                  <div className="fw-semibold text-truncate" title={a.name}>{a.name}</div>
                  <div className="text-muted" style={{ fontSize: 12 }}>{a.ip}:{a.port}</div>
                </div>
              </div>
              <div className="d-flex flex-wrap gap-1 mb-2" style={{ fontSize: 12 }}>
                <Badge>{a.protocol}</Badge>
                {a.username && <Badge color="secondary">{a.username}</Badge>}
                {a.groupFullName && <Badge color="info">{a.groupFullName}</Badge>}
              </div>
              <div className="d-flex gap-1 mt-auto">
                <button className="btn btn-sm btn-light flex-fill" onClick={() => onConnect(a)}><i className="bx bx-link-external" /> 连接</button>
                {isAdmin && <button className="btn btn-sm btn-light" title="编辑" onClick={() => onEdit(a)}><i className="bx bx-edit-alt" /></button>}
                {isAdmin && <button className="btn btn-sm btn-danger-light" title="删除" onClick={() => onDelete(a.id)}><i className="bx bx-trash" /></button>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {pageCount > 1 && (
        <div className="d-flex justify-content-end align-items-center gap-2 mt-3">
          <button className="btn btn-sm btn-light" disabled={page.pageIndex <= 1} onClick={() => onPage(page.pageIndex - 1)}><i className="bx bx-chevron-left" /></button>
          <span className="text-muted" style={{ fontSize: 13 }}>{page.pageIndex} / {pageCount}</span>
          <button className="btn btn-sm btn-light" disabled={page.pageIndex >= pageCount} onClick={() => onPage(page.pageIndex + 1)}><i className="bx bx-chevron-right" /></button>
        </div>
      )}
    </>
  )
}
