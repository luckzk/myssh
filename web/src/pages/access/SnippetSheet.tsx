import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { makeCrud } from '../../api/crud'
import { Drawer, Empty, Spinner, toast } from '../../ui'

const snippets = makeCrud<any>('snippets')
export const SNIPPETS_KEY = ['snippets', 'all']
export const snippetsQuery = {
  queryKey: SNIPPETS_KEY,
  queryFn: () => snippets.paging({ pageIndex: 1, pageSize: 100 }),
  staleTime: 5 * 60 * 1000,
}

// 命令片段抽屉（暗色）：列表 + 执行按钮 + 新增。打开即有数据（TerminalPage 预取）。
export default function SnippetSheet({
  open,
  onClose,
  onUse,
}: {
  open: boolean
  onClose: () => void
  onUse: (content: string) => void
}) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  const { data, isLoading } = useQuery({ ...snippetsQuery, enabled: open })

  const create = useMutation({
    mutationFn: () => snippets.create({ name, content, visibility: 'private' }),
    onSuccess: () => {
      toast.success('已新增命令片段')
      setAdding(false)
      setName('')
      setContent('')
      qc.invalidateQueries({ queryKey: SNIPPETS_KEY })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const run = (s: any) => {
    onUse(s.content)
    onClose()
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dark
      width={440}
      title="命令片段"
      extra={
        <button className="term-tool" style={{ width: 28, height: 28, fontSize: 16 }} title="新增片段" onClick={() => setAdding((v) => !v)}>
          <i className={`bx ${adding ? 'bx-x' : 'bx-plus'}`} />
        </button>
      }
    >
      {adding && (
        <div className="mb-3 p-2 rounded" style={{ background: '#2B2D30' }}>
          <input
            className="form-control form-control-sm mb-2 bg-dark text-light border-secondary"
            placeholder="名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="form-control form-control-sm mb-2 bg-dark text-light border-secondary"
            style={{ fontFamily: 'monospace' }}
            rows={3}
            placeholder="命令内容"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="d-flex justify-content-end gap-2">
            <button className="btn btn-sm btn-secondary" onClick={() => setAdding(false)}>取消</button>
            <button className="btn btn-sm btn-primary" disabled={!name || !content || create.isPending} onClick={() => create.mutate()}>
              保存
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Spinner center />
      ) : !data?.items?.length ? (
        <Empty text="暂无命令片段，点右上「+」新增" />
      ) : (
        <div className="d-flex flex-column gap-2">
          {data.items.map((s: any) => (
            <div key={s.id} className="rounded p-2 d-flex align-items-start gap-2" style={{ background: '#2B2D30' }}>
              <div className="flex-grow-1 min-w-0">
                <div className="fw-medium text-truncate" style={{ color: '#e5e7eb' }}>{s.name}</div>
                <code className="d-block text-truncate" style={{ fontSize: 12, color: '#9ca3af' }}>{s.content}</code>
              </div>
              <button className="btn btn-sm btn-primary flex-shrink-0" onClick={() => run(s)}>
                <i className="bx bx-play" /> 执行
              </button>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
