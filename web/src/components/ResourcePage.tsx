import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { makeCrud } from '../api/crud'
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
  Textarea,
  Select,
  Switch,
  type Column,
} from '../ui'

// 字段定义，驱动表单与表格列。
export interface FieldDef {
  name: string
  label: string
  type?: 'text' | 'textarea' | 'password' | 'number' | 'select' | 'switch' | 'tag'
  options?: { value: any; label: string }[]
  required?: boolean
  inTable?: boolean // 是否进表格列
  inForm?: boolean // 是否进表单（默认 true）
  render?: (v: any, rec: any) => any
}

interface Props {
  title: string
  group: string // 后端资源组，如 'snippets'
  fields: FieldDef[]
  queryKey: string
  crumbs?: string[]
}

// 通用资源管理页：列表 + 新增/编辑 + 删除，由 fields 配置驱动（Ynex/Bootstrap 版）。
export default function ResourcePage({ title, group, fields, queryKey, crumbs }: Props) {
  const crud = makeCrud<any>(group)
  const qc = useQueryClient()
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 10 })
  const [editing, setEditing] = useState<any>(null)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, any>>({})

  const { data, isLoading } = useQuery({
    queryKey: [queryKey, page],
    queryFn: () => crud.paging(page),
  })

  const save = useMutation({
    mutationFn: (v: any) => (editing ? crud.update(editing.id, v) : crud.create(v)),
    onSuccess: () => {
      toast.success('已保存')
      setOpen(false)
      qc.invalidateQueries({ queryKey: [queryKey] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => crud.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: [queryKey] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openForm = (rec?: any) => {
    setEditing(rec || null)
    const v: Record<string, any> = {}
    fields.forEach((f) => {
      if (rec) {
        v[f.name] = f.type === 'password' ? '' : rec[f.name]
      } else {
        v[f.name] = f.type === 'switch' ? false : f.type === 'select' ? f.options?.[0]?.value : ''
      }
    })
    setValues(v)
    setOpen(true)
  }

  const set = (name: string, val: any) => setValues((cur) => ({ ...cur, [name]: val }))

  const submit = () => {
    for (const f of fields) {
      if (f.inForm === false) continue
      if (f.required && (values[f.name] === '' || values[f.name] == null)) {
        toast.warning(`请输入${f.label}`)
        return
      }
    }
    save.mutate(values)
  }

  const onDelete = async (id: string) => {
    if (await confirm('确认删除该条记录？', { danger: true, okText: '删除' })) {
      remove.mutate(id)
    }
  }

  const columns: Column[] = fields
    .filter((f) => f.inTable !== false)
    .map((f) => ({
      title: f.label,
      dataIndex: f.name,
      render:
        f.render ||
        (f.type === 'switch'
          ? (v: boolean) =>
              v ? <Badge color="success">是</Badge> : <Badge color="secondary">否</Badge>
          : f.type === 'password'
            ? () => <span className="text-muted">••••••</span>
            : f.type === 'tag'
              ? (v: string) => v && <Badge>{v}</Badge>
              : undefined),
    }))

  columns.push({
    title: '操作',
    key: '__act',
    render: (_: any, rec: any) => (
      <div className="d-flex gap-2">
        <button className="btn btn-sm btn-light" onClick={() => openForm(rec)}>
          <i className="bx bx-edit-alt" /> 编辑
        </button>
        <button className="btn btn-sm btn-danger-light" onClick={() => onDelete(rec.id)}>
          <i className="bx bx-trash" /> 删除
        </button>
      </div>
    ),
  })

  const renderControl = (f: FieldDef) => {
    const common = {
      value: values[f.name] ?? '',
      onChange: (e: any) => set(f.name, e.target.value),
    }
    switch (f.type) {
      case 'textarea':
        return <Textarea {...common} />
      case 'password':
        return <Password value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} />
      case 'number':
        return <TextInput type="number" {...common} onChange={(e) => set(f.name, e.target.value === '' ? '' : Number(e.target.value))} />
      case 'select':
        return <Select options={f.options ?? []} value={values[f.name] ?? ''} onChange={(e) => set(f.name, e.target.value)} />
      case 'switch':
        return <Switch checked={!!values[f.name]} onChange={(v) => set(f.name, v)} />
      default:
        return <TextInput {...common} />
    }
  }

  return (
    <>
      <PageHeader
        title={title}
        crumbs={crumbs ?? ['资源管理', title]}
        extra={
          <button className="btn btn-primary" onClick={() => openForm()}>
            <i className="bx bx-plus" /> 新增
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
        title={editing ? `编辑${title}` : `新增${title}`}
        onClose={() => setOpen(false)}
        onOk={submit}
        okLoading={save.isPending}
        width={640}
      >
        {/* Ynex「Input Types」网格布局：双列响应式，文本域整行 */}
        <div className="row gy-3">
          {fields
            .filter((f) => f.inForm !== false)
            .map((f) => (
              <Field
                key={f.name}
                col={f.type === 'textarea' ? 'col-12' : 'col-md-6'}
                label={f.label}
                required={f.required}
                extra={f.type === 'password' && editing ? '留空则不修改' : undefined}
              >
                {renderControl(f)}
              </Field>
            ))}
        </div>
      </Modal>
    </>
  )
}
