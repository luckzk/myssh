import { api } from './client'

// 类型对齐 docs/recon/asset-credential.md。

export interface Paging<T> {
  items: T[]
  total: number
}

export interface Credential {
  id: string
  name: string
  type: 'password' | 'private-key'
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  description?: string
  createdAt?: number
}

export interface Asset {
  id: string
  name: string
  alias?: string
  logo?: string
  protocol: string
  ip: string
  port: number
  accountType: 'password' | 'private-key' | 'credential'
  credentialId?: string
  username?: string
  password?: string
  privateKey?: string
  passphrase?: string
  description?: string
  status?: string
  gatewayType?: string
  gatewayId?: string
  groupId?: string
  groupFullName?: string
  tags?: string[]
  os?: string
  distro?: string
  // 多层跳板 + 连接/初始化/代理/高级
  gatewayChain?: string[]
  timeout?: number
  heartbeat?: number
  defaultPath?: string
  initCommand?: string
  disableProxy?: boolean
  proxy?: string
  x11?: boolean
  x11Cookie?: string
  encoding?: string
  hostKeyAlgo?: string
  cipher?: string
  kex?: string
  createdAt?: number
  updatedAt?: number
}

// 资产分组树节点（对齐后端 asset_group.go 的 AntD TreeDataNode 结构）。
export interface GroupNode {
  key: string
  title: string
  icon?: string // boxicons 类名（空=默认 bx-folder）
  iconColor?: string // #hex（空=默认琥珀）
  children?: GroupNode[]
}

function qs(p: Record<string, any>) {
  return Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
}

export const credentialApi = {
  paging: (p: { pageIndex: number; pageSize: number }): Promise<Paging<Credential>> =>
    api.get(`/admin/credentials/paging?${qs(p)}`),
  create: (data: Partial<Credential>) => api.post('/admin/credentials', data),
  update: (id: string, data: Partial<Credential>) => api.put(`/admin/credentials/${id}`, data),
  remove: (id: string) => api.delete(`/admin/credentials/${id}`),
}

export const assetApi = {
  paging: (p: {
    pageIndex: number
    pageSize: number
    groupId?: string
    keyword?: string
    assetId?: string
  }): Promise<Paging<Asset>> => api.get(`/admin/assets/paging?${qs(p)}`),
  list: (): Promise<Asset[]> => api.get('/admin/assets'),
  test: (data: Partial<Asset>): Promise<{ ok: boolean; message: string }> => api.post('/admin/assets/test', data),
  create: (data: Partial<Asset>) => api.post('/admin/assets', data),
  update: (id: string, data: Partial<Asset>) => api.put(`/admin/assets/${id}`, data),
  remove: (id: string) => api.delete(`/admin/assets/${id}`),
}

// 资产分组树：取整棵 / 存整棵 / 删节点。
export const assetGroupApi = {
  tree: (): Promise<GroupNode[]> => api.get('/admin/assets/groups'),
  save: (tree: GroupNode[]) => api.put('/admin/assets/groups', tree),
  remove: (id: string) => api.delete(`/admin/assets/groups/${id}`),
}

// guacd 网关：选择/检测/自动安装。
export interface GuacdConfig {
  assetId: string
  host: string
  effectiveAddr: string
}
export interface GuacdInstallResult {
  ok?: boolean
  arch?: string
  dockerOK?: boolean
  output?: string
  message?: string
  archWarning?: string
}
// 站点信息（系统设置 → 站点信息）
export interface SiteSettings {
  name: string
  copyright: string
  icp: string
}
export const siteApi = {
  get: (): Promise<SiteSettings> => api.get('/admin/site-settings'),
  save: (data: SiteSettings) => api.put('/admin/site-settings', data),
}

// 会话保活设置（系统设置 → 会话保活），存 Setting KV，运行时生效、无需重启。
export interface SessionSettings {
  ttl: string        // 分离会话保活时长，如 "12h"
  scrollback: string // 回滚缓冲大小，如 "256k"
}
export const sessionSettingsApi = {
  get: (): Promise<SessionSettings> => api.get('/admin/session-settings'),
  save: (data: SessionSettings) => api.put('/admin/session-settings', data),
}

export const guacdApi = {
  config: (): Promise<GuacdConfig> => api.get('/admin/guacd/config'),
  select: (assetId: string) => api.post('/admin/guacd/select', { assetId }),
  check: (assetId: string): Promise<{ reachable: boolean; host: string; latencyMs?: number; error?: string }> =>
    api.post('/admin/guacd/check', { assetId }),
  install: (assetId: string): Promise<GuacdInstallResult> =>
    api.post('/admin/guacd/install', { assetId }),
}

export interface TrustedHostKey {
  id: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  publicKey: string
  previousFingerprint: string
  status: 'trusted' | 'pending' | 'revoked'
  createdBy: string
  createdAt: number
  updatedAt: number
  lastSeenAt: number
}

export const hostKeyApi = {
  paging: (p: { pageIndex: number; pageSize: number; status?: string; host?: string }): Promise<Paging<TrustedHostKey>> =>
    api.get(`/admin/host-keys/paging?${qs(p)}`),
  trust: (id: string) => api.post(`/admin/host-keys/${id}/trust`),
  revoke: (id: string) => api.post(`/admin/host-keys/${id}/revoke`),
}

export interface SecurityCheck {
  key: string
  title: string
  status: 'ok' | 'warning' | 'danger'
  message: string
  remediation: string
}

export interface SecuritySummary {
  env: string
  blocking: boolean
  checks: SecurityCheck[]
  updatedAt: number
}

export const securityApi = {
  checks: (): Promise<SecuritySummary> => api.get('/admin/security/checks'),
}
