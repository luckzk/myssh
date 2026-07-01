import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { credentialApi, type Credential } from '../api/resource'
import {
  Card,
  PageHeader,
  DataTable,
  Modal,
  confirm,
  toast,
  Field,
  TextInput,
  Password,
  Textarea,
  Select,
  type Column,
} from '../ui'

// 凭证管理：列表 + 新增/编辑（type 切换 password / private-key）。
// 契约见 docs/recon/asset-credential.md。
export default function CredentialPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 10 })
  const [editing, setEditing] = useState<Credential | null>(null)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Partial<Credential>>({})

  const { data, isLoading } = useQuery({
    queryKey: ['credentials', page],
    queryFn: () => credentialApi.paging(page),
  })

  const save = useMutation({
    mutationFn: (v: Partial<Credential>) =>
      editing ? credentialApi.update(editing.id, v) : credentialApi.create(v),
    onSuccess: () => {
      toast.success('已保存')
      setOpen(false)
      qc.invalidateQueries({ queryKey: ['credentials'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => credentialApi.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['credentials'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openForm = (rec?: Credential) => {
    setEditing(rec || null)
    if (rec) {
      setValues({ ...rec, password: '', privateKey: '', passphrase: '' })
    } else {
      setValues({ type: 'password', name: '', username: '', description: '' })
    }
    setOpen(true)
  }

  const set = (name: keyof Credential, val: any) =>
    setValues((cur) => ({ ...cur, [name]: val }))

  const submit = () => {
    if (!values.name) {
      toast.warning('请输入名称')
      return
    }
    if (!values.type) {
      toast.warning('请选择类型')
      return
    }
    save.mutate(values)
  }

  const onDelete = async (id: string) => {
    if (await confirm('确认删除？', { danger: true, okText: '删除' })) {
      remove.mutate(id)
    }
  }

  const columns: Column<Credential>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'type' },
    { title: '用户名', dataIndex: 'username' },
    {
      title: '密码/私钥',
      key: '__secret',
      render: () => <span className="text-muted">••••••</span>,
    },
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
        title="凭证"
        crumbs={['资源管理', '凭证']}
        extra={
          <button className="btn btn-primary" onClick={() => openForm()}>
            <i className="bx bx-plus" /> 新增凭证
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

      <Modal
        open={open}
        title={editing ? '编辑凭证' : '新增凭证'}
        onClose={() => setOpen(false)}
        onOk={submit}
        okLoading={save.isPending}
        width={640}
      >
        <div className="row gy-3">
          <Field col="col-md-6" label="名称" required>
            <TextInput value={values.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field col="col-md-6" label="类型" required>
            <Select
              options={[
                { value: 'password', label: '密码' },
                { value: 'private-key', label: '密钥' },
              ]}
              value={values.type ?? 'password'}
              onChange={(e) => set('type', e.target.value)}
            />
          </Field>
          <Field col="col-md-6" label="用户名">
            <TextInput value={values.username ?? ''} onChange={(e) => set('username', e.target.value)} />
          </Field>
          {values.type === 'password' ? (
            <Field col="col-md-6" label="密码" extra={editing ? '留空则不修改' : undefined}>
              <Password value={values.password ?? ''} onChange={(e) => set('password', e.target.value)} />
            </Field>
          ) : (
            <>
              <Field col="col-md-6" label="私钥口令">
                <Password value={values.passphrase ?? ''} onChange={(e) => set('passphrase', e.target.value)} />
              </Field>
              <Field col="col-12" label="私钥" extra={editing ? '留空则不修改' : undefined}>
                <Textarea rows={4} value={values.privateKey ?? ''} onChange={(e) => set('privateKey', e.target.value)} />
              </Field>
            </>
          )}
          <Field col="col-12" label="备注">
            <Textarea rows={2} value={values.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
      </Modal>
    </>
  )
}
