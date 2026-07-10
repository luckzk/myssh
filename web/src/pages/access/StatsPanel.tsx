import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { accessApi } from '../../api/access'
import { toast } from '../../ui'

const fmtBytes = (b: number) => {
  if (b >= 1 << 30) return (b / (1 << 30)).toFixed(1) + 'G'
  if (b >= 1 << 20) return (b / (1 << 20)).toFixed(1) + 'M'
  if (b >= 1 << 10) return (b / (1 << 10)).toFixed(1) + 'K'
  return b + 'B'
}
const fmtKB = (kb: number) => fmtBytes(kb * 1024)
const fmtRate = (bps: number) => fmtBytes(bps) + '/s'
const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d > 0 ? `${d}天${h}时` : `${h}小时`
}
// 健康色（内存/磁盘：绿=健康 → 黄 → 红）
const color = (p: number) => (p >= 85 ? '#ef4444' : p >= 60 ? '#f59e0b' : '#22c55e')
// 占用率 6 档渐变（进程/GPU/容器：红→橙→黄→蓝→青→绿），对齐参考面板
const usageColor = (p: number) =>
  p >= 90 ? '#ef4444' : p >= 70 ? '#f97316' : p >= 50 ? '#eab308' : p >= 30 ? '#3b82f6' : p >= 10 ? '#06b6d4' : '#22c55e'
const fmtMB = (mb: number) => (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GiB' : mb + ' MiB')

// 卡片容器（对齐 demo 监控分块）
function Card({ icon, title, right, children }: { icon: string; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded mb-2 p-3" style={{ background: '#26282B', border: '1px solid #34363a' }}>
      <div className="d-flex align-items-center mb-2" style={{ fontSize: 13 }}>
        <i className={`bx ${icon} me-2`} style={{ color: '#6ea8fe' }} />
        <span className="fw-medium" style={{ color: '#e5e7eb' }}>{title}</span>
        {right != null && <span className="ms-auto" style={{ color: '#9ca3af', fontSize: 12 }}>{right}</span>}
      </div>
      {children}
    </div>
  )
}

// 小信息块
function Box({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded p-2" style={{ background: '#1E1F22' }}>
      <div style={{ color: '#6b7280', fontSize: 11 }}>{label}</div>
      <div className="text-truncate" style={{ color: '#e5e7eb', fontSize: 13 }}>{value}</div>
    </div>
  )
}

// 通用进度条
function Bar({ pct, tint }: { pct: number; tint?: string }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div className="progress" style={{ height: 6, background: '#1E1F22' }}>
      <div className="progress-bar" style={{ width: `${p}%`, background: tint || color(p) }} />
    </div>
  )
}

// CPU 折线（保留最近 N 个采样）
function Sparkline({ data, stroke }: { data: number[]; stroke: string }) {
  const w = 264, h = 90
  if (data.length < 2) return <div style={{ height: h }} className="d-flex align-items-center justify-content-center text-secondary" >采集中…</div>
  const max = 100
  const step = w / (data.length - 1)
  const pts = data.map((v, i) => `${i * step},${h - (v / max) * h}`).join(' ')
  const area = `0,${h} ${pts} ${w},${h}`
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polygon points={area} fill={stroke} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  )
}

// 内存条目（带颜色圆点）
function MemItem({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <div className="text-center" style={{ flex: 1 }}>
      <div className="d-flex align-items-center justify-content-center gap-1" style={{ color: '#9ca3af', fontSize: 11 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, display: 'inline-block' }} />
        {label}
      </div>
      <div style={{ color: '#e5e7eb', fontSize: 13 }}>{value}</div>
    </div>
  )
}

// 空态 / 错误 / 加载提示
function Hint({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={danger ? 'text-danger' : 'text-secondary'} style={{ fontSize: 12, padding: '16px 8px', textAlign: 'center' }}>
      {children}
    </div>
  )
}

// ================= 总览 =================
function OverviewTab({ sessionId, active }: { sessionId: string; active: boolean }) {
  const [cpuHist, setCpuHist] = useState<number[]>([])

  const { data, isError, error } = useQuery({
    queryKey: ['host-stats', sessionId],
    queryFn: () => accessApi.stats(sessionId),
    enabled: active && !!sessionId,
    refetchInterval: 2000,
  })

  useEffect(() => {
    if (data) setCpuHist((h) => [...h, data.cpuPct].slice(-40))
  }, [data])

  const load = (data?.load || '').split(/\s+/).filter(Boolean)

  if (isError) return <Hint danger>采集失败：{(error as any)?.message}</Hint>
  if (!data) return <Hint>采集中…</Hint>
  return (
    <>
      <Card icon="bx-server" title="System">
        <div className="d-grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Box label="主机" value={data.host} />
          <Box label="系统" value={data.os} />
          <Box label="架构" value={data.arch} />
          <Box label="运行时长" value={fmtUptime(data.uptimeSec)} />
        </div>
      </Card>
      <Card icon="bx-tachometer" title="System Load">
        <div className="d-flex gap-2">
          <Box label="1 分钟" value={load[0] ?? '-'} />
          <Box label="5 分钟" value={load[1] ?? '-'} />
          <Box label="15 分钟" value={load[2] ?? '-'} />
        </div>
      </Card>
      <Card icon="bx-chip" title="CPU" right={<span style={{ color: color(data.cpuPct) }}>{data.cpuPct}%</span>}>
        <Sparkline data={cpuHist} stroke={color(data.cpuPct)} />
      </Card>
      <Card icon="bx-memory-card" title="Memory" right={`${fmtKB(data.memUsedKB)} / ${fmtKB(data.memTotalKB)}`}>
        <div className="mb-2"><Bar pct={data.memPct} /></div>
        <div className="d-flex">
          <MemItem dot="#ef4444" label="Used" value={fmtKB(data.memUsedKB)} />
          <MemItem dot="#22c55e" label="Free" value={fmtKB(data.memFreeKB)} />
          <MemItem dot="#9ca3af" label="Cache" value={fmtKB(data.memCacheKB)} />
        </div>
      </Card>
      <Card icon="bx-transfer" title="Disk /" right={<span style={{ color: color(Number(data.diskPct) || 0) }}>{data.diskPct}%</span>}>
        <div className="mb-1"><Bar pct={Number(data.diskPct) || 0} /></div>
        <div className="text-end" style={{ color: '#6b7280', fontSize: 11 }}>{fmtKB(data.diskUsedKB)} / {fmtKB(data.diskTotalKB)}</div>
      </Card>
      <Card icon="bx-network-chart" title="Network">
        <div className="d-flex">
          <div style={{ flex: 1 }} className="d-flex align-items-center gap-2">
            <i className="bx bx-down-arrow-alt" style={{ color: '#22c55e' }} />
            <span style={{ fontSize: 13 }}>{fmtRate(data.netRxBps)}</span>
          </div>
          <div style={{ flex: 1 }} className="d-flex align-items-center gap-2">
            <i className="bx bx-up-arrow-alt" style={{ color: '#6ea8fe' }} />
            <span style={{ fontSize: 13 }}>{fmtRate(data.netTxBps)}</span>
          </div>
        </div>
      </Card>
    </>
  )
}

// 搜索输入（深色）
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="d-flex align-items-center px-2 mb-2" style={{ background: '#26282B', border: '1px solid #34363a', borderRadius: 8, height: 32 }}>
      <i className="bx bx-search" style={{ color: '#6b7280', fontSize: 14 }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ background: 'transparent', border: 'none', outline: 'none', color: '#e5e7eb', fontSize: 12, marginLeft: 6, width: '100%' }}
      />
      {value && <i className="bx bx-x" style={{ color: '#6b7280', cursor: 'pointer' }} onClick={() => onChange('')} />}
    </div>
  )
}

// ================= 进程 =================
function ProcessTab({ sessionId, active }: { sessionId: string; active: boolean }) {
  const [sort, setSort] = useState<'cpu' | 'mem'>('cpu')
  const [q, setQ] = useState('')
  const { data, isError, error } = useQuery({
    queryKey: ['host-procs', sessionId, sort],
    queryFn: () => accessApi.processes(sessionId, sort),
    enabled: active && !!sessionId,
    refetchInterval: 2500,
  })

  const SortBtn = ({ id, label }: { id: 'cpu' | 'mem'; label: string }) => (
    <button
      onClick={() => setSort(id)}
      style={{
        fontSize: 12, padding: '2px 10px', borderRadius: 6, cursor: 'pointer',
        background: sort === id ? '#845adf' : '#26282B',
        color: sort === id ? '#fff' : '#9ca3af', border: '1px solid #34363a',
      }}
    >
      {label}
    </button>
  )

  const shown = (data?.processes || []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || String(p.pid).includes(q))

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-2">
        <span style={{ color: '#9ca3af', fontSize: 12 }}>排序</span>
        <SortBtn id="cpu" label="CPU" />
        <SortBtn id="mem" label="内存" />
        {data && (
          <span className="ms-auto" style={{ background: '#845adf22', color: '#a78bfa', fontSize: 11, padding: '2px 8px', borderRadius: 999 }}>
            总数 {data.total}
          </span>
        )}
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="搜索进程 / PID…" />
      {isError ? (
        <Hint danger>采集失败：{(error as any)?.message}</Hint>
      ) : !data ? (
        <Hint>采集中…</Hint>
      ) : (
        <div className="rounded" style={{ background: '#26282B', border: '1px solid #34363a', overflow: 'hidden' }}>
          <div className="d-flex px-2 py-1" style={{ fontSize: 11, color: '#6b7280', borderBottom: '1px solid #34363a' }}>
            <span style={{ width: 8 }} />
            <span style={{ width: 62 }}>PID</span>
            <span style={{ flex: 1 }}>名称</span>
            <span style={{ width: 44, textAlign: 'right' }}>CPU</span>
            <span style={{ width: 44, textAlign: 'right' }}>内存</span>
          </div>
          {shown.map((p) => {
            const key = sort === 'mem' ? p.mem : p.cpu
            return (
              <div key={p.pid} className="d-flex align-items-center py-1" style={{ fontSize: 12, color: '#e5e7eb', borderBottom: '1px solid #2b2d30' }}>
                <span style={{ width: 3, alignSelf: 'stretch', background: usageColor(key), borderRadius: 2, marginRight: 5, flexShrink: 0 }} />
                <span style={{ width: 62, color: '#6b7280' }}>{p.pid}</span>
                <span className="text-truncate" style={{ flex: 1 }} title={`${p.name} · ${p.user}`}>{p.name}</span>
                <span style={{ width: 44, textAlign: 'right', color: usageColor(p.cpu), fontWeight: 600 }}>{p.cpu.toFixed(1)}</span>
                <span style={{ width: 44, textAlign: 'right', color: usageColor(p.mem) }}>{p.mem.toFixed(1)}</span>
              </div>
            )
          })}
          {shown.length === 0 && <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', padding: 10 }}>无匹配进程</div>}
        </div>
      )}
    </div>
  )
}

// ================= Docker =================
function DockerTab({ sessionId, active }: { sessionId: string; active: boolean }) {
  const qc = useQueryClient()
  const [sub, setSub] = useState<'containers' | 'images' | 'volumes'>('containers')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')

  const { data, isError, error } = useQuery({
    queryKey: ['host-docker', sessionId],
    queryFn: () => accessApi.docker(sessionId),
    enabled: active && !!sessionId,
    refetchInterval: 3000,
  })

  if (isError) return <Hint danger>采集失败：{(error as any)?.message}</Hint>
  if (!data) return <Hint>采集中…</Hint>
  if (!data.available) return <Hint>未获取到 Docker（该主机未安装或无权限）</Hint>

  const info = data.info
  const containers = data.containers || []
  const images = data.images || []
  const volumes = data.volumes || []

  const act = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setBusy(id + action)
    try {
      await accessApi.dockerAction(sessionId, id, action)
      toast.success('操作成功')
      qc.invalidateQueries({ queryKey: ['host-docker', sessionId] })
    } catch (e: any) {
      toast.error('操作失败：' + (e?.message || ''))
    } finally {
      setBusy('')
    }
  }
  const Act = ({ id, action, icon }: { id: string; action: 'start' | 'stop' | 'restart'; icon: string }) => (
    <button
      onClick={() => act(id, action)}
      disabled={busy === id + action}
      title={{ start: '启动', stop: '停止', restart: '重启' }[action]}
      style={{ background: '#1E1F22', border: '1px solid #34363a', borderRadius: 6, color: '#9ca3af', width: 26, height: 24, cursor: 'pointer' }}
    >
      <i className={`bx ${busy === id + action ? 'bx-loader-alt bx-spin' : icon}`} style={{ fontSize: 14 }} />
    </button>
  )

  const SubTab = ({ id, label, n }: { id: typeof sub; label: string; n: number }) => (
    <button
      onClick={() => { setSub(id); setQ('') }}
      style={{
        fontSize: 12, padding: '3px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid #34363a',
        background: sub === id ? '#845adf' : '#26282B', color: sub === id ? '#fff' : '#9ca3af',
      }}
    >
      {label} {n}
    </button>
  )

  const ql = q.toLowerCase()
  const shownC = containers.filter((c) => !q || c.name.toLowerCase().includes(ql) || c.image.toLowerCase().includes(ql))
  const shownI = images.filter((i) => !q || `${i.repo}:${i.tag}`.toLowerCase().includes(ql))
  const shownV = volumes.filter((v) => !q || v.name.toLowerCase().includes(ql))

  return (
    <>
      {info && data.daemonOk ? (
        <Card icon="bxl-docker" title={`Docker${info.serverVersion ? ' ' + info.serverVersion : ''}`}>
          <div className="d-flex gap-3" style={{ fontSize: 12, color: '#9ca3af' }}>
            <span><i className="bx bxs-circle me-1" style={{ color: '#22c55e', fontSize: 8 }} />运行 {info.running}</span>
            <span><i className="bx bxs-circle me-1" style={{ color: '#6b7280', fontSize: 8 }} />停止 {info.stopped}</span>
            <span className="ms-auto"><i className="bx bx-layer me-1" />镜像 {info.images}</span>
          </div>
          {(info.driver || info.os) && (
            <div className="d-flex flex-wrap mt-2" style={{ fontSize: 11, color: '#6b7280', gap: '2px 12px' }}>
              {info.driver && <span>存储 {info.driver}</span>}
              {info.os && <span>{info.os}</span>}
              {info.arch && <span>{info.arch}</span>}
              {info.memTotalKB > 0 && <span>{info.ncpu} 核 / {fmtKB(info.memTotalKB)}</span>}
            </div>
          )}
        </Card>
      ) : (
        <Hint danger>Docker 守护进程未运行或无权限</Hint>
      )}

      {data.daemonOk && (
        <>
          <div className="d-flex gap-2 mb-2">
            <SubTab id="containers" label="容器" n={containers.length} />
            <SubTab id="images" label="镜像" n={images.length} />
            <SubTab id="volumes" label="卷" n={volumes.length} />
          </div>
          <SearchInput value={q} onChange={setQ} placeholder={`搜索${sub === 'containers' ? '容器' : sub === 'images' ? '镜像' : '卷'}…`} />

          {sub === 'containers' && (shownC.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', padding: 8 }}>{containers.length ? '无匹配容器' : '暂无容器'}</div>
          ) : shownC.map((ct) => {
            const running = ct.state === 'running'
            const c = running ? '#22c55e' : '#6b7280'
            return (
              <div key={ct.id} className="rounded mb-2" style={{ background: '#26282B', border: '1px solid #34363a', borderLeft: `3px solid ${c}`, overflow: 'hidden' }}>
                <div className="p-2">
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <span className="text-truncate fw-medium" style={{ color: '#e5e7eb', fontSize: 13, flex: 1 }} title={ct.name}>{ct.name}</span>
                    <span style={{ fontSize: 10, color: c, background: `${c}22`, padding: '1px 6px', borderRadius: 4 }}>{running ? '运行中' : '已退出'}</span>
                  </div>
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <span className="text-truncate" style={{ color: '#6b7280', fontSize: 11, flex: 1 }} title={ct.image}>{ct.image}</span>
                    <span style={{ color: '#5b5f66', fontSize: 10 }}>{ct.id}</span>
                  </div>
                  {running && (
                    <div className="d-flex align-items-center gap-2 mb-1" style={{ fontSize: 11, color: '#9ca3af' }}>
                      <i className="bx bx-chip" style={{ color: '#6ea8fe' }} />
                      <span style={{ width: 42 }}>{ct.cpu || '-'}</span>
                      <div style={{ flex: 1 }}><Bar pct={ct.memPct} /></div>
                      <span style={{ minWidth: 78, textAlign: 'right' }}>{ct.memUsage || '-'}</span>
                    </div>
                  )}
                  <div className="d-flex gap-1 justify-content-end">
                    {running ? (
                      <>
                        <Act id={ct.id} action="restart" icon="bx-refresh" />
                        <Act id={ct.id} action="stop" icon="bx-stop" />
                      </>
                    ) : (
                      <Act id={ct.id} action="start" icon="bx-play" />
                    )}
                  </div>
                </div>
              </div>
            )
          }))}

          {sub === 'images' && (shownI.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', padding: 8 }}>{images.length ? '无匹配镜像' : '暂无镜像'}</div>
          ) : shownI.map((im, i) => (
            <div key={im.id + i} className="rounded mb-2 p-2 d-flex align-items-center gap-2" style={{ background: '#26282B', border: '1px solid #34363a' }}>
              <i className="bx bx-layer" style={{ color: '#6ea8fe' }} />
              <div className="flex-grow-1" style={{ minWidth: 0 }}>
                <div className="text-truncate" style={{ color: '#e5e7eb', fontSize: 12 }} title={`${im.repo}:${im.tag}`}>{im.repo}<span style={{ color: '#6b7280' }}>:{im.tag}</span></div>
                <div style={{ color: '#5b5f66', fontSize: 10 }}>{im.id}</div>
              </div>
              <span style={{ color: '#9ca3af', fontSize: 11 }}>{im.size}</span>
            </div>
          )))}

          {sub === 'volumes' && (shownV.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', padding: 8 }}>{volumes.length ? '无匹配卷' : '暂无数据卷'}</div>
          ) : shownV.map((v, i) => (
            <div key={v.name + i} className="rounded mb-2 p-2 d-flex align-items-center gap-2" style={{ background: '#26282B', border: '1px solid #34363a' }}>
              <i className="bx bx-hdd" style={{ color: '#6ea8fe' }} />
              <span className="text-truncate flex-grow-1" style={{ color: '#e5e7eb', fontSize: 12 }} title={v.name}>{v.name}</span>
              <span style={{ color: '#6b7280', fontSize: 11 }}>{v.driver}</span>
            </div>
          )))}
        </>
      )}
    </>
  )
}

// ================= GPU =================
function GpuTab({ sessionId, active }: { sessionId: string; active: boolean }) {
  const { data, isError, error } = useQuery({
    queryKey: ['host-gpu', sessionId],
    queryFn: () => accessApi.gpu(sessionId),
    enabled: active && !!sessionId,
    refetchInterval: 2500,
  })

  if (isError) return <Hint danger>采集失败：{(error as any)?.message}</Hint>
  if (!data) return <Hint>采集中…</Hint>
  if (!data.available) return <Hint>未检测到 NVIDIA GPU</Hint>

  const gpus = data.gpus
  const maxUtil = gpus.reduce((m, g) => Math.max(m, g.utilPct), 0)
  const maxTemp = gpus.reduce((m, g) => Math.max(m, g.tempC), 0)
  const memUsed = gpus.reduce((s, g) => s + g.memUsedMB, 0)
  const memTotal = gpus.reduce((s, g) => s + g.memTotalMB, 0)

  return (
    <>
      {/* 顶部标题：驱动 + CUDA */}
      <div className="d-flex align-items-center gap-2 mb-2 px-1" style={{ fontSize: 12, color: '#9ca3af' }}>
        <i className="bx bx-chip" style={{ color: '#76b900', fontSize: 15 }} />
        <span>NVIDIA</span>
        {data.driverVersion && <span>驱动 {data.driverVersion}</span>}
        {data.cudaVersion && <span>· CUDA {data.cudaVersion}</span>}
      </div>
      {/* 汇总条 */}
      <div className="d-grid gap-2 mb-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Box label="GPU 数量" value={gpus.length} />
        <Box label="最高利用率" value={<span style={{ color: usageColor(maxUtil) }}>{maxUtil}%</span>} />
        <Box label="显存合计" value={`${fmtMB(memUsed)} / ${fmtMB(memTotal)}`} />
        <Box label="最高温度" value={`${maxTemp} °C`} />
      </div>

      {gpus.map((g) => {
        const memPct = g.memTotalMB > 0 ? (g.memUsedMB * 100) / g.memTotalMB : 0
        return (
          <div key={g.index} className="rounded mb-2" style={{ background: '#26282B', border: '1px solid #34363a', borderLeft: `3px solid ${usageColor(g.utilPct)}`, overflow: 'hidden' }}>
            <div className="p-2">
              <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: 13 }}>
                <span style={{ background: usageColor(g.utilPct), color: '#0b0c0e', fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 6 }}>GPU #{g.index}</span>
                <span className="fw-medium text-truncate" style={{ color: '#e5e7eb', flex: 1 }} title={g.name}>{g.name}</span>
                {g.pstate && <span style={{ color: '#9ca3af', fontSize: 11 }}>{g.pstate}</span>}
              </div>
              <div className="d-flex justify-content-between" style={{ fontSize: 11, color: '#9ca3af' }}>
                <span>GPU 利用率</span><span style={{ color: usageColor(g.utilPct) }}>{g.utilPct}%</span>
              </div>
              <div className="mb-2 mt-1"><Bar pct={g.utilPct} tint={usageColor(g.utilPct)} /></div>
              <div className="d-flex justify-content-between" style={{ fontSize: 11, color: '#9ca3af' }}>
                <span>显存</span><span>{fmtMB(g.memUsedMB)} / {fmtMB(g.memTotalMB)}</span>
              </div>
              <div className="mb-2 mt-1"><Bar pct={memPct} tint="#22c55e" /></div>
              {/* 详情行 */}
              <div className="d-flex flex-wrap" style={{ fontSize: 11, color: '#9ca3af', gap: '2px 12px' }}>
                <span><i className="bx bx-thermometer me-1" style={{ color: '#f59e0b' }} />{g.tempC}°C</span>
                <span><i className="bx bx-bolt-circle me-1" style={{ color: '#6ea8fe' }} />{g.powerW.toFixed(0)}/{g.powerLimitW.toFixed(0)}W</span>
                <span><i className="bx bx-wind me-1" style={{ color: '#22c55e' }} />{g.fanPct < 0 ? '—' : g.fanPct + '%'}</span>
                <span><i className="bx bx-memory-card me-1" />空闲 {fmtMB(g.memFreeMB)}</span>
              </div>
              {g.uuid && <div className="text-truncate mt-1" style={{ fontSize: 10, color: '#5b5f66' }} title={g.uuid}>{g.uuid}</div>}
            </div>
          </div>
        )
      })}
    </>
  )
}

// ================= 面板外壳（Tab） =================
const TABS = [
  { id: 'overview', label: '总览', icon: 'bx-bar-chart-alt-2' },
  { id: 'process', label: '进程', icon: 'bx-list-ul' },
  { id: 'docker', label: 'Docker', icon: 'bxl-docker' },
  { id: 'gpu', label: 'GPU', icon: 'bx-chip' },
] as const

export default function StatsPanel({ sessionId, open }: { sessionId: string; open: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('overview')

  return (
    <div
      className="d-flex flex-column"
      style={{ width: 340, background: '#1E1F22', borderLeft: '1px solid #34363a', color: '#e5e7eb', flexShrink: 0 }}
    >
      {/* Tab 栏 */}
      <div className="d-flex" style={{ borderBottom: '1px solid #34363a', flexShrink: 0 }}>
        {TABS.map((t) => {
          const on = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="d-flex align-items-center justify-content-center gap-1 flex-fill"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '10px 4px', fontSize: 12,
                color: on ? '#845adf' : '#9ca3af',
                borderBottom: on ? '2px solid #845adf' : '2px solid transparent',
              }}
              title={t.label}
            >
              <i className={`bx ${t.icon}`} style={{ fontSize: 15 }} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* 内容 */}
      <div className="flex-grow-1 p-2" style={{ overflowY: 'auto', minHeight: 0 }}>
        {open && sessionId && (
          <>
            {tab === 'overview' && <OverviewTab sessionId={sessionId} active={open} />}
            {tab === 'process' && <ProcessTab sessionId={sessionId} active={open} />}
            {tab === 'docker' && <DockerTab sessionId={sessionId} active={open} />}
            {tab === 'gpu' && <GpuTab sessionId={sessionId} active={open} />}
          </>
        )}
      </div>
    </div>
  )
}
