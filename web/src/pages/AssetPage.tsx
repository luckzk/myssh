import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assetApi, assetGroupApi, type Asset } from '../api/resource'
import { makeCrud } from '../api/crud'
import GroupTree, { flattenGroups } from '../components/GroupTree'
import GuacdModal from '../components/GuacdModal'
import AssetForm from './AssetForm'
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

  const columns: Column<Asset>[] = [
    { title: '名称', dataIndex: 'name' },
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
          <button
            className="btn btn-sm btn-light"
            onClick={() => {
              // 打开终端工作台（固定窗口名 → 复用同一浏览器标签，内部用 tab）
              const q = `open=${rec.id}&name=${encodeURIComponent(rec.name)}&protocol=${rec.protocol}`
              window.open(`/access?${q}`, 'nt-workspace')
            }}
          >
            <i className="bx bx-link-external" /> 连接
          </button>
          <button className="btn btn-sm btn-light" onClick={() => openForm(rec)}>
            <i className="bx bx-edit-alt" /> 编辑
          </button>
          <button className="btn btn-sm btn-danger-light" onClick={() => onDelete(rec.id)}>
            <i className="bx bx-trash" /> 删除
          </button>
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
          <>
            <button className="btn btn-light" onClick={() => setGuacdOpen(true)}>
              <i className="bx bx-server" /> guacd 网关
            </button>
            <button className="btn btn-primary" onClick={() => openForm()}>
              <i className="bx bx-plus" /> 新增资产
            </button>
          </>
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
            {/* 资源搜索：跨 名称/协议/地址/账号/分组/标签，范围=左侧所选分组 */}
            <div className="input-group mb-3" style={{ maxWidth: 460 }}>
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
            {focusAssetId && (
              <div className="mb-2 fs-13">
                <span className="badge bg-info-transparent text-info">已聚焦单个资产</span>
                <a className="ms-2" href="#" onClick={(e) => { e.preventDefault(); setFocusAssetId('') }}>清除</a>
              </div>
            )}
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
