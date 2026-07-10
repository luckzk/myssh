import { api } from './client'
import type { Paging } from './resource'

export interface User {
  id: string
  username: string
  nickname?: string
  type: 'admin' | 'user'
  status?: string // '' 正常 | disabled
  mail?: string
  phone?: string
  lastLoginAt?: number
  createdAt?: number
  password?: string // 仅写入
}

const qs = (p: Record<string, any>) =>
  Object.entries(p)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')

export const userApi = {
  paging: (p: { pageIndex: number; pageSize: number; keyword?: string }): Promise<Paging<User>> =>
    api.get(`/admin/users/paging?${qs(p)}`),
  list: (): Promise<User[]> => api.get('/admin/users'),
  create: (data: Partial<User>) => api.post('/admin/users', data),
  update: (id: string, data: Partial<User>) => api.put(`/admin/users/${id}`, data),
  remove: (id: string) => api.delete(`/admin/users/${id}`),
}
