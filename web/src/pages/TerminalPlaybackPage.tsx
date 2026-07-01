import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import * as AsciinemaPlayer from 'asciinema-player'
import 'asciinema-player/dist/bundle/asciinema-player.css'
import { sessionApi, type SessionCommand } from '../api/session'

// 终端录像回放：复用 asciinema-player 播放 .cast（对齐上游 TerminalPlayback.tsx）。
// 命令列表点击 → seek 到对应时间点（pos = (cmd.createdAt - connectedAt)/1000）。
export default function TerminalPlaybackPage() {
  const [sp] = useSearchParams()
  const sessionId = sp.get('sessionId') || ''
  const playerRef = useRef<HTMLDivElement>(null)
  const playerInst = useRef<any>(null)

  const { data: session } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionApi.get(sessionId),
    enabled: !!sessionId,
  })
  const { data: cmds } = useQuery({
    queryKey: ['session-commands', sessionId],
    queryFn: () => sessionApi.commands(sessionId),
    enabled: !!sessionId,
  })

  useEffect(() => {
    if (!playerRef.current || !sessionId) return
    const player = AsciinemaPlayer.create(sessionApi.recordingUrl(sessionId), playerRef.current, {
      fit: 'width',
      autoPlay: true,
      terminalFontSize: '14px',
    })
    playerInst.current = player
    return () => player.dispose()
  }, [sessionId])

  const seekTo = (cmd: SessionCommand) => {
    if (!session || !playerInst.current) return
    const pos = (cmd.createdAt - session.connectedAt) / 1000
    playerInst.current.seek(Math.max(0, pos - 0.5))
  }

  return (
    <div style={{ padding: 16, background: '#1e1e1e', minHeight: '100vh' }}>
      <div className="row g-3">
        <div className="col-lg-8">
          <div ref={playerRef} id="player" style={{ minHeight: '70vh' }} />
        </div>
        <div className="col-lg-4">
          <div className="card custom-card" style={{ background: '#2a2a2a', border: 'none' }}>
            <div className="card-header" style={{ background: '#2a2a2a', borderColor: '#3a3a3a' }}>
              <div className="card-title text-white">命令列表（点击跳转）</div>
            </div>
            <div className="card-body p-0" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {cmds?.items?.length ? (
                <ul className="list-group list-group-flush">
                  {cmds.items.map((r) => (
                    <li
                      key={r.id}
                      className="list-group-item bg-transparent border-0 py-1 px-3"
                      role="button"
                      onClick={() => seekTo(r)}
                      style={{ fontFamily: 'monospace', fontSize: 12, color: '#9cdcfe', cursor: 'pointer' }}
                    >
                      {r.command}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-muted p-3">无命令记录</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
