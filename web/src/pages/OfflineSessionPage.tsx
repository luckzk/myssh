import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionApi, type Session } from '../api/session'
import { Card, PageHeader, DataTable, Badge, confirm, toast, type Column } from '../ui'

// 离线会话列表：已结束、有录像的会话，可回放。
// 在线会话 = 同表 status=connected（后续 online-session 模块）。
export default function OfflineSessionPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 10 })

  const { data, isLoading } = useQuery({
    queryKey: ['offline-sessions', page],
    queryFn: () => sessionApi.paging({ ...page, status: 'disconnected' }),
  })

  const clear = useMutation({
    mutationFn: () => sessionApi.clear(),
    onSuccess: () => {
      toast.success('已清空')
      qc.invalidateQueries({ queryKey: ['offline-sessions'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const fmtDur = (a: number, b: number) => {
    if (!a || !b) return '-'
    const s = Math.max(0, Math.round((b - a) / 1000))
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`
  }
  const fmtSize = (n: number) => (n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)

  const onClear = async () => {
    if (await confirm('确认清空所有离线会话？', { danger: true, okText: '清空' })) {
      clear.mutate()
    }
  }

  const onPlayback = (rec: Session) => {
    if (rec.recordingSize > 0) {
      window.open(`/terminal-playback?sessionId=${rec.id}`, '_blank')
    } else {
      toast.info('该会话无录像')
    }
  }

  const columns: Column<Session>[] = [
    { title: '资产', dataIndex: 'assetName' },
    { title: '协议', dataIndex: 'protocol', render: (v) => <Badge>{v?.toUpperCase()}</Badge> },
    { title: '目标', render: (_, r) => `${r.username}@${r.ip}:${r.port}` },
    { title: '来源', dataIndex: 'clientIp' },
    { title: '时长', render: (_, r) => fmtDur(r.connectedAt, r.disconnectedAt) },
    { title: '命令数', dataIndex: 'commandCount' },
    { title: '录像', dataIndex: 'recordingSize', render: (n) => (n > 0 ? fmtSize(n) : '-') },
    {
      title: '操作',
      key: '__act',
      render: (_, rec) => (
        <button
          className="btn btn-sm btn-light"
          disabled={rec.recordingSize <= 0}
          onClick={() => onPlayback(rec)}
        >
          <i className="bx bx-play-circle" /> 回放
        </button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="离线会话"
        crumbs={['日志审计', '离线会话']}
        extra={
          <button className="btn btn-danger-light" onClick={onClear}>
            <i className="bx bx-trash" /> 清空
          </button>
        }
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
