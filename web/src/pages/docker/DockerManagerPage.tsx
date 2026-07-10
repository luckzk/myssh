import { useParams, useSearchParams } from 'react-router-dom'
import DockerManager from './DockerManager'

// 整页 Docker 管理器（深链 /docker/:assetId）。name 经 query 传入,便于标题展示。
export default function DockerManagerPage() {
  const { assetId } = useParams()
  const [sp] = useSearchParams()
  const name = sp.get('name') || assetId || ''
  return (
    <div style={{ height: '100vh', background: '#1E1F22' }}>
      <DockerManager assetId={assetId!} assetName={name} mode="page" />
    </div>
  )
}
