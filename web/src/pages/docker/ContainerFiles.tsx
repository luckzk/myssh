import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dockerApi } from '../../api/docker'

// 容器内文件浏览（docker exec ls/cat/cp）。以覆盖层形式嵌在管理器内部。只读:浏览 + 查看 + 下载。
const C = { bg: '#1E1F22', card: '#26282B', border: '#34363a', text: '#e5e7eb', muted: '#9ca3af', dim: '#6b7280' }

const normDir = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
const parentPath = (p: string) => {
  p = normDir(p)
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}
const joinPath = (dir: string, name: string) => (dir === '/' ? '/' + name : normDir(dir) + '/' + name)
const isTextName = (n: string) => /\.(txt|log|conf|cfg|ini|json|ya?ml|xml|md|sh|env|properties|toml|py|js|ts|go|rb|php|sql|html?|css)$/i.test(n) || !/\./.test(n)

export default function ContainerFiles({ assetId, id, name, onClose }: { assetId: string; id: string; name: string; onClose: () => void }) {
  const [path, setPath] = useState('/')
  const [view, setView] = useState<null | { name: string; content: string }>(null)
  const [loadingFile, setLoadingFile] = useState('')
  const { data, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['docker-fs', assetId, id, path],
    queryFn: () => dockerApi.fsLs(assetId, id, path),
  })

  const openFile = async (fname: string) => {
    const full = joinPath(path, fname)
    setLoadingFile(fname)
    try {
      const r = await dockerApi.fsRead(assetId, id, full)
      setView({ name: fname, content: r.content })
    } finally {
      setLoadingFile('')
    }
  }

  const entries = data?.entries || []
  const dirs = entries.filter((e) => e.isDir)
  const files = entries.filter((e) => !e.isDir)

  return (
    <div className="d-flex flex-column" style={{ position: 'absolute', inset: 0, zIndex: 20, background: C.bg }}>
      <div className="d-flex align-items-center px-3" style={{ height: 40, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <i className="bx bx-folder-open me-2" style={{ color: '#e0a23b' }} />
        <span className="text-truncate" style={{ color: C.text, fontSize: 13 }}>容器文件 · {name}</span>
        <button className="term-tool ms-auto" title="刷新" onClick={() => refetch()}><i className="bx bx-refresh" /></button>
        <button className="term-tool" title="返回" onClick={onClose}><i className="bx bx-x" /></button>
      </div>

      {/* 路径栏 */}
      <div className="d-flex align-items-center gap-1 px-2 py-1" style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
        <button className="term-tool" title="根目录" onClick={() => setPath('/')} style={{ width: 26, height: 26 }}><i className="bx bx-home-alt" /></button>
        <button className="term-tool" title="上级" disabled={path === '/'} onClick={() => setPath(parentPath(path))} style={{ width: 26, height: 26 }}><i className="bx bx-up-arrow-alt" /></button>
        <input
          className="form-control form-control-sm bg-dark text-light border-secondary"
          style={{ fontSize: 12, height: 26 }}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') refetch() }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 6 }}>
        {isError ? (
          <div style={{ color: '#f87171', fontSize: 12, padding: 12 }}>读取失败：{(error as any)?.message}</div>
        ) : !data ? (
          <div style={{ color: C.dim, fontSize: 12, padding: 12 }}>加载中…</div>
        ) : !data.available ? (
          <div style={{ color: '#f87171', fontSize: 12, padding: 12 }}>目标未安装 Docker</div>
        ) : entries.length === 0 ? (
          <div style={{ color: C.dim, fontSize: 12, padding: 12, textAlign: 'center' }}>{isFetching ? '加载中…' : '空目录'}</div>
        ) : (
          [...dirs, ...files].map((e) => (
            <div key={e.name} className="d-flex align-items-center gap-2 px-2" style={{ height: 30, borderRadius: 4, cursor: e.isDir ? 'pointer' : 'default' }}
              onClick={() => e.isDir && setPath(joinPath(path, e.name))}
              onMouseEnter={(ev) => (ev.currentTarget.style.background = '#2b2d30')} onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}>
              <i className={`bx ${e.isDir ? 'bxs-folder' : e.isLink ? 'bx-link' : 'bx-file-blank'}`} style={{ color: e.isDir ? '#e0a23b' : '#7f8c9b' }} />
              <span className="text-truncate flex-grow-1" style={{ color: C.text, fontSize: 12 }}>{e.name}</span>
              {!e.isDir && (
                <>
                  <span style={{ color: C.dim, fontSize: 11 }}>{e.size}</span>
                  {isTextName(e.name) && (
                    <button className="btn btn-link p-0 text-info" title="查看" onClick={(ev) => { ev.stopPropagation(); openFile(e.name) }}>
                      <i className={`bx ${loadingFile === e.name ? 'bx-loader-alt bx-spin' : 'bx-show'}`} />
                    </button>
                  )}
                  <a className="text-secondary" title="下载" href={dockerApi.fsDownloadUrl(assetId, id, joinPath(path, e.name))} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                    <i className="bx bx-download" />
                  </a>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {view && (
        <>
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(0,0,0,.5)' }} onClick={() => setView(null)} />
          <div className="rounded shadow d-flex flex-column" style={{ position: 'absolute', inset: '6% 6%', zIndex: 31, background: C.bg, border: `1px solid ${C.border}` }}>
            <div className="d-flex align-items-center px-3" style={{ height: 40, borderBottom: `1px solid ${C.border}` }}>
              <span className="text-truncate" style={{ color: C.text, fontSize: 13 }}>{view.name}</span>
              <button className="term-tool ms-auto" title="关闭" onClick={() => setView(null)}><i className="bx bx-x" /></button>
            </div>
            <pre style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: 0, padding: 12, background: '#111316', color: '#d4d4d4', fontSize: 12 }}>{view.content}</pre>
          </div>
        </>
      )}
    </div>
  )
}
