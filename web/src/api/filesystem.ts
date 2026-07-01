import { api } from './client'
import type { Paging } from './resource'

// 契约见 docs/recon/filesystem.md（对齐上游 filesystem-api.ts）。
export interface FileInfo {
  name: string
  size: number
  modTime: number
  path: string
  mode: string
  isDir: boolean
  isLink: boolean
}

const G = '/access/filesystem'

export const fsApi = {
  ls: (sid: string, dir: string, hidden = false): Promise<FileInfo[]> =>
    api.get(`${G}/${sid}/ls?dir=${encodeURIComponent(dir)}&hiddenFileVisible=${hidden}`),
  rm: (sid: string, filename: string) =>
    api.post(`${G}/${sid}/rm?filename=${encodeURIComponent(filename)}`),
  mkdir: (sid: string, dir: string) =>
    api.post(`${G}/${sid}/mkdir?dir=${encodeURIComponent(dir)}`),
  touch: (sid: string, filename: string) =>
    api.post(`${G}/${sid}/touch?filename=${encodeURIComponent(filename)}`),
  stat: (sid: string, path: string): Promise<{ mode: string; owner: string; group: string; isDir: boolean }> =>
    api.get(`${G}/${sid}/stat?path=${encodeURIComponent(path)}`),
  chmod: (sid: string, p: { path: string; mode: string; owner?: string; recursive?: boolean }) =>
    api.post(
      `${G}/${sid}/chmod?path=${encodeURIComponent(p.path)}&mode=${p.mode}` +
        `&owner=${encodeURIComponent(p.owner ?? '')}&recursive=${p.recursive ? 'true' : 'false'}`,
    ),
  rename: (sid: string, oldName: string, newName: string) =>
    api.post(`${G}/${sid}/rename?oldName=${encodeURIComponent(oldName)}&newName=${encodeURIComponent(newName)}`),
  downloadUrl: (sid: string, filename: string) =>
    `/api${G}/${sid}/download?filename=${encodeURIComponent(filename)}`,
  previewUrl: (sid: string, filename: string) =>
    `/api${G}/${sid}/preview?filename=${encodeURIComponent(filename)}`,
  // 上传走 multipart，单独用 fetch
  upload: async (sid: string, dir: string, file: File): Promise<{ size: number }> => {
    const fd = new FormData()
    fd.append('file', file)
    const token = localStorage.getItem('X-Auth-Token') || ''
    const r = await fetch(`/api${G}/${sid}/upload?dir=${encodeURIComponent(dir)}`, {
      method: 'POST',
      headers: token ? { 'X-Auth-Token': token } : {},
      body: fd,
    })
    return r.json()
  },
}

// 文件审计日志
export interface FsLog {
  id: string
  sessionId: string
  userId: string
  assetId: string
  action: string
  path: string
  size: number
  createdAt: number
}

export const fsLogApi = {
  paging: (p: { pageIndex: number; pageSize: number }): Promise<Paging<FsLog>> =>
    api.get(`/admin/filesystem-logs/paging?pageIndex=${p.pageIndex}&pageSize=${p.pageSize}`),
}
