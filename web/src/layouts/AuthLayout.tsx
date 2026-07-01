import { useMemo } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAtom } from 'jotai'
import { authApi } from '../api/auth'
import { accountAtom } from '../store/atoms'
import { GROUPS, MENU_META } from '../menus'
import { iconOf } from '../menu-icons'
import { TOKEN_KEY } from '../api/client'
import { Spinner } from '../ui'

// 顶级（无分组）菜单归到「主导航」分类。
const TOP_CATEGORY = '主导航'

// 鉴权布局：Ynex（Bootstrap 5）结构。侧边栏由 account/info 的 menus[].checked 动态渲染。
export default function AuthLayout() {
  const nav = useNavigate()
  const loc = useLocation()
  const [, setAccount] = useAtom(accountAtom)

  const { data: account, isLoading } = useQuery({
    queryKey: ['account'],
    queryFn: async () => {
      const a = await authApi.accountInfo()
      setAccount(a)
      return a
    },
  })

  // 组装：分类（主导航 + 各分组）→ 叶子项
  const sections = useMemo(() => {
    if (!account) return []
    const checked = new Set(account.menus.filter((m) => m.checked).map((m) => m.key))
    const top: { key: string; label: string }[] = []
    const groups: Record<string, { key: string; label: string }[]> = {}
    for (const m of MENU_META) {
      if (!checked.has(m.key)) continue
      if (m.group) (groups[m.group] ??= []).push({ key: m.key, label: m.label })
      else top.push({ key: m.key, label: m.label })
    }
    const out: { title: string; items: { key: string; label: string }[] }[] = []
    if (top.length) out.push({ title: TOP_CATEGORY, items: top })
    for (const gk of Object.keys(GROUPS)) {
      if (groups[gk]?.length) out.push({ title: GROUPS[gk], items: groups[gk] })
    }
    return out
  }, [account])

  const selected = loc.pathname.replace(/^\//, '') || 'dashboard'

  const logout = async () => {
    await authApi.logout().catch(() => {})
    localStorage.removeItem(TOKEN_KEY)
    nav('/login')
  }

  const toggleSidebar = () => {
    const el = document.documentElement
    el.setAttribute(
      'data-toggled',
      el.getAttribute('data-toggled') === 'open' ? 'close' : 'open',
    )
  }

  if (isLoading) {
    return (
      <div className="d-flex vh-100 align-items-center justify-content-center">
        <Spinner />
      </div>
    )
  }

  return (
    <>
      {/* ===== Header ===== */}
      <header className="app-header">
        <div className="main-header-container container-fluid">
          <div className="header-content-left">
            <div className="header-element">
              <a
                className="sidemenu-toggle header-link"
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  toggleSidebar()
                }}
              >
                <i className="bx bx-menu header-link-icon" />
              </a>
            </div>
            {/* 搜索框 */}
            <div className="header-element d-none d-md-block ms-2">
              <div className="input-group" style={{ width: 280 }}>
                <span className="input-group-text bg-transparent border-end-0">
                  <i className="bx bx-search-alt-2" />
                </span>
                <input
                  type="text"
                  className="form-control border-start-0 ps-0"
                  placeholder="搜索…"
                />
              </div>
            </div>
          </div>

          <div className="header-content-right">
            {/* 用户下拉 */}
            <div className="header-element dropdown">
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="header-link dropdown-toggle d-flex align-items-center gap-2"
                data-bs-toggle="dropdown"
                data-bs-auto-close="outside"
                aria-expanded="false"
              >
                <span
                  className="avatar avatar-sm avatar-rounded d-flex align-items-center justify-content-center text-white"
                  style={{ background: 'var(--primary-color)' }}
                >
                  <i className="bx bx-user" />
                </span>
                <span className="d-none d-sm-block fw-medium">{account?.nickname}</span>
              </a>
              <ul className="dropdown-menu dropdown-menu-end">
                <li>
                  <span className="dropdown-item-text text-muted small">
                    {account?.type}
                  </span>
                </li>
                <li>
                  <hr className="dropdown-divider" />
                </li>
                <li>
                  <a
                    className="dropdown-item d-flex align-items-center"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault()
                      logout()
                    }}
                  >
                    <i className="bx bx-log-out fs-16 me-2" />
                    退出登录
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </header>

      {/* ===== Sidebar ===== */}
      <aside className="app-sidebar sticky" id="sidebar">
        <div className="main-sidebar-header">
          <a href="#" onClick={(e) => e.preventDefault()} className="header-logo d-flex align-items-center gap-2 px-3">
            <span
              className="d-inline-flex align-items-center justify-content-center text-white fw-bold"
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                fontSize: 17,
                background: 'linear-gradient(135deg, #845ADF 0%, #6f42c1 100%)',
              }}
            >
              N
            </span>
            <span className="fw-semibold fs-16">Next Terminal</span>
          </a>
        </div>

        <div className="main-sidebar" id="sidebar-scroll">
          <nav className="main-menu-container nav nav-pills flex-column sub-open">
            <ul className="main-menu">
              {sections.map((sec) => (
                <li className="slide__category" key={sec.title}>
                  <span className="category-name">{sec.title}</span>
                  <ul className="list-unstyled mb-0">
                    {sec.items.map((it) => (
                      <li className="slide" key={it.key}>
                        <a
                          href="#"
                          className={`side-menu__item ${selected === it.key ? 'active' : ''}`}
                          onClick={(e) => {
                            e.preventDefault()
                            nav('/' + it.key)
                          }}
                        >
                          <i className={`bx ${iconOf(it.key)} side-menu__icon`} />
                          <span className="side-menu__label">{it.label}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </aside>

      {/* ===== Content ===== */}
      <div className="main-content app-content">
        <div className="container-fluid">
          <Outlet />
        </div>
      </div>
    </>
  )
}
