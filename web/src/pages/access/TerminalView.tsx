import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { api, TOKEN_KEY } from '../../api/client'
import { authApi } from '../../api/auth'
import { useTermSettings, setTermSettings, THEMES, type TermSettings } from '../../store/termSettings'
import { Drawer } from '../../ui'
import FileManager from '../FileManager'
import SearchBox from './SearchBox'
import SnippetSheet, { snippetsQuery } from './SnippetSheet'
import StatsPanel from './StatsPanel'
import ShareModal from './ShareModal'
import ShellAssistantSheet from './ShellAssistantSheet'
import Watermark from './Watermark'
import TermPrefsForm from './TermPrefsForm'
import PortForwardSheet from './PortForwardSheet'

const MsgData = 1
const MsgResize = 2
const MsgExit = 4
const MsgKeepAlive = 6
const MsgPing = 9
const MsgErrorT = 0

const enc = (type: number, content = '') => `${type}${content}`
const BROADCAST_EVENT = 'nt-terminal-broadcast'
const sendFrame = (ws: WebSocket | null, type: number, content = '') => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(enc(type, content))
}
const dec = (s: string): [number, string] => {
  if (s === '') return [MsgData, '']
  const t = parseInt(s[0], 10)
  return [Number.isNaN(t) ? MsgData : t, s.slice(1)]
}

type Status = 'connecting' | 'connected' | 'disconnected' | 'error'

function ToolBtn({ icon, title, onClick, disabled, active }: { icon: string; title: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button className={`term-tool${active ? ' term-tool-active' : ''}`} title={title} onClick={onClick} disabled={disabled}>
      <i className={`bx ${icon}`} />
    </button>
  )
}

interface Props {
  assetId: string
  name: string
  active: boolean
  viewer?: boolean
  joinToken?: string
  joinSessionId?: string
  onClose?: () => void // 工作台内关闭该 tab；缺省则 window.close()
}

// 单个 SSH 终端会话视图（可被工作台多 tab 保活复用）。
export default function TerminalView({ assetId, name, active, viewer = false, joinToken = '', joinSessionId = '', onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const settings = useTermSettings()
  const settingsRef = useRef<TermSettings>(settings)
  settingsRef.current = settings

  const [sessionId, setSessionId] = useState(viewer ? joinSessionId : '')
  const [status, setStatus] = useState<Status>('connecting')
  const [ping, setPing] = useState<number | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [fsOpen, setFsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [snippetOpen, setSnippetOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [forwardOpen, setForwardOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)

  const { data: account } = useQuery({ queryKey: ['account-wm'], queryFn: authApi.accountInfo })
  const qc = useQueryClient()
  useEffect(() => {
    qc.prefetchQuery(snippetsQuery)
  }, [qc])

  useEffect(() => {
    if (!ref.current || !assetId) return
    const s0 = settingsRef.current
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: s0.fontFamily,
      fontSize: s0.fontSize,
      disableStdin: viewer,
      macOptionIsMeta: s0.macOptionIsMeta,
      theme: (THEMES[s0.theme] ?? THEMES.dark).theme,
    })
    const fit = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(searchAddon)
    term.open(ref.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    searchRef.current = searchAddon

    // 选中复制
    term.onSelectionChange(() => {
      if (settingsRef.current.selectionCopy && term.hasSelection()) {
        navigator.clipboard?.writeText(term.getSelection()).catch(() => {})
      }
    })
    // 拦截 Ctrl/Cmd+F → 打开终端搜索
    term.attachCustomKeyEventHandler((e) => {
      if (
        settingsRef.current.interceptSearchHotkey &&
        e.type === 'keydown' &&
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'f' || e.key === 'F')
      ) {
        e.preventDefault()
        setSearchOpen(true)
        return false
      }
      return true
    })

    let ws: WebSocket | null = null
    let closed = false
    let pingTimer: any
    let reconnectTimer: any
    let reconnectAttempts = 0
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const token = localStorage.getItem(TOKEN_KEY) || ''
    if (!viewer) {
      term.onData((d) => sendFrame(wsRef.current, MsgData, d))
      term.onResize(({ cols, rows }) => sendFrame(wsRef.current, MsgResize, `${cols},${rows}`))
    }
    const onBroadcast = (e: Event) => {
      if (viewer) return
      const text = (e as CustomEvent<string>).detail
      if (typeof text === 'string' && text) {
        sendFrame(wsRef.current, MsgData, text)
      }
    }
    window.addEventListener(BROADCAST_EVENT, onBroadcast)

    const stopPing = () => {
      clearInterval(pingTimer)
      pingTimer = null
    }
    const wire = (sid: string, isViewer: boolean) => {
      stopPing()
      const q = isViewer
        ? `sessionId=${sid}&join=${encodeURIComponent(joinToken)}&token=${encodeURIComponent(token)}`
        : `cols=${term.cols}&rows=${term.rows}&sessionId=${sid}&token=${encodeURIComponent(token)}`
      ws = new WebSocket(`${proto}://${location.host}/api/access/terminal?${q}`)
      wsRef.current = ws
      ws.onopen = () => {
        setStatus('connected')
        reconnectAttempts = 0
        if (!isViewer) {
          pingTimer = setInterval(() => sendFrame(ws ?? null, MsgPing, Date.now().toString()), 3000)
        }
      }
      ws.onmessage = (e) => {
        const [type, content] = dec(typeof e.data === 'string' ? e.data : '')
        switch (type) {
          case MsgData:
            term.write(content)
            break
          case MsgPing: {
            const t = parseInt(content, 10)
            if (!Number.isNaN(t)) setPing(Date.now() - t)
            break
          }
          case MsgKeepAlive:
            sendFrame(ws ?? null, MsgPing, Date.now().toString())
            break
          case MsgErrorT:
            term.writeln(`\r\n\x1b[31m${content}\x1b[0m`)
            break
          case MsgExit:
            term.writeln(`\r\n\x1b[33m[会话结束] ${content}\x1b[0m`)
            break
        }
      }
      ws.onclose = () => {
        stopPing()
        if (!closed) {
          setStatus('disconnected')
          if (!isViewer && sid) {
            reconnectAttempts += 1
            if (reconnectAttempts <= 10) {
              term.writeln(`\r\n\x1b[33m[连接已断开，正在宽限重连 ${reconnectAttempts}/10]\x1b[0m`)
              reconnectTimer = setTimeout(() => wire(sid, false), 3000)
              return
            }
          }
          term.writeln('\r\n\x1b[31m[连接已断开]\x1b[0m')
        }
      }
    }

    ;(async () => {
      try {
        if (viewer) {
          term.writeln(`\x1b[36m接入观战 ${name} ...\x1b[0m`)
          wire(joinSessionId, true)
        } else {
          term.writeln(`\x1b[36m正在连接 ${name} ...\x1b[0m`)
          const sess = await api.post('/account/sessions', { assetId, width: term.cols, height: term.rows })
          setSessionId(sess.id)
          wire(sess.id, false)
        }
      } catch (err: any) {
        setStatus('error')
        term.writeln(`\r\n\x1b[31m连接失败: ${err.message}\x1b[0m`)
      }
    })()

    const onResize = () => fit.fit()
    window.addEventListener('resize', onResize)
    return () => {
      closed = true
      clearTimeout(reconnectTimer)
      stopPing()
      window.removeEventListener('resize', onResize)
      window.removeEventListener(BROADCAST_EVENT, onBroadcast)
      try { sendFrame(ws, MsgExit, 'close') } catch {}
      ws?.close()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, epoch])

  // macOptionIsMeta 实时跟随设置
  useEffect(() => {
    if (termRef.current) termRef.current.options.macOptionIsMeta = settings.macOptionIsMeta
  }, [settings.macOptionIsMeta])

  // 主题/字体/字号 实时跟随设置
  useEffect(() => {
    const t = termRef.current
    if (!t) return
    t.options.theme = (THEMES[settings.theme] ?? THEMES.dark).theme
    t.options.fontFamily = settings.fontFamily
    t.options.fontSize = settings.fontSize
    setTimeout(() => fitRef.current?.fit(), 0)
  }, [settings.theme, settings.fontFamily, settings.fontSize])

  // 激活该 tab / 切换面板 → 重排尺寸
  useEffect(() => {
    if (active) setTimeout(() => { fitRef.current?.fit(); termRef.current?.focus() }, 30)
  }, [active, statsOpen])

  const clearScreen = () => termRef.current?.clear()
  const changeFont = (delta: number) => {
    const next = Math.max(8, Math.min(28, (termRef.current?.options.fontSize ?? 14) + delta))
    setTermSettings({ fontSize: next }) // 持久化 → 主题/字号 effect 应用并 fit
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen().catch(() => {})
  }
  const reconnect = () => {
    setStatus('connecting')
    setSessionId('')
    setEpoch((e) => e + 1)
  }
  const close = () => (onClose ? onClose() : window.close())
  const closeSession = () => {
    try { sendFrame(wsRef.current, MsgExit, 'close') } catch {}
    close()
  }
  const useSnippet = (content: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      sendFrame(ws, MsgData, content)
      sendFrame(ws, MsgData, '\r')
    }
  }
  const onContextMenu = (e: React.MouseEvent) => {
    if (!settingsRef.current.rightClickPaste || viewer) return
    e.preventDefault()
    navigator.clipboard?.readText().then((t) => {
      if (t) sendFrame(wsRef.current, MsgData, t)
    }).catch(() => {})
  }

  const statusMeta: Record<Status, { color: string; text: string }> = {
    connecting: { color: '#f59e0b', text: '连接中' },
    connected: { color: '#22c55e', text: '已连接' },
    disconnected: { color: '#ef4444', text: '已断开' },
    error: { color: '#ef4444', text: '连接失败' },
  }
  const sm = statusMeta[status]
  const pingColor = ping == null ? '#9ca3af' : ping < 100 ? '#22c55e' : ping < 300 ? '#f59e0b' : '#ef4444'

  return (
    <div className="d-flex" style={{ height: '100%', background: '#1E1F22' }}>
      <div className="d-flex flex-column flex-grow-1" style={{ minWidth: 0 }}>
        <div
          className="d-flex align-items-center px-3"
          style={{ height: 32, background: '#2B2D30', borderBottom: '1px solid #1b1c1e', color: '#cbd5e1', fontSize: 13, gap: 8 }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: sm.color, boxShadow: `0 0 6px ${sm.color}` }} />
          <span className="fw-medium text-truncate" style={{ color: '#e5e7eb' }}>{name}</span>
          <span style={{ color: '#9ca3af' }}>· {sm.text}</span>
          {viewer && <span className="badge bg-warning-transparent text-warning">只读观战</span>}
          <span className="ms-auto d-flex align-items-center gap-3" style={{ fontSize: 12 }}>
            <span style={{ color: pingColor }}>Ping {ping == null ? '--' : `${ping} ms`}</span>
            <span style={{ color: '#6b7280' }}>SSH</span>
          </span>
        </div>
        <div style={{ position: 'relative', flexGrow: 1, minHeight: 0 }} onContextMenu={onContextMenu}>
          <div ref={ref} style={{ height: '100%', width: '100%', padding: 8 }} />
          <Watermark text={account ? `${account.nickname || account.username || ''}` : ''} />
          {searchOpen && (
            <div style={{ position: 'absolute', top: 10, right: 12, zIndex: 10 }}>
              <SearchBox search={searchRef.current} onClose={() => setSearchOpen(false)} />
            </div>
          )}
        </div>
      </div>

      {statsOpen && !viewer && <StatsPanel sessionId={sessionId} open={statsOpen} />}

      <div
        className="d-flex flex-column align-items-center py-3"
        style={{ width: 44, background: '#1E1F22', borderLeft: '1px solid #34363a', gap: 6, flexShrink: 0 }}
      >
        <ToolBtn icon="bx-search" title="搜索" active={searchOpen} onClick={() => setSearchOpen((v) => !v)} />
        {!viewer && (
          <>
            <ToolBtn icon="bx-eraser" title="清屏" onClick={clearScreen} />
            <ToolBtn icon="bx-share-alt" title="会话共享" onClick={() => setShareOpen(true)} disabled={!sessionId} />
            <ToolBtn icon="bx-transfer" title="端口转发" onClick={() => setForwardOpen(true)} disabled={!sessionId} />
            <ToolBtn icon="bx-folder" title="文件管理" onClick={() => setFsOpen(true)} disabled={!sessionId} />
            <ToolBtn icon="bx-bar-chart-alt-2" title="监控统计" active={statsOpen} onClick={() => setStatsOpen((v) => !v)} disabled={!sessionId} />
            <ToolBtn icon="bx-code-block" title="命令片段" onClick={() => setSnippetOpen(true)} disabled={!sessionId} />
            <ToolBtn icon="bx-bot" title="AI 助手（占位）" onClick={() => setAiOpen(true)} />
          </>
        )}
        <ToolBtn icon="bx-zoom-in" title="放大字号" onClick={() => changeFont(1)} />
        <ToolBtn icon="bx-zoom-out" title="缩小字号" onClick={() => changeFont(-1)} />
        <ToolBtn icon="bx-cog" title="终端设置（主题/字体/鼠标/键盘）" onClick={() => setPrefsOpen(true)} />
        <ToolBtn icon="bx-fullscreen" title="全屏" onClick={toggleFullscreen} />
        <ToolBtn icon="bx-refresh" title="重连" onClick={reconnect} />
        <div className="flex-grow-1" />
        <ToolBtn icon="bx-x" title="断开并关闭" onClick={closeSession} />
      </div>

      {sessionId && !viewer && <FileManager sessionId={sessionId} open={fsOpen} onClose={() => setFsOpen(false)} />}
      {sessionId && !viewer && <PortForwardSheet sessionId={sessionId} open={forwardOpen} onClose={() => setForwardOpen(false)} />}
      <SnippetSheet open={snippetOpen} onClose={() => setSnippetOpen(false)} onUse={useSnippet} />
      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} sessionId={sessionId} />
      <ShellAssistantSheet open={aiOpen} onClose={() => setAiOpen(false)} />
      <Drawer open={prefsOpen} onClose={() => setPrefsOpen(false)} dark width={360} title="终端设置">
        <TermPrefsForm dark />
      </Drawer>
    </div>
  )
}
