import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fsApi, type FileInfo } from '../api/filesystem'
import { Spinner, Empty, confirm, toast } from '../ui'
import PermissionDialog from './access/PermissionDialog'

const fmtSize = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)}M` : n > 1024 ? `${(n / 1024).toFixed(1)}K` : `${n}B`

const BOOKMARK_KEY = 'nt-sftp-bookmarks'
const isTextEditable = (name: string) =>
  /\.(txt|log|conf|cfg|ini|json|ya?ml|xml|md|sh|bash|zsh|sql|env|properties|go|ts|tsx|js|jsx|css|html|py|rb|php|java|c|cc|cpp|h|hpp)$/i.test(name)

// shell 单引号转义，安全拼接路径到终端命令
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const parentOf = (p: string) => {
  const i = p.lastIndexOf('/')
  if (i > 0) return p.slice(0, i)
  return i === 0 ? '/' : '.'
}
const baseOf = (p: string) => {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

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
  hidden,
  selectedDir,
  onSelectDir,
  onCtx,
  onPreview,
  onEdit,
}: {
  sid: string
  file: FileInfo
  depth: number
  hidden: boolean
  selectedDir: string
  onSelectDir: (dir: string) => void
  onCtx: (file: FileInfo, e: React.MouseEvent) => void
  onPreview: (file: FileInfo) => void
  onEdit: (file: FileInfo) => void
}) {
  const [open, setOpen] = useState(false)
  const isDir = file.isDir
  const { data: children, isLoading } = useQuery({
    queryKey: ['fs', sid, file.path, hidden],
    queryFn: () => fsApi.ls(sid, file.path, hidden),
    enabled: isDir && open,
  })

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
        title={`${file.path}\n${file.mode}  ·  ${fmtSize(file.size)}`}
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
              <FsNode key={c.path} sid={sid} file={c} depth={depth + 1} hidden={hidden} selectedDir={selectedDir} onSelectDir={onSelectDir} onCtx={onCtx} onPreview={onPreview} onEdit={onEdit} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  sessionId: string
  cwd?: string // 来自终端目录同步（shell cd 后自动跟随）
  dirFollow?: boolean // 目录跟随开关（受控；来自持久化终端偏好）
  onSetDirFollow?: (on: boolean) => void // 切换目录跟随：持久化 + 通知服务端注入/撤销 PROMPT_COMMAND
  onClose: () => void
  onRunInTerminal?: (cmd: string) => void // 执行命令到当前终端
  onNewTerminalAt?: (dir: string) => void // 在指定目录新建终端 tab
}

// 停靠式文件管理面板：路径栏 + 工具栏 + 懒加载文件树 + 右键菜单（对齐 8/9/10/11.png）。
export default function FileManager({ sessionId, cwd, dirFollow, onSetDirFollow, onClose, onRunInTerminal, onNewTerminalAt }: Props) {
  const qc = useQueryClient()
  const [root, setRoot] = useState('.') // 树根 = 当前目录（. 即登录家目录）
  const [pathInput, setPathInput] = useState('.')
  const [hidden, setHidden] = useState(false)
  const [followLocal, setFollowLocal] = useState(true) // 未受控时的兜底状态
  const follow = dirFollow ?? followLocal // 目录跟随 shell cwd（优先受控 prop）
  const toggleFollow = () => {
    const next = !follow
    if (onSetDirFollow) onSetDirFollow(next)
    else setFollowLocal(next)
  }
  const [treeKey, setTreeKey] = useState(0) // ++ 触发树重挂载（折叠全部 / 重新定位）
  const [selectedDir, setSelectedDir] = useState('.') // 上传/新建的目标目录
  const [creating, setCreating] = useState<null | { mode: 'dir' | 'file'; dir: string }>(null)
  const [renaming, setRenaming] = useState<null | { file: FileInfo }>(null)
  const [nameInput, setNameInput] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; file: FileInfo } | null>(null)
  const [submenu, setSubmenu] = useState<null | 'terminal' | 'upload' | 'other'>(null)
  const [permFile, setPermFile] = useState<FileInfo | null>(null)
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null)
  const [editFile, setEditFile] = useState<FileInfo | null>(null)
  const [editContent, setEditContent] = useState('')
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [bookmarks, setBookmarks] = useState<string[]>(() => loadBookmarks())
  const [queue, setQueue] = useState<{ id: string; name: string; status: 'queued' | 'uploading' | 'done' | 'error'; error?: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<string>('.') // 触发上传时锁定目标目录

  useEffect(() => saveBookmarks(bookmarks), [bookmarks])

  // 跟随 shell 目录变化：终端 cd 后自动把树根定位过去。
  useEffect(() => {
    if (follow && cwd && cwd !== root) {
      setRoot(cwd)
      setPathInput(cwd)
      setSelectedDir(cwd)
      setTreeKey((k) => k + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, follow])

  const { data: roots, isLoading } = useQuery({
    queryKey: ['fs', sessionId, root, hidden],
    queryFn: () => fsApi.ls(sessionId, root, hidden),
    enabled: !!sessionId,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['fs', sessionId] })

  const navigate = (dir: string) => {
    setRoot(dir)
    setPathInput(dir)
    setSelectedDir(dir)
    setTreeKey((k) => k + 1)
  }
  const collapseAll = () => setTreeKey((k) => k + 1)

  const dirOf = (f: FileInfo) => (f.isDir ? f.path : parentOf(f.path))

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
    setBookmarks((cur) => [dir, ...cur.filter((x) => x !== dir)].slice(0, 20))
    toast.success('已加入书签')
  }
  const removeBookmark = (dir: string) => setBookmarks((cur) => cur.filter((x) => x !== dir))

  const delFromMenu = async (f: FileInfo) => {
    if (!(await confirm(`删除 ${f.name}？`, { danger: true, okText: '删除' }))) return
    try {
      await fsApi.rm(sessionId, f.path)
      toast.success('已删除')
      refresh()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制${label}`)
    } catch {
      toast.error('复制失败')
    }
  }

  const runUpload = async (files: File[], baseDir: string, withRel: boolean) => {
    if (files.length === 0) return
    const items = files.map((file) => ({ id: `${file.name}-${Math.random()}`, name: withRel ? (file as any).webkitRelativePath || file.name : file.name, status: 'queued' as const }))
    setQueue((cur) => [...items, ...cur].slice(0, 50))
    const madeDirs = new Set<string>()
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      const id = items[i].id
      const rel = withRel ? ((file as any).webkitRelativePath as string) || file.name : file.name
      const targetDir = withRel ? (parentOf(rel) === '.' ? baseDir : `${baseDir}/${parentOf(rel)}`) : baseDir
      setQueue((cur) => cur.map((x) => (x.id === id ? { ...x, status: 'uploading' } : x)))
      try {
        if (withRel && targetDir !== baseDir && !madeDirs.has(targetDir)) {
          await fsApi.mkdir(sessionId, targetDir)
          madeDirs.add(targetDir)
        }
        await fsApi.upload(sessionId, targetDir, file)
        setQueue((cur) => cur.map((x) => (x.id === id ? { ...x, status: 'done' } : x)))
      } catch (err: any) {
        setQueue((cur) => cur.map((x) => (x.id === id ? { ...x, status: 'error', error: err.message } : x)))
      }
    }
    toast.success(`上传完成：${files.length} 个文件`)
    refresh()
  }

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    await runUpload(files, uploadTargetRef.current, false)
  }
  const onFolderPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    await runUpload(files, uploadTargetRef.current, true)
  }
  const pickFiles = (dir: string) => { uploadTargetRef.current = dir; fileInputRef.current?.click() }
  const pickFolder = (dir: string) => { uploadTargetRef.current = dir; folderInputRef.current?.click() }

  const startCreate = (mode: 'dir' | 'file', dir: string) => {
    setCreating({ mode, dir })
    setRenaming(null)
    setNameInput('')
  }
  const submitCreate = async () => {
    if (!creating) return
    const name = nameInput.trim()
    if (!name) return
    const full = creating.dir === '.' ? name : `${creating.dir}/${name}`
    try {
      if (creating.mode === 'dir') await fsApi.mkdir(sessionId, full)
      else await fsApi.touch(sessionId, full)
      toast.success('已创建')
      setCreating(null)
      setNameInput('')
      refresh()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const startRename = (file: FileInfo) => {
    setRenaming({ file })
    setCreating(null)
    setNameInput(file.name)
  }
  const submitRename = async () => {
    if (!renaming) return
    const name = nameInput.trim()
    if (!name || name === renaming.file.name) { setRenaming(null); return }
    const parent = parentOf(renaming.file.path)
    const dest = parent === '.' ? name : `${parent}/${name}`
    try {
      await fsApi.rename(sessionId, renaming.file.path, dest)
      toast.success('已重命名')
      setRenaming(null)
      refresh()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const cdToTerminal = (dir: string) => {
    onRunInTerminal?.(`cd ${q(dir)}`)
    toast.success('已发送 cd 命令到终端')
  }
  const compress = (f: FileInfo) => {
    const parent = parentOf(f.path)
    const base = baseOf(f.path)
    onRunInTerminal?.(`cd ${q(parent)} && tar -czvf ${q(base + '.tar.gz')} ${q(base)}`)
    toast.success('已发送压缩命令到终端')
    setTimeout(refresh, 1500)
  }

  const closeMenu = () => { setMenu(null); setSubmenu(null) }
  const bar = creating || renaming
  // 面板停靠在右侧，靠右时子菜单向左弹出，避免超出视口被裁剪
  const openLeft = !!menu && typeof window !== 'undefined' && menu.x > window.innerWidth / 2

  const displayRoot = useMemo(() => (root === '.' ? '~' : root), [root])

  return (
    <div className="d-flex flex-column" style={{ width: '100%', height: '100%', background: '#1E1F22', borderLeft: '1px solid #34363a', color: '#d4d4d4' }}>
      <input ref={fileInputRef} type="file" className="d-none" multiple onChange={onFilePicked} />
      {/* @ts-expect-error 非标准目录选择属性 */}
      <input ref={folderInputRef} type="file" className="d-none" multiple webkitdirectory="" directory="" onChange={onFolderPicked} />

      {/* 顶部标题 + 关闭 */}
      <div className="d-flex align-items-center px-2" style={{ height: 32, borderBottom: '1px solid #34363a', flexShrink: 0 }}>
        <i className="bx bx-folder text-warning me-1" />
        <span style={{ fontSize: 13, color: '#e5e7eb' }}>文件管理</span>
        <button className="term-tool nt-tip ms-auto" style={{ width: 28, height: 28, fontSize: 16 }} data-tip="关闭文件管理" onClick={onClose}>
          <i className="bx bx-x" />
        </button>
      </div>

      {/* 路径输入 */}
      <div className="px-2 pt-2" style={{ flexShrink: 0 }}>
        <div className="d-flex align-items-center gap-1">
          <i className="bx bx-folder-open text-info" />
          <input
            className="form-control form-control-sm bg-dark text-light border-secondary"
            style={{ fontSize: 12, height: 28 }}
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') navigate(pathInput.trim() || '.') }}
            placeholder="输入路径后回车跳转"
          />
        </div>
      </div>

      {/* 工具栏 */}
      <div className="d-flex align-items-center px-2 py-1 flex-wrap" style={{ gap: 2, flexShrink: 0 }}>
        <button className="term-tool nt-tip" style={{ width: 28, height: 28, fontSize: 16 }} data-tip="返回家目录" onClick={() => navigate('.')}>
          <i className="bx bx-home-alt" />
        </button>
        <button className="term-tool nt-tip" style={{ width: 28, height: 28, fontSize: 16 }} data-tip="定位到当前终端目录" disabled={!cwd} onClick={() => cwd && navigate(cwd)}>
          <i className="bx bx-current-location" />
        </button>
        <button className="term-tool nt-tip" style={{ width: 28, height: 28, fontSize: 16 }} data-tip="折叠全部" onClick={collapseAll}>
          <i className="bx bx-collapse-vertical" />
        </button>
        <button className={`term-tool nt-tip${hidden ? ' term-tool-active' : ''}`} style={{ width: 28, height: 28, fontSize: 16 }} data-tip={hidden ? '隐藏文件：已显示（点击隐藏“.”开头文件）' : '隐藏文件：已隐藏（点击显示“.”开头文件）'} onClick={() => setHidden((v) => !v)}>
          <i className={`bx ${hidden ? 'bx-show' : 'bx-hide'}`} />
        </button>
        <button className="term-tool nt-tip" style={{ width: 28, height: 28, fontSize: 16 }} data-tip="刷新当前目录" onClick={refresh}>
          <i className="bx bx-refresh" />
        </button>
        <button className={`term-tool nt-tip${follow ? ' term-tool-active' : ''}`} style={{ width: 28, height: 28, fontSize: 16 }} data-tip={follow ? '目录跟随：已开启（点击关闭，终端不再注入 PROMPT_COMMAND）' : '目录跟随：已关闭（点击开启，跟随终端 cd 变化）'} onClick={toggleFollow}>
          <i className={`bx ${follow ? 'bx-link' : 'bx-unlink'}`} />
        </button>
        <span style={{ width: 1, height: 18, background: '#34363a', margin: '0 2px' }} />
        <div style={{ position: 'relative' }}>
          <button className={`term-tool nt-tip${showBookmarks ? ' term-tool-active' : ''}`} style={{ width: 28, height: 28, fontSize: 16 }} data-tip="书签目录" onClick={() => setShowBookmarks((v) => !v)}>
            <i className="bx bx-bookmark" />
          </button>
          {showBookmarks && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 1080 }} onClick={() => setShowBookmarks(false)} />
              <div className="rounded shadow" style={{ position: 'absolute', top: 30, left: 0, zIndex: 1081, width: 240, background: '#26282B', border: '1px solid #34363a' }}>
                <button className="ctx-item" onClick={() => { addBookmark(root); }}>
                  <i className="bx bx-bookmark-plus me-2 text-warning" />收藏当前目录
                </button>
                <div style={{ borderTop: '1px solid #34363a', maxHeight: 220, overflow: 'auto' }}>
                  {bookmarks.length === 0 ? (
                    <div className="text-muted px-3 py-2" style={{ fontSize: 12 }}>暂无书签</div>
                  ) : (
                    bookmarks.map((dir) => (
                      <div key={dir} className="ctx-item d-flex align-items-center" onClick={() => { navigate(dir); setShowBookmarks(false) }}>
                        <i className="bx bx-folder me-2 text-warning" />
                        <span className="text-truncate flex-grow-1" style={{ maxWidth: 170 }}>{dir}</span>
                        <i className="bx bx-x" onClick={(e) => { e.stopPropagation(); removeBookmark(dir) }} />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <button className="term-tool nt-tip" style={{ width: 28, height: 28, fontSize: 16 }} data-tip={`上传文件到 ${displayRoot}`} onClick={() => pickFiles(root)}>
          <i className="bx bx-upload" />
        </button>
        <button className="term-tool nt-tip" style={{ width: 28, height: 28, fontSize: 16 }} data-tip={`在 ${displayRoot} 新建文件`} onClick={() => startCreate('file', root)}>
          <i className="bx bx-file-blank" />
        </button>
        <button className="term-tool nt-tip" style={{ width: 28, height: 28, fontSize: 16 }} data-tip={`在 ${displayRoot} 新建目录`} onClick={() => startCreate('dir', root)}>
          <i className="bx bx-folder-plus" />
        </button>
      </div>

      {/* 新建 / 重命名 输入条 */}
      {bar && (
        <div className="d-flex align-items-center gap-2 mx-2 mb-1 p-2 rounded" style={{ background: '#2B2D30', flexShrink: 0 }}>
          <i className={`bx ${renaming ? 'bx-edit text-info' : creating!.mode === 'dir' ? 'bxs-folder' : 'bx-file-blank'}`} style={{ color: creating?.mode === 'dir' ? '#e0a23b' : undefined }} />
          <input
            autoFocus
            className="form-control form-control-sm bg-dark text-light border-secondary flex-grow-1"
            style={{ minWidth: 0 }}
            placeholder={renaming ? '新名称' : creating!.mode === 'dir' ? '新目录名称' : '新文件名称'}
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') renaming ? submitRename() : submitCreate()
              else if (e.key === 'Escape') { setCreating(null); setRenaming(null) }
            }}
          />
          <button className="btn btn-sm btn-primary text-nowrap flex-shrink-0" disabled={!nameInput.trim()} onClick={() => (renaming ? submitRename() : submitCreate())}>确定</button>
          <button className="btn btn-sm btn-secondary text-nowrap flex-shrink-0" onClick={() => { setCreating(null); setRenaming(null) }}>取消</button>
        </div>
      )}

      {/* 传输队列 */}
      {queue.length > 0 && (
        <div className="mx-2 mb-1 p-2 rounded" style={{ background: '#2B2D30', flexShrink: 0 }}>
          <div className="d-flex align-items-center justify-content-between mb-1">
            <span className="text-light" style={{ fontSize: 12 }}>传输队列</span>
            <button className="btn btn-sm btn-link p-0 text-secondary" onClick={() => setQueue([])}>清空</button>
          </div>
          <div className="d-flex flex-column gap-1" style={{ maxHeight: 100, overflow: 'auto' }}>
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

      {/* 文件树 */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 4px 12px' }}>
        {isLoading ? (
          <Spinner center />
        ) : !roots?.length ? (
          <Empty text="空目录" />
        ) : (
          <div key={treeKey}>
            {roots.map((f) => (
              <FsNode key={f.path} sid={sessionId} file={f} depth={0} hidden={hidden} selectedDir={selectedDir} onSelectDir={setSelectedDir} onCtx={(file, e) => { setSubmenu(null); setMenu({ x: e.clientX, y: e.clientY, file }) }} onPreview={setPreviewFile} onEdit={openEditor} />
            ))}
          </div>
        )}
      </div>

      {/* 右键菜单（对齐 9/10/11.png） */}
      {menu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1090 }} onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu() }} />
          <div
            className="py-1 rounded shadow"
            style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 420), zIndex: 1091, minWidth: 180, background: '#26282B', border: '1px solid #34363a' }}
            onMouseLeave={() => setSubmenu(null)}
          >
            <button className="ctx-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { refresh(); closeMenu() }}><i className="bx bx-refresh me-2" />刷新</button>
            <button className="ctx-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { startCreate('file', dirOf(menu.file)); closeMenu() }}><i className="bx bx-file-plus me-2" />新建文件</button>
            <button className="ctx-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { startCreate('dir', dirOf(menu.file)); closeMenu() }}><i className="bx bx-folder-plus me-2" />新建文件夹</button>
            <button className="ctx-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { startRename(menu.file); closeMenu() }}><i className="bx bx-edit-alt me-2" />重命名</button>
            {menu.file.isDir ? (
              <button className="ctx-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { toast.info('文件夹请先“压缩”后再下载'); closeMenu() }}><i className="bx bx-download me-2" />下载</button>
            ) : (
              <a className="ctx-item d-block text-decoration-none" href={fsApi.downloadUrl(sessionId, menu.file.path)} target="_blank" rel="noreferrer" onMouseEnter={() => setSubmenu(null)} onClick={closeMenu}><i className="bx bx-download me-2" />下载</a>
            )}
            <button className="ctx-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { setPermFile(menu.file); closeMenu() }}><i className="bx bx-lock-open-alt me-2" />修改权限</button>

            {/* 终端 子菜单 */}
            <div style={{ position: 'relative' }} onMouseEnter={() => setSubmenu('terminal')}>
              <button className="ctx-item d-flex align-items-center"><i className="bx bx-terminal me-2" />终端<i className="bx bx-chevron-right ms-auto" /></button>
              {submenu === 'terminal' && (
                <div className="py-1 rounded shadow" style={{ position: 'absolute', top: 0, [openLeft ? 'right' : 'left']: '100%', minWidth: 200, background: '#26282B', border: '1px solid #34363a' }}>
                  <button className="ctx-item" onClick={() => { cdToTerminal(dirOf(menu.file)); closeMenu() }}><i className="bx bx-paint me-2" />执行 CD 命令到终端</button>
                  <button className="ctx-item" onClick={() => { onNewTerminalAt?.(dirOf(menu.file)); closeMenu() }}><i className="bx bx-plus-circle me-2" />新建终端到当前目录</button>
                </div>
              )}
            </div>

            <button className="ctx-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { copyText(menu.file.name, '文件名'); closeMenu() }}><i className="bx bx-copy me-2" />复制文件名</button>
            <button className="ctx-item" onMouseEnter={() => setSubmenu(null)} onClick={() => { copyText(menu.file.path, '绝对路径'); closeMenu() }}><i className="bx bx-copy-alt me-2" />复制绝对路径</button>
            <button className="ctx-item text-danger" onMouseEnter={() => setSubmenu(null)} onClick={() => { delFromMenu(menu.file); closeMenu() }}><i className="bx bx-trash me-2" />删除</button>

            {/* 上传 子菜单 */}
            <div style={{ position: 'relative' }} onMouseEnter={() => setSubmenu('upload')}>
              <button className="ctx-item d-flex align-items-center"><i className="bx bx-upload me-2" />上传<i className="bx bx-chevron-right ms-auto" /></button>
              {submenu === 'upload' && (
                <div className="py-1 rounded shadow" style={{ position: 'absolute', top: 0, [openLeft ? 'right' : 'left']: '100%', minWidth: 160, background: '#26282B', border: '1px solid #34363a' }}>
                  <button className="ctx-item" onClick={() => { pickFiles(dirOf(menu.file)); closeMenu() }}><i className="bx bx-file me-2" />上传文件</button>
                  <button className="ctx-item" onClick={() => { pickFolder(dirOf(menu.file)); closeMenu() }}><i className="bx bxs-cloud-upload me-2" />上传文件夹</button>
                </div>
              )}
            </div>

            {/* 其他 子菜单 */}
            <div style={{ position: 'relative' }} onMouseEnter={() => setSubmenu('other')}>
              <button className="ctx-item d-flex align-items-center"><i className="bx bx-dots-horizontal-rounded me-2" />其他<i className="bx bx-chevron-right ms-auto" /></button>
              {submenu === 'other' && (
                <div className="py-1 rounded shadow" style={{ position: 'absolute', top: 0, [openLeft ? 'right' : 'left']: '100%', minWidth: 140, background: '#26282B', border: '1px solid #34363a' }}>
                  <button className="ctx-item" onClick={() => { compress(menu.file); closeMenu() }}><i className="bx bx-archive me-2" />压缩</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <PermissionDialog open={!!permFile} onClose={() => setPermFile(null)} sessionId={sessionId} file={permFile} onDone={refresh} />

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
              style={{ flex: 1, width: '100%', resize: 'none', border: 0, outline: 'none', background: '#111316', color: '#e5e7eb', padding: 14, fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace', fontSize: 13, lineHeight: 1.5 }}
            />
          </div>
        </>
      )}
    </div>
  )
}
