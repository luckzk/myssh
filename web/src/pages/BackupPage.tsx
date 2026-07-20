import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, Card, Modal, Field, TextInput, Switch, Select, DataTable, Badge, Empty, toast, confirm, prompt, type Column } from '../ui'
import { backupJobApi, backupApi, type BackupJob, type BackupRecord } from '../api/backup'
import { backupDestinationApi, type BackupDestination, type BackupObject } from '../api/backupDestination'

const fmtSize = (n: number) => (n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB' : n >= 1 << 10 ? (n / (1 << 10)).toFixed(1) + ' KB' : n + ' B')

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: '每天 03:00', value: '0 3 * * *' },
  { label: '每 6 小时', value: '0 */6 * * *' },
  { label: '每周日 04:00', value: '0 4 * * 0' },
  { label: '每月 1 号 03:00', value: '0 3 1 * *' },
]

const emptyJob: Partial<BackupJob> = { name: '', destinationId: '', contents: 'db,recordings', enabled: false, cron: '0 3 * * *' }
const hasContent = (csv: string, k: string) => csv.split(',').map((s) => s.trim()).includes(k)

export default function BackupPage() {
  const qc = useQueryClient()
  const { data: jobs = [] } = useQuery({ queryKey: ['backup-jobs'], queryFn: backupJobApi.list, refetchInterval: 5000 })
  const { data: dests = [] } = useQuery({ queryKey: ['backup-destinations'], queryFn: backupDestinationApi.list })
  const { data: history = [] } = useQuery({ queryKey: ['backup-history'], queryFn: backupApi.history, refetchInterval: 5000 })
  const destName = useMemo(() => Object.fromEntries(dests.map((d) => [d.id, d.name])), [dests])

  const [editing, setEditing] = useState<Partial<BackupJob> | null>(null)

  const save = useMutation({
    mutationFn: (j: Partial<BackupJob>) => (j.id ? backupJobApi.update(j.id, j) : backupJobApi.create(j)),
    onSuccess: () => { toast.success('已保存'); setEditing(null); qc.invalidateQueries({ queryKey: ['backup-jobs'] }) },
    onError: (e: any) => toast.error(e.message),
  })
  const del = useMutation({
    mutationFn: (id: string) => backupJobApi.remove(id),
    onSuccess: () => { toast.success('已删除'); qc.invalidateQueries({ queryKey: ['backup-jobs'] }) },
    onError: (e: any) => toast.error(e.message),
  })
  const run = useMutation({
    mutationFn: (id: string) => backupJobApi.run(id),
    onSuccess: (r) => { toast.success(`备份完成：${r.objectKey}（${fmtSize(r.size)}）`); qc.invalidateQueries({ queryKey: ['backup-history'] }); qc.invalidateQueries({ queryKey: ['backup-jobs'] }) },
    onError: (e: any) => toast.error('备份失败：' + e.message),
  })

  const onDelete = async (j: BackupJob) => {
    if (await confirm(`删除任务「${j.name}」？（不影响已生成的备份）`, { title: '删除', okText: '删除', danger: true })) del.mutate(j.id)
  }

  const contentBadges = (csv: string) => (
    <span className="d-inline-flex gap-1">
      {hasContent(csv, 'db') && <Badge color="primary">数据库</Badge>}
      {hasContent(csv, 'recordings') && <Badge color="secondary">录像</Badge>}
    </span>
  )

  const cols: Column<BackupJob>[] = [
    { title: '任务', dataIndex: 'name' },
    { title: '内容', key: 'contents', render: (_, r) => contentBadges(r.contents) },
    { title: '目标', key: 'dest', render: (_, r) => destName[r.destinationId] ?? <span className="text-danger">目标已删</span> },
    { title: '定时', key: 'cron', render: (_, r) => (r.enabled ? <code>{r.cron}</code> : <span className="text-muted">未启用</span>) },
    {
      title: '上次结果', key: 'last', render: (_, r) => (!r.lastRunAt ? <span className="text-muted">—</span> :
        <span title={r.lastMessage}>{r.lastStatus === 'success' ? <Badge color="success">成功</Badge> : <Badge color="danger">失败</Badge>} <span className="text-muted" style={{ fontSize: 12 }}>{new Date(r.lastRunAt).toLocaleString()}</span></span>),
    },
    {
      title: '操作', key: 'op', render: (_, r) => (
        <div className="d-flex gap-1">
          <button className="btn btn-sm btn-success" disabled={run.isPending} onClick={() => run.mutate(r.id)}><i className={`bx ${run.isPending ? 'bx-loader-alt bx-spin' : 'bx-cloud-upload'}`} /> 立即备份</button>
          <button className="btn btn-sm btn-light" onClick={() => setEditing({ ...r })}><i className="bx bx-edit" /> 编辑</button>
          <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(r)}><i className="bx bx-trash" /></button>
        </div>
      ),
    },
  ]

  const hisCols: Column<BackupRecord>[] = [
    { title: '时间', key: 't', render: (_, r) => new Date(r.createdAt).toLocaleString() },
    { title: '目标', key: 'dest', render: (_, r) => destName[r.destinationId] ?? '-' },
    { title: '对象', dataIndex: 'objectKey', render: (v: string) => <span className="text-truncate d-inline-block" style={{ maxWidth: 300 }} title={v}>{v}</span> },
    { title: '大小', key: 'sz', render: (_, r) => (r.size ? fmtSize(r.size) : '-') },
    { title: '状态', key: 'st', render: (_, r) => (r.status === 'success' ? <Badge color="success">成功</Badge> : <span title={r.message}><Badge color="danger">失败</Badge></span>) },
  ]

  return (
    <>
      <PageHeader title="备份" extra={<button className="btn btn-primary" disabled={dests.length === 0} onClick={() => setEditing({ ...emptyJob, destinationId: dests.find((d) => d.isDefault)?.id ?? dests[0]?.id ?? '' })}><i className="bx bx-plus" /> 新建任务</button>} />
      <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>备份任务 = 备份什么（数据库 / 录像）+ 何时（定时）+ 存到哪（备份目标）。目标在 <Link to="/backup-destination">资源管理 → 备份目标</Link> 维护。</p>

      <Card>
        {dests.length === 0 ? <Empty text="请先到「备份目标」新建一个目标" /> : jobs.length === 0 ? <Empty text="暂无备份任务，点右上角新建" /> : <DataTable columns={cols} dataSource={jobs} rowKey="id" />}
      </Card>

      <div className="mt-3"><RestoreSection dests={dests} destName={destName} /></div>

      <div className="mt-3">
        <Card title="备份历史">
          {history.length === 0 ? <Empty text="暂无备份记录" /> : <DataTable columns={hisCols} dataSource={history} rowKey="id" />}
        </Card>
      </div>

      {editing && <JobModal value={editing} dests={dests} pending={save.isPending} onCancel={() => setEditing(null)} onSave={(j) => save.mutate(j)} />}
    </>
  )
}

function JobModal({ value, dests, pending, onCancel, onSave }: {
  value: Partial<BackupJob>; dests: BackupDestination[]; pending: boolean
  onCancel: () => void; onSave: (j: Partial<BackupJob>) => void
}) {
  const [form, setForm] = useState<Partial<BackupJob>>(value)
  const set = <K extends keyof BackupJob>(k: K, v: BackupJob[K]) => setForm((f) => ({ ...f, [k]: v }))
  const toggleContent = (k: string, on: boolean) => {
    const cur = new Set((form.contents ?? '').split(',').map((s) => s.trim()).filter(Boolean))
    if (on) cur.add(k); else cur.delete(k)
    set('contents', Array.from(cur).join(','))
  }
  const isEdit = !!form.id

  return (
    <Modal open width={620} title={isEdit ? '编辑备份任务' : '新建备份任务'} onClose={onCancel}
      footer={<>
        <button className="btn btn-light" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" disabled={pending} onClick={() => onSave(form)}>保存</button>
      </>}>
      <Field label="① 任务名称" required><TextInput value={form.name ?? ''} placeholder="如：每日全量" onChange={(e) => set('name', e.target.value)} /></Field>

      <Field label="② 备份内容" required extra="至少选择一项">
        <div className="d-flex gap-4 mt-1">
          <Switch label="数据库" checked={hasContent(form.contents ?? '', 'db')} onChange={(v) => toggleContent('db', v)} />
          <Switch label="会话录像" checked={hasContent(form.contents ?? '', 'recordings')} onChange={(v) => toggleContent('recordings', v)} />
        </div>
      </Field>

      <Field label="③ 备份时间">
        <div className="d-flex align-items-center gap-3">
          <Switch label="启用定时" checked={!!form.enabled} onChange={(v) => set('enabled', v)} />
        </div>
        {form.enabled && <>
          <div className="mt-2"><TextInput value={form.cron ?? ''} placeholder="0 3 * * *" onChange={(e) => set('cron', e.target.value)} /></div>
          <div className="text-muted" style={{ fontSize: 12 }}>5 段：分 时 日 月 周（服务器本地时区）</div>
          <div className="d-flex flex-wrap gap-1 mt-1">
            {CRON_PRESETS.map((p) => <button key={p.value} type="button" className="btn btn-sm btn-light" onClick={() => set('cron', p.value)}>{p.label}</button>)}
          </div>
        </>}
      </Field>

      <Field label="④ 备份目标" required>
        <Select value={form.destinationId} options={dests.map((d) => ({ value: d.id, label: `${d.name}（${d.type === 'local' ? '本地' : 'S3'}）` }))} onChange={(e) => set('destinationId', e.target.value)} />
      </Field>
    </Modal>
  )
}

function RestoreSection({ dests, destName }: { dests: BackupDestination[]; destName: Record<string, string> }) {
  const [destId, setDestId] = useState('')
  const { data: objects = [], isFetching, refetch } = useQuery({
    queryKey: ['backup-objects', destId],
    queryFn: () => backupDestinationApi.objects(destId),
    enabled: false,
  })

  const restore = useMutation({
    mutationFn: ({ key, pass }: { key: string; pass?: string }) => backupApi.restore(destId, key, pass),
    onSuccess: (r) => toast.success(r.message || '恢复文件已就绪，重启后生效'),
    onError: (e: any) => toast.error('恢复失败：' + e.message),
  })

  const onRestore = async (key: string) => {
    if (!(await confirm(`确认用「${destName[destId]}」的备份「${key}」覆盖当前数据？恢复文件将在下次重启服务端时生效，现有数据会先备份为 .pre-restore-*。`, { title: '从备份恢复', okText: '恢复', danger: true }))) return
    // 后端默认用目标上保存的加密口令；如需用不同口令可让用户手填
    const pass = (await prompt('恢复口令（该目标已设则留空直接回车）', { placeholder: '留空=用目标口令', okText: '恢复' })) ?? undefined
    restore.mutate({ key, pass: pass || undefined })
  }

  const cols: Column<BackupObject>[] = [
    { title: '对象键', dataIndex: 'key', render: (v: string) => <span className="text-truncate d-inline-block" style={{ maxWidth: 360 }} title={v}>{v}</span> },
    { title: '大小', key: 'sz', render: (_, r) => fmtSize(r.size) },
    { title: '修改时间', key: 't', render: (_, r) => new Date(r.lastModified).toLocaleString() },
    {
      title: '操作', key: 'op', render: (_, r) => (
        <button className="btn btn-sm btn-outline-danger" disabled={restore.isPending} onClick={() => onRestore(r.key)}><i className="bx bx-reset" /> 恢复</button>
      ),
    },
  ]

  const extra = (
    <div className="d-flex gap-2 align-items-center">
      <Select value={destId} options={[{ value: '', label: '选择目标…' }, ...dests.map((d) => ({ value: d.id, label: d.name }))]} onChange={(e) => setDestId(e.target.value)} />
      <button className="btn btn-sm btn-light" disabled={!destId || isFetching} onClick={() => refetch()}>
        <i className={`bx ${isFetching ? 'bx-loader-alt bx-spin' : 'bx-refresh'}`} /> 列出备份
      </button>
    </div>
  )

  return (
    <Card title="从备份恢复" extra={extra}>
      <p className="text-muted" style={{ fontSize: 13 }}>选择一个目标 → 列出其中的备份 → 恢复。恢复为「暂存 + 重启生效」：现有数据库/录像会先改名为 <code>.pre-restore-*</code> 保底。</p>
      {!destId ? <Empty text="请先选择一个备份目标" /> : objects.length === 0 ? <Empty text="点「列出备份」加载对象（该目标可能暂无 .enc 备份）" /> : <DataTable columns={cols} dataSource={objects} rowKey="key" />}
    </Card>
  )
}
