import { Navigate, Route, Routes } from 'react-router-dom'
import { TOKEN_KEY } from './api/client'
import { MENU_META } from './menus'
import AuthLayout from './layouts/AuthLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import PlaceholderPage from './pages/PlaceholderPage'
import AssetPage from './pages/AssetPage'
import CredentialPage from './pages/CredentialPage'
import TerminalPage from './pages/TerminalPage'
import GraphicsPage from './pages/GraphicsPage'
import AccessWorkspace from './pages/access/AccessWorkspace'
import SettingPage from './pages/SettingPage'
import OfflineSessionPage from './pages/OfflineSessionPage'
import OnlineSessionPage from './pages/OnlineSessionPage'
import FileSystemLogPage from './pages/FileSystemLogPage'
import TerminalPlaybackPage from './pages/TerminalPlaybackPage'
import AgentGatewayPage from './pages/AgentGatewayPage'
import UserPage from './pages/UserPage'
import AuthorizationPage from './pages/AuthorizationPage'
import CommandFilterPage from './pages/CommandFilterPage'
import {
  SnippetPage,
  StoragePage,
  DatabaseAssetPage,
  CertificatePage,
  GatewayGroupPage,
  SshGatewayPage,
} from './pages/resource-modules'

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
  setting: SettingPage,
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem(TOKEN_KEY)
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* 终端工作台（多 tab，全屏独立） */}
      <Route
        path="/access"
        element={
          <RequireAuth>
            <AccessWorkspace />
          </RequireAuth>
        }
      />
      {/* 独立终端页（深链 / 只读观战链接） */}
      <Route
        path="/term/:assetId"
        element={
          <RequireAuth>
            <TerminalPage />
          </RequireAuth>
        }
      />
      {/* 图形会话（RDP/VNC），全屏独立页 */}
      <Route
        path="/graphics/:assetId"
        element={
          <RequireAuth>
            <GraphicsPage />
          </RequireAuth>
        }
      />
      {/* 终端录像回放，全屏独立页 */}
      <Route
        path="/terminal-playback"
        element={
          <RequireAuth>
            <TerminalPlaybackPage />
          </RequireAuth>
        }
      />
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
            <Route key={m.key} path={'/' + m.key} element={Impl ? <Impl /> : <PlaceholderPage />} />
          )
        })}
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
