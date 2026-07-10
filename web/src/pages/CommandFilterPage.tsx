import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { commandFilterApi, type CommandFilter } from '../api/commandFilter'
import { userApi } from '../api/user'
import { assetApi } from '../api/resource'
import { Card, PageHeader, DataTable, Modal, Badge, confirm, toast, Field, TextInput, Select, Switch, type Column } from '../ui'

interface Opt {
  value: string
  label: string
  sub?: string
}

// 带搜索的复选框多选框（与授权页一致）。
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
      <div style={{ maxHeight: 160, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="text-muted p-2" style={{ fontSize: 12 }}>无</div>
        ) : (
          filtered.map((o) => (
            <label key={o.value} className="d-flex align-items-center gap-2 px-2 py-1" style={{ cursor: 'pointer' }}>
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

const empty: Partial<CommandFilter> = { name: '', enabled: true, action: 'block', pattern: '', regex: false, priority: 100, userIds: [], assetIds: [] }

// 命令过滤：命中输入的整行命令时按动作阻断/告警。规则可绑定用户/资产（空=全局）。
export default function CommandFilterPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 10 })
  const [editing, setEditing] = useState<CommandFilter | null>(null)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Partial<CommandFilter>>(empty)

  const { data, isLoading } = useQuery({ queryKey: ['command-filters', page], queryFn: () => commandFilterApi.paging(page) })
  const { data: users } = useQuery({ queryKey: ['users-all'], queryFn: () => userApi.list() })
  const { data: assets } = useQuery({ queryKey: ['assets-all'], queryFn: () => assetApi.list() })

  const userOpts: Opt[] = useMemo(() => (users ?? []).map((u) => ({ value: u.id, label: u.nickname || u.username, sub: u.type === 'admin' ? '管理员' : '' })), [users])
  const assetOpts: Opt[] = useMemo(() => (assets ?? []).map((a) => ({ value: a.id, label: a.name, sub: `${a.protocol} ${a.ip}` })), [assets])

  const save = useMutation({
    mutationFn: (v: Partial<CommandFilter>) => (editing ? commandFilterApi.update(editing.id, v) : commandFilterApi.create(v)),
    onSuccess: () => { toast.success('已保存'); setOpen(false); qc.invalidateQueries({ queryKey: ['command-filters'] }) },
    onError: (e: any) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => commandFilterApi.remove(id),
    onSuccess: () => { toast.success('已删除'); qc.invalidateQueries({ queryKey: ['command-filters'] }) },
    onError: (e: any) => toast.error(e.message),
  })

  const openForm = (rec?: CommandFilter) => {
    setEditing(rec || null)
    setValues(rec ? { ...rec } : { ...empty })
    setOpen(true)
  }
  const set = (name: keyof CommandFilter, val: any) => setValues((cur) => ({ ...cur, [name]: val }))

  const submit = () => {
    if (!values.name?.trim()) return toast.warning('请输入规则名称')
    if (!values.pattern?.trim()) return toast.warning('请输入关键字或正则')
    save.mutate(values)
  }
  const onDelete = async (id: string) => {
    if (await confirm('确认删除该规则？', { danger: true, okText: '删除' })) remove.mutate(id)
  }

  const columns: Column<CommandFilter>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '动作', key: '__act', render: (_, r) => <Badge color={r.action === 'block' ? 'danger' : 'warning'}>{r.action === 'block' ? '拦截' : '告警'}</Badge> },
    { title: '规则', key: '__pat', render: (_, r) => <span><code style={{ fontSize: 12 }}>{r.pattern}</code>{r.regex && <Badge color="secondary" >正则</Badge>}</span> },
    { title: '范围', key: '__scope', render: (_, r) => (r.userIds?.length || r.assetIds?.length) ? `${r.userIds?.length || 0} 用户 · ${r.assetIds?.length || 0} 资产` : <span className="text-muted">全局</span> },
    { title: '优先级', dataIndex: 'priority', width: 80 },
    { title: '状态', key: '__en', render: (_, r) => <Badge color={r.enabled ? 'success' : 'secondary'}>{r.enabled ? '启用' : '停用'}</Badge> },
    {
      title: '操作',
      key: '__op',
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
        title="命令过滤"
        crumbs={['授权', '命令过滤']}
        extra={<button className="btn btn-primary" onClick={() => openForm()}><i className="bx bx-plus" /> 新增规则</button>}
      />
      <Card>
        <div className="alert alert-warning py-2 px-3 mb-3" style={{ fontSize: 13 }}>
          <i className="bx bx-info-circle me-1" />
          拦截在按回车时对整行命令生效（阻断=不下发到远端并清空当前行）；<b>全屏程序（vim/top/less 等）内自动豁免</b>；行还原为近似，属尽力而为，不能替代目标机自身的权限控制。
        </div>
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

      <Modal open={open} title={editing ? '编辑规则' : '新增规则'} onClose={() => setOpen(false)} onOk={submit} okLoading={save.isPending} width={760}>
        <div className="row gy-3">
          <Field col="col-md-6" label="规则名称" required>
            <TextInput value={values.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field col="col-md-3" label="动作" required>
            <Select
              options={[{ value: 'block', label: '拦截' }, { value: 'warn', label: '告警' }]}
              value={values.action ?? 'block'}
              onChange={(e) => set('action', e.target.value)}
            />
          </Field>
          <Field col="col-md-3" label="优先级" extra="数值小优先">
            <input type="number" className="form-control" value={values.priority ?? 100} onChange={(e) => set('priority', Number(e.target.value) || 0)} />
          </Field>
          <Field col="col-md-9" label="关键字 / 正则" required>
            <TextInput value={values.pattern ?? ''} onChange={(e) => set('pattern', e.target.value)} />
          </Field>
          <Field col="col-md-3" label="按正则解析">
            <div className="pt-1"><Switch checked={!!values.regex} onChange={(v) => set('regex', v)} label={values.regex ? '正则' : '字面量'} /></div>
          </Field>
          <Field col="col-md-3" label="启用">
            <div className="pt-1"><Switch checked={values.enabled ?? true} onChange={(v) => set('enabled', v)} label={values.enabled ? '已启用' : '已停用'} /></div>
          </Field>
          <Field col="col-md-6" label="限定用户（空=全局）">
            <MultiPicker title="用户" options={userOpts} value={values.userIds ?? []} onChange={(v) => set('userIds', v)} />
          </Field>
          <Field col="col-md-6" label="限定资产（空=全局）">
            <MultiPicker title="资产" options={assetOpts} value={values.assetIds ?? []} onChange={(v) => set('assetIds', v)} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
