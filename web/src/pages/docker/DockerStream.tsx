import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// 复用终端数字前缀帧协议（对齐后端 gateway/bridge.go）。
const MsgError = 0, MsgData = 1, MsgResize = 2, MsgExit = 4, MsgPing = 9
const enc = (t: number, c: string) => `${t}${c}`
const dec = (s: string): [number, string] => {
  if (s === '') return [MsgData, '']
  const t = parseInt(s[0], 10)
  return [Number.isNaN(t) ? MsgData : t, s.slice(1)]
}

// Docker 流式视图：日志/pull(只读) 与 exec(交互) 共用。以覆盖层形式嵌在管理器内部。
export default function DockerStream({ url, interactive, title, icon, onClose }: {
  url: string
  interactive: boolean
  title: string
  icon: string
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      convertEol: true, fontSize: 13, scrollback: 5000,
      disableStdin: !interactive, cursorBlink: interactive,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      theme: { background: '#111316', foreground: '#e5e7eb' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    if (ref.current) term.open(ref.current)
    const doFit = () => { try { fit.fit() } catch { /* not mounted */ } }
    setTimeout(doFit, 0)

    const ws = new WebSocket(url)
    let pingIv: ReturnType<typeof setInterval> | undefined
    ws.onopen = () => {
      if (interactive) ws.send(enc(MsgResize, `${term.cols},${term.rows}`))
      pingIv = setInterval(() => { if (ws.readyState === 1) ws.send(enc(MsgPing, Date.now().toString())) }, 5000)
    }
    ws.onmessage = (e) => {
      const [t, c] = dec(typeof e.data === 'string' ? e.data : '')
      if (t === MsgData) term.write(c)
      else if (t === MsgError) term.write(`\r\n\x1b[31m${c}\x1b[0m\r\n`)
      else if (t === MsgExit) term.write(`\r\n\x1b[90m[已结束] ${c}\x1b[0m\r\n`)
    }
    ws.onerror = () => term.write('\r\n\x1b[31m[连接失败]\x1b[0m\r\n')
    ws.onclose = () => { if (pingIv) clearInterval(pingIv) }

    if (interactive) {
      term.onData((d) => { if (ws.readyState === 1) ws.send(enc(MsgData, d)) })
      term.onResize(({ cols, rows }) => { if (ws.readyState === 1) ws.send(enc(MsgResize, `${cols},${rows}`)) })
    }
    const onWinResize = () => doFit()
    window.addEventListener('resize', onWinResize)
    return () => {
      window.removeEventListener('resize', onWinResize)
      if (pingIv) clearInterval(pingIv)
      try { ws.close() } catch { /* ignore */ }
      term.dispose()
    }
  }, [url, interactive])

  return (
    <div className="d-flex flex-column" style={{ position: 'absolute', inset: 0, zIndex: 20, background: '#111316' }}>
      <div className="d-flex align-items-center px-3" style={{ height: 40, borderBottom: '1px solid #34363a', flexShrink: 0, background: '#1E1F22' }}>
        <i className={`bx ${icon} me-2`} style={{ color: '#6ea8fe' }} />
        <span className="text-truncate" style={{ color: '#e5e7eb', fontSize: 13 }}>{title}</span>
        <button className="term-tool ms-auto" title="返回" onClick={onClose}><i className="bx bx-x" /></button>
      </div>
      <div ref={ref} style={{ flex: 1, minHeight: 0, padding: 6 }} />
    </div>
  )
}
