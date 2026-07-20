import { api } from './client'

export interface BackupDestination {
  id: string
  name: string
  type: 'local' | 's3'
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKey: string
  secretKey?: string
  useSSL: boolean
  localPath: string
  passphrase?: string
  isDefault: boolean
  createdAt?: number
  updatedAt?: number
}

export interface BackupObject {
  key: string
  size: number
  lastModified: number
}

export const backupDestinationApi = {
  list: (): Promise<BackupDestination[]> => api.get('/admin/backup-destinations'),
  get: (id: string): Promise<BackupDestination> => api.get(`/admin/backup-destinations/${id}`),
  create: (d: Partial<BackupDestination>): Promise<{ id: string }> => api.post('/admin/backup-destinations', d),
  update: (id: string, d: Partial<BackupDestination>): Promise<{ id: string }> => api.put(`/admin/backup-destinations/${id}`, d),
  remove: (id: string): Promise<{ status: string }> => api.delete(`/admin/backup-destinations/${id}`),
  test: (id: string): Promise<{ ok: boolean }> => api.post(`/admin/backup-destinations/${id}/test`),
  objects: (id: string): Promise<BackupObject[]> => api.get(`/admin/backup-destinations/${id}/objects`),
}
