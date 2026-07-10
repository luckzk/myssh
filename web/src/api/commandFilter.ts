import { api } from './client'
import type { Paging } from './resource'

export interface CommandFilter {
  id: string
  name: string
  enabled: boolean
  action: 'block' | 'warn'
  pattern: string
  regex: boolean
  priority: number
  userIds: string[]
  assetIds: string[]
  createdAt?: number
}

const qs = (p: Record<string, any>) =>
  Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')

export const commandFilterApi = {
  paging: (p: { pageIndex: number; pageSize: number; keyword?: string }): Promise<Paging<CommandFilter>> =>
    api.get(`/admin/command-filters/paging?${qs(p)}`),
  create: (data: Partial<CommandFilter>) => api.post('/admin/command-filters', data),
  update: (id: string, data: Partial<CommandFilter>) => api.put(`/admin/command-filters/${id}`, data),
  remove: (id: string) => api.delete(`/admin/command-filters/${id}`),
}
