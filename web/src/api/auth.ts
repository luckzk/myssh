import { api } from './client'

// 类型对齐 docs/recon/auth.md 抓取到的真实响应结构。
export interface LoginStatus {
  status: 'Logged In' | 'Unlogged'
  passwordEnabled: boolean
  oidcEnabled: boolean
  webauthnEnabled: boolean
  wechatWorkEnabled: boolean
}

export interface Branding {
  name: string
  copyright: string
  version: string
  icp: string
  debug: boolean
  hiddenUpgrade: boolean
}

export interface MenuItem {
  key: string
  checked: boolean
}

export interface AccountInfo {
  id: string
  username: string
  nickname: string
  type: 'admin' | 'user'
  enabledTotp: boolean
  mfaEnabled: boolean
  roles: string[]
  language: string
  needChangePassword: boolean
  forceTotpEnabled: boolean
  menus: MenuItem[]
}

export interface LoginResult {
  needTotp: boolean
  token: string
}

export const authApi = {
  loginStatus: (): Promise<LoginStatus> => api.get('/login-status'),
  branding: (): Promise<Branding> => api.get('/branding'),
  login: (username: string, password: string): Promise<LoginResult> =>
    api.post('/login', { username, password }),
  logout: () => api.post('/logout'),
  accountInfo: (): Promise<AccountInfo> => api.get('/account/info'),
}
