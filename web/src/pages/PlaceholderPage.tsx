import { useLocation } from 'react-router-dom'
import { MENU_META } from '../menus'
import { PageHeader, Card, Empty } from '../ui'

// 其余模块的占位页：按里程碑逐个替换为真实实现。
export default function PlaceholderPage() {
  const loc = useLocation()
  const key = loc.pathname.replace(/^\//, '')
  const meta = MENU_META.find((m) => m.key === key)
  const label = meta?.label || key
  return (
    <>
      <PageHeader title={label} crumbs={['首页', label]} />
      <Card>
        <Empty text={`模块「${label}」待实现（按路线图后续里程碑交付）`} />
      </Card>
    </>
  )
}
