import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { dockerApi, dockerWsUrl, type DockerAction, type DockerObjType, type RunReq } from '../../api/docker'
import { confirm, toast } from '../../ui'
import DockerStream from './DockerStream'
import ContainerFiles from './ContainerFiles'

// 资产级 Docker 管理器：侧面板(panel) 与整页(page) 共用同一组件。
// 分区:概览 / 容器 / 镜像 / 网络 / 卷。数据经资产级 REST 拉取,操作走 action 白名单。

const C = { bg: '#1E1F22', card: '#26282B', border: '#34363a', text: '#e5e7eb', muted: '#9ca3af', dim: '#6b7280', accent: '#845adf' }
type Section = 'overview' | 'containers' | 'images' | 'networks' | 'volumes' | 'compose'
const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: 'overview', label: '概览', icon: 'bx-bar-chart-alt-2' },
  { id: 'containers', label: '容器', icon: 'bx-box' },
  { id: 'images', label: '镜像', icon: 'bx-layer' },
  { id: 'networks', label: '网络', icon: 'bx-network-chart' },
  { id: 'volumes', label: '卷', icon: 'bx-hdd' },
  { id: 'compose', label: '编排', icon: 'bx-collection' },
]

const fmtKB = (kb: number) => {
  const b = kb * 1024
  if (b >= 1 << 30) return (b / (1 << 30)).toFixed(1) + 'G'
  if (b >= 1 << 20) return (b / (1 << 20)).toFixed(1) + 'M'
  return (b / (1 << 10)).toFixed(0) + 'K'
}

function Hint({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return <div style={{ color: danger ? '#f87171' : C.dim, fontSize: 12, textAlign: 'center', padding: 16 }}>{children}</div>
}

function IBtn({ icon, title, danger, spin, onClick }: { icon: string; title: string; danger?: boolean; spin?: boolean; onClick: () => void }) {
  return (
    <button
      className="nt-tip"
      data-tip={title}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: danger ? '#f87171' : C.muted, width: 28, height: 26, cursor: 'pointer', flexShrink: 0 }}
    >
      <i className={`bx ${spin ? 'bx-loader-alt bx-spin' : icon}`} style={{ fontSize: 14 }} />
    </button>
  )
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="d-flex align-items-center px-2 mb-2" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, height: 32 }}>
      <i className="bx bx-search" style={{ color: C.dim, fontSize: 14 }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ background: 'transparent', border: 'none', outline: 'none', color: C.text, fontSize: 12, marginLeft: 6, width: '100%' }} />
      {value && <i className="bx bx-x" style={{ color: C.dim, cursor: 'pointer' }} onClick={() => onChange('')} />}
    </div>
  )
}

// 文本输入弹窗（create / rename 用）
function PromptModal({ title, label, initial, onOk, onClose }: { title: string; label: string; initial?: string; onOk: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(initial || '')
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.5)' }} onClick={onClose} />
      <div className="rounded shadow" style={{ position: 'fixed', top: '30vh', left: '50%', transform: 'translateX(-50%)', zIndex: 1201, width: 360, maxWidth: '92vw', background: C.bg, border: `1px solid ${C.border}`, color: C.text }}>
        <div className="px-3 d-flex align-items-center" style={{ height: 44, borderBottom: `1px solid ${C.border}` }}>{title}</div>
        <div className="p-3">
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{label}</div>
          <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) onOk(v.trim()) }}
            className="form-control form-control-sm bg-dark text-light border-secondary" style={{ fontSize: 13 }} />
        </div>
        <div className="d-flex justify-content-end gap-2 px-3 pb-3">
          <button className="btn btn-sm btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-sm btn-primary" disabled={!v.trim()} onClick={() => onOk(v.trim())}>确定</button>
        </div>
      </div>
    </>
  )
}

// inspect 详情弹窗
function InspectModal({ assetId, id, title, onClose }: { assetId: string; id: string; title: string; onClose: () => void }) {
  const { data, isError, error } = useQuery({ queryKey: ['docker-inspect', assetId, id], queryFn: () => dockerApi.inspect(assetId, id) })
  const obj = data?.inspect
  const env: string[] = obj?.Config?.Env || []
  const mounts: any[] = obj?.Mounts || []
  const nets: Record<string, any> = obj?.NetworkSettings?.Networks || {}
  const ports = obj?.NetworkSettings?.Ports || obj?.HostConfig?.PortBindings || {}
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.5)' }} onClick={onClose} />
      <div className="rounded shadow d-flex flex-column" style={{ position: 'fixed', inset: '8vh 10vw', zIndex: 1201, background: C.bg, border: `1px solid ${C.border}`, color: C.text }}>
        <div className="px-3 d-flex align-items-center" style={{ height: 44, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <i className="bx bx-info-circle me-2" style={{ color: '#6ea8fe' }} />
          <span className="text-truncate">{title}</span>
          <button className="term-tool ms-auto" title="关闭" onClick={onClose}><i className="bx bx-x" /></button>
        </div>
        <div className="p-3" style={{ overflow: 'auto', minHeight: 0 }}>
          {isError ? (
            <Hint danger>获取失败：{(error as any)?.message}</Hint>
          ) : !data ? (
            <Hint>加载中…</Hint>
          ) : !data.available ? (
            <Hint>目标未安装 Docker</Hint>
          ) : obj ? (
            <>
              {(env.length > 0 || mounts.length > 0 || Object.keys(nets).length > 0 || Object.keys(ports).length > 0) && (
                <div className="d-grid gap-3 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                  {Object.keys(ports).length > 0 && (
                    <Field label="端口">{Object.entries(ports).map(([k, v]) => (
                      <div key={k} style={{ fontSize: 12 }}>{k} → {Array.isArray(v) && v[0]?.HostPort ? `${v[0].HostIp || '0.0.0.0'}:${v[0].HostPort}` : '—'}</div>
                    ))}</Field>
                  )}
                  {Object.keys(nets).length > 0 && (
                    <Field label="网络">{Object.entries(nets).map(([k, v]: any) => (
                      <div key={k} style={{ fontSize: 12 }}>{k} <span style={{ color: C.dim }}>{v?.IPAddress || ''}</span></div>
                    ))}</Field>
                  )}
                  {mounts.length > 0 && (
                    <Field label="挂载">{mounts.map((m, i) => (
                      <div key={i} className="text-truncate" style={{ fontSize: 12 }} title={`${m.Source} → ${m.Destination}`}>{m.Destination} <span style={{ color: C.dim }}>({m.Type})</span></div>
                    ))}</Field>
                  )}
                  {env.length > 0 && (
                    <Field label="环境变量">{env.map((e, i) => (
                      <div key={i} className="text-truncate" style={{ fontSize: 12 }} title={e}>{e}</div>
                    ))}</Field>
                  )}
                </div>
              )}
              <details>
                <summary style={{ cursor: 'pointer', color: C.muted, fontSize: 12, marginBottom: 6 }}>原始 JSON</summary>
                <pre style={{ background: '#111316', color: '#d4d4d4', fontSize: 11, padding: 12, borderRadius: 6, overflow: 'auto', maxHeight: '46vh' }}>{JSON.stringify(obj, null, 2)}</pre>
              </details>
            </>
          ) : (
            <pre style={{ background: '#111316', color: '#d4d4d4', fontSize: 12, padding: 12, borderRadius: 6, overflow: 'auto' }}>{data.raw}</pre>
          )}
        </div>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded p-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div style={{ color: C.dim, fontSize: 11, marginBottom: 4 }}>{label}</div>
      <div style={{ maxHeight: 140, overflow: 'auto' }}>{children}</div>
    </div>
  )
}

export default function DockerManager({ assetId, assetName, mode, active = true, onExpand }: { assetId: string; assetName?: string; mode: 'panel' | 'page'; active?: boolean; onExpand?: () => void }) {
  const qc = useQueryClient()
  const [section, setSection] = useState<Section>('containers')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [inspect, setInspect] = useState<{ id: string; title: string } | null>(null)
  const [prompt, setPrompt] = useState<null | { title: string; label: string; initial?: string; run: (v: string) => void }>(null)
  const [stream, setStream] = useState<null | { url: string; interactive: boolean; title: string; icon: string }>(null)
  const [files, setFiles] = useState<null | { id: string; name: string }>(null)
  const [runOpen, setRunOpen] = useState<null | { image: string }>(null)
  const [viewCompose, setViewCompose] = useState<null | { path: string; name: string }>(null)

  const openLogs = (id: string, name: string) => setStream({ url: dockerWsUrl(assetId, 'logs', { id, tail: '300' }), interactive: false, title: `日志 · ${name}`, icon: 'bx-file' })
  const openExec = (id: string, name: string) => setStream({ url: dockerWsUrl(assetId, 'exec', { id }), interactive: true, title: `终端 · ${name}`, icon: 'bx-terminal' })
  const openPull = (ref: string) => setStream({ url: dockerWsUrl(assetId, 'pull', { ref }), interactive: false, title: `拉取 · ${ref}`, icon: 'bx-download' })

  const ov = useQuery({ queryKey: ['docker-ov', assetId], queryFn: () => dockerApi.overview(assetId), enabled: active, refetchInterval: active ? 5000 : false })
  const list = useQuery({
    queryKey: ['docker-list', assetId, section],
    queryFn: () =>
      section === 'containers' ? dockerApi.containers(assetId)
        : section === 'images' ? dockerApi.images(assetId)
          : section === 'networks' ? dockerApi.networks(assetId)
            : section === 'volumes' ? dockerApi.volumes(assetId)
              : section === 'compose' ? dockerApi.compose(assetId)
                : Promise.resolve({ available: true } as any),
    enabled: active && section !== 'overview',
    refetchInterval: active && section === 'containers' ? 3000 : active ? 8000 : false,
  })

  // 占用率单独异步拉取（docker stats 慢），列表先出、占用率随后补齐
  const statsQ = useQuery({
    queryKey: ['docker-cstats', assetId],
    queryFn: () => dockerApi.containerStats(assetId),
    enabled: active && section === 'containers',
    refetchInterval: active ? 5000 : false,
  })
  const statsById: Record<string, any> = {}
  for (const s of statsQ.data?.stats || []) statsById[s.id] = s

  const doRun = async (body: RunReq) => {
    try {
      const r = await dockerApi.run(assetId, body)
      toast.success('已创建容器' + (r.output ? '：' + r.output.slice(0, 12) : ''))
      setRunOpen(null)
      setSection('containers')
      refresh()
    } catch (e: any) {
      toast.error('创建失败：' + (e?.message || ''))
    }
  }
  const doCompose = async (configFile: string, action: 'up' | 'down' | 'restart') => {
    if (action === 'down' && !(await confirm('确定要 down 该项目（停止并移除容器）？', { danger: true, okText: 'down' }))) return
    try {
      await dockerApi.composeAction(assetId, { configFile, action })
      toast.success('操作成功')
      qc.invalidateQueries({ queryKey: ['docker-list', assetId] })
    } catch (e: any) {
      toast.error('操作失败：' + (e?.message || ''))
    }
  }

  const refresh = () => { qc.invalidateQueries({ queryKey: ['docker-list', assetId] }); qc.invalidateQueries({ queryKey: ['docker-ov', assetId] }) }

  const run = async (type: DockerObjType, action: DockerAction, id?: string, name?: string, danger?: boolean) => {
    if (danger && !(await confirm(`确定要执行 ${action} ${name || id || ''}？`, { danger: true, okText: '执行' }))) return
    setBusy((id || '') + action)
    try {
      const r = await dockerApi.action(assetId, { type, action, id, name })
      toast.success('操作成功' + (r.output ? '：' + r.output.slice(0, 80) : ''))
      refresh()
    } catch (e: any) {
      toast.error('操作失败：' + (e?.message || ''))
    } finally {
      setBusy('')
    }
  }
  const askName = (title: string, label: string, initial: string, cb: (v: string) => void) =>
    setPrompt({ title, label, initial, run: (v) => { setPrompt(null); cb(v) } })

  const ql = q.toLowerCase()
  const info = ov.data?.info
  const notAvail = ov.data && !ov.data.available
  const unavailText = ov.data?.reason === 'not-installed' ? '该主机未安装 Docker 或 Podman'
    : ov.data?.reason === 'podman-no-shim' ? '检测到 Podman，但缺少 docker 兼容命令。可安装 podman-docker，或建软链：ln -s $(command -v podman) /usr/local/bin/docker'
      : '未获取到 Docker（该主机未安装或无权限）'

  return (
    <div className="d-flex flex-column" style={{ position: 'relative', height: '100%', width: '100%', background: C.bg, color: C.text, borderLeft: mode === 'panel' ? `1px solid ${C.border}` : undefined }}>
      {/* 头部：资产名 + 概览摘要 */}
      <div className="d-flex align-items-center px-3" style={{ height: 44, borderBottom: `1px solid ${C.border}`, flexShrink: 0, gap: 8 }}>
        <i className="bx bxl-docker" style={{ color: '#2496ed', fontSize: 18 }} />
        <span className="fw-medium text-truncate" style={{ fontSize: 14 }}>{assetName || 'Docker'}</span>
        {info && ov.data?.daemonOk && (
          <span className="ms-auto d-flex gap-3" style={{ fontSize: 12, color: C.muted }}>
            <span><i className="bx bxs-circle me-1" style={{ color: '#22c55e', fontSize: 8 }} />{info.running}</span>
            <span><i className="bx bxs-circle me-1" style={{ color: C.dim, fontSize: 8 }} />{info.stopped}</span>
            <span><i className="bx bx-layer me-1" />{info.images}</span>
          </span>
        )}
        {onExpand && <button className="term-tool" title="扩大为标签页" onClick={onExpand} style={{ marginLeft: info ? 8 : 'auto' }}><i className="bx bx-expand-alt" /></button>}
        <button className="term-tool" title="刷新" onClick={refresh} style={{ marginLeft: onExpand || info ? 0 : 'auto' }}><i className="bx bx-refresh" /></button>
      </div>

      {/* 分区标签 */}
      <div className="d-flex" style={{ borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        {SECTIONS.map((s) => {
          const on = section === s.id
          return (
            <button key={s.id} onClick={() => { setSection(s.id); setQ('') }} className="d-flex align-items-center justify-content-center gap-1 flex-fill"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '9px 4px', fontSize: 12, color: on ? C.accent : C.muted, borderBottom: on ? `2px solid ${C.accent}` : '2px solid transparent' }}>
              <i className={`bx ${s.icon}`} style={{ fontSize: 15 }} /><span>{s.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex-grow-1 p-2" style={{ overflowY: 'auto', minHeight: 0, maxWidth: mode === 'page' ? 1100 : undefined, width: '100%', margin: mode === 'page' ? '0 auto' : undefined }}>
        {notAvail ? (
          <Hint danger>{unavailText}</Hint>
        ) : section === 'overview' ? (
          <OverviewSection assetId={assetId} active={active} info={info} daemonOk={ov.data?.daemonOk} onPrune={(t) => run(t, 'prune', undefined, undefined, true)} />
        ) : section === 'compose' ? (
          <ComposeSection data={list.data as any} error={list.isError ? (list.error as any) : null} onAction={doCompose}
            onViewFile={(path, name) => setViewCompose({ path, name })} />
        ) : (
          <>
            {section === 'volumes' && <div className="mb-2 d-flex justify-content-end"><button className="btn btn-sm btn-outline-secondary" onClick={() => askName('新建数据卷', '卷名称', '', (v) => run('volume', 'create', undefined, v))}><i className="bx bx-plus" /> 新建卷</button></div>}
            {section === 'networks' && <div className="mb-2 d-flex justify-content-end"><button className="btn btn-sm btn-outline-secondary" onClick={() => askName('新建网络', '网络名称', '', (v) => run('network', 'create', undefined, v))}><i className="bx bx-plus" /> 新建网络</button></div>}
            {section === 'images' && <div className="mb-2 d-flex justify-content-end gap-2"><button className="btn btn-sm btn-outline-secondary" onClick={() => setRunOpen({ image: '' })}><i className="bx bx-play-circle" /> 运行容器</button><button className="btn btn-sm btn-outline-secondary" onClick={() => askName('拉取镜像', '镜像引用（如 nginx:latest）', '', (v) => openPull(v))}><i className="bx bx-download" /> 拉取镜像</button></div>}
            <SearchInput value={q} onChange={setQ} placeholder="搜索…" />
            {list.isError ? <Hint danger>采集失败：{(list.error as any)?.message}</Hint>
              : !list.data ? <Hint>采集中…</Hint>
                : !list.data.available ? <Hint danger>目标未安装 Docker</Hint>
                  : section === 'containers' ? (
                    <ContainerList data={(list.data as any).containers || []} stats={statsById} ql={ql} mode={mode} busy={busy}
                      onAction={run} onInspect={(id, name) => setInspect({ id, title: name })}
                      onLogs={openLogs} onExec={openExec} onFiles={(id, name) => setFiles({ id, name })}
                      onRename={(id, cur) => askName('重命名容器', '新名称', cur, (v) => run('container', 'rename', id, v))} />
                  ) : section === 'images' ? (
                    <ImageList data={(list.data as any).images || []} ql={ql} mode={mode} busy={busy}
                      onAction={run} onInspect={(id, name) => setInspect({ id, title: name })} onRun={(ref) => setRunOpen({ image: ref })} />
                  ) : section === 'networks' ? (
                    <NetworkList data={(list.data as any).networks || []} ql={ql} busy={busy}
                      onAction={run} onInspect={(id, name) => setInspect({ id, title: name })} />
                  ) : (
                    <VolumeList data={(list.data as any).volumes || []} ql={ql} busy={busy}
                      onAction={run} onInspect={(id, name) => setInspect({ id, title: name })} />
                  )}
          </>
        )}
      </div>

      {stream && <DockerStream url={stream.url} interactive={stream.interactive} title={stream.title} icon={stream.icon} onClose={() => setStream(null)} />}
      {files && <ContainerFiles assetId={assetId} id={files.id} name={files.name} onClose={() => setFiles(null)} />}
      {runOpen && <RunModal initialImage={runOpen.image} onRun={doRun} onClose={() => setRunOpen(null)} />}
      {viewCompose && <ComposeFileModal assetId={assetId} path={viewCompose.path} name={viewCompose.name} onClose={() => setViewCompose(null)} />}
      {inspect && <InspectModal assetId={assetId} id={inspect.id} title={inspect.title} onClose={() => setInspect(null)} />}
      {prompt && <PromptModal title={prompt.title} label={prompt.label} initial={prompt.initial} onOk={prompt.run} onClose={() => setPrompt(null)} />}
    </div>
  )
}

const PRUNE_TARGETS: { type: DockerObjType; label: string }[] = [
  { type: 'system', label: '系统(全部未用)' },
  { type: 'image', label: '镜像' },
  { type: 'container', label: '容器' },
  { type: 'volume', label: '卷' },
  { type: 'network', label: '网络' },
  { type: 'builder', label: '构建缓存' },
]

function OverviewSection({ assetId, active, info, daemonOk, onPrune }: { assetId: string; active: boolean; info?: any; daemonOk?: boolean; onPrune: (t: DockerObjType) => void }) {
  const df = useQuery({ queryKey: ['docker-df', assetId], queryFn: () => dockerApi.df(assetId), enabled: active && !!daemonOk })
  if (!info) return <Hint>采集中…</Hint>
  if (!daemonOk) return <Hint danger>Docker 守护进程未运行或无权限</Hint>
  const cells: [string, React.ReactNode][] = [
    ['版本', info.serverVersion || '—'],
    ['运行 / 全部', `${info.running} / ${info.containers}`],
    ['镜像', info.images],
    ['卷 / 网络', `${info.volumes} / ${info.networks}`],
    ['存储驱动', info.driver || '—'],
    ['系统', [info.os, info.arch].filter(Boolean).join(' · ') || '—'],
    ['CPU', info.ncpu ? info.ncpu + ' 核' : '—'],
    ['内存', info.memTotalKB > 0 ? fmtKB(info.memTotalKB) : '—'],
  ]
  const usage = df.data?.usage || []
  return (
    <>
    <div className="d-grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
      {cells.map(([k, v]) => (
        <div key={k} className="rounded p-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div style={{ color: C.dim, fontSize: 11 }}>{k}</div>
          <div className="text-truncate" style={{ color: C.text, fontSize: 14 }}>{v}</div>
        </div>
      ))}
    </div>

    {/* 磁盘占用 */}
    <div className="rounded mb-3" style={{ background: C.card, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div className="px-2 py-1 d-flex align-items-center" style={{ fontSize: 12, color: C.muted, borderBottom: `1px solid ${C.border}` }}>
        <i className="bx bx-hdd me-1" />磁盘占用{df.isFetching && <i className="bx bx-loader-alt bx-spin ms-2" />}
      </div>
      {usage.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 12, padding: 8, textAlign: 'center' }}>{df.data ? '无数据' : '加载中…'}</div>
      ) : (
        <>
          <div className="d-flex px-2 py-1" style={{ fontSize: 11, color: C.dim }}>
            <span style={{ flex: 1 }}>类型</span><span style={{ width: 44, textAlign: 'right' }}>总数</span><span style={{ width: 60, textAlign: 'right' }}>大小</span><span style={{ width: 72, textAlign: 'right' }}>可回收</span>
          </div>
          {usage.map((u) => (
            <div key={u.type} className="d-flex px-2 py-1" style={{ fontSize: 12, color: C.text, borderTop: `1px solid ${C.border}` }}>
              <span style={{ flex: 1 }}>{u.type}</span><span style={{ width: 44, textAlign: 'right' }}>{u.total}</span><span style={{ width: 60, textAlign: 'right' }}>{u.size}</span><span style={{ width: 72, textAlign: 'right', color: '#f59e0b' }}>{u.reclaimable}</span>
            </div>
          ))}
        </>
      )}
    </div>

    {/* 一键清理 */}
    <div className="rounded p-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}><i className="bx bx-trash me-1" />清理未使用资源（prune）</div>
      <div className="d-flex flex-wrap gap-2">
        {PRUNE_TARGETS.map((p) => (
          <button key={p.type} className="btn btn-sm btn-outline-secondary" onClick={() => onPrune(p.type)}>{p.label}</button>
        ))}
      </div>
    </div>
    </>
  )
}

type ActFn = (type: DockerObjType, action: DockerAction, id?: string, name?: string, danger?: boolean) => void

function ContainerList({ data, stats, ql, mode, busy, onAction, onInspect, onLogs, onExec, onFiles, onRename }: { data: any[]; stats: Record<string, any>; ql: string; mode: 'panel' | 'page'; busy: string; onAction: ActFn; onInspect: (id: string, name: string) => void; onLogs: (id: string, name: string) => void; onExec: (id: string, name: string) => void; onFiles: (id: string, name: string) => void; onRename: (id: string, cur: string) => void }) {
  const shown = data.filter((c) => !ql || c.name.toLowerCase().includes(ql) || (c.image || '').toLowerCase().includes(ql))
  if (shown.length === 0) return <Hint>{data.length ? '无匹配容器' : '暂无容器'}</Hint>
  return (
    <div className="d-grid gap-2" style={{ gridTemplateColumns: mode === 'page' ? 'repeat(auto-fill, minmax(340px, 1fr))' : '1fr' }}>
      {shown.map((ct) => {
        const running = ct.state === 'running'
        const paused = ct.state === 'paused'
        const col = running ? '#22c55e' : paused ? '#f59e0b' : C.dim
        const bz = (a: string) => busy === ct.id + a
        const st = stats[ct.id]
        return (
          <div key={ct.id} className="rounded" style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${col}`, overflow: 'hidden' }}>
            <div className="p-2">
              <div className="d-flex align-items-center gap-2 mb-1">
                <span className="text-truncate fw-medium" style={{ color: C.text, fontSize: 13, flex: 1 }} title={ct.name}>{ct.name}</span>
                <span style={{ fontSize: 10, color: col, background: `${col}22`, padding: '1px 6px', borderRadius: 4 }}>{running ? '运行中' : paused ? '已暂停' : '已退出'}</span>
              </div>
              <div className="d-flex align-items-center gap-2 mb-1">
                <span className="text-truncate" style={{ color: C.dim, fontSize: 11, flex: 1 }} title={ct.image}>{ct.image}</span>
                <span style={{ color: '#5b5f66', fontSize: 10 }}>{ct.id}</span>
              </div>
              {ct.ports && <div className="text-truncate mb-1" style={{ color: C.dim, fontSize: 10 }} title={ct.ports}>{ct.ports}</div>}
              {running && (
                <div className="d-flex align-items-center gap-2 mb-1" style={{ fontSize: 11, color: C.muted }}>
                  <i className="bx bx-chip" style={{ color: '#6ea8fe' }} /><span style={{ width: 46 }}>{st?.cpu || '—'}</span>
                  <span className="ms-auto">{st?.memUsage || '…'}</span>
                </div>
              )}
              <div className="d-flex flex-wrap gap-1 justify-content-end">
                {running ? (
                  <>
                    <IBtn icon="bx-refresh" title="重启" spin={bz('restart')} onClick={() => onAction('container', 'restart', ct.id)} />
                    <IBtn icon="bx-pause" title="暂停" spin={bz('pause')} onClick={() => onAction('container', 'pause', ct.id)} />
                    <IBtn icon="bx-stop" title="停止" spin={bz('stop')} onClick={() => onAction('container', 'stop', ct.id)} />
                  </>
                ) : paused ? (
                  <IBtn icon="bx-play" title="恢复" spin={bz('unpause')} onClick={() => onAction('container', 'unpause', ct.id)} />
                ) : (
                  <IBtn icon="bx-play" title="启动" spin={bz('start')} onClick={() => onAction('container', 'start', ct.id)} />
                )}
                <IBtn icon="bx-file" title="日志" onClick={() => onLogs(ct.id, ct.name)} />
                {running && <IBtn icon="bx-terminal" title="进入终端" onClick={() => onExec(ct.id, ct.name)} />}
                {running && <IBtn icon="bx-folder" title="文件" onClick={() => onFiles(ct.id, ct.name)} />}
                <IBtn icon="bx-rename" title="重命名" onClick={() => onRename(ct.id, ct.name)} />
                <IBtn icon="bx-info-circle" title="详情" onClick={() => onInspect(ct.id, ct.name)} />
                <IBtn icon="bx-trash" title="删除(强制)" danger spin={bz('rm')} onClick={() => onAction('container', 'rm', ct.id, ct.name, true)} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ImageList({ data, ql, mode, busy, onAction, onInspect, onRun }: { data: any[]; ql: string; mode: 'panel' | 'page'; busy: string; onAction: ActFn; onInspect: (id: string, name: string) => void; onRun: (ref: string) => void }) {
  const shown = data.filter((i) => !ql || `${i.repo}:${i.tag}`.toLowerCase().includes(ql))
  if (shown.length === 0) return <Hint>{data.length ? '无匹配镜像' : '暂无镜像'}</Hint>
  return (
    <div className="d-grid gap-2" style={{ gridTemplateColumns: mode === 'page' ? 'repeat(auto-fill, minmax(320px, 1fr))' : '1fr' }}>
      {shown.map((im, i) => {
        const ref = im.tag && im.tag !== '<none>' ? `${im.repo}:${im.tag}` : im.id
        return (
        <div key={im.id + i} className="rounded p-2 d-flex align-items-center gap-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <i className="bx bx-layer" style={{ color: '#6ea8fe' }} />
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="text-truncate" style={{ color: C.text, fontSize: 12 }} title={`${im.repo}:${im.tag}`}>{im.repo}<span style={{ color: C.dim }}>:{im.tag}</span></div>
            <div style={{ color: '#5b5f66', fontSize: 10 }}>{im.id} · {im.size}{im.created ? ' · ' + im.created : ''}</div>
          </div>
          <IBtn icon="bx-play-circle" title="运行为容器" onClick={() => onRun(ref)} />
          <IBtn icon="bx-info-circle" title="详情" onClick={() => onInspect(im.id, `${im.repo}:${im.tag}`)} />
          <IBtn icon="bx-trash" title="删除镜像" danger spin={busy === im.id + 'rm'} onClick={() => onAction('image', 'rm', im.id, `${im.repo}:${im.tag}`, true)} />
        </div>
        )
      })}
    </div>
  )
}

function NetworkList({ data, ql, busy, onAction, onInspect }: { data: any[]; ql: string; busy: string; onAction: ActFn; onInspect: (id: string, name: string) => void }) {
  const shown = data.filter((n) => !ql || n.name.toLowerCase().includes(ql))
  if (shown.length === 0) return <Hint>{data.length ? '无匹配网络' : '暂无网络'}</Hint>
  const builtin = (n: string) => n === 'bridge' || n === 'host' || n === 'none'
  return (
    <div className="d-flex flex-column gap-2">
      {shown.map((n) => (
        <div key={n.id} className="rounded p-2 d-flex align-items-center gap-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <i className="bx bx-network-chart" style={{ color: '#6ea8fe' }} />
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="text-truncate" style={{ color: C.text, fontSize: 12 }} title={n.name}>{n.name}</div>
            <div style={{ color: '#5b5f66', fontSize: 10 }}>{n.driver}</div>
          </div>
          <IBtn icon="bx-info-circle" title="详情" onClick={() => onInspect(n.id, n.name)} />
          {!builtin(n.name) && <IBtn icon="bx-trash" title="删除网络" danger spin={busy === n.id + 'rm'} onClick={() => onAction('network', 'rm', n.id, n.name, true)} />}
        </div>
      ))}
    </div>
  )
}

function VolumeList({ data, ql, busy, onAction, onInspect }: { data: any[]; ql: string; busy: string; onAction: ActFn; onInspect: (id: string, name: string) => void }) {
  const shown = data.filter((v) => !ql || v.name.toLowerCase().includes(ql))
  if (shown.length === 0) return <Hint>{data.length ? '无匹配卷' : '暂无数据卷'}</Hint>
  return (
    <div className="d-flex flex-column gap-2">
      {shown.map((v, i) => (
        <div key={v.name + i} className="rounded p-2 d-flex align-items-center gap-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <i className="bx bx-hdd" style={{ color: '#6ea8fe' }} />
          <span className="text-truncate flex-grow-1" style={{ color: C.text, fontSize: 12 }} title={v.name}>{v.name}</span>
          <span style={{ color: C.dim, fontSize: 11 }}>{v.driver}</span>
          <IBtn icon="bx-info-circle" title="详情" onClick={() => onInspect(v.name, v.name)} />
          <IBtn icon="bx-trash" title="删除卷" danger spin={busy === v.name + 'rm'} onClick={() => onAction('volume', 'rm', v.name, v.name, true)} />
        </div>
      ))}
    </div>
  )
}

function ComposeSection({ data, error, onAction, onViewFile }: { data?: { available: boolean; projects?: any[] }; error: any; onAction: (configFile: string, action: 'up' | 'down' | 'restart') => void; onViewFile: (path: string, name: string) => void }) {
  if (error) return <Hint danger>采集失败：{error?.message}</Hint>
  if (!data) return <Hint>采集中…</Hint>
  if (!data.available) return <Hint>未检测到 docker compose（该主机未安装 compose 插件）</Hint>
  const projects = data.projects || []
  if (projects.length === 0) return <Hint>暂无 compose 项目</Hint>
  const firstPath = (p: string) => (p || '').split(',')[0]
  return (
    <div className="d-flex flex-column gap-2">
      {projects.map((p) => (
        <div key={p.name + p.configFiles} className="rounded p-2" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="d-flex align-items-center gap-2 mb-1">
            <i className="bx bx-collection" style={{ color: '#6ea8fe' }} />
            <span className="text-truncate fw-medium" style={{ color: C.text, fontSize: 13, flex: 1 }} title={p.name}>{p.name}</span>
            <span style={{ fontSize: 10, color: C.muted }}>{p.status}</span>
          </div>
          <div className="text-truncate" style={{ color: '#5b5f66', fontSize: 10 }} title={p.configFiles}>{p.configFiles}</div>
          <div className="d-flex gap-1 justify-content-end mt-1">
            <IBtn icon="bx-play" title="up -d" onClick={() => onAction(firstPath(p.configFiles), 'up')} />
            <IBtn icon="bx-refresh" title="restart" onClick={() => onAction(firstPath(p.configFiles), 'restart')} />
            <IBtn icon="bx-stop" title="down" danger onClick={() => onAction(firstPath(p.configFiles), 'down')} />
            <IBtn icon="bx-file" title="查看 compose 文件" onClick={() => onViewFile(firstPath(p.configFiles), p.name)} />
          </div>
        </div>
      ))}
    </div>
  )
}

function ComposeFileModal({ assetId, path, name, onClose }: { assetId: string; path: string; name: string; onClose: () => void }) {
  const { data, isError, error } = useQuery({ queryKey: ['compose-file', assetId, path], queryFn: () => dockerApi.composeFile(assetId, path) })
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(0,0,0,.5)' }} onClick={onClose} />
      <div className="rounded shadow d-flex flex-column" style={{ position: 'absolute', inset: '6% 6%', zIndex: 31, background: C.bg, border: `1px solid ${C.border}` }}>
        <div className="d-flex align-items-center px-3" style={{ height: 40, borderBottom: `1px solid ${C.border}` }}>
          <i className="bx bx-collection me-2" style={{ color: '#6ea8fe' }} />
          <span className="text-truncate" style={{ color: C.text, fontSize: 13 }}>{name} · {path}</span>
          <button className="term-tool ms-auto" title="关闭" onClick={onClose}><i className="bx bx-x" /></button>
        </div>
        {isError ? <Hint danger>读取失败：{(error as any)?.message}</Hint>
          : <pre style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: 0, padding: 12, background: '#111316', color: '#d4d4d4', fontSize: 12 }}>{data?.content ?? '加载中…'}</pre>}
      </div>
    </>
  )
}

function RunModal({ initialImage, onRun, onClose }: { initialImage: string; onRun: (body: RunReq) => Promise<void> | void; onClose: () => void }) {
  const [image, setImage] = useState(initialImage || '')
  const [name, setName] = useState('')
  const [ports, setPorts] = useState('')
  const [envs, setEnvs] = useState('')
  const [vols, setVols] = useState('')
  const [restart, setRestart] = useState('')
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
  const submit = async () => {
    if (!image.trim()) return
    setBusy(true)
    await onRun({ image: image.trim(), name: name.trim() || undefined, ports: lines(ports), envs: lines(envs), volumes: lines(vols), restart: restart || undefined, command: command.trim() || undefined })
    setBusy(false)
  }
  const ta = { className: 'form-control form-control-sm bg-dark text-light border-secondary', style: { fontSize: 12 } }
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="mb-2"><div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>{label}</div>{children}</div>
  )
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(0,0,0,.5)' }} onClick={onClose} />
      <div className="rounded shadow d-flex flex-column" style={{ position: 'absolute', inset: '4% 8%', zIndex: 31, background: C.bg, border: `1px solid ${C.border}` }}>
        <div className="d-flex align-items-center px-3" style={{ height: 44, borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <i className="bx bx-play-circle me-2" style={{ color: '#22c55e' }} />
          <span style={{ color: C.text, fontSize: 14 }}>运行容器</span>
          <button className="term-tool ms-auto" title="关闭" onClick={onClose}><i className="bx bx-x" /></button>
        </div>
        <div className="p-3" style={{ overflow: 'auto', minHeight: 0 }}>
          <Row label="镜像 *"><input {...ta} value={image} onChange={(e) => setImage(e.target.value)} placeholder="nginx:latest" /></Row>
          <Row label="容器名称"><input {...ta} value={name} onChange={(e) => setName(e.target.value)} placeholder="可选" /></Row>
          <Row label="端口映射（每行一个，如 8080:80）"><textarea {...ta} rows={2} value={ports} onChange={(e) => setPorts(e.target.value)} /></Row>
          <Row label="环境变量（每行一个，KEY=VALUE）"><textarea {...ta} rows={2} value={envs} onChange={(e) => setEnvs(e.target.value)} /></Row>
          <Row label="挂载（每行一个，/host:/container）"><textarea {...ta} rows={2} value={vols} onChange={(e) => setVols(e.target.value)} /></Row>
          <Row label="重启策略">
            <select {...ta} value={restart} onChange={(e) => setRestart(e.target.value)}>
              <option value="">默认(no)</option><option value="always">always</option><option value="unless-stopped">unless-stopped</option><option value="on-failure">on-failure</option>
            </select>
          </Row>
          <Row label="启动命令（可选，覆盖镜像 CMD）"><input {...ta} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="如 sleep 3600" /></Row>
        </div>
        <div className="d-flex justify-content-end gap-2 px-3 pb-3" style={{ flexShrink: 0 }}>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-sm btn-primary" disabled={!image.trim() || busy} onClick={submit}><i className={`bx ${busy ? 'bx-loader-alt bx-spin' : 'bx-play'}`} /> 运行</button>
        </div>
      </div>
    </>
  )
}
