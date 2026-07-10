import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { authorizationApi, type Authorization } from '../api/authorization'
import { userApi } from '../api/user'
import { assetApi, assetGroupApi, type GroupNode } from '../api/resource'
import { Card, PageHeader, DataTable, Modal, Badge, confirm, toast, Field, TextInput, Switch, type Column } from '../ui'

interface Opt {
  value: string
  label: string
  sub?: string
}

// 带搜索的复选框多选框（无现成 ui 组件，内联轻量实现）。
function MultiPicker({ title, options, value, onChange }: { title: string; options: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  const [kw, setKw] = useState('')
  const k = kw.toLowerCase()
  const filtered = options.filter((o) => o.label.toLowerCase().includes(k) || (o.sub ?? '').toLowerCase().includes(k))
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  return (
    <div className="border rounded">
      <div className="p-2 border-bottom d-flex align-items-center gap-2">
        <span className="fw-semibold" style={{ fontSize: 13 }}>{title}</span>
        <Badge color="primary">{value.length}</Badge>
        <input className="form-control form-control-sm ms-auto" style={{ maxWidth: 160 }} placeholder="搜索" value={kw} onChange={(e) => setKw(e.target.value)} />
      </div>
      <div style={{ maxHeight: 180, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="text-muted p-2" style={{ fontSize: 12 }}>无</div>
        ) : (
          filtered.map((o) => (
            <label key={o.value} className="d-flex align-items-center gap-2 px-2 py-1 auth-pick-item" style={{ cursor: 'pointer' }}>
              <input type="checkbox" className="form-check-input mt-0" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              <span style={{ fontSize: 13 }}>{o.label}</span>
              {o.sub && <span className="text-muted ms-1" style={{ fontSize: 11 }}>{o.sub}</span>}
            </label>
          ))
        )}
      </div>
    </div>
  )
}

function flattenGroups(nodes: GroupNode[] | undefined, prefix = ''): Opt[] {
  const out: Opt[] = []
  for (const n of nodes ?? []) {
    if (n.key !== 'all') out.push({ value: n.key, label: prefix + n.title })
    out.push(...flattenGroups(n.children, prefix + n.title + ' / '))
  }
  return out
}

const empty: Partial<Authorization> = { name: '', enabled: true, userIds: [], assetIds: [], assetGroupIds: [] }

// 资产授权：把用户[] 授权到 资产[]/资产分组[]；会话建立时据此鉴权（admin 直通）。
export default function AuthorizationPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 10 })
  const [editing, setEditing] = useState<Authorization | null>(null)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Partial<Authorization>>(empty)

  const { data, isLoading } = useQuery({ queryKey: ['authorizations', page], queryFn: () => authorizationApi.paging(page) })
  const { data: users } = useQuery({ queryKey: ['users-all'], queryFn: () => userApi.list() })
  const { data: assets } = useQuery({ queryKey: ['assets-all'], queryFn: () => assetApi.list() })
  const { data: groupTree } = useQuery({ queryKey: ['asset-group-tree'], queryFn: () => assetGroupApi.tree() })

  const userOpts: Opt[] = useMemo(() => (users ?? []).map((u) => ({ value: u.id, label: u.nickname || u.username, sub: u.type === 'admin' ? '管理员' : '' })), [users])
  const assetOpts: Opt[] = useMemo(() => (assets ?? []).map((a) => ({ value: a.id, label: a.name, sub: `${a.protocol} ${a.ip}` })), [assets])
  const groupOpts: Opt[] = useMemo(() => flattenGroups(groupTree), [groupTree])

  const save = useMutation({
    mutationFn: (v: Partial<Authorization>) => (editing ? authorizationApi.update(editing.id, v) : authorizationApi.create(v)),
    onSuccess: () => {
      toast.success('已保存')
      setOpen(false)
      qc.invalidateQueries({ queryKey: ['authorizations'] })
    },
    onError: (e: any) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => authorizationApi.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['authorizations'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openForm = (rec?: Authorization) => {
    setEditing(rec || null)
    setValues(rec ? { ...rec } : { ...empty })
    setOpen(true)
  }
  const set = (name: keyof Authorization, val: any) => setValues((cur) => ({ ...cur, [name]: val }))

  const submit = () => {
    if (!values.name?.trim()) return toast.warning('请输入策略名称')
    if (!values.userIds?.length) return toast.warning('请至少选择一个用户')
    if (!values.assetIds?.length && !values.assetGroupIds?.length) return toast.warning('请至少授权一个资产或分组')
    save.mutate(values)
  }
  const onDelete = async (id: string) => {
    if (await confirm('确认删除该授权策略？', { danger: true, okText: '删除' })) remove.mutate(id)
  }

  const columns: Column<Authorization>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '状态', key: '__en', render: (_, r) => <Badge color={r.enabled ? 'success' : 'secondary'}>{r.enabled ? '启用' : '停用'}</Badge> },
    { title: '用户数', key: '__u', render: (_, r) => r.userIds?.length ?? 0 },
    { title: '授权资产', key: '__a', render: (_, r) => `${r.assetIds?.length ?? 0} 资产 · ${r.assetGroupIds?.length ?? 0} 分组` },
    {
      title: '操作',
      key: '__act',
      render: (_, rec) => (
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-light" onClick={() => openForm(rec)}><i className="bx bx-edit-alt" /> 编辑</button>
          <button className="btn btn-sm btn-danger-light" onClick={() => onDelete(rec.id)}><i className="bx bx-trash" /> 删除</button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="资产授权"
        crumbs={['授权', '资产授权']}
        extra={
          <button className="btn btn-primary" onClick={() => openForm()}>
            <i className="bx bx-plus" /> 新增授权
          </button>
        }
      />
      <Card>
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

      <Modal open={open} title={editing ? '编辑授权策略' : '新增授权策略'} onClose={() => setOpen(false)} onOk={submit} okLoading={save.isPending} width={760}>
        <div className="row gy-3">
          <Field col="col-md-8" label="策略名称" required>
            <TextInput value={values.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field col="col-md-4" label="启用">
            <div className="pt-1">
              <Switch checked={values.enabled ?? true} onChange={(v) => set('enabled', v)} label={values.enabled ? '已启用' : '已停用'} />
            </div>
          </Field>
          <Field col="col-12" label="授权用户" required>
            <MultiPicker title="用户" options={userOpts} value={values.userIds ?? []} onChange={(v) => set('userIds', v)} />
          </Field>
          <Field col="col-md-6" label="授权资产分组（含子分组）">
            <MultiPicker title="资产分组" options={groupOpts} value={values.assetGroupIds ?? []} onChange={(v) => set('assetGroupIds', v)} />
          </Field>
          <Field col="col-md-6" label="授权资产">
            <MultiPicker title="资产" options={assetOpts} value={values.assetIds ?? []} onChange={(v) => set('assetIds', v)} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
