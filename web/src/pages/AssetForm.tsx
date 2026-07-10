import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { assetApi, credentialApi, type Asset } from '../api/resource'
import { Modal, Field, TextInput, Password, Textarea, Select, Switch, toast } from '../ui'
import AssetIcon from '../components/AssetIcon'

const PROTOCOLS = ['ssh', 'rdp', 'vnc', 'telnet', 'serial', 'local']
const DEFAULT_PORT: Record<string, number> = { ssh: 22, rdp: 3389, vnc: 5900, telnet: 23, serial: 9600, local: 0 }

// 验证方式（对齐 conn_ssh 参考的分段）。值即存入 accountType。
const AUTH_METHODS = [
  { v: 'password', label: '密码' },
  { v: 'private-key', label: '密钥' },
  { v: 'credential', label: '登录凭证' },
  { v: 'keyboard', label: '交互认证' },
  { v: 'ask', label: '每次询问' },
]

const TABS_SSH = ['基本信息', '连接设置', '初始化', '跳板机', '代理设置', '高级设置']
const TABS_OTHER = ['基本信息']

interface JumpGroup {
  label: string
  options: { value: string; label: string }[]
}
interface Props {
  open: boolean
  editing: Asset | null
  groupOptions: { value: string; label: string }[]
  jumpGroups: JumpGroup[] // 跳板候选：按文件夹分组的服务器（optgroup）
  onClose: () => void
  onSaved: () => void
}

// 主机资产 新增/编辑：多 Tab 对话框（对齐 conn_ssh 参考；紫色 Ynex 主题）。
export default function AssetForm({ open, editing, groupOptions, jumpGroups, onClose, onSaved }: Props) {
  const [tab, setTab] = useState('基本信息')
  const [v, setV] = useState<Record<string, any>>({})
  const [testing, setTesting] = useState(false)

  // 凭证下拉（登录凭证模式）
  const { data: creds } = useQuery({ queryKey: ['credentials', 'all'], queryFn: () => credentialApi.paging({ pageIndex: 1, pageSize: 100 }) })
  const credOptions = useMemo(
    () => [{ value: '', label: '请选择凭证' }, ...(creds?.items ?? []).map((c) => ({ value: c.id, label: c.name }))],
    [creds],
  )

  useEffect(() => {
    if (!open) return
    setTab('基本信息')
    if (editing) {
      setV({ ...editing, password: '', privateKey: '', passphrase: '', tags: (editing.tags ?? []).join(', '), gatewayChain: editing.gatewayChain ?? [] })
    } else {
      setV({ protocol: 'ssh', port: 22, accountType: 'password', tags: '', gatewayChain: [], heartbeat: 5000, defaultPath: '' })
    }
  }, [open, editing])

  const set = (k: string, val: any) => setV((c) => ({ ...c, [k]: val }))
  const logoRef = useRef<HTMLInputElement>(null)
  const onPickLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 256 * 1024) return toast.warning('图标不能超过 256KB')
    const reader = new FileReader()
    reader.onload = () => set('logo', String(reader.result))
    reader.readAsDataURL(file)
  }
  const isSsh = v.protocol === 'ssh'
  const isTelnet = v.protocol === 'telnet'
  const isSerial = v.protocol === 'serial'
  const isLocal = v.protocol === 'local'
  const tabs = isSsh ? TABS_SSH : TABS_OTHER
  const auth = v.accountType ?? 'password'

  const buildPayload = () => {
    const tags = String(v.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean)
    const gatewayChain = (v.gatewayChain ?? []).filter(Boolean)
    return { ...v, tags, gatewayChain, gatewayType: gatewayChain.length ? 'ssh-gateway' : '', timeout: Number(v.timeout) || 0, heartbeat: Number(v.heartbeat) || 0, port: Number(v.port) || 0 }
  }

  const save = useMutation({
    mutationFn: () => {
      const p = buildPayload()
      return editing ? assetApi.update(editing.id, p) : assetApi.create(p)
    },
    onSuccess: () => { toast.success('已保存'); onSaved(); onClose() },
    onError: (e: any) => toast.error(e.message),
  })

  const submit = () => {
    if (!v.name) return toast.warning('请输入名称')
    if (!isLocal) {
      if (!v.ip) return toast.warning(isSerial ? '请输入串口设备' : '请输入地址')
      if (!v.port && !isSerial) return toast.warning('请输入端口')
    }
    save.mutate()
  }

  const test = async () => {
    setTesting(true)
    try {
      const r = await assetApi.test(buildPayload())
      r.ok ? toast.success('连接成功') : toast.error('连接失败：' + r.message)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setTesting(false)
    }
  }

  // 跳板机链路操作
  const chain: string[] = v.gatewayChain ?? []
  const setChain = (next: string[]) => set('gatewayChain', next)

  return (
    <Modal
      open={open}
      width={780}
      title={editing ? '编辑主机' : '新增主机'}
      onClose={onClose}
      footer={
        <div className="d-flex w-100 align-items-center justify-content-between">
          <button className="btn btn-light" disabled={testing} onClick={test}>
            {testing && <span className="spinner-border spinner-border-sm me-2" />}
            <i className="bx bx-plug" /> 测试连接
          </button>
          <div className="d-flex gap-2">
            <button className="btn btn-light" onClick={onClose}>取消</button>
            <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>
              {save.isPending && <span className="spinner-border spinner-border-sm me-2" />}
              {editing ? '保存' : '创建'}
            </button>
          </div>
        </div>
      }
    >
      <div className="d-flex align-items-stretch" style={{ minHeight: 360 }}>
        {/* 左竖向 Tab（Ynex tab-style-7）+ 右侧竖线分隔 */}
        <div className="nav flex-column nav-pills tab-style-7 border-end pe-3" role="tablist" style={{ minWidth: 96, flexShrink: 0 }}>
          {tabs.map((t) => (
            <button key={t} type="button" className={`nav-link text-start ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {/* 右内容 */}
        <div className="flex-grow-1 ps-3" style={{ minWidth: 0 }}>
          {tab === '基本信息' && (
            <div className="row gy-3">
              <Field col="col-md-12" label="分组">
                <Select options={groupOptions} value={v.groupId ?? ''} onChange={(e) => set('groupId', e.target.value)} />
              </Field>
              <Field col="col-md-6" label="名称" required>
                <TextInput placeholder="我的服务器" value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field col="col-md-4" label="协议" required>
                <Select options={PROTOCOLS.map((p) => ({ value: p, label: p.toUpperCase() }))} value={v.protocol ?? 'ssh'}
                  onChange={(e) => { const p = e.target.value; setV((c) => ({ ...c, protocol: p, port: DEFAULT_PORT[p] })) }} />
              </Field>
              {!isLocal && (
                <>
                  <Field col="col-md-2" label={isSerial ? '波特率' : '端口'} required>
                    <TextInput type="number" placeholder={isSerial ? '9600' : ''} value={v.port ?? ''} onChange={(e) => set('port', e.target.value === '' ? '' : Number(e.target.value))} />
                  </Field>
                  <Field col="col-12" label={isSerial ? '串口设备' : '地址'} required>
                    <TextInput placeholder={isSerial ? '/dev/ttyUSB0' : '112.221.141.33'} value={v.ip ?? ''} onChange={(e) => set('ip', e.target.value)} />
                  </Field>
                </>
              )}
              {isLocal && (
                <>
                  <Field col="col-md-6" label="Shell" extra="留空=按平台默认（Linux/mac: $SHELL 或 bash；Windows: powershell）">
                    <TextInput placeholder="/bin/bash 或 留空" value={v.username ?? ''} onChange={(e) => set('username', e.target.value)} />
                  </Field>
                  <div className="col-12 text-muted" style={{ fontSize: 12 }}>
                    <i className="bx bx-info-circle me-1" />本地终端 = 给「运行后端的机器」开 shell（极敏感）：需服务端启用 <code>NT_LOCAL_TERMINAL=true</code> 且仅管理员可连；命令过滤仍生效。
                  </div>
                </>
              )}
              <Field col="col-12" label="图标" extra="优先级：自定义 > 系统(连接后自动识别) > 默认。支持 png/jpg/svg，≤256KB">
                <div className="d-flex align-items-center gap-3">
                  <span className="d-inline-flex align-items-center justify-content-center border rounded" style={{ width: 40, height: 40, background: '#f8f9fb' }}>
                    <AssetIcon asset={{ logo: v.logo, os: v.os, protocol: v.protocol }} size={24} />
                  </span>
                  <input ref={logoRef} type="file" accept="image/*" className="d-none" onChange={onPickLogo} />
                  <button type="button" className="btn btn-light btn-sm" onClick={() => logoRef.current?.click()}><i className="bx bx-upload" /> 上传图标</button>
                  {v.logo && <button type="button" className="btn btn-link btn-sm text-secondary p-0" onClick={() => set('logo', '')}>清除</button>}
                </div>
              </Field>

              {isSsh && (
                <div className="col-12">
                  <label className="form-label">验证方式 <span className="text-danger">*</span></label>
                  <div className="btn-group d-flex flex-wrap" role="group">
                    {AUTH_METHODS.map((m) => (
                      <button key={m.v} type="button" className={`btn btn-sm ${auth === m.v ? 'btn-primary' : 'btn-light'}`} style={{ flex: 'none' }} onClick={() => set('accountType', m.v)}>{m.label}</button>
                    ))}
                  </div>
                </div>
              )}

              {!isSerial && !isLocal && (auth === 'credential' ? (
                <Field col="col-12" label="登录凭证">
                  <Select options={credOptions} value={v.credentialId ?? ''} onChange={(e) => set('credentialId', e.target.value)} />
                </Field>
              ) : (
                <>
                  <Field col="col-md-6" label="登录用户" required={isSsh}>
                    <TextInput placeholder="root" value={v.username ?? ''} onChange={(e) => set('username', e.target.value)} />
                  </Field>
                  {auth === 'private-key' ? (
                    <>
                      <Field col="col-md-6" label="私钥口令" extra="私钥有加密口令时填写，无则留空">
                        <Password value={v.passphrase ?? ''} onChange={(e) => set('passphrase', e.target.value)} />
                      </Field>
                      <Field col="col-12" label="私钥" extra={editing ? '留空则不修改' : undefined}>
                        <Textarea rows={4} value={v.privateKey ?? ''} onChange={(e) => set('privateKey', e.target.value)} />
                      </Field>
                    </>
                  ) : auth !== 'ask' ? (
                    <Field col="col-md-6" label="登录密码" extra={editing ? '留空则不修改' : undefined}>
                      <Password value={v.password ?? ''} onChange={(e) => set('password', e.target.value)} />
                    </Field>
                  ) : null}
                </>
              ))}
              {isSerial && (
                <div className="col-12 text-muted" style={{ fontSize: 12 }}>
                  <i className="bx bx-info-circle me-1" />串口连接堡垒机主机本地设备（如 /dev/ttyUSB0），固定 8N1，无需账号密码；仅允许管理员在白名单路径内的设备。
                </div>
              )}
              {isTelnet && (
                <div className="col-12 text-muted" style={{ fontSize: 12 }}>
                  <i className="bx bx-info-circle me-1" />Telnet：登录用户/密码可留空——连接后在提示符手动登录；填写则尝试按 login:/password: 提示自动登录（明文协议，仅用于老旧设备）。
                </div>
              )}

              <Field col="col-md-6" label="标签" extra="英文逗号分隔">
                <TextInput value={v.tags ?? ''} onChange={(e) => set('tags', e.target.value)} />
              </Field>
              <Field col="col-12" label="主机备注">
                <Textarea rows={2} value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} />
              </Field>
            </div>
          )}

          {tab === '连接设置' && (
            <div className="row gy-3">
              <Field col="col-md-6" label="超时时间（毫秒）"><TextInput type="number" value={v.timeout ?? ''} onChange={(e) => set('timeout', e.target.value)} /></Field>
              <Field col="col-md-6" label="心跳时间（毫秒）"><TextInput type="number" placeholder="5000" value={v.heartbeat ?? ''} onChange={(e) => set('heartbeat', e.target.value)} /></Field>
            </div>
          )}

          {tab === '初始化' && (
            <div className="row gy-3">
              <Field col="col-12" label="默认路径"><TextInput placeholder="~" value={v.defaultPath ?? ''} onChange={(e) => set('defaultPath', e.target.value)} /></Field>
              <Field col="col-12" label="初始执行"><Textarea rows={4} placeholder="#!/bin/bash" value={v.initCommand ?? ''} onChange={(e) => set('initCommand', e.target.value)} /></Field>
            </div>
          )}

          {tab === '跳板机' && (
            <div>
              <div className="alert alert-warning py-2" style={{ fontSize: 13 }}>支持多层跳板：列表顶部为第一跳，依次转发到下一跳直至目标主机。</div>
              {chain.map((gid, i) => (
                <div key={i} className="d-flex align-items-center gap-2 mb-2">
                  <span className="text-muted" style={{ width: 56, fontSize: 13 }}>第 {i + 1} 跳</span>
                  <select className="form-select" value={gid} onChange={(e) => { const n = [...chain]; n[i] = e.target.value; setChain(n) }}>
                    <option value="">请选择服务器</option>
                    {jumpGroups.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                  <button className="btn btn-danger-light" onClick={() => setChain(chain.filter((_, j) => j !== i))}><i className="bx bx-trash" /></button>
                </div>
              ))}
              <button className="btn btn-light w-100 border-dashed" style={{ borderStyle: 'dashed' }} onClick={() => setChain([...chain, ''])}><i className="bx bx-plus" /> 添加跳板机</button>
            </div>
          )}

          {tab === '代理设置' && (
            <div>
              <div className="alert alert-warning py-2" style={{ fontSize: 13 }}>
                选择后数据将经代理中转；支持 socks5（如 socks://127.0.0.1:10808）、http（如 http://127.0.0.1:10809）。<span className="text-muted">（暂存，转发待接）</span>
              </div>
              <div className="d-flex align-items-center gap-3 mb-3">
                <span style={{ width: 70 }}>禁用代理</span>
                <Switch checked={!!v.disableProxy} onChange={(b) => set('disableProxy', b)} />
              </div>
              <Field label="代理设置"><TextInput placeholder="未设置" value={v.proxy ?? ''} onChange={(e) => set('proxy', e.target.value)} /></Field>
            </div>
          )}

          {tab === '高级设置' && (
            <div className="row gy-3">
              <div className="col-12 d-flex align-items-center gap-3">
                <span style={{ width: 90 }}>启用 X11 转发</span>
                <Switch checked={!!v.x11} onChange={(b) => set('x11', b)} />
                <span className="text-muted" style={{ fontSize: 12 }}>（暂存，待接）</span>
              </div>
              <Field col="col-md-6" label="X11 Cookie 模式"><TextInput value={v.x11Cookie ?? ''} onChange={(e) => set('x11Cookie', e.target.value)} /></Field>
              <Field col="col-md-6" label="终端显示编码"><TextInput placeholder="如 UTF-8 / GBK，与服务器一致" value={v.encoding ?? ''} onChange={(e) => set('encoding', e.target.value)} /></Field>
              <Field col="col-md-4" label="主机密钥算法"><TextInput placeholder="留空" value={v.hostKeyAlgo ?? ''} onChange={(e) => set('hostKeyAlgo', e.target.value)} /></Field>
              <Field col="col-md-4" label="Cipher 算法"><TextInput placeholder="留空" value={v.cipher ?? ''} onChange={(e) => set('cipher', e.target.value)} /></Field>
              <Field col="col-md-4" label="密钥交换算法"><TextInput placeholder="留空" value={v.kex ?? ''} onChange={(e) => set('kex', e.target.value)} /></Field>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
