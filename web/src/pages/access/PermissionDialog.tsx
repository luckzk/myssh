import { useEffect, useState } from 'react'
import { fsApi } from '../../api/filesystem'
import { Modal, toast } from '../../ui'
import type { FileInfo } from '../../api/filesystem'

type Triple = { r: boolean; w: boolean; x: boolean }
const empty: Triple = { r: false, w: false, x: false }

const tripleToDigit = (t: Triple) => (t.r ? 4 : 0) + (t.w ? 2 : 0) + (t.x ? 1 : 0)
const digitToTriple = (d: number): Triple => ({ r: (d & 4) !== 0, w: (d & 2) !== 0, x: (d & 1) !== 0 })

// 设置权限弹窗（宝塔风格 · 暗色）：表格 行=所有者/所属组/公共 列=读取/写入/执行 + 八进制 + 属主 + 应用到子目录。
export default function PermissionDialog({
  open,
  onClose,
  sessionId,
  file,
  onDone,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  file: FileInfo | null
  onDone: () => void
}) {
  const [owner, setOwner] = useState<Triple>(empty)
  const [group, setGroup] = useState<Triple>(empty)
  const [other, setOther] = useState<Triple>(empty)
  const [ownerUser, setOwnerUser] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [saving, setSaving] = useState(false)

  const octal = `${tripleToDigit(owner)}${tripleToDigit(group)}${tripleToDigit(other)}`

  useEffect(() => {
    if (!open || !file) return
    setRecursive(false)
    fsApi.stat(sessionId, file.path).then(
      (s) => {
        const m = s.mode.padStart(3, '0').slice(-3)
        setOwner(digitToTriple(Number(m[0])))
        setGroup(digitToTriple(Number(m[1])))
        setOther(digitToTriple(Number(m[2])))
        setOwnerUser(s.owner)
      },
      (e) => toast.error(e.message),
    )
  }, [open, file, sessionId])

  const setOctal = (v: string) => {
    const m = v.replace(/[^0-7]/g, '').slice(0, 3).padStart(3, '0')
    setOwner(digitToTriple(Number(m[0])))
    setGroup(digitToTriple(Number(m[1])))
    setOther(digitToTriple(Number(m[2])))
  }

  const save = async () => {
    if (!file) return
    setSaving(true)
    try {
      await fsApi.chmod(sessionId, { path: file.path, mode: octal, owner: ownerUser, recursive })
      toast.success('权限已更新')
      onDone()
      onClose()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  // 一格复选框
  const Cell = ({ val, set, k }: { val: Triple; set: (t: Triple) => void; k: 'r' | 'w' | 'x' }) => (
    <td className="text-center">
      <input
        type="checkbox"
        className="form-check-input mt-0"
        checked={val[k]}
        onChange={(e) => set({ ...val, [k]: e.target.checked })}
      />
    </td>
  )
  const Line = ({ label, val, set }: { label: string; val: Triple; set: (t: Triple) => void }) => (
    <tr>
      <td style={{ color: '#9ca3af' }}>{label}</td>
      <Cell val={val} set={set} k="r" />
      <Cell val={val} set={set} k="w" />
      <Cell val={val} set={set} k="x" />
    </tr>
  )

  const inputDark = 'form-control form-control-sm bg-dark text-light border-secondary'

  return (
    <Modal
      open={open}
      width={420}
      dark
      title={`权限设置${file ? ` [${file.name}]` : ''}`}
      onClose={onClose}
      onOk={save}
      okLoading={saving}
      okText="确定"
    >
      <table
        className="table table-sm align-middle mb-3"
        style={{
          color: '#d4d4d4',
          ['--bs-table-bg' as any]: 'transparent',
          ['--bs-table-color' as any]: '#d4d4d4',
          ['--bs-border-color' as any]: '#34363a',
        }}
      >
        <thead>
          <tr style={{ color: '#6b7280' }}>
            <th style={{ width: '34%', fontWeight: 500 }} />
            <th className="text-center" style={{ fontWeight: 500 }}>读取<span className="text-secondary">(4)</span></th>
            <th className="text-center" style={{ fontWeight: 500 }}>写入<span className="text-secondary">(2)</span></th>
            <th className="text-center" style={{ fontWeight: 500 }}>执行<span className="text-secondary">(1)</span></th>
          </tr>
        </thead>
        <tbody>
          <Line label="所有者" val={owner} set={setOwner} />
          <Line label="所属组" val={group} set={setGroup} />
          <Line label="公共" val={other} set={setOther} />
        </tbody>
      </table>

      <div className="row g-2 align-items-center mb-1">
        <label className="col-3 col-form-label col-form-label-sm" style={{ color: '#9ca3af' }}>权限</label>
        <div className="col-3">
          <input className={inputDark} style={{ textAlign: 'center', fontFamily: 'monospace' }} value={octal} onChange={(e) => setOctal(e.target.value)} />
        </div>
        <label className="col-2 col-form-label col-form-label-sm text-end" style={{ color: '#9ca3af' }}>所有者</label>
        <div className="col-4">
          <input className={inputDark} value={ownerUser} onChange={(e) => setOwnerUser(e.target.value)} placeholder="如 root" />
        </div>
      </div>

      {file?.isDir && (
        <label className="form-check d-flex align-items-center gap-2 mt-2 mb-0" style={{ color: '#d4d4d4' }}>
          <input type="checkbox" className="form-check-input mt-0" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
          应用到子目录
        </label>
      )}
    </Modal>
  )
}
