import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fsApi, type FileInfo } from '../api/filesystem'
import { Drawer, Spinner, Empty, confirm, toast } from '../ui'
import PermissionDialog from './access/PermissionDialog'

const fmtSize = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)}M` : n > 1024 ? `${(n / 1024).toFixed(1)}K` : `${n}B`

const BOOKMARK_KEY = 'nt-sftp-bookmarks'
const isTextEditable = (name: string) =>
  /\.(txt|log|conf|cfg|ini|json|ya?ml|xml|md|sh|bash|zsh|sql|env|properties|go|ts|tsx|js|jsx|css|html|py|rb|php|java|c|cc|cpp|h|hpp)$/i.test(name)

function loadBookmarks(): string[] {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveBookmarks(items: string[]) {
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(items))
}

// 单个文件/目录节点：目录可懒加载展开（每个目录独立 useQuery 缓存）。
function FsNode({
  sid,
  file,
  depth,
  selectedDir,
  onSelectDir,
  onChanged,
  onCtx,
  onPreview,
  onEdit,
}: {
  sid: string
  file: FileInfo
  depth: number
  selectedDir: string
  onSelectDir: (dir: string) => void
  onChanged: () => void
  onCtx: (file: FileInfo, e: React.MouseEvent) => void
  onPreview: (file: FileInfo) => void
  onEdit: (file: FileInfo) => void
}) {
  const [open, setOpen] = useState(false)
  const isDir = file.isDir
  const { data: children, isLoading } = useQuery({
    queryKey: ['fs', sid, file.path],
    queryFn: () => fsApi.ls(sid, file.path),
    enabled: isDir && open,
  })

  const del = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!(await confirm(`删除 ${file.name}？`, { danger: true, okText: '删除' }))) return
    try {
      await fsApi.rm(sid, file.path)
      toast.success('已删除')
      onChanged()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const onClick = () => {
    if (isDir) {
      setOpen((o) => !o)
      onSelectDir(file.path)
    }
  }

  const selected = isDir && selectedDir === file.path
  return (
    <div>
      <div
        className="fs-node d-flex align-items-center"
        style={{
          paddingLeft: 8 + depth * 14,
          background: selected ? '#34363a' : undefined,
          cursor: isDir ? 'pointer' : 'default',
        }}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault()
          onCtx(file, e)
        }}
      >
        {isDir ? (
          <i className={`bx ${open ? 'bx-chevron-down' : 'bx-chevron-right'}`} style={{ width: 16, color: '#9ca3af' }} />
        ) : (
          <span style={{ width: 16, display: 'inline-block' }} />
        )}
        <i className={`bx ${isDir ? 'bxs-folder' : 'bx-file-blank'} me-1`} style={{ color: isDir ? '#e0a23b' : '#7f8c9b' }} />
        <span className="flex-grow-1 text-truncate" style={{ fontSize: 13 }}>
          {file.name}
          {file.isLink && <span className="badge bg-secondary-transparent text-secondary ms-1">link</span>}
        </span>
        {!isDir && (
          <span className="fs-actions d-flex align-items-center gap-2 pe-2">
            <span className="text-muted" style={{ fontSize: 11 }}>{fmtSize(file.size)}</span>
            <button className="btn btn-link p-0 text-info" title="预览" onClick={(e) => { e.stopPropagation(); onPreview(file) }}>
              <i className="bx bx-show" />
            </button>
            {isTextEditable(file.name) && (
              <button className="btn btn-link p-0 text-warning" title="编辑" onClick={(e) => { e.stopPropagation(); onEdit(file) }}>
                <i className="bx bx-edit" />
              </button>
            )}
            <a href={fsApi.downloadUrl(sid, file.path)} target="_blank" rel="noreferrer" title="下载" onClick={(e) => e.stopPropagation()}>
              <i className="bx bx-download" />
            </a>
            <a href="#" className="text-danger" title="删除" onClick={del}>
              <i className="bx bx-trash" />
            </a>
          </span>
        )}
      </div>
      {isDir && open && (
        <div>
          {isLoading ? (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
              <span className="spinner-border spinner-border-sm text-secondary my-1" />
            </div>
          ) : (
            (children ?? []).map((c) => (
              <FsNode key={c.path} sid={sid} file={c} depth={depth + 1} selectedDir={selectedDir} onSelectDir={onSelectDir} onChanged={onChanged} onCtx={onCtx} onPreview={onPreview} onEdit={onEdit} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// 文件管理：暗色懒加载文件树（对齐 demo）。上传/新建目录作用于「当前选中目录」。
export default function FileManager({ sessionId, open, onClose }: { sessionId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [selectedDir, setSelectedDir] = useState('.')
  const [creating, setCreating] = useState<null | 'dir' | 'file'>(null)
  const [newName, setNewName] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; file: FileInfo } | null>(null)
  const [permFile, setPermFile] = useState<FileInfo | null>(null)
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null)
  const [editFile, setEditFile] = useState<FileInfo | null>(null)
  const [editContent, setEditContent] = useState('')
  const [bookmarks, setBookmarks] = useState<string[]>(() => loadBookmarks())
  const [queue, setQueue] = useState<{ id: string; name: string; status: 'queued' | 'uploading' | 'done' | 'error'; error?: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => saveBookmarks(bookmarks), [bookmarks])

  const onCtx = (file: FileInfo, e: React.MouseEvent) => setMenu({ x: e.clientX, y: e.clientY, file })

  const delFromMenu = async (f: FileInfo) => {
    if (!(await confirm(`删除 ${f.name}？`, { danger: true, okText: '删除' }))) return
    try {
      await fsApi.rm(sessionId, f.path)
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['fs', sessionId] })
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const { data: roots, isLoading } = useQuery({
    queryKey: ['fs', sessionId, '.'],
    queryFn: () => fsApi.ls(sessionId, '.'),
    enabled: open && !!sessionId,
  })
  const { data: selectedEntries, isLoading: selectedLoading } = useQuery({
    queryKey: ['fs', sessionId, selectedDir],
    queryFn: () => fsApi.ls(sessionId, selectedDir),
    enabled: open && !!sessionId && selectedDir !== '.',
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['fs', sessionId] })

  const openEditor = async (file: FileInfo) => {
    if (!isTextEditable(file.name) && !(await confirm('该文件类型不在常见文本列表中，仍要按文本方式编辑？'))) return
    try {
      const res = await fsApi.read(sessionId, file.path)
      setEditContent(res.content)
      setEditFile(file)
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const saveEdit = useMutation({
    mutationFn: () => fsApi.write(sessionId, editFile!.path, editContent),
    onSuccess: () => {
      toast.success('已保存远程文件')
      refresh()
      setEditFile(null)
    },
    onError: (err: any) => toast.error(err.message),
  })

  const addBookmark = (dir: string) => {
    setBookmarks((cur) => [dir, ...cur.filter((x) => x !== dir)].slice(0, 12))
    toast.success('已加入书签')
  }

  const removeBookmark = (dir: string) => setBookmarks((cur) => cur.filter((x) => x !== dir))

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    const items = files.map((file) => ({ id: `${Date.now()}-${file.name}-${Math.random()}`, name: file.name, status: 'queued' as const }))
    setQueue((cur) => [...items, ...cur].slice(0, 20))
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      const id = items[i].id
      setQueue((cur) => cur.map((x) => (x.id === id ? { ...x, status: 'uploading' } : x)))
      try {
        await fsApi.upload(sessionId, selectedDir, file)
        setQueue((cur) => cur.map((x) => (x.id === id ? { ...x, status: 'done' } : x)))
      } catch (err: any) {
        setQueue((cur) => cur.map((x) => (x.id === id ? { ...x, status: 'error', error: err.message } : x)))
      }
    }
    toast.success(`上传队列完成：${files.length} 个文件`)
    refresh()
  }

  const startCreate = (mode: 'dir' | 'file') => {
    setCreating(mode)
    setNewName('')
  }

  const submitCreate = async () => {
    const name = newName.trim()
    if (!name) return
    const full = selectedDir === '.' ? name : `${selectedDir}/${name}`
    try {
      if (creating === 'dir') await fsApi.mkdir(sessionId, full)
      else await fsApi.touch(sessionId, full)
      toast.success('已创建')
      setCreating(null)
      setNewName('')
      refresh()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dark
      width={460}
      title="文件管理"
      extra={
        <div className="d-flex gap-1">
          <input ref={fileInputRef} type="file" className="d-none" multiple onChange={onFilePicked} />
          <button className="term-tool" style={{ width: 28, height: 28, fontSize: 16 }} title={`上传到 ${selectedDir}`} onClick={() => fileInputRef.current?.click()}>
            <i className="bx bx-upload" />
          </button>
          <button className="term-tool" style={{ width: 28, height: 28, fontSize: 16 }} title={`在 ${selectedDir} 新建文件`} onClick={() => startCreate('file')}>
            <i className="bx bx-file-blank" />
          </button>
          <button className="term-tool" style={{ width: 28, height: 28, fontSize: 16 }} title={`在 ${selectedDir} 新建目录`} onClick={() => startCreate('dir')}>
            <i className="bx bx-folder-plus" />
          </button>
          <button className="term-tool" style={{ width: 28, height: 28, fontSize: 16 }} title="刷新" onClick={refresh}>
            <i className="bx bx-refresh" />
          </button>
        </div>
      }
    >
      <div className="text-muted mb-2" style={{ fontSize: 12 }}>
        <i className="bx bx-folder-open me-1" />
        当前目录：<code className="text-info">{selectedDir}</code>
        <button className="btn btn-sm btn-link p-0 ms-2 text-warning" onClick={() => addBookmark(selectedDir)}>
          <i className="bx bx-bookmark-plus" /> 加书签
        </button>
      </div>
      {bookmarks.length > 0 && (
        <div className="mb-2 p-2 rounded" style={{ background: '#2B2D30' }}>
          <div className="text-light mb-1" style={{ fontSize: 12 }}>目录书签</div>
          <div className="d-flex flex-wrap gap-1">
            {bookmarks.map((dir) => (
              <button key={dir} className="btn btn-sm btn-dark border-secondary d-inline-flex align-items-center gap-1" onClick={() => setSelectedDir(dir)}>
                <i className="bx bx-bookmark" />
                <span className="text-truncate" style={{ maxWidth: 150 }}>{dir}</span>
                <i className="bx bx-x" onClick={(e) => { e.stopPropagation(); removeBookmark(dir) }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {creating && (
        <div className="d-flex align-items-center gap-2 mb-2 p-2 rounded" style={{ background: '#2B2D30' }}>
          <i className={`bx ${creating === 'dir' ? 'bxs-folder' : 'bx-file-blank'}`} style={{ color: creating === 'dir' ? '#e0a23b' : '#7f8c9b' }} />
          <input
            autoFocus
            className="form-control form-control-sm bg-dark text-light border-secondary flex-grow-1"
            style={{ minWidth: 0 }}
            placeholder={creating === 'dir' ? '新目录名称' : '新文件名称'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
              else if (e.key === 'Escape') setCreating(null)
            }}
          />
          <button className="btn btn-sm btn-primary text-nowrap flex-shrink-0" disabled={!newName.trim()} onClick={submitCreate}>确定</button>
          <button className="btn btn-sm btn-secondary text-nowrap flex-shrink-0" onClick={() => setCreating(null)}>取消</button>
        </div>
      )}
      {queue.length > 0 && (
        <div className="mb-2 p-2 rounded" style={{ background: '#2B2D30' }}>
          <div className="d-flex align-items-center justify-content-between mb-1">
            <span className="text-light" style={{ fontSize: 12 }}>传输队列</span>
            <button className="btn btn-sm btn-link p-0 text-secondary" onClick={() => setQueue([])}>清空</button>
          </div>
          <div className="d-flex flex-column gap-1" style={{ maxHeight: 110, overflow: 'auto' }}>
            {queue.map((item) => (
              <div key={item.id} className="d-flex align-items-center gap-2" style={{ fontSize: 12 }}>
                <i className={`bx ${item.status === 'done' ? 'bx-check text-success' : item.status === 'error' ? 'bx-x text-danger' : item.status === 'uploading' ? 'bx-loader-alt bx-spin text-info' : 'bx-time text-secondary'}`} />
                <span className="text-truncate flex-grow-1">{item.name}</span>
                <span className={item.status === 'error' ? 'text-danger' : 'text-secondary'}>{item.error ?? item.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {isLoading ? (
        <Spinner center />
      ) : !roots?.length ? (
        <Empty text="空目录" />
      ) : (
        <div>
          {roots.map((f) => (
            <FsNode key={f.path} sid={sessionId} file={f} depth={0} selectedDir={selectedDir} onSelectDir={setSelectedDir} onChanged={refresh} onCtx={onCtx} onPreview={setPreviewFile} onEdit={openEditor} />
          ))}
        </div>
      )}
      {selectedDir !== '.' && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid #34363a' }}>
          <div className="text-light mb-2" style={{ fontSize: 12 }}>当前目录内容</div>
          {selectedLoading ? (
            <span className="spinner-border spinner-border-sm text-secondary" />
          ) : !selectedEntries?.length ? (
            <Empty text="空目录" />
          ) : (
            selectedEntries.map((f) => (
              <FsNode key={`selected-${f.path}`} sid={sessionId} file={f} depth={0} selectedDir={selectedDir} onSelectDir={setSelectedDir} onChanged={refresh} onCtx={onCtx} onPreview={setPreviewFile} onEdit={openEditor} />
            ))
          )}
        </div>
      )}

      {/* 右键菜单 */}
      {menu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1090 }} onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div
            className="py-1 rounded shadow"
            style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1091, minWidth: 160, background: '#26282B', border: '1px solid #34363a' }}
          >
            <button className="ctx-item" onClick={() => { setPermFile(menu.file); setMenu(null) }}>
              <i className="bx bx-lock-open-alt me-2" />设置权限
            </button>
            {!menu.file.isDir && (
              <>
                <button className="ctx-item" onClick={() => { setPreviewFile(menu.file); setMenu(null) }}>
                  <i className="bx bx-show me-2" />预览
                </button>
                <button className="ctx-item" onClick={() => { openEditor(menu.file); setMenu(null) }}>
                  <i className="bx bx-edit me-2" />编辑
                </button>
                <a className="ctx-item d-block text-decoration-none" href={fsApi.downloadUrl(sessionId, menu.file.path)} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}>
                  <i className="bx bx-download me-2" />下载
                </a>
              </>
            )}
            <button className="ctx-item text-danger" onClick={() => { delFromMenu(menu.file); setMenu(null) }}>
              <i className="bx bx-trash me-2" />删除
            </button>
          </div>
        </>
      )}

      <PermissionDialog
        open={!!permFile}
        onClose={() => setPermFile(null)}
        sessionId={sessionId}
        file={permFile}
        onDone={refresh}
      />
      {previewFile && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.45)' }} onClick={() => setPreviewFile(null)} />
          <div className="rounded shadow" style={{ position: 'fixed', inset: '8vh 8vw', zIndex: 1101, background: '#1E1F22', border: '1px solid #34363a', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex align-items-center px-3" style={{ height: 42, borderBottom: '1px solid #34363a' }}>
              <span className="text-light text-truncate">{previewFile.name}</span>
              <button className="term-tool ms-auto" title="关闭" onClick={() => setPreviewFile(null)}><i className="bx bx-x" /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
              {/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(previewFile.name) ? (
                <img src={fsApi.previewUrl(sessionId, previewFile.path)} alt={previewFile.name} style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', margin: '0 auto' }} />
              ) : (
                <iframe title={previewFile.name} src={fsApi.previewUrl(sessionId, previewFile.path)} style={{ width: '100%', height: '100%', border: 0, background: '#111', color: '#fff' }} />
              )}
            </div>
          </div>
        </>
      )}
      {editFile && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.45)' }} onClick={() => setEditFile(null)} />
          <div className="rounded shadow" style={{ position: 'fixed', inset: '7vh 7vw', zIndex: 1101, background: '#1E1F22', border: '1px solid #34363a', display: 'flex', flexDirection: 'column' }}>
            <div className="d-flex align-items-center px-3" style={{ height: 44, borderBottom: '1px solid #34363a' }}>
              <i className="bx bx-edit text-warning me-2" />
              <span className="text-light text-truncate">{editFile.path}</span>
              <button className="btn btn-sm btn-primary ms-auto me-2" disabled={saveEdit.isPending} onClick={() => saveEdit.mutate()}>
                <i className="bx bx-save" /> 保存
              </button>
              <button className="term-tool" title="关闭" onClick={() => setEditFile(null)}><i className="bx bx-x" /></button>
            </div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              spellCheck={false}
              style={{
                flex: 1,
                width: '100%',
                resize: 'none',
                border: 0,
                outline: 'none',
                background: '#111316',
                color: '#e5e7eb',
                padding: 14,
                fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            />
          </div>
        </>
      )}
    </Drawer>
  )
}
