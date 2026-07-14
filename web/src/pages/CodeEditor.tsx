import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { keymap, EditorView } from '@codemirror/view'
import { EditorState, type Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { StreamLanguage } from '@codemirror/language'
import { unifiedMergeView } from '@codemirror/merge'
import { confirm, toast } from '../ui'

// 语言按需动态加载：基础编辑器包不含各语言语法，用到哪个才拉哪个（首开更快、包更小）。
// 必须用「字面量」import 路径，Vite 才能正确分包。
const legacy = async (m: Promise<any>, key: string): Promise<Extension> => StreamLanguage.define((await m)[key])
const LANG_LOADERS: Record<string, () => Promise<Extension>> = {
  plain: async () => [],
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  typescript: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true }),
  python: async () => (await import('@codemirror/lang-python')).python(),
  json: async () => (await import('@codemirror/lang-json')).json(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
  markdown: async () => (await import('@codemirror/lang-markdown')).markdown(),
  xml: async () => (await import('@codemirror/lang-xml')).xml(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  go: async () => legacy(import('@codemirror/legacy-modes/mode/go'), 'go'),
  shell: async () => legacy(import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  dockerfile: async () => legacy(import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile'),
  nginx: async () => legacy(import('@codemirror/legacy-modes/mode/nginx'), 'nginx'),
  ini: async () => legacy(import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  toml: async () => legacy(import('@codemirror/legacy-modes/mode/toml'), 'toml'),
  c: async () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'c'),
  cpp: async () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'cpp'),
  java: async () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'java'),
  ruby: async () => legacy(import('@codemirror/legacy-modes/mode/ruby'), 'ruby'),
  lua: async () => legacy(import('@codemirror/legacy-modes/mode/lua'), 'lua'),
}
// 下拉里展示的语言（顺序）
const LANG_LIST = ['plain', 'javascript', 'typescript', 'python', 'go', 'shell', 'json', 'yaml', 'html', 'css', 'sql', 'markdown', 'xml', 'dockerfile', 'nginx', 'ini', 'toml', 'c', 'cpp', 'java', 'ruby', 'lua']

const EXT_LANG: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  go: 'go',
  sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell',
  json: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml',
  html: 'html', htm: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  sql: 'sql',
  md: 'markdown', markdown: 'markdown',
  xml: 'xml', svg: 'xml', plist: 'xml', xsl: 'xml',
  conf: 'nginx',
  ini: 'ini', env: 'ini', properties: 'ini', cfg: 'ini',
  toml: 'toml',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
  java: 'java',
  rb: 'ruby',
  lua: 'lua',
}
function detectLang(path: string): string {
  const base = (path.split('/').pop() || '').toLowerCase()
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile'
  if (base.includes('nginx') && base.endsWith('.conf')) return 'nginx'
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return EXT_LANG[ext] || 'plain'
}
const baseOf = (p: string) => p.split('/').pop() || p

// 稳定引用：内联对象会让 react-codemirror 每次渲染都重配 → onUpdate → setState → 死循环。
const BASIC_SETUP = { lineNumbers: true, highlightActiveLine: true, bracketMatching: true, closeBrackets: true, foldGutter: true, highlightSelectionMatches: true, searchKeymap: true }

export default function CodeEditor({ path, initial, readOnly, onSave, onSaveAs, onReread, onClose }: {
  path: string
  initial: string
  readOnly?: boolean
  onSave: (content: string, encoding: string) => Promise<boolean>
  onSaveAs?: (name: string, content: string, encoding: string) => Promise<boolean>
  onReread?: (encoding: string) => Promise<string | null>
  onClose: () => void
}) {
  const [content, setContent] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [lang, setLang] = useState(() => detectLang(path))
  const [wrap, setWrap] = useState(false)
  const [font, setFont] = useState(13)
  const [saving, setSaving] = useState(false)
  const [ro, setRo] = useState(!!readOnly)
  const [diff, setDiff] = useState(false)
  const [encoding, setEncoding] = useState('utf-8')
  const [langExt, setLangExt] = useState<Extension>([])
  const [pos, setPos] = useState({ line: 1, col: 1, sel: 0, lines: initial.split('\n').length })
  const dirty = content !== saved
  const doSaveRef = useRef<() => void>(() => {})

  // 语言语法按需加载（切换语言 / 首次打开时拉取对应语法包）
  useEffect(() => {
    let alive = true
    ;(LANG_LOADERS[lang] || LANG_LOADERS.plain)().then((ext) => { if (alive) setLangExt(ext) }).catch(() => {})
    return () => { alive = false }
  }, [lang])

  const doSave = async () => {
    if (saving || !dirty || ro) return
    setSaving(true)
    const ok = await onSave(content, encoding)
    setSaving(false)
    if (ok) setSaved(content)
  }
  doSaveRef.current = doSave
  const doSaveAs = async () => {
    if (!onSaveAs) return
    const name = window.prompt('另存为（同目录，输入新文件名）', baseOf(path))
    if (!name || !name.trim()) return
    setSaving(true)
    const ok = await onSaveAs(name.trim(), content, encoding)
    setSaving(false)
    if (ok) toast.success('已另存为 ' + name.trim())
  }
  // 切换编码：按新编码重新读取磁盘原文（避免用错编码解码后乱码保存）
  const changeEncoding = async (enc: string) => {
    setEncoding(enc)
    if (onReread) {
      const re = await onReread(enc)
      if (re != null) { setContent(re); setSaved(re) }
    }
  }
  const tryClose = async () => {
    if (dirty && !(await confirm('有未保存的修改，确定关闭？', { danger: true, okText: '放弃修改' }))) return
    onClose()
  }

  const extensions = useMemo<Extension[]>(() => {
    const ext: Extension[] = [
      langExt,
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { doSaveRef.current(); return true } }]),
      EditorView.theme({
        '&': { fontSize: `${font}px` },
        '.cm-content': { fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace' },
        '.cm-scroller': { lineHeight: '1.5' },
      }),
    ]
    if (wrap) ext.push(EditorView.lineWrapping)
    if (ro) ext.push(EditorState.readOnly.of(true), EditorView.editable.of(false))
    if (diff) ext.push(unifiedMergeView({ original: saved }))
    return ext
    // diff 用已保存内容作对照；切换 diff/编码/只读时重建
  }, [langExt, wrap, font, ro, diff, saved])

  const Btn = ({ icon, title, onClick, active }: { icon: string; title: string; onClick: () => void; active?: boolean }) => (
    <button className={`term-tool${active ? ' term-tool-active' : ''}`} title={title} onClick={onClick} style={{ width: 30, height: 30, fontSize: 16 }}>
      <i className={`bx ${icon}`} />
    </button>
  )

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.45)' }} onClick={tryClose} />
      <div className="rounded shadow d-flex flex-column" style={{ position: 'fixed', inset: '6vh 6vw', zIndex: 1101, background: '#1E1F22', border: '1px solid #34363a' }}>
        {/* 顶栏：文件名 + 工具 + 保存 */}
        <div className="d-flex align-items-center px-3 gap-2" style={{ height: 46, borderBottom: '1px solid #34363a', flexShrink: 0 }}>
          <i className="bx bx-edit text-warning" />
          <span className="text-light text-truncate" style={{ flex: 1 }} title={path}>{baseOf(path)}{dirty && <span className="text-warning ms-1">●</span>}</span>

          <select value={lang} onChange={(e) => setLang(e.target.value)} className="form-select form-select-sm bg-dark text-light border-secondary" style={{ width: 'auto', fontSize: 12, height: 30 }} title="语言">
            {LANG_LIST.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={encoding} onChange={(e) => changeEncoding(e.target.value)} className="form-select form-select-sm bg-dark text-light border-secondary" style={{ width: 'auto', fontSize: 12, height: 30 }} title="编码（切换会按新编码重读）">
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK</option>
          </select>
          <Btn icon="bx-text" title="自动换行" active={wrap} onClick={() => setWrap((v) => !v)} />
          <Btn icon="bx-git-compare" title="对比未保存改动 (diff)" active={diff} onClick={() => setDiff((v) => !v)} />
          <Btn icon={ro ? 'bx-lock' : 'bx-lock-open'} title={ro ? '只读（点击可编辑）' : '可编辑（点击设为只读）'} active={ro} onClick={() => setRo((v) => !v)} />
          <Btn icon="bx-zoom-out" title="缩小字号" onClick={() => setFont((f) => Math.max(10, f - 1))} />
          <Btn icon="bx-zoom-in" title="放大字号" onClick={() => setFont((f) => Math.min(24, f + 1))} />
          <span style={{ width: 1, height: 20, background: '#34363a' }} />
          {onSaveAs && <button className="btn btn-sm btn-outline-secondary" disabled={saving} onClick={doSaveAs} title="另存为"><i className="bx bx-save" /> 另存为</button>}
          <button className="btn btn-sm btn-primary" disabled={saving || !dirty || ro} onClick={doSave} title="保存 (Ctrl+S)">
            <i className={`bx ${saving ? 'bx-loader-alt bx-spin' : 'bx-save'}`} /> 保存
          </button>
          <button className="term-tool" title="关闭" onClick={tryClose}><i className="bx bx-x" /></button>
        </div>

        {/* 编辑器 */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <CodeMirror
            value={content}
            height="100%"
            theme={oneDark}
            extensions={extensions}
            onChange={setContent}
            onUpdate={(v) => {
              const s = v.state.selection.main
              const line = v.state.doc.lineAt(s.head)
              const next = { line: line.number, col: s.head - line.from + 1, sel: s.to - s.from, lines: v.state.doc.lines }
              setPos((p) => (p.line === next.line && p.col === next.col && p.sel === next.sel && p.lines === next.lines ? p : next))
            }}
            style={{ height: '100%' }}
            basicSetup={BASIC_SETUP}
          />
        </div>

        {/* 状态栏 */}
        <div className="d-flex align-items-center px-3 gap-3" style={{ height: 26, borderTop: '1px solid #34363a', flexShrink: 0, fontSize: 11, color: '#9ca3af' }}>
          <span>行 {pos.line}:{pos.col}</span>
          {pos.sel > 0 && <span>已选 {pos.sel}</span>}
          <span>共 {pos.lines} 行</span>
          <span>{content.length} 字符</span>
          {ro && <span style={{ color: '#6ea8fe' }}>只读</span>}
          {diff && <span style={{ color: '#845adf' }}>diff</span>}
          <span className="ms-auto">{lang}</span>
          <span>{encoding.toUpperCase()}</span>
          <span style={{ color: dirty ? '#f59e0b' : '#22c55e' }}>{dirty ? '未保存' : '已保存'}</span>
        </div>
      </div>
    </>
  )
}
