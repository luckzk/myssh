import { api } from './client'
import type { Paging } from './resource'

// 通用资源 API 工厂，对齐上游 Api<T>：/admin/{group}/paging 等。
export function makeCrud<T extends { id?: string }>(group: string) {
  return {
    paging: (p: { pageIndex: number; pageSize: number; name?: string }): Promise<Paging<T>> => {
      const q = Object.entries(p)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v as any)}`)
        .join('&')
      return api.get(`/admin/${group}/paging?${q}`)
    },
    create: (data: Partial<T>) => api.post(`/admin/${group}`, data),
    update: (id: string, data: Partial<T>) => api.put(`/admin/${group}/${id}`, data),
    remove: (id: string) => api.delete(`/admin/${group}/${id}`),
  }
}
