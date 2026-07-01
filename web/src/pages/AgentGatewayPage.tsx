import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { makeCrud } from '../api/crud'
import { Card, PageHeader, DataTable, Badge, confirm, toast, type Column } from '../ui'

// Agent 网关：版本提示条 + 注册 Token 管理 + 已注册 Agent 列表（三段式自定义页）。
// 端点取自真实抓包（docs/recon/agent-gateway.md）：
//   GET /api/agent/version、/api/admin/agent-gateway-tokens、/api/admin/agent-gateways

const tokens = makeCrud<any>('agent-gateway-tokens')
const agents = makeCrud<any>('agent-gateways')

function fmtTime(ms?: number) {
  return ms ? new Date(ms).toLocaleString() : '-'
}

export default function AgentGatewayPage() {
  const qc = useQueryClient()
  const [tokPage, setTokPage] = useState({ pageIndex: 1, pageSize: 10 })
  const [agPage, setAgPage] = useState({ pageIndex: 1, pageSize: 10 })

  const version = useQuery({
    queryKey: ['agent-version'],
    queryFn: () => api.get('/agent/version') as Promise<{ version: string }>,
  })

  const tokList = useQuery({
    queryKey: ['agent-gateway-tokens', tokPage],
    queryFn: () => tokens.paging(tokPage),
  })

  const agList = useQuery({
    queryKey: ['agent-gateways', agPage],
    queryFn: () => agents.paging(agPage),
  })

  const genToken = useMutation({
    mutationFn: () => tokens.create({ name: 'token-' + Date.now() }),
    onSuccess: () => {
      toast.success('已生成注册 Token')
      qc.invalidateQueries({ queryKey: ['agent-gateway-tokens'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const delToken = useMutation({
    mutationFn: (id: string) => tokens.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['agent-gateway-tokens'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const delAgent = useMutation({
    mutationFn: (id: string) => agents.remove(id),
    onSuccess: () => {
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['agent-gateways'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('已复制 Token'),
      () => toast.warning('复制失败，请手动选择'),
    )
  }

  const onDelToken = async (id: string) => {
    if (await confirm('确认删除该 Token？', { danger: true, okText: '删除' })) {
      delToken.mutate(id)
    }
  }

  const onDelAgent = async (id: string) => {
    if (await confirm('确认删除该 Agent？', { danger: true, okText: '删除' })) {
      delAgent.mutate(id)
    }
  }

  const tokenCols: Column[] = [
    { title: '名称', dataIndex: 'name' },
    {
      title: 'Token',
      dataIndex: 'token',
      render: (v: string) => (
        <span className="d-inline-flex align-items-center gap-2">
          <code>{v}</code>
          <button
            className="btn btn-sm btn-light"
            title="复制"
            onClick={() => copy(v)}
          >
            <i className="bx bx-copy" />
          </button>
        </span>
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt', render: (v: number) => fmtTime(v) },
    {
      title: '操作',
      key: '__act',
      render: (_, rec: any) => (
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-light" onClick={() => copy(rec.token)}>
            <i className="bx bx-copy" /> 复制
          </button>
          <button className="btn btn-sm btn-danger-light" onClick={() => onDelToken(rec.id)}>
            <i className="bx bx-trash" /> 删除
          </button>
        </div>
      ),
    },
  ]

  const agentCols: Column[] = [
    { title: '名称', dataIndex: 'name' },
    { title: 'IP', dataIndex: 'ip' },
    { title: '系统', dataIndex: 'os' },
    { title: '架构', dataIndex: 'arch' },
    { title: '版本', dataIndex: 'version' },
    {
      title: '状态',
      dataIndex: 'online',
      render: (v: boolean) => (
        <Badge color={v ? 'success' : 'secondary'}>{v ? '在线' : '离线'}</Badge>
      ),
    },
    { title: '注册时间', dataIndex: 'createdAt', render: (v: number) => fmtTime(v) },
    {
      title: '操作',
      key: '__act',
      render: (_, rec: any) => (
        <button className="btn btn-sm btn-danger-light" onClick={() => onDelAgent(rec.id)}>
          <i className="bx bx-trash" /> 删除
        </button>
      ),
    },
  ]

  return (
    <>
      <PageHeader title="Agent 网关" crumbs={['资源管理', 'Agent 网关']} />

      <div className="alert alert-primary" role="alert">
        <div className="fw-semibold">
          当前 Agent 版本：{version.data?.version ?? '...'}
        </div>
        <div className="fs-13">
          生成注册 Token 后，在目标主机部署 Agent 并携带该 Token 注册（POST
          /api/agent/register），注册成功后将出现在下方列表。
        </div>
      </div>

      <Card
        title="注册 Token"
        extra={
          <button
            className="btn btn-primary btn-sm"
            disabled={genToken.isPending}
            onClick={() => genToken.mutate()}
          >
            {genToken.isPending && (
              <span className="spinner-border spinner-border-sm me-2" />
            )}
            <i className="bx bx-plus" /> 生成 Token
          </button>
        }
      >
        <DataTable
          columns={tokenCols}
          dataSource={tokList.data?.items}
          loading={tokList.isLoading}
          rowKey="id"
          size="sm"
          pagination={{
            current: tokPage.pageIndex,
            pageSize: tokPage.pageSize,
            total: tokList.data?.total,
            onChange: (pageIndex, pageSize) => setTokPage({ pageIndex, pageSize }),
          }}
        />
      </Card>

      <Card title="已注册 Agent">
        <DataTable
          columns={agentCols}
          dataSource={agList.data?.items}
          loading={agList.isLoading}
          rowKey="id"
          size="sm"
          pagination={{
            current: agPage.pageIndex,
            pageSize: agPage.pageSize,
            total: agList.data?.total,
            onChange: (pageIndex, pageSize) => setAgPage({ pageIndex, pageSize }),
          }}
        />
      </Card>
    </>
  )
}
