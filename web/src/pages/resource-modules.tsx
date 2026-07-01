import ResourcePage, { type FieldDef } from '../components/ResourcePage'

// 各资源模块的字段配置（对齐 docs/recon/resources.md）。

const visibility = [
  { value: 'public', label: '公开' },
  { value: 'private', label: '私有' },
]

export function SnippetPage() {
  const fields: FieldDef[] = [
    { name: 'name', label: '名称', required: true },
    { name: 'content', label: '命令内容', type: 'textarea', required: true },
    { name: 'visibility', label: '可见性', type: 'select', options: visibility },
  ]
  return <ResourcePage title="命令片段" group="snippets" queryKey="snippets" fields={fields} />
}

export function StoragePage() {
  const fields: FieldDef[] = [
    { name: 'name', label: '名称', required: true },
    { name: 'limitSize', label: '容量上限(字节)', type: 'number' },
    { name: 'isShare', label: '共享', type: 'switch' },
    { name: 'isDefault', label: '默认', type: 'switch' },
  ]
  return <ResourcePage title="存储" group="storages" queryKey="storages" fields={fields} />
}

const dbTypes = ['mysql', 'postgres', 'redis', 'mariadb', 'sqlserver'].map((v) => ({ value: v, label: v }))

export function DatabaseAssetPage() {
  const fields: FieldDef[] = [
    { name: 'name', label: '名称', required: true },
    { name: 'type', label: '类型', type: 'select', options: dbTypes },
    { name: 'host', label: '主机', required: true },
    { name: 'port', label: '端口', type: 'number', required: true },
    { name: 'database', label: '数据库' },
    { name: 'username', label: '用户名' },
    { name: 'password', label: '密码', type: 'password' },
    { name: 'description', label: '描述', type: 'textarea', inTable: false },
  ]
  return <ResourcePage title="数据库资产" group="database-assets" queryKey="database-assets" fields={fields} />
}

export function CertificatePage() {
  const fields: FieldDef[] = [
    { name: 'commonName', label: '通用名(CN)', required: true },
    { name: 'type', label: '类型' },
    { name: 'certificate', label: '证书(PEM)', type: 'textarea', inTable: false },
    { name: 'privateKey', label: '私钥', type: 'password', inTable: false },
    { name: 'requireClientAuth', label: '要求客户端认证', type: 'switch' },
    { name: 'isDefault', label: '默认', type: 'switch' },
  ]
  return <ResourcePage title="证书" group="certificates" queryKey="certificates" fields={fields} />
}

const selModes = [
  { value: 'priority', label: '优先级' },
  { value: 'latency', label: '延迟' },
  { value: 'random', label: '随机' },
]

export function GatewayGroupPage() {
  const fields: FieldDef[] = [
    { name: 'name', label: '名称', required: true },
    { name: 'description', label: '描述', type: 'textarea', inTable: false },
    { name: 'selectionMode', label: '选择模式', type: 'select', options: selModes },
  ]
  return <ResourcePage title="网关组" group="gateway-groups" queryKey="gateway-groups" fields={fields} />
}

const cfgModes = [
  { value: 'direct', label: '直连' },
  { value: 'credential', label: '引用凭证' },
  { value: 'asset', label: '引用资产' },
]

export function SshGatewayPage() {
  const fields: FieldDef[] = [
    { name: 'name', label: '名称', required: true },
    { name: 'configMode', label: '配置模式', type: 'select', options: cfgModes },
    { name: 'ip', label: 'IP', required: true },
    { name: 'port', label: '端口', type: 'number', required: true },
    { name: 'username', label: '用户名' },
    { name: 'password', label: '密码', type: 'password', inTable: false },
  ]
  return <ResourcePage title="SSH 网关" group="ssh-gateways" queryKey="ssh-gateways" fields={fields} />
}
