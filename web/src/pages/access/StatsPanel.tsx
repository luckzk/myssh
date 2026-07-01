import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { accessApi } from '../../api/access'

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
const color = (p: number) => (p >= 85 ? '#ef4444' : p >= 60 ? '#f59e0b' : '#22c55e')

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

// 监控统计侧面板（demo 同款：System / System Load / CPU / Memory / Network）。
export default function StatsPanel({ sessionId, open }: { sessionId: string; open: boolean }) {
  const [cpuHist, setCpuHist] = useState<number[]>([])
  const lastRef = useRef(0)

  const { data, isError, error } = useQuery({
    queryKey: ['host-stats', sessionId],
    queryFn: () => accessApi.stats(sessionId),
    enabled: open && !!sessionId,
    refetchInterval: 2000,
  })

  useEffect(() => {
    if (data && data.cpuPct !== lastRef.current) {
      lastRef.current = data.cpuPct
    }
    if (data) setCpuHist((h) => [...h, data.cpuPct].slice(-40))
  }, [data])

  const load = (data?.load || '').split(/\s+/).filter(Boolean)

  return (
    <div
      className="d-flex flex-column p-2"
      style={{ width: 320, background: '#1E1F22', borderLeft: '1px solid #34363a', color: '#e5e7eb', flexShrink: 0, overflowY: 'auto' }}
    >
      <div className="d-flex align-items-center gap-2 px-1 py-2">
        <i className="bx bx-bar-chart-alt-2" style={{ color: '#845adf' }} />
        <span className="fw-medium">监控统计</span>
      </div>

      {isError ? (
        <div className="text-danger px-2" style={{ fontSize: 12 }}>采集失败：{(error as any)?.message}</div>
      ) : !data ? (
        <div className="text-secondary px-2" style={{ fontSize: 12 }}>采集中…</div>
      ) : (
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
            <div className="progress mb-2" style={{ height: 6, background: '#1E1F22' }}>
              <div className="progress-bar" style={{ width: `${Math.min(100, data.memPct)}%`, background: color(data.memPct) }} />
            </div>
            <div className="d-flex">
              <MemItem dot="#ef4444" label="Used" value={fmtKB(data.memUsedKB)} />
              <MemItem dot="#22c55e" label="Free" value={fmtKB(data.memFreeKB)} />
              <MemItem dot="#9ca3af" label="Cache" value={fmtKB(data.memCacheKB)} />
            </div>
          </Card>

          <Card icon="bx-transfer" title="Disk /" right={<span style={{ color: color(Number(data.diskPct) || 0) }}>{data.diskPct}%</span>}>
            <div className="progress mb-1" style={{ height: 6, background: '#1E1F22' }}>
              <div className="progress-bar" style={{ width: `${Math.min(100, Number(data.diskPct) || 0)}%`, background: color(Number(data.diskPct) || 0) }} />
            </div>
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
      )}
    </div>
  )
}
