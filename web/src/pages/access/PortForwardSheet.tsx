import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accessApi, type PortForward } from '../../api/access'
import { Drawer, Empty, Spinner, toast } from '../../ui'

const TYPE_LABEL: Record<string, string> = {
  local: '本地',
  remote: '远程',
  dynamic: 'SOCKS5',
}

export default function PortForwardSheet({
  open,
  onClose,
  sessionId,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
}) {
  const qc = useQueryClient()
  const [type, setType] = useState<'local' | 'remote' | 'dynamic'>('local')
  const [listenHost, setListenHost] = useState('127.0.0.1')
  const [listenPort, setListenPort] = useState(0)
  const [targetHost, setTargetHost] = useState('127.0.0.1')
  const [targetPort, setTargetPort] = useState(80)
  const key = ['port-forwards', sessionId]

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => accessApi.forwards(sessionId),
    enabled: open && !!sessionId,
    refetchInterval: open ? 3000 : false,
  })

  const create = useMutation({
    mutationFn: () => accessApi.createForward({ sessionId, type, listenHost, listenPort, targetHost, targetPort }),
    onSuccess: (f) => {
      toast.success(`转发已启动：${f.listenHost}:${f.listenPort}`)
      qc.invalidateQueries({ queryKey: key })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const stop = useMutation({
    mutationFn: (id: string) => accessApi.stopForward(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(e.message),
  })

  const running = (data ?? []).filter((f) => f.status === 'running' || f.status === 'starting')

  return (
    <Drawer open={open} onClose={onClose} dark width={520} title="端口转发">
      <div className="mb-3 p-2 rounded" style={{ background: '#2B2D30' }}>
        <div className="row g-2">
          <div className="col-4">
            <label className="form-label text-secondary fs-12">类型</label>
            <select className="form-select form-select-sm bg-dark text-light border-secondary" value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="local">本地 -L</option>
              <option value="remote">远程 -R</option>
              <option value="dynamic">SOCKS5 -D</option>
            </select>
          </div>
          <div className="col-5">
            <label className="form-label text-secondary fs-12">监听地址</label>
            <input className="form-control form-control-sm bg-dark text-light border-secondary" value={listenHost} onChange={(e) => setListenHost(e.target.value)} />
          </div>
          <div className="col-3">
            <label className="form-label text-secondary fs-12">端口</label>
            <input className="form-control form-control-sm bg-dark text-light border-secondary" type="number" min={0} max={65535} value={listenPort} onChange={(e) => setListenPort(Number(e.target.value) || 0)} />
          </div>
          {type !== 'dynamic' && (
            <>
              <div className="col-8">
                <label className="form-label text-secondary fs-12">目标地址</label>
                <input className="form-control form-control-sm bg-dark text-light border-secondary" value={targetHost} onChange={(e) => setTargetHost(e.target.value)} />
              </div>
              <div className="col-4">
                <label className="form-label text-secondary fs-12">目标端口</label>
                <input className="form-control form-control-sm bg-dark text-light border-secondary" type="number" min={1} max={65535} value={targetPort} onChange={(e) => setTargetPort(Number(e.target.value) || 0)} />
              </div>
            </>
          )}
          <div className="col-12 d-flex justify-content-end">
            <button className="btn btn-sm btn-primary" disabled={create.isPending || !sessionId} onClick={() => create.mutate()}>
              <i className="bx bx-play me-1" />启动
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Spinner center />
      ) : running.length === 0 ? (
        <Empty text="暂无运行中的端口转发" />
      ) : (
        <div className="d-flex flex-column gap-2">
          {running.map((f) => <ForwardItem key={f.id} item={f} onStop={() => stop.mutate(f.id)} stopping={stop.isPending} />)}
        </div>
      )}
    </Drawer>
  )
}

function ForwardItem({ item, onStop, stopping }: { item: PortForward; onStop: () => void; stopping: boolean }) {
  return (
    <div className="p-2 rounded d-flex align-items-center gap-2" style={{ background: '#26282B', border: '1px solid #34363a' }}>
      <span className="badge bg-info-transparent text-info">{TYPE_LABEL[item.type]}</span>
      <div className="flex-grow-1" style={{ minWidth: 0 }}>
        <div className="text-light text-truncate" style={{ fontSize: 13 }}>
          {item.listenHost}:{item.listenPort}
          {item.type !== 'dynamic' && <span className="text-secondary"> → {item.targetHost}:{item.targetPort}</span>}
        </div>
        {item.error && <div className="text-danger text-truncate" style={{ fontSize: 12 }}>{item.error}</div>}
      </div>
      <button className="btn btn-sm btn-danger-light" disabled={stopping} onClick={onStop}>
        停止
      </button>
    </div>
  )
}
