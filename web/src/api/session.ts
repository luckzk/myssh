import { api } from './client'
import type { Paging } from './resource'

// 契约见 docs/recon/playback.md（对齐上游 session-api.ts）。
export interface Session {
  id: string
  protocol: string
  ip: string
  port: number
  username: string
  assetId: string
  assetName: string
  userId: string
  clientIp: string
  status: string
  connectedAt: number
  disconnectedAt: number
  recording: string
  recordingSize: number
  commandCount: number
}

export interface SessionCommand {
  id: string
  sessionId: string
  riskLevel: number
  command: string
  result: string
  createdAt: number
}

function qs(p: Record<string, any>) {
  return Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
}

export const sessionApi = {
  paging: (p: { pageIndex: number; pageSize: number; status?: string; protocol?: string }): Promise<Paging<Session>> =>
    api.get(`/admin/sessions/paging?${qs(p)}`),
  get: (id: string): Promise<Session> => api.get(`/admin/sessions/${id}`),
  disconnect: (id: string) => api.post(`/admin/sessions/${id}/disconnect`),
  watch: (id: string): Promise<{ token: string; url: string }> => api.get(`/admin/sessions/${id}/watch`),
  clear: () => api.post('/admin/sessions/clear'),
  // 录像 URL 给 asciinema-player 直接消费
  recordingUrl: (id: string) => `/api/admin/sessions/${id}/recording`,
  commands: (sessionId: string): Promise<Paging<SessionCommand>> =>
    api.get(`/admin/session-commands/paging?${qs({ pageIndex: 1, pageSize: 1000, sessionId })}`),
}
