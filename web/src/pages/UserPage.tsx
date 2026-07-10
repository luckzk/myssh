import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { userApi, type User } from '../api/user'
import {
  Card,
  PageHeader,
  DataTable,
  Modal,
  Badge,
  confirm,
  toast,
  Field,
  TextInput,
  Password,
  Select,
  type Column,
} from '../ui'

const fmtTime = (t?: number) => (t ? new Date(t).toLocaleString() : '-')

// 用户管理：列表 + 新增/编辑（普通用户自动归入默认 user 角色，可连其被授权的资产）。
export default function UserPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 10 })
  const [editing, setEditing] = useState<User | null>(null)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Partial<User>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['users', page],
    queryFn: () => userApi.paging(page),
  })

  const save = useMutation({
    mutationFn: (v: Partial<User>) => (editing ? userApi.update(editing.id, v) : userApi.create(v)),
    onSuccess: () => {
      toast.success('已保存')
      setOpen(false)
      qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => userApi.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openForm = (rec?: User) => {
    setEditing(rec || null)
    if (rec) setValues({ ...rec, password: '' })
    else setValues({ type: 'user', status: '', username: '', nickname: '', password: '' })
    setOpen(true)
  }

  const set = (name: keyof User, val: any) => setValues((cur) => ({ ...cur, [name]: val }))

  const submit = () => {
    if (!values.username?.trim()) return toast.warning('请输入用户名')
    if (!editing && !values.password) return toast.warning('请输入初始密码')
    save.mutate(values)
  }

  const onDelete = async (id: string) => {
    if (await confirm('确认删除该用户？', { danger: true, okText: '删除' })) remove.mutate(id)
  }

  const columns: Column<User>[] = [
    { title: '用户名', dataIndex: 'username' },
    { title: '昵称', dataIndex: 'nickname' },
    {
      title: '类型',
      key: '__type',
      render: (_, r) => <Badge color={r.type === 'admin' ? 'primary' : 'secondary'}>{r.type === 'admin' ? '管理员' : '普通用户'}</Badge>,
    },
    {
      title: '状态',
      key: '__status',
      render: (_, r) => <Badge color={r.status === 'disabled' ? 'danger' : 'success'}>{r.status === 'disabled' ? '禁用' : '正常'}</Badge>,
    },
    { title: '最后登录', key: '__last', render: (_, r) => <span className="text-muted">{fmtTime(r.lastLoginAt)}</span> },
    {
      title: '操作',
      key: '__act',
      render: (_, rec) => (
        <div className="d-flex gap-2">
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
        title="用户"
        crumbs={['身份管理', '用户']}
        extra={
          <button className="btn btn-primary" onClick={() => openForm()}>
            <i className="bx bx-plus" /> 新增用户
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

      <Modal open={open} title={editing ? '编辑用户' : '新增用户'} onClose={() => setOpen(false)} onOk={submit} okLoading={save.isPending} width={640}>
        <div className="row gy-3">
          <Field col="col-md-6" label="用户名" required>
            <TextInput value={values.username ?? ''} disabled={!!editing} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field col="col-md-6" label="昵称">
            <TextInput value={values.nickname ?? ''} onChange={(e) => set('nickname', e.target.value)} />
          </Field>
          <Field col="col-md-6" label="类型" required>
            <Select
              options={[
                { value: 'user', label: '普通用户' },
                { value: 'admin', label: '管理员' },
              ]}
              value={values.type ?? 'user'}
              onChange={(e) => set('type', e.target.value)}
            />
          </Field>
          <Field col="col-md-6" label="状态">
            <Select
              options={[
                { value: '', label: '正常' },
                { value: 'disabled', label: '禁用' },
              ]}
              value={values.status ?? ''}
              onChange={(e) => set('status', e.target.value)}
            />
          </Field>
          <Field col="col-md-6" label="密码" required={!editing} extra={editing ? '留空则不修改' : undefined}>
            <Password value={values.password ?? ''} onChange={(e) => set('password', e.target.value)} />
          </Field>
          <Field col="col-md-6" label="邮箱">
            <TextInput value={values.mail ?? ''} onChange={(e) => set('mail', e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
