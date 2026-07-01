import { useEffect, useRef, useState } from 'react'
import Guacamole from 'guacamole-common-js'
import { api, TOKEN_KEY } from '../../api/client'

interface Props {
  assetId: string
  name: string
  active: boolean
  onClose?: () => void
}

// 单个图形会话视图（RDP/VNC，经 guacd）。可被工作台多 tab 复用。
export default function GraphicsView({ assetId, name, onClose }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const displayRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('正在连接...')

  useEffect(() => {
    if (!displayRef.current || !assetId) return
    let client: any
    let keyboard: any
    let mouse: any
    const w = wrapRef.current?.clientWidth || window.innerWidth
    const h = wrapRef.current?.clientHeight || window.innerHeight
    ;(async () => {
      try {
        const sess = await api.post('/account/sessions', { assetId, width: w, height: h })
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const token = localStorage.getItem(TOKEN_KEY) || ''
        const tunnel = new Guacamole.WebSocketTunnel(`${proto}://${location.host}/api/access/graphics`)
        client = new Guacamole.Client(tunnel)
        const el = displayRef.current!
        el.innerHTML = ''
        el.appendChild(client.getDisplay().getElement())
        client.onstatechange = (s: number) => {
          const map: Record<number, string> = { 1: '连接中', 2: '等待中', 3: '已连接', 5: '已断开' }
          setStatus(map[s] || '')
        }
        client.onerror = (e: any) => setStatus('错误: ' + (e?.message || ''))
        const params = new URLSearchParams({ sessionId: sess.id, width: String(w), height: String(h), dpi: '96', token }).toString()
        client.connect(params)
        mouse = new Guacamole.Mouse(client.getDisplay().getElement())
        mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = (state: any) => client.sendMouseState(state)
        keyboard = new Guacamole.Keyboard(document)
        keyboard.onkeydown = (k: number) => client.sendKeyEvent(1, k)
        keyboard.onkeyup = (k: number) => client.sendKeyEvent(0, k)
      } catch (e: any) {
        setStatus('连接失败: ' + e.message)
      }
    })()
    return () => {
      try {
        keyboard && (keyboard.onkeydown = keyboard.onkeyup = null)
        client && client.disconnect()
      } catch {}
    }
  }, [assetId])

  return (
    <div className="d-flex flex-column" style={{ height: '100%', background: '#000' }}>
      <div
        className="d-flex align-items-center px-3"
        style={{ height: 32, background: '#2B2D30', borderBottom: '1px solid #1b1c1e', color: '#cbd5e1', fontSize: 13, gap: 8, flexShrink: 0 }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
        <span className="fw-medium text-truncate" style={{ color: '#e5e7eb' }}>{name}</span>
        <span style={{ color: '#9ca3af' }}>· {status}</span>
        <span className="ms-auto" style={{ color: '#6b7280', fontSize: 12 }}>图形</span>
        {onClose && (
          <button className="term-tool ms-2" style={{ width: 26, height: 26, fontSize: 15 }} title="关闭" onClick={onClose}>
            <i className="bx bx-x" />
          </button>
        )}
      </div>
      <div ref={wrapRef} style={{ position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'hidden' }}>
        <div ref={displayRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}
