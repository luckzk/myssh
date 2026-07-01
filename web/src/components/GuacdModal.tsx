import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { guacdApi, type Asset } from '../api/resource'
import { Modal, toast } from '../ui'

// guacd 网关：选一台 SSH 资产 → 检测 4822 / 自动安装(Docker) / 设为当前 guacd。
interface Props {
  open: boolean
  onClose: () => void
  sshAssets: Asset[]
}

export default function GuacdModal({ open, onClose, sshAssets }: Props) {
  const qc = useQueryClient()
  const [assetId, setAssetId] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState<'' | 'check' | 'install' | 'select'>('')
  const [log, setLog] = useState<string>('')

  const { data: cfg } = useQuery({
    queryKey: ['guacd-config'],
    queryFn: guacdApi.config,
    enabled: open,
  })

  const check = async () => {
    if (!assetId) return toast.warning('请先选择资产')
    setBusy('check')
    setLog('正在检测 4822 端口…')
    try {
      const r = await guacdApi.check(assetId)
      setLog(
        r.reachable
          ? `✅ ${r.host}:4822 可达（${r.latencyMs} ms）`
          : `❌ ${r.host}:4822 不可达：${r.error ?? '连接失败'}`,
      )
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const install = async () => {
    if (!assetId) return toast.warning('请先选择资产')
    if (!ack) return toast.warning('请先勾选「我已知晓风险」')
    setBusy('install')
    setLog('正在通过 SSH 在目标上安装并启动 guacd（Docker）…')
    try {
      const r = await guacdApi.install(assetId)
      const lines = [
        `架构: ${r.arch || '未知'}`,
        `Docker: ${r.dockerOK ? '可用' : '不可用'}`,
        r.archWarning ? `⚠️ ${r.archWarning}` : '',
        r.message ? `结果: ${r.message}` : '',
        r.output ? `\n输出:\n${r.output}` : '',
      ].filter(Boolean)
      setLog(lines.join('\n'))
      if (r.ok) toast.success('guacd 已启动，建议点「检测 4822」确认')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  const selectHost = async () => {
    if (!assetId) return toast.warning('请先选择资产')
    setBusy('select')
    try {
      await guacdApi.select(assetId)
      toast.success('已设为当前 guacd 主机')
      qc.invalidateQueries({ queryKey: ['guacd-config'] })
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal
      open={open}
      title="guacd 网关"
      width={640}
      onClose={onClose}
      footer={
        <button className="btn btn-light" onClick={onClose}>
          关闭
        </button>
      }
    >
      <div className="alert alert-warning" role="alert">
        <div className="fw-semibold mb-1">
          <i className="bx bx-shield-x me-1" />
          风险提示
        </div>
        <ul className="mb-0 ps-3 fs-13">
          <li>「安装」会经 SSH 在所选主机上执行 Docker 命令拉起 guacd 容器。</li>
          <li>guacd 默认<strong>无认证</strong>，会监听 <code>4822</code>；请确保该主机可信、4822 仅对本服务开放。</li>
          <li>guacd 官方镜像仅 amd64；arm64 主机需 qemu 模拟或换 amd64 主机。</li>
        </ul>
      </div>

      <div className="mb-3">
        <div className="text-muted fs-13">
          当前生效 guacd：
          <code className="ms-1">{cfg?.effectiveAddr || '（未选择，使用配置默认值）'}</code>
        </div>
      </div>

      <div className="mb-3">
        <label className="form-label">guacd 主机（SSH 资产）</label>
        <select
          className="form-select"
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
        >
          <option value="">— 请选择 —</option>
          {sshAssets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}（{a.ip}）
            </option>
          ))}
        </select>
        {sshAssets.length === 0 && (
          <div className="form-text text-warning">暂无 SSH 协议资产，请先在资产列表新增。</div>
        )}
      </div>

      <div className="form-check mb-3">
        <input
          className="form-check-input"
          type="checkbox"
          id="guacd-ack"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        <label className="form-check-label" htmlFor="guacd-ack">
          我已知晓上述风险，授权在该主机执行安装
        </label>
      </div>

      <div className="d-flex gap-2 mb-3">
        <button className="btn btn-light" disabled={busy !== ''} onClick={check}>
          {busy === 'check' && <span className="spinner-border spinner-border-sm me-2" />}
          <i className="bx bx-pulse" /> 检测 4822
        </button>
        <button className="btn btn-warning" disabled={busy !== '' || !ack} onClick={install}>
          {busy === 'install' && <span className="spinner-border spinner-border-sm me-2" />}
          <i className="bx bx-download" /> 安装 guacd
        </button>
        <button className="btn btn-primary" disabled={busy !== ''} onClick={selectHost}>
          {busy === 'select' && <span className="spinner-border spinner-border-sm me-2" />}
          <i className="bx bx-check" /> 设为当前 guacd
        </button>
      </div>

      {log && (
        <pre
          className="bg-light rounded p-2 mb-0 fs-13"
          style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}
        >
          {log}
        </pre>
      )}
    </Modal>
  )
}
