import { api } from './client'

// 终端工作台相关：监控统计 + 会话共享。
export interface HostStats {
  cpuPct: number
  memUsedKB: number
  memTotalKB: number
  memFreeKB: number
  memCacheKB: number
  memPct: number
  load: string
  diskUsedKB: number
  diskTotalKB: number
  diskPct: string
  netRxBps: number
  netTxBps: number
  uptimeSec: number
  host: string
  os: string
  arch: string
}

export interface PortForward {
  id: string
  sessionId: string
  userId: string
  username: string
  assetId: string
  assetName: string
  type: 'local' | 'remote' | 'dynamic'
  listenHost: string
  listenPort: number
  targetHost: string
  targetPort: number
  status: 'starting' | 'running' | 'stopped' | 'failed'
  error: string
  startedAt: number
  stoppedAt: number
  createdAt: number
}

export const accessApi = {
  stats: (sessionId: string): Promise<HostStats> =>
    api.get(`/access/stats?sessionId=${encodeURIComponent(sessionId)}`),
  share: (sessionId: string): Promise<{ token: string; url: string }> =>
    api.post(`/access/sessions/${sessionId}/share`),
  forwards: (sessionId: string): Promise<PortForward[]> =>
    api.get(`/access/forwards?sessionId=${encodeURIComponent(sessionId)}`),
  createForward: (p: {
    sessionId: string
    type: 'local' | 'remote' | 'dynamic'
    listenHost: string
    listenPort: number
    targetHost?: string
    targetPort?: number
  }): Promise<PortForward> => api.post('/access/forwards', p),
  stopForward: (id: string): Promise<{ status: string; stopped: boolean }> =>
    api.post(`/access/forwards/${id}/stop`),
}
