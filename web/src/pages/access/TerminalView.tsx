import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { api, TOKEN_KEY } from '../../api/client'
import { authApi } from '../../api/auth'
import { accountSessionApi } from '../../api/session'
import { useTermSettings, setTermSettings, THEMES, type TermSettings } from '../../store/termSettings'
import { compileHighlighter, type Highlighter } from '../../store/highlight'
import { Drawer } from '../../ui'
import FileManager from '../FileManager'
import SearchBox from './SearchBox'
import SnippetSheet, { snippetsQuery } from './SnippetSheet'
import StatsPanel from './StatsPanel'
import DockerManager from '../docker/DockerManager'
import ShareModal from './ShareModal'
import ShellAssistantSheet from './ShellAssistantSheet'
import Watermark from './Watermark'
import TermPrefsForm from './TermPrefsForm'
import PortForwardSheet from './PortForwardSheet'

const MsgData = 1
const MsgResize = 2
const MsgExit = 4
const MsgDirChanged = 5
const MsgKeepAlive = 6
const MsgPing = 9
const MsgErrorT = 0
const NEW_TERM_EVENT = 'nt-open-terminal-at'

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
  initCwd?: string // 新建终端到指定目录：连接后自动 cd
  existingSessionId?: string // 重新附着到已存活会话（恢复会话/刷新）
  termId?: string // 工作台内该终端 tab 的 id（广播按当前工作组的 term 集合过滤）
  compact?: boolean // 精简：隐藏顶部状态条（分屏时名称已在分屏标签上显示）
  onSession?: (sessionId: string) => void // 新建会话后回报 sessionId（供工作台持久化以便重新附着）
  onClose?: () => void // 工作台内关闭该 tab；缺省则 window.close()
}

// 单个 SSH 终端会话视图（可被工作台多 tab 保活复用）。
export default function TerminalView({ assetId, name, active, viewer = false, joinToken = '', joinSessionId = '', initCwd = '', existingSessionId = '', termId = '', compact = false, onSession, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const settings = useTermSettings()
  const settingsRef = useRef<TermSettings>(settings)
  settingsRef.current = settings
  // 关键字高亮器（规则变更时重建），在写入 xterm 前对输出着色
  const highlighterRef = useRef<Highlighter>(compileHighlighter(settings.highlightEnabled, settings.highlightRules))
  useEffect(() => {
    highlighterRef.current = compileHighlighter(settings.highlightEnabled, settings.highlightRules)
  }, [settings.highlightEnabled, settings.highlightRules])

  const [sessionId, setSessionId] = useState(viewer ? joinSessionId : '')
  const [status, setStatus] = useState<Status>('connecting')
  const [ping, setPing] = useState<number | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [shellCwd, setShellCwd] = useState('') // 终端目录同步（OSC7 → MsgDirChanged）
  const [fsOpen, setFsOpen] = useState(false)
  const initCwdRef = useRef(initCwd)
  const cwdSentRef = useRef(false)
  const existingSessionIdRef = useRef(existingSessionId)
  const onSessionRef = useRef(onSession)
  onSessionRef.current = onSession
  const pendingBcastRef = useRef<string[]>([]) // 广播到达时若 socket 尚未 OPEN，暂存待连上后补发
  const termIdRef = useRef(termId)
  termIdRef.current = termId
  const [searchOpen, setSearchOpen] = useState(false)
  const [snippetOpen, setSnippetOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [dockerOpen, setDockerOpen] = useState(false)
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
      const detail = (e as CustomEvent<{ text: string; targets?: string[] }>).detail
      const text = detail?.text
      if (typeof text !== 'string' || !text) return
      // 按当前工作组过滤：targets 非空且不含本终端 → 跳过
      if (detail.targets && !detail.targets.includes(termIdRef.current)) return
      const cur = wsRef.current
      if (cur && cur.readyState === WebSocket.OPEN) sendFrame(cur, MsgData, text)
      else pendingBcastRef.current.push(text) // 尚未连上：暂存，onopen 时补发
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
        : `cols=${term.cols}&rows=${term.rows}&sessionId=${sid}&dirFollow=${settingsRef.current.dirFollow ? 1 : 0}&token=${encodeURIComponent(token)}`
      ws = new WebSocket(`${proto}://${location.host}/api/access/terminal?${q}`)
      wsRef.current = ws
      ws.onopen = () => {
        setStatus('connected')
        reconnectAttempts = 0
        if (!isViewer) {
          pingTimer = setInterval(() => sendFrame(ws ?? null, MsgPing, Date.now().toString()), 3000)
          // 补发连接前到达的广播（修复：刚打开的终端 socket 未 OPEN 时会漏收广播）
          if (pendingBcastRef.current.length) {
            pendingBcastRef.current.forEach((t) => sendFrame(ws ?? null, MsgData, t))
            pendingBcastRef.current = []
          }
          // 新建终端到指定目录：连接后自动 cd（只发一次）
          if (initCwdRef.current && !cwdSentRef.current) {
            cwdSentRef.current = true
            setTimeout(() => sendFrame(ws ?? null, MsgData, `cd '${initCwdRef.current.replace(/'/g, `'\\''`)}'\r`), 300)
          }
        }
      }
      ws.onmessage = (e) => {
        const [type, content] = dec(typeof e.data === 'string' ? e.data : '')
        switch (type) {
          case MsgData:
            term.write(highlighterRef.current(content))
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
          case MsgDirChanged:
            if (content) setShellCwd(content)
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
        } else if (existingSessionIdRef.current) {
          // 重新附着到已存活的会话（换浏览器/重登/刷新），不新建、shell 状态不丢
          term.writeln(`\x1b[36m正在恢复会话 ${name} ...\x1b[0m`)
          setSessionId(existingSessionIdRef.current)
          wire(existingSessionIdRef.current, false)
        } else {
          term.writeln(`\x1b[36m正在连接 ${name} ...\x1b[0m`)
          const sess = await api.post('/account/sessions', { assetId, width: term.cols, height: term.rows })
          // 该 effect 已被清理（StrictMode 双挂载/快速卸载）→ 丢弃这次陈旧结果，
          // 否则会用一个终端已 dispose 的 ws 覆盖 wsRef，导致该 tab 手动输入/广播都进不去。
          if (closed) return
          setSessionId(sess.id)
          onSessionRef.current?.(sess.id)
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
      // 卸载=分离（保活），不发 MsgExit——会话在服务器端持续存活，可重新附着。
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

  // 激活该 tab / 切换统计或文件面板 → 终端重排尺寸（否则 xterm 会溢出到面板下方）
  useEffect(() => {
    if (active) setTimeout(() => { fitRef.current?.fit() }, 30)
  }, [active, statsOpen, fsOpen])

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
  // 文件管理右键菜单 → 执行命令到当前终端
  const runInTerminal = (cmd: string) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) sendFrame(ws, MsgData, cmd + '\r')
  }
  // 文件管理「目录跟随」开关 → 持久化偏好 + 实时通知服务端注入/撤销 PROMPT_COMMAND
  const setDirFollow = (on: boolean) => {
    setTermSettings({ dirFollow: on })
    if (sessionId) accountSessionApi.setDirFollow(sessionId, on).catch(() => {})
  }
  // 文件管理右键菜单 → 在指定目录新建终端 tab（交由工作台处理）
  const newTerminalAt = (dir: string) => {
    window.dispatchEvent(new CustomEvent(NEW_TERM_EVENT, { detail: { assetId, name, cwd: dir } }))
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
    <div className="d-flex" style={{ height: '100%', background: '#1E1F22', overflow: 'hidden' }}>
      <div className="d-flex flex-column flex-grow-1" style={{ minWidth: 0, minHeight: 0 }}>
        {!compact && (
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
        )}
        <div style={{ position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'hidden' }} onContextMenu={onContextMenu}>
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

      {dockerOpen && !viewer && (
        <div style={{ width: 360, flexShrink: 0, height: '100%' }}>
          <DockerManager assetId={assetId} assetName={name} mode="panel" />
        </div>
      )}

      {fsOpen && sessionId && !viewer && (
        <div style={{ width: 340, flexShrink: 0, height: '100%' }}>
          <FileManager
            sessionId={sessionId}
            cwd={shellCwd}
            dirFollow={settings.dirFollow}
            onSetDirFollow={setDirFollow}
            onClose={() => setFsOpen(false)}
            onRunInTerminal={runInTerminal}
            onNewTerminalAt={newTerminalAt}
          />
        </div>
      )}

      <div
        className="d-flex flex-column align-items-center py-3 nt-toolrail"
        style={{ width: 44, background: '#1E1F22', borderLeft: '1px solid #34363a', gap: 6, flexShrink: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
        <ToolBtn icon="bx-search" title="搜索" active={searchOpen} onClick={() => setSearchOpen((v) => !v)} />
        {!viewer && (
          <>
            <ToolBtn icon="bx-eraser" title="清屏" onClick={clearScreen} />
            <ToolBtn icon="bx-share-alt" title="会话共享" onClick={() => setShareOpen(true)} disabled={!sessionId} />
            <ToolBtn icon="bx-transfer" title="端口转发" onClick={() => setForwardOpen(true)} disabled={!sessionId} />
            <ToolBtn icon="bx-folder" title="文件管理" active={fsOpen} onClick={() => setFsOpen((v) => !v)} disabled={!sessionId} />
            <ToolBtn icon="bx-bar-chart-alt-2" title="监控统计" active={statsOpen} onClick={() => setStatsOpen((v) => !v)} disabled={!sessionId} />
            <ToolBtn icon="bxl-docker" title="Docker 管理" active={dockerOpen} onClick={() => setDockerOpen((v) => !v)} />
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
