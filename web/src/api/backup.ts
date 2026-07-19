import { api } from './client'

export interface BackupConfig {
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKey: string
  secretKey?: string
  passphrase?: string
  useSSL: boolean
  secretKeySet?: boolean
  passphraseSet?: boolean
}

export interface BackupRecord {
  id: string
  objectKey: string
  size: number
  status: string
  message: string
  createdAt: number
}

export const backupApi = {
  getConfig: (): Promise<BackupConfig> => api.get('/admin/backup/config'),
  saveConfig: (cfg: Partial<BackupConfig>): Promise<{ ok: boolean }> => api.put('/admin/backup/config', cfg),
  run: (): Promise<{ ok: boolean; objectKey: string; size: number }> => api.post('/admin/backup/run'),
  history: (): Promise<BackupRecord[]> => api.get('/admin/backup/history'),
}
