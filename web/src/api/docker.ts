import { api, TOKEN_KEY } from './client'

// 资产级 Docker 管理 API（不依赖已打开的终端会话，按 assetId 鉴权）。

export interface DockerOverview {
  serverVersion: string
  containers: number
  running: number
  stopped: number
  images: number
  volumes: number
  networks: number
  driver: string
  os: string
  arch: string
  ncpu: number
  memTotalKB: number
}
export interface DockerContainer {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
  createdAt: string
  cpu: string
  memUsage: string
  memPct: number
}
export interface DockerImage {
  id: string
  repo: string
  tag: string
  size: string
  created: string
}
export interface DockerNetwork {
  id: string
  name: string
  driver: string
}
export interface DockerVolume {
  name: string
  driver: string
}

export interface DockerDfRow {
  type: string
  total: string
  active: string
  size: string
  reclaimable: string
}
export interface ComposeProject {
  name: string
  status: string
  configFiles: string
}
export interface FsEntry {
  name: string
  isDir: boolean
  isLink: boolean
  size: string
  mode: string
}
export interface RunReq {
  image: string
  name?: string
  ports?: string[]
  envs?: string[]
  volumes?: string[]
  restart?: string
  command?: string
}

export type DockerObjType = 'container' | 'image' | 'volume' | 'network' | 'system' | 'builder'
export type DockerAction =
  | 'start' | 'stop' | 'restart' | 'kill' | 'pause' | 'unpause' | 'rm' | 'rename' | 'create' | 'prune'

export interface DockerActionReq {
  type: DockerObjType
  action: DockerAction
  id?: string
  name?: string
}

export const dockerApi = {
  overview: (assetId: string): Promise<{ available: boolean; daemonOk?: boolean; reason?: string; info?: DockerOverview }> =>
    api.get(`/access/docker/${assetId}/overview`),
  containers: (assetId: string): Promise<{ available: boolean; containers?: DockerContainer[] }> =>
    api.get(`/access/docker/${assetId}/containers`),
  images: (assetId: string): Promise<{ available: boolean; images?: DockerImage[] }> =>
    api.get(`/access/docker/${assetId}/images`),
  networks: (assetId: string): Promise<{ available: boolean; networks?: DockerNetwork[] }> =>
    api.get(`/access/docker/${assetId}/networks`),
  volumes: (assetId: string): Promise<{ available: boolean; volumes?: DockerVolume[] }> =>
    api.get(`/access/docker/${assetId}/volumes`),
  inspect: (assetId: string, id: string): Promise<{ available: boolean; inspect?: any; raw?: string }> =>
    api.get(`/access/docker/${assetId}/inspect?id=${encodeURIComponent(id)}`),
  action: (assetId: string, body: DockerActionReq): Promise<{ ok: boolean; output?: string }> =>
    api.post(`/access/docker/${assetId}/action`, body),
  df: (assetId: string): Promise<{ available: boolean; usage?: DockerDfRow[] }> =>
    api.get(`/access/docker/${assetId}/df`),
  run: (assetId: string, body: RunReq): Promise<{ ok: boolean; output?: string }> =>
    api.post(`/access/docker/${assetId}/run`, body),
  compose: (assetId: string): Promise<{ available: boolean; projects?: ComposeProject[] }> =>
    api.get(`/access/docker/${assetId}/compose`),
  composeAction: (assetId: string, body: { configFile: string; action: 'up' | 'down' | 'restart' }): Promise<{ ok: boolean; output?: string }> =>
    api.post(`/access/docker/${assetId}/compose/action`, body),
  composeFile: (assetId: string, path: string): Promise<{ content: string }> =>
    api.get(`/access/docker/${assetId}/compose/file?path=${encodeURIComponent(path)}`),
  fsLs: (assetId: string, id: string, path: string): Promise<{ available: boolean; path: string; entries?: FsEntry[] }> =>
    api.get(`/access/docker/${assetId}/fs/ls?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`),
  fsRead: (assetId: string, id: string, path: string): Promise<{ content: string }> =>
    api.get(`/access/docker/${assetId}/fs/read?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`),
  fsDownloadUrl: (assetId: string, id: string, path: string): string => {
    const token = localStorage.getItem(TOKEN_KEY) || ''
    const qs = new URLSearchParams({ id, path, token }).toString()
    return `/api/access/docker/${encodeURIComponent(assetId)}/fs/download?${qs}`
  },
}

// Phase 2：流式端点 WS URL 构造器（logs / exec / pull）。token 走 query（浏览器 WS 无法设自定义头）。
export function dockerWsUrl(assetId: string, kind: 'logs' | 'exec' | 'pull', params: Record<string, string | number>): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const token = localStorage.getItem(TOKEN_KEY) || ''
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), token }).toString()
  return `${proto}://${location.host}/api/access/docker/${encodeURIComponent(assetId)}/${kind}?${qs}`
}
