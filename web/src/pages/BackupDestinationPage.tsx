import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, Card, Modal, Field, TextInput, Password, Switch, Select, DataTable, Badge, Empty, toast, confirm, type Column } from '../ui'
import { backupDestinationApi, type BackupDestination } from '../api/backupDestination'

const empty: Partial<BackupDestination> = {
  name: '', type: 's3', endpoint: '', region: '', bucket: '', prefix: '',
  accessKey: '', secretKey: '', useSSL: true, localPath: '', passphrase: '', isDefault: false,
}

export default function BackupDestinationPage() {
  const qc = useQueryClient()
  const { data: list = [] } = useQuery({ queryKey: ['backup-destinations'], queryFn: backupDestinationApi.list })
  const [editing, setEditing] = useState<Partial<BackupDestination> | null>(null)
  const isEdit = !!editing?.id

  const save = useMutation({
    mutationFn: (d: Partial<BackupDestination>) => (d.id ? backupDestinationApi.update(d.id, d) : backupDestinationApi.create(d)),
    onSuccess: () => { toast.success('已保存'); setEditing(null); qc.invalidateQueries({ queryKey: ['backup-destinations'] }) },
    onError: (e: any) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: (id: string) => backupDestinationApi.remove(id),
    onSuccess: () => { toast.success('已删除'); qc.invalidateQueries({ queryKey: ['backup-destinations'] }) },
    onError: (e: any) => toast.error(e.message),
  })
  const test = useMutation({
    mutationFn: (id: string) => backupDestinationApi.test(id),
    onSuccess: () => toast.success('连接正常'),
    onError: (e: any) => toast.error('连接失败：' + e.message),
  })

  const onDelete = async (d: BackupDestination) => {
    if (await confirm(`删除备份目标「${d.name}」？`, { title: '删除', okText: '删除', danger: true })) del.mutate(d.id)
  }

  const cols: Column<BackupDestination>[] = [
    { title: '名称', dataIndex: 'name', render: (v: string, r) => <span>{v}{r.isDefault && <Badge color="info" >默认</Badge>}</span> },
    { title: '类型', key: 'type', render: (_, r) => (r.type === 'local' ? <Badge color="secondary">本地</Badge> : <Badge color="primary">S3 兼容</Badge>) },
    { title: '位置', key: 'loc', render: (_, r) => <span className="text-truncate d-inline-block" style={{ maxWidth: 360 }} title={r.type === 'local' ? r.localPath : `${r.endpoint}/${r.bucket}`}>{r.type === 'local' ? r.localPath : `${r.endpoint}/${r.bucket}${r.prefix ? '/' + r.prefix : ''}`}</span> },
    {
      title: '操作', key: 'op', render: (_, r) => (
        <div className="d-flex gap-1">
          <button className="btn btn-sm btn-light" onClick={() => setEditing({ ...r, secretKey: '', passphrase: '' })}><i className="bx bx-edit" /> 编辑</button>
          <button className="btn btn-sm btn-light" disabled={test.isPending} onClick={() => test.mutate(r.id)}><i className="bx bx-plug" /> 测试</button>
          <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(r)}><i className="bx bx-trash" /></button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="备份目标" extra={<button className="btn btn-primary" onClick={() => setEditing({ ...empty })}><i className="bx bx-plus" /> 新建目标</button>} />
      <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>备份存放的地方：本地目录或 S3 兼容存储（S3 / R2 / B2 / MinIO）。备份统一 AES-256-GCM 加密，口令存在各目标上。</p>
      <Card>
        {list.length === 0 ? <Empty text="暂无备份目标，点右上角新建" /> : <DataTable columns={cols} dataSource={list} rowKey="id" />}
      </Card>

      {editing && <DestModal value={editing} isEdit={isEdit} pending={save.isPending} onCancel={() => setEditing(null)} onSave={(d) => save.mutate(d)} />}
    </>
  )
}

function DestModal({ value, isEdit, pending, onCancel, onSave }: {
  value: Partial<BackupDestination>; isEdit: boolean; pending: boolean
  onCancel: () => void; onSave: (d: Partial<BackupDestination>) => void
}) {
  const [form, setForm] = useState<Partial<BackupDestination>>(value)
  const set = <K extends keyof BackupDestination>(k: K, v: BackupDestination[K]) => setForm((f) => ({ ...f, [k]: v }))
  const isLocal = form.type === 'local'
  const secretPlaceholder = isEdit ? '••••••（不改留空）' : ''

  return (
    <Modal open width={640} title={isEdit ? '编辑备份目标' : '新建备份目标'} onClose={onCancel}
      footer={<>
        <button className="btn btn-light" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" disabled={pending} onClick={() => onSave(form)}>保存</button>
      </>}>
      <div className="row g-3">
        <div className="col-md-6">
          <Field label="名称" required><TextInput value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
        </div>
        <div className="col-md-6">
          <Field label="类型" required>
            <Select value={form.type} options={[{ value: 's3', label: 'S3 兼容存储' }, { value: 'local', label: '本地目录' }]} onChange={(e) => set('type', e.target.value as any)} />
          </Field>
        </div>

        {isLocal ? (
          <div className="col-12">
            <Field label="存储路径" required extra="服务端可写的绝对路径，如 /var/lib/nt-backups"><TextInput value={form.localPath ?? ''} placeholder="/var/lib/nt-backups" onChange={(e) => set('localPath', e.target.value)} /></Field>
          </div>
        ) : (
          <>
            <div className="col-md-8">
              <Field label="Endpoint" required extra="如 s3.amazonaws.com、<账户>.r2.cloudflarestorage.com、127.0.0.1:9000（不含 http://）"><TextInput value={form.endpoint ?? ''} placeholder="s3.amazonaws.com" onChange={(e) => set('endpoint', e.target.value)} /></Field>
            </div>
            <div className="col-md-4">
              <Field label="Region"><TextInput value={form.region ?? ''} placeholder="us-east-1 / auto" onChange={(e) => set('region', e.target.value)} /></Field>
            </div>
            <div className="col-md-6">
              <Field label="Bucket" required><TextInput value={form.bucket ?? ''} placeholder="my-backups" onChange={(e) => set('bucket', e.target.value)} /></Field>
            </div>
            <div className="col-md-6">
              <Field label="路径前缀" extra="对象键前缀（目录），可空"><TextInput value={form.prefix ?? ''} placeholder="myssh" onChange={(e) => set('prefix', e.target.value)} /></Field>
            </div>
            <div className="col-md-6">
              <Field label="Access Key" required><TextInput value={form.accessKey ?? ''} onChange={(e) => set('accessKey', e.target.value)} /></Field>
            </div>
            <div className="col-md-6">
              <Field label="Secret Key" required={!isEdit} extra={isEdit ? '已设置，留空则不修改' : undefined}>
                <Password value={form.secretKey ?? ''} placeholder={secretPlaceholder} onChange={(e) => set('secretKey', e.target.value)} />
              </Field>
            </div>
            <div className="col-md-6 d-flex align-items-end">
              <Switch label="使用 HTTPS (TLS)" checked={!!form.useSSL} onChange={(v) => set('useSSL', v)} />
            </div>
          </>
        )}

        <div className="col-md-6">
          <Field label="备份加密口令" required={!isEdit} extra="AES-256-GCM 口令；恢复时需要它，请妥善保管">
            <Password value={form.passphrase ?? ''} placeholder={secretPlaceholder} onChange={(e) => set('passphrase', e.target.value)} />
          </Field>
        </div>
        <div className="col-md-6 d-flex align-items-end">
          <Switch label="设为默认目标" checked={!!form.isDefault} onChange={(v) => set('isDefault', v)} />
        </div>
      </div>
    </Modal>
  )
}
