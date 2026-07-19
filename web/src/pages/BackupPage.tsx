import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, Card, Field, TextInput, Password, Switch, DataTable, Badge, Empty, toast, type Column } from '../ui'
import { backupApi, type BackupConfig, type BackupRecord } from '../api/backup'

const fmtSize = (n: number) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : n >= 1 << 10 ? (n / (1 << 10)).toFixed(1) + ' KB' : n + ' B')

export default function BackupPage() {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['backup-config'], queryFn: backupApi.getConfig })
  const { data: history = [] } = useQuery({ queryKey: ['backup-history'], queryFn: backupApi.history, refetchInterval: 5000 })

  const [form, setForm] = useState<BackupConfig>({ endpoint: '', region: '', bucket: '', prefix: '', accessKey: '', useSSL: true })
  useEffect(() => { if (cfg) setForm({ ...cfg, secretKey: '', passphrase: '' }) }, [cfg])
  const set = <K extends keyof BackupConfig>(k: K, v: BackupConfig[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = useMutation({
    mutationFn: () => backupApi.saveConfig(form),
    onSuccess: () => { toast.success('配置已保存'); qc.invalidateQueries({ queryKey: ['backup-config'] }) },
    onError: (e: any) => toast.error(e.message),
  })
  const run = useMutation({
    mutationFn: backupApi.run,
    onSuccess: (r) => { toast.success(`备份完成：${r.objectKey}（${fmtSize(r.size)}）`); qc.invalidateQueries({ queryKey: ['backup-history'] }) },
    onError: (e: any) => toast.error('备份失败：' + e.message),
  })

  const cols: Column<BackupRecord>[] = [
    { title: '时间', key: 't', render: (_, r) => new Date(r.createdAt).toLocaleString() },
    { title: '对象', dataIndex: 'objectKey', render: (v: string) => <span className="text-truncate d-inline-block" style={{ maxWidth: 340 }} title={v}>{v}</span> },
    { title: '大小', key: 'sz', render: (_, r) => (r.size ? fmtSize(r.size) : '-') },
    { title: '状态', key: 'st', render: (_, r) => (r.status === 'success' ? <Badge color="success">成功</Badge> : <span title={r.message}><Badge color="danger">失败</Badge></span>) },
  ]

  return (
    <>
      <PageHeader title="加密备份" />
      <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>打包（数据库 + 会话录像）→ AES-256-GCM 加密 → 上传到 S3 兼容存储（S3 / R2 / B2 / MinIO）</p>

      <Card>
        <div className="row g-3" style={{ maxWidth: 860 }}>
          <div className="col-md-8">
            <Field label="Endpoint" required extra="如 s3.amazonaws.com、<账户>.r2.cloudflarestorage.com、127.0.0.1:9000（不含 http://）">
              <TextInput value={form.endpoint} placeholder="s3.amazonaws.com" onChange={(e) => set('endpoint', e.target.value)} />
            </Field>
          </div>
          <div className="col-md-4">
            <Field label="Region"><TextInput value={form.region} placeholder="us-east-1 / auto" onChange={(e) => set('region', e.target.value)} /></Field>
          </div>
          <div className="col-md-6">
            <Field label="Bucket" required><TextInput value={form.bucket} placeholder="my-backups" onChange={(e) => set('bucket', e.target.value)} /></Field>
          </div>
          <div className="col-md-6">
            <Field label="路径前缀" extra="对象键前缀（目录），可空"><TextInput value={form.prefix} placeholder="myssh" onChange={(e) => set('prefix', e.target.value)} /></Field>
          </div>
          <div className="col-md-6">
            <Field label="Access Key" required><TextInput value={form.accessKey} onChange={(e) => set('accessKey', e.target.value)} /></Field>
          </div>
          <div className="col-md-6">
            <Field label="Secret Key" required={!cfg?.secretKeySet} extra={cfg?.secretKeySet ? '已设置，留空则不修改' : undefined}>
              <Password value={form.secretKey ?? ''} placeholder={cfg?.secretKeySet ? '••••••（不改留空）' : ''} onChange={(e) => set('secretKey', e.target.value)} />
            </Field>
          </div>
          <div className="col-md-6">
            <Field label="备份加密口令" required={!cfg?.passphraseSet} extra="独立于服务端密钥；恢复时需要它，请妥善保管">
              <Password value={form.passphrase ?? ''} placeholder={cfg?.passphraseSet ? '••••••（不改留空）' : ''} onChange={(e) => set('passphrase', e.target.value)} />
            </Field>
          </div>
          <div className="col-md-6 d-flex align-items-end">
            <Switch label="使用 HTTPS (TLS)" checked={form.useSSL} onChange={(v: boolean) => set('useSSL', v)} />
          </div>
          <div className="col-12 d-flex gap-2">
            <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
              <i className="bx bx-save" /> 保存配置
            </button>
            <button className="btn btn-success" disabled={run.isPending} onClick={() => run.mutate()}>
              <i className={`bx ${run.isPending ? 'bx-loader-alt bx-spin' : 'bx-cloud-upload'}`} /> {run.isPending ? '备份中…' : '立即备份'}
            </button>
          </div>
        </div>
      </Card>

      <div className="mt-3">
        <Card title="备份历史">
          {history.length === 0 ? <Empty text="暂无备份记录" /> : <DataTable columns={cols} dataSource={history} rowKey="id" />}
        </Card>
      </div>
    </>
  )
}
