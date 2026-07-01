import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fsLogApi, type FsLog } from '../api/filesystem'
import { Card, PageHeader, DataTable, Badge, type Column } from '../ui'

// 操作类型 → Bootstrap 语义色（对应 Badge color）。
const ACTION_COLOR: Record<string, 'primary' | 'success' | 'danger' | 'info' | 'warning' | 'secondary'> = {
  upload: 'primary',
  download: 'success',
  rm: 'danger',
  mkdir: 'info',
  rename: 'warning',
  touch: 'secondary',
}

// 文件传输日志：upload/download/rm/mkdir/rename 审计。
export default function FileSystemLogPage() {
  const [page, setPage] = useState({ pageIndex: 1, pageSize: 10 })
  const { data, isLoading } = useQuery({
    queryKey: ['fs-logs', page],
    queryFn: () => fsLogApi.paging(page),
  })

  const fmtSize = (n: number) => (n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)
  const fmtTime = (t: number) => new Date(t).toLocaleString()

  const columns: Column<FsLog>[] = [
    {
      title: '操作',
      dataIndex: 'action',
      render: (a) => <Badge color={ACTION_COLOR[a] || 'secondary'}>{a}</Badge>,
    },
    { title: '路径', dataIndex: 'path' },
    { title: '大小', dataIndex: 'size', render: (n) => (n > 0 ? fmtSize(n) : '-') },
    { title: '时间', dataIndex: 'createdAt', render: (t) => fmtTime(t) },
  ]

  return (
    <>
      <PageHeader title="文件传输日志" crumbs={['日志审计', '文件传输日志']} />
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
