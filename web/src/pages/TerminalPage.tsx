import { useParams, useSearchParams } from 'react-router-dom'
import TerminalView from './access/TerminalView'

// 独立终端页（深链 / 只读观战链接）。普通连接走 /access 工作台多 tab。
export default function TerminalPage() {
  const { assetId } = useParams()
  const [sp] = useSearchParams()
  const name = sp.get('name') || assetId || ''
  const joinToken = sp.get('join') || ''
  const joinSessionId = sp.get('sessionId') || ''
  return (
    <div style={{ height: '100vh' }}>
      <TerminalView
        assetId={assetId!}
        name={name}
        active
        viewer={!!joinToken}
        joinToken={joinToken}
        joinSessionId={joinSessionId}
      />
    </div>
  )
}
