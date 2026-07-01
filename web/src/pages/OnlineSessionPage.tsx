import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionApi, type Session } from '../api/session'
import { Card, PageHeader, DataTable, Badge, confirm, toast, type Column } from '../ui'

// 在线会话：status=connected 视图，自动刷新（轮询），支持强制下线。
export default function OnlineSessionPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 10 })

  const { data, isLoading } = useQuery({
    queryKey: ['online-sessions', page],
    queryFn: () => sessionApi.paging({ ...page, status: 'connected' }),
    refetchInterval: 3000, // 每 3s 自动刷新
  })

  const kill = useMutation({
    mutationFn: (id: string) => sessionApi.disconnect(id),
    onSuccess: () => {
      toast.success('已强制下线')
      qc.invalidateQueries({ queryKey: ['online-sessions'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const fmtDur = (a: number) => {
    if (!a) return '-'
    const s = Math.max(0, Math.round((Date.now() - a) / 1000))
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`
  }

  const onKill = async (id: string) => {
    if (await confirm('确认强制下线该会话？', { danger: true, okText: '强制下线' })) {
      kill.mutate(id)
    }
  }

  const columns: Column<Session>[] = [
    { title: '用户', dataIndex: 'username' },
    { title: '资产', dataIndex: 'assetName' },
    { title: '协议', dataIndex: 'protocol', render: (v) => <Badge>{v?.toUpperCase()}</Badge> },
    { title: '目标', render: (_, r) => `${r.username}@${r.ip}:${r.port}` },
    { title: '来源', dataIndex: 'clientIp' },
    { title: '已连接', render: (_, r) => fmtDur(r.connectedAt) },
    {
      title: '操作',
      key: '__act',
      render: (_, rec) => (
        <button className="btn btn-sm btn-danger-light" onClick={() => onKill(rec.id)}>
          <i className="bx bx-power-off" /> 强制下线
        </button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="在线会话"
        crumbs={['日志审计', '在线会话']}
        extra={<Badge color="info">自动刷新（3s）· {data?.total ?? 0} 个在线</Badge>}
      />
      <Card>
        <DataTable
          columns={columns}
          dataSource={data?.items}
          loading={isLoading}
          rowKey="id"
          pagination={{
            current: page.pageIndex,
            pageSize: page.pageSize,
            total: data?.total,
            onChange: (pageIndex, pageSize) => setPage({ pageIndex, pageSize }),
          }}
        />
      </Card>
    </>
  )
}
