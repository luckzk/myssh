import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { TOKEN_KEY } from './api/client'
import { MENU_META } from './menus'
import AuthLayout from './layouts/AuthLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import PlaceholderPage from './pages/PlaceholderPage'

// 重路由懒加载：xterm 终端 / guacamole 图形 / 工作台 / 各管理页不进主包，
// 按需下载。登录、面板、布局壳保持同步加载，保证首屏快。
const AccessWorkspace = lazy(() => import('./pages/access/AccessWorkspace'))
const TerminalPage = lazy(() => import('./pages/TerminalPage'))
const GraphicsPage = lazy(() => import('./pages/GraphicsPage'))
const TerminalPlaybackPage = lazy(() => import('./pages/TerminalPlaybackPage'))
const AssetPage = lazy(() => import('./pages/AssetPage'))
const CredentialPage = lazy(() => import('./pages/CredentialPage'))
const SettingPage = lazy(() => import('./pages/SettingPage'))
const OfflineSessionPage = lazy(() => import('./pages/OfflineSessionPage'))
const OnlineSessionPage = lazy(() => import('./pages/OnlineSessionPage'))
const FileSystemLogPage = lazy(() => import('./pages/FileSystemLogPage'))
const AgentGatewayPage = lazy(() => import('./pages/AgentGatewayPage'))
const UserPage = lazy(() => import('./pages/UserPage'))
const AuthorizationPage = lazy(() => import('./pages/AuthorizationPage'))
const CommandFilterPage = lazy(() => import('./pages/CommandFilterPage'))
const BackupPage = lazy(() => import('./pages/BackupPage'))
const SnippetPage = lazy(() => import('./pages/resource-modules').then((m) => ({ default: m.SnippetPage })))
const StoragePage = lazy(() => import('./pages/resource-modules').then((m) => ({ default: m.StoragePage })))
const DatabaseAssetPage = lazy(() => import('./pages/resource-modules').then((m) => ({ default: m.DatabaseAssetPage })))
const CertificatePage = lazy(() => import('./pages/resource-modules').then((m) => ({ default: m.CertificatePage })))
const GatewayGroupPage = lazy(() => import('./pages/resource-modules').then((m) => ({ default: m.GatewayGroupPage })))
const SshGatewayPage = lazy(() => import('./pages/resource-modules').then((m) => ({ default: m.SshGatewayPage })))

// 已实现真实页面的模块 key → 组件；其余走占位页。
const IMPLEMENTED: Record<string, React.ComponentType> = {
  asset: AssetPage,
  credential: CredentialPage,
  'online-session': OnlineSessionPage,
  'offline-session': OfflineSessionPage,
  'filesystem-log': FileSystemLogPage,
  snippet: SnippetPage,
  storage: StoragePage,
  'database-asset': DatabaseAssetPage,
  certificate: CertificatePage,
  'gateway-group': GatewayGroupPage,
  'ssh-gateway': SshGatewayPage,
  'agent-gateway': AgentGatewayPage,
  user: UserPage,
  'authorised-asset': AuthorizationPage,
  'command-filter': CommandFilterPage,
  backup: BackupPage,
  setting: SettingPage,
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? children : <Navigate to="/login" replace />
}

// 全屏路由加载态（深色，避免白屏闪烁）
const FullLoading = () => (
  <div style={{ height: '100vh', background: '#1E1F22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 13 }}>加载中…</div>
)
// 布局内容区加载态（侧边栏保留）
const ContentLoading = () => (
  <div style={{ padding: 40, textAlign: 'center', color: '#9aa1ac', fontSize: 13 }}>加载中…</div>
)
const full = (el: JSX.Element) => <Suspense fallback={<FullLoading />}>{el}</Suspense>
const content = (el: JSX.Element) => <Suspense fallback={<ContentLoading />}>{el}</Suspense>

export default function App() {
  // 登录态下空闲预取重 chunk（终端工作台/图形），提前进浏览器 HTTP 缓存（跨窗口共享），
  // 之后 window.open('/access') 或点连接时秒开。
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return
    const warm = () => {
      import('./pages/access/AccessWorkspace').catch(() => {})
      import('./pages/TerminalPage').catch(() => {})
    }
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: any) => number)
    const id = ric ? ric(warm, { timeout: 4000 }) : window.setTimeout(warm, 2500)
    return () => { if (ric && (window as any).cancelIdleCallback) (window as any).cancelIdleCallback(id); else clearTimeout(id) }
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* 终端工作台（多 tab，全屏独立） */}
      <Route path="/access" element={<RequireAuth>{full(<AccessWorkspace />)}</RequireAuth>} />
      {/* 独立终端页（深链 / 只读观战链接） */}
      <Route path="/term/:assetId" element={<RequireAuth>{full(<TerminalPage />)}</RequireAuth>} />
      {/* 图形会话（RDP/VNC），全屏独立页 */}
      <Route path="/graphics/:assetId" element={<RequireAuth>{full(<GraphicsPage />)}</RequireAuth>} />
      {/* 终端录像回放，全屏独立页 */}
      <Route path="/terminal-playback" element={<RequireAuth>{full(<TerminalPlaybackPage />)}</RequireAuth>} />
      <Route
        element={
          <RequireAuth>
            <AuthLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        {/* 已实现模块用真实页面，其余占位；路由 key 与菜单一致 */}
        {MENU_META.filter((m) => m.key !== 'dashboard').map((m) => {
          const Impl = IMPLEMENTED[m.key]
          return (
            <Route key={m.key} path={'/' + m.key} element={Impl ? content(<Impl />) : <PlaceholderPage />} />
          )
        })}
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
