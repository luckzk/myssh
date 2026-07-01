import { useParams, useSearchParams } from 'react-router-dom'
import GraphicsView from './access/GraphicsView'

// 独立图形页（深链）。普通连接走 /access 工作台多 tab。
export default function GraphicsPage() {
  const { assetId } = useParams()
  const [sp] = useSearchParams()
  const name = sp.get('name') || assetId || ''
  return (
    <div style={{ height: '100vh' }}>
      <GraphicsView assetId={assetId!} name={name} active />
    </div>
  )
}
