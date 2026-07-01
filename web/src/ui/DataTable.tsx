import { type ReactNode } from 'react'
import { Spinner, Empty } from './widgets'

export interface Column<T = any> {
  title: ReactNode
  dataIndex?: string
  key?: string
  width?: number | string
  render?: (value: any, record: T) => ReactNode
}

export interface PaginationCfg {
  current: number
  pageSize: number
  total?: number
  onChange: (page: number, pageSize: number) => void
}

interface Props<T> {
  columns: Column<T>[]
  dataSource?: T[]
  rowKey?: string | ((r: T) => string)
  loading?: boolean
  pagination?: PaginationCfg
  size?: 'sm' | 'md'
}

// Ynex/Bootstrap 表格 + 分页。API 仿 antd Table，便于页面移植。
export default function DataTable<T extends Record<string, any>>({
  columns,
  dataSource = [],
  rowKey = 'id',
  loading,
  pagination,
  size = 'md',
}: Props<T>) {
  const keyOf = (r: T, i: number) =>
    typeof rowKey === 'function' ? rowKey(r) : (r[rowKey] ?? String(i))

  const totalPages = pagination?.total
    ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
    : 1

  return (
    <div>
      <div className="table-responsive">
        <table className={`table text-nowrap ${size === 'sm' ? 'table-sm' : ''}`}>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c.key ?? c.dataIndex ?? i} style={{ width: c.width }}>
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length}>
                  <Spinner center />
                </td>
              </tr>
            ) : dataSource.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <Empty />
                </td>
              </tr>
            ) : (
              dataSource.map((r, ri) => (
                <tr key={keyOf(r, ri)}>
                  {columns.map((c, ci) => {
                    const v = c.dataIndex ? r[c.dataIndex] : undefined
                    return (
                      <td key={c.key ?? c.dataIndex ?? ci}>
                        {c.render ? c.render(v, r) : (v as ReactNode)}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total != null && pagination.total > 0 && (
        <div className="d-flex align-items-center justify-content-between flex-wrap mt-2">
          <div className="text-muted fs-12">
            共 {pagination.total} 条 · 第 {pagination.current}/{totalPages} 页
          </div>
          <ul className="pagination mb-0">
            <li className={`page-item ${pagination.current <= 1 ? 'disabled' : ''}`}>
              <button
                className="page-link"
                onClick={() =>
                  pagination.onChange(pagination.current - 1, pagination.pageSize)
                }
              >
                上一页
              </button>
            </li>
            <li className="page-item active">
              <span className="page-link">{pagination.current}</span>
            </li>
            <li
              className={`page-item ${pagination.current >= totalPages ? 'disabled' : ''}`}
            >
              <button
                className="page-link"
                onClick={() =>
                  pagination.onChange(pagination.current + 1, pagination.pageSize)
                }
              >
                下一页
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
