import { useAtomValue } from 'jotai'
import { accountAtom } from '../store/atoms'
import { PageHeader } from '../ui'

// 仪表盘。真实统计端点待 S6 接入（/api/admin/dashboard/v2/*）。
export default function DashboardPage() {
  const account = useAtomValue(accountAtom)
  const visible = account?.menus.filter((m) => m.checked).length ?? 0

  const stats = [
    { label: '可见模块', value: visible, icon: 'bx-grid-alt', color: 'primary' },
    { label: '角色', value: account?.roles.join(', ') || '-', icon: 'bx-id-card', color: 'secondary' },
    { label: '在线会话', value: 0, icon: 'bx-broadcast', color: 'success' },
    { label: '资产', value: 0, icon: 'bx-server', color: 'warning' },
  ]

  return (
    <>
      <PageHeader title="仪表盘" crumbs={['首页', '仪表盘']} />
      <p className="text-muted">
        欢迎，{account?.nickname}（{account?.type}）。当前角色可见 {visible} 个菜单模块。
      </p>
      <div className="row">
        {stats.map((s) => (
          <div className="col-xxl-3 col-sm-6 mb-3" key={s.label}>
            <div className="card custom-card">
              <div className="card-body d-flex align-items-center justify-content-between">
                <div>
                  <span className="text-muted d-block mb-1">{s.label}</span>
                  <h4 className="fw-semibold mb-0">{s.value}</h4>
                </div>
                <span
                  className={`avatar avatar-lg bg-${s.color}-transparent text-${s.color} d-flex align-items-center justify-content-center`}
                  style={{ borderRadius: 12 }}
                >
                  <i className={`bx ${s.icon} fs-3`} />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
