import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, Card, Empty, toast, DataTable, Badge, confirm, type Column } from '../ui'
import { hostKeyApi, siteApi, type SiteSettings, type TrustedHostKey } from '../api/resource'
import TermPrefsForm from './access/TermPrefsForm'

// 系统设置：Ynex「Vertical Tab Style-1」(nav-pills tab-style-7) 左竖向标签 + 右内容。
const CATEGORIES = [
  { key: 'site', label: '站点信息', icon: 'bx-globe' },
  { key: 'access', label: '资产接入设置', icon: 'bx-terminal' },
  { key: 'security', label: '安全设置', icon: 'bx-shield' },
  { key: 'notify', label: '通知与集成', icon: 'bx-bell' },
  { key: 'log', label: '日志保留设置', icon: 'bx-history' },
  { key: 'maintenance', label: '系统维护', icon: 'bx-wrench' },
]

function SitePanel() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['site-settings'], queryFn: siteApi.get })
  const [form, setForm] = useState<SiteSettings>({ name: '', copyright: '', icp: '' })
  useEffect(() => { if (data) setForm(data) }, [data])
  const save = useMutation({
    mutationFn: () => siteApi.save(form),
    onSuccess: () => { toast.success('已保存'); qc.invalidateQueries({ queryKey: ['site-settings'] }) },
    onError: (e: any) => toast.error(e.message),
  })
  return (
    <div className="row g-3" style={{ maxWidth: 720 }}>
      <div className="col-md-6">
        <label className="form-label">系统名称</label>
        <input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="NEXT TERMINAL" />
      </div>
      <div className="col-md-6">
        <label className="form-label">ICP 备案号</label>
        <input className="form-control" value={form.icp} onChange={(e) => setForm({ ...form, icp: e.target.value })} />
      </div>
      <div className="col-12">
        <label className="form-label">版权信息</label>
        <input className="form-control" value={form.copyright} onChange={(e) => setForm({ ...form, copyright: e.target.value })} />
      </div>
      <div className="col-12">
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>保存</button>
      </div>
    </div>
  )
}

function SecurityPanel() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['host-keys'],
    queryFn: () => hostKeyApi.paging({ pageIndex: 1, pageSize: 100 }),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['host-keys'] })
  const trust = useMutation({
    mutationFn: hostKeyApi.trust,
    onSuccess: () => { toast.success('已信任主机密钥'); refresh() },
    onError: (e: any) => toast.error(e.message),
  })
  const revoke = useMutation({
    mutationFn: hostKeyApi.revoke,
    onSuccess: () => { toast.success('已撤销'); refresh() },
    onError: (e: any) => toast.error(e.message),
  })
  const onTrust = async (id: string) => {
    if (await confirm('确认信任该主机密钥？HostKey 变化可能意味着目标重装，也可能是中间人风险。')) trust.mutate(id)
  }
  const onRevoke = async (id: string) => {
    if (await confirm('确认撤销该主机密钥？后续连接会重新进入首次信任或变更确认流程。', { danger: true, okText: '撤销' })) revoke.mutate(id)
  }
  const cols: Column<TrustedHostKey>[] = [
    { title: '主机', render: (_, r) => `${r.host}:${r.port}` },
    { title: '算法', dataIndex: 'keyType', width: 110 },
    { title: '指纹', dataIndex: 'fingerprint', render: (v) => <code style={{ fontSize: 12 }}>{v}</code> },
    { title: '状态', dataIndex: 'status', width: 100, render: (v) => <Badge color={v === 'trusted' ? 'success' : v === 'pending' ? 'warning' : 'secondary'}>{v}</Badge> },
    { title: '上次指纹', dataIndex: 'previousFingerprint', render: (v) => v ? <code style={{ fontSize: 12 }}>{v}</code> : '-' },
    {
      title: '操作',
      width: 150,
      render: (_, r) => (
        <div className="d-flex gap-1">
          {r.status !== 'trusted' && <button className="btn btn-sm btn-primary-light" onClick={() => onTrust(r.id)}>信任</button>}
          {r.status !== 'revoked' && <button className="btn btn-sm btn-danger-light" onClick={() => onRevoke(r.id)}>撤销</button>}
        </div>
      ),
    },
  ]
  return (
    <div>
      <p className="text-muted" style={{ fontSize: 13 }}>
        SSH HostKey 默认使用 TOFU：首次连接自动信任，后续指纹变化会阻断连接并在这里进入待确认状态。
      </p>
      <DataTable columns={cols} dataSource={data?.items ?? []} loading={isLoading} size="sm" />
    </div>
  )
}

export default function SettingPage() {
  const [cat, setCat] = useState('site')
  const current = CATEGORIES.find((c) => c.key === cat)!

  return (
    <>
      <PageHeader title="系统设置" crumbs={['系统', '设置']} />
      <Card>
        <div className="d-flex align-items-stretch" style={{ minHeight: 320 }}>
          {/* 左竖向标签（Vertical Tab Style-1 = nav-pills tab-style-7）+ 竖线分隔 */}
          <div className="nav flex-column nav-pills tab-style-7 border-end pe-3" role="tablist" aria-orientation="vertical" style={{ minWidth: 168, flexShrink: 0 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                className={`nav-link text-start ${cat === c.key ? 'active' : ''}`}
                type="button"
                role="tab"
                onClick={() => setCat(c.key)}
              >
                <i className={`bx ${c.icon} me-1 align-middle`} />
                {c.label}
              </button>
            ))}
          </div>

          {/* 右内容 */}
          <div className="tab-content flex-grow-1 ps-3" style={{ minWidth: 0 }}>
            <h6 className="fw-semibold mb-3 pb-2 border-bottom">{current.label}</h6>
            {cat === 'site' && <SitePanel />}
            {cat === 'access' && (
              <div style={{ maxWidth: 440 }}>
                <p className="text-muted" style={{ fontSize: 13 }}>这些偏好同样可在终端工作台内的「终端设置」实时调整。</p>
                <TermPrefsForm />
              </div>
            )}
            {cat === 'security' && <SecurityPanel />}
            {cat !== 'site' && cat !== 'access' && cat !== 'security' && (
              <Empty text={`「${current.label}」规划中（对齐 demo 设置项，后端待接）`} />
            )}
          </div>
        </div>
      </Card>
    </>
  )
}
