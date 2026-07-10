import { api } from './client'
import type { Paging } from './resource'

export interface Authorization {
  id: string
  name: string
  enabled: boolean
  userIds: string[]
  assetIds: string[]
  assetGroupIds: string[]
  createdAt?: number
}

const qs = (p: Record<string, any>) =>
  Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')

export const authorizationApi = {
  paging: (p: { pageIndex: number; pageSize: number; keyword?: string }): Promise<Paging<Authorization>> =>
    api.get(`/admin/authorizations/paging?${qs(p)}`),
  create: (data: Partial<Authorization>) => api.post('/admin/authorizations', data),
  update: (id: string, data: Partial<Authorization>) => api.put(`/admin/authorizations/${id}`, data),
  remove: (id: string) => api.delete(`/admin/authorizations/${id}`),
}
