import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, Card, Empty, toast, DataTable, Badge, confirm, type Column } from '../ui'
import { hostKeyApi, securityApi, siteApi, sessionSettingsApi, type SiteSettings, type SessionSettings, type TrustedHostKey } from '../api/resource'
import TermPrefsForm from './access/TermPrefsForm'

// 系统设置：Ynex「Vertical Tab Style-1」(nav-pills tab-style-7) 左竖向标签 + 右内容。
const CATEGORIES = [
  { key: 'site', label: '站点信息', icon: 'bx-globe' },
  { key: 'access', label: '资产接入设置', icon: 'bx-terminal' },
  { key: 'session', label: '会话保活', icon: 'bx-time-five' },
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

function SessionPanel() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['session-settings'], queryFn: sessionSettingsApi.get })
  const [form, setForm] = useState<SessionSettings>({ ttl: '', scrollback: '' })
  useEffect(() => { if (data) setForm(data) }, [data])
  const save = useMutation({
    mutationFn: () => sessionSettingsApi.save(form),
    onSuccess: () => { toast.success('已保存，立即生效'); qc.invalidateQueries({ queryKey: ['session-settings'] }) },
    onError: (e: any) => toast.error(e.message),
  })
  return (
    <div className="row g-3" style={{ maxWidth: 620 }}>
      <p className="text-muted col-12 mb-0" style={{ fontSize: 13 }}>
        浏览器断开后，SSH 会话在服务器端保活，可换浏览器 / 重新登录后恢复（shell 状态不丢）。修改立即生效，无需重启。
      </p>
      <div className="col-md-6">
        <label className="form-label">分离会话保活时长</label>
        <input className="form-control" value={form.ttl} onChange={(e) => setForm({ ...form, ttl: e.target.value })} placeholder="12h" />
        <div className="form-text">无人连接超过该时长自动回收。示例：12h、90m、24h。</div>
      </div>
      <div className="col-md-6">
        <label className="form-label">回滚缓冲大小</label>
        <input className="form-control" value={form.scrollback} onChange={(e) => setForm({ ...form, scrollback: e.target.value })} placeholder="256k" />
        <div className="form-text">重新附着时回放的近期输出量。示例：256k、1m。</div>
      </div>
      <div className="col-12">
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>保存</button>
      </div>
    </div>
  )
}

function SecurityPanel() {
  const qc = useQueryClient()
  const checks = useQuery({
    queryKey: ['security-checks'],
    queryFn: securityApi.checks,
  })
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
      <div className="mb-4">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <div>
            <h6 className="fw-semibold mb-1">生产安全体检</h6>
            <p className="text-muted mb-0" style={{ fontSize: 13 }}>
              当前环境：{checks.data?.env ?? '-'}；生产模式会阻断危险默认配置。
            </p>
          </div>
          <button className="btn btn-sm btn-light" onClick={() => qc.invalidateQueries({ queryKey: ['security-checks'] })}>
            <i className="bx bx-refresh" /> 刷新
          </button>
        </div>
        <div className="row g-2">
          {(checks.data?.checks ?? []).map((item) => (
            <div className="col-md-6" key={item.key}>
              <div className="border rounded p-3 h-100" style={{ background: '#fff' }}>
                <div className="d-flex align-items-start gap-2">
                  <Badge color={item.status === 'ok' ? 'success' : item.status === 'warning' ? 'warning' : 'danger'}>
                    {item.status === 'ok' ? '通过' : item.status === 'warning' ? '注意' : '风险'}
                  </Badge>
                  <div style={{ minWidth: 0 }}>
                    <div className="fw-semibold">{item.title}</div>
                    <div className="text-muted mt-1" style={{ fontSize: 13 }}>{item.message}</div>
                    {item.status !== 'ok' && <div className="text-danger mt-2" style={{ fontSize: 12 }}>{item.remediation}</div>}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {checks.isLoading && <div className="col-12 text-muted">正在检查...</div>}
        </div>
      </div>

      <h6 className="fw-semibold mb-2">SSH HostKey 信任</h6>
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
            {cat === 'session' && <SessionPanel />}
            {cat === 'security' && <SecurityPanel />}
            {cat !== 'site' && cat !== 'access' && cat !== 'session' && cat !== 'security' && (
              <Empty text={`「${current.label}」规划中（对齐 demo 设置项，后端待接）`} />
            )}
          </div>
        </div>
      </Card>
    </>
  )
}
