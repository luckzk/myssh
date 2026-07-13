import { useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { keymap, EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { StreamLanguage } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { sql } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { go } from '@codemirror/legacy-modes/mode/go'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { c, cpp, java } from '@codemirror/legacy-modes/mode/clike'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { confirm } from '../ui'

// 语言构造器（按需返回 CodeMirror 扩展）。legacy 模式用 StreamLanguage 包裹。
const sl = (m: any) => () => StreamLanguage.define(m)
const LANGS: Record<string, () => Extension> = {
  plain: () => [],
  javascript: () => javascript({ jsx: true }),
  typescript: () => javascript({ jsx: true, typescript: true }),
  python: () => python(),
  json: () => json(),
  html: () => html(),
  css: () => css(),
  sql: () => sql(),
  markdown: () => markdown(),
  xml: () => xml(),
  yaml: () => yaml(),
  go: sl(go),
  shell: sl(shell),
  dockerfile: sl(dockerFile),
  nginx: sl(nginx),
  ini: sl(properties),
  toml: sl(toml),
  c: sl(c),
  cpp: sl(cpp),
  java: sl(java),
  ruby: sl(ruby),
  lua: sl(lua),
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

export default function CodeEditor({ path, initial, onSave, onClose }: {
  path: string
  initial: string
  onSave: (content: string) => Promise<boolean>
  onClose: () => void
}) {
  const [content, setContent] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [lang, setLang] = useState(() => detectLang(path))
  const [wrap, setWrap] = useState(false)
  const [font, setFont] = useState(13)
  const [saving, setSaving] = useState(false)
  const [pos, setPos] = useState({ line: 1, col: 1, sel: 0, lines: initial.split('\n').length })
  const dirty = content !== saved
  const doSaveRef = useRef<() => void>(() => {})

  const doSave = async () => {
    if (saving || !dirty) return
    setSaving(true)
    const ok = await onSave(content)
    setSaving(false)
    if (ok) setSaved(content)
  }
  doSaveRef.current = doSave
  const tryClose = async () => {
    if (dirty && !(await confirm('有未保存的修改，确定关闭？', { danger: true, okText: '放弃修改' }))) return
    onClose()
  }

  const extensions = useMemo<Extension[]>(() => {
    const ext: Extension[] = [
      (LANGS[lang] || LANGS.plain)(),
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { doSaveRef.current(); return true } }]),
      EditorView.theme({
        '&': { fontSize: `${font}px` },
        '.cm-content': { fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace' },
        '.cm-scroller': { lineHeight: '1.5' },
      }),
    ]
    if (wrap) ext.push(EditorView.lineWrapping)
    return ext
  }, [lang, wrap, font])

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
          <Btn icon="bx-text" title="自动换行" active={wrap} onClick={() => setWrap((v) => !v)} />
          <Btn icon="bx-zoom-out" title="缩小字号" onClick={() => setFont((f) => Math.max(10, f - 1))} />
          <Btn icon="bx-zoom-in" title="放大字号" onClick={() => setFont((f) => Math.min(24, f + 1))} />
          <span style={{ width: 1, height: 20, background: '#34363a' }} />
          <button className="btn btn-sm btn-primary" disabled={saving || !dirty} onClick={doSave} title="保存 (Ctrl+S)">
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
          <span className="ms-auto">{lang}</span>
          <span>UTF-8</span>
          <span style={{ color: dirty ? '#f59e0b' : '#22c55e' }}>{dirty ? '未保存' : '已保存'}</span>
        </div>
      </div>
    </>
  )
}
