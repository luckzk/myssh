import { api } from './client'

export interface BackupJob {
  id: string
  name: string
  destinationId: string
  contents: string // CSV: db,recordings
  enabled: boolean
  cron: string
  lastRunAt?: number
  lastStatus?: string
  lastMessage?: string
  createdAt?: number
  updatedAt?: number
}

export interface BackupRecord {
  id: string
  jobId: string
  destinationId: string
  objectKey: string
  size: number
  status: string
  message: string
  createdAt: number
}

export const backupJobApi = {
  list: (): Promise<BackupJob[]> => api.get('/admin/backup-jobs'),
  get: (id: string): Promise<BackupJob> => api.get(`/admin/backup-jobs/${id}`),
  create: (j: Partial<BackupJob>): Promise<{ id: string }> => api.post('/admin/backup-jobs', j),
  update: (id: string, j: Partial<BackupJob>): Promise<{ id: string }> => api.put(`/admin/backup-jobs/${id}`, j),
  remove: (id: string): Promise<{ status: string }> => api.delete(`/admin/backup-jobs/${id}`),
  run: (id: string): Promise<{ ok: boolean; objectKey: string; size: number }> => api.post(`/admin/backup-jobs/${id}/run`),
}

export const backupApi = {
  history: (): Promise<BackupRecord[]> => api.get('/admin/backup/history'),
  restore: (destinationId: string, objectKey: string, passphrase?: string): Promise<{ ok: boolean; message: string }> =>
    api.post('/admin/backup/restore', { destinationId, objectKey, passphrase }),
}
