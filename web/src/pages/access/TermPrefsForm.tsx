import { useTermSettings, setTermSettings, THEMES, FONT_FAMILIES, DEFAULT_HIGHLIGHT_RULES, type TermSettings, type HighlightRule } from '../../store/termSettings'

// 终端偏好表单（外观 + 鼠标 + 键盘）。dark=暗色（终端抽屉），否则浅色（设置页）。
export default function TermPrefsForm({ dark = false }: { dark?: boolean }) {
  const s = useTermSettings()
  const muted = dark ? '#9ca3af' : '#6b7280'
  const inputCls = dark ? 'form-select form-select-sm bg-dark text-light border-secondary' : 'form-select'
  const numCls = dark ? 'form-control form-control-sm bg-dark text-light border-secondary' : 'form-control'

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-3">
      <div className="fw-medium mb-2" style={{ color: dark ? '#e5e7eb' : undefined }}>{title}</div>
      {children}
    </div>
  )
  const Toggle = ({ k, label }: { k: keyof TermSettings; label: string }) => (
    <label className="form-check d-flex align-items-center gap-2 mb-2" style={{ color: dark ? '#d4d4d4' : undefined }}>
      <input
        type="checkbox"
        className="form-check-input mt-0"
        checked={s[k] as boolean}
        onChange={(e) => setTermSettings({ [k]: e.target.checked })}
      />
      {label}
    </label>
  )

  return (
    <div>
      <Section title="外观">
        <div className="mb-2">
          <label className="form-label mb-1" style={{ color: muted, fontSize: 13 }}>配色主题</label>
          <select className={inputCls} value={s.theme} onChange={(e) => setTermSettings({ theme: e.target.value })}>
            {Object.entries(THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="d-flex gap-2 mb-1">
          <div style={{ width: 90 }}>
            <label className="form-label mb-1" style={{ color: muted, fontSize: 13 }}>字号</label>
            <input type="number" min={8} max={28} className={numCls} value={s.fontSize}
              onChange={(e) => setTermSettings({ fontSize: Math.max(8, Math.min(28, Number(e.target.value) || 14)) })} />
          </div>
          <div className="flex-grow-1">
            <label className="form-label mb-1" style={{ color: muted, fontSize: 13 }}>字体</label>
            <select className={inputCls} value={s.fontFamily} onChange={(e) => setTermSettings({ fontFamily: e.target.value })}>
              {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f.split(',')[0].replace(/"/g, '')}</option>)}
            </select>
          </div>
        </div>
      </Section>

      <Section title="鼠标">
        <Toggle k="selectionCopy" label="选中复制" />
        <Toggle k="rightClickPaste" label="右键粘贴" />
      </Section>

      <Section title="键盘">
        <Toggle k="interceptSearchHotkey" label="拦截搜索快捷键 (Ctrl/Cmd+F)" />
        <Toggle k="macOptionIsMeta" label="macOS Option 作为 Meta 键" />
      </Section>

      <Section title="关键字高亮">
        <Toggle k="highlightEnabled" label="启用关键字高亮（对输出中的关键字着色，便于阅读繁忙日志）" />
        {s.highlightEnabled && <HighlightRules dark={dark} rules={s.highlightRules} numCls={numCls} muted={muted} />}
      </Section>
    </div>
  )
}

function HighlightRules({ dark, rules, numCls, muted }: { dark: boolean; rules: HighlightRule[]; numCls: string; muted: string }) {
  const setRules = (next: HighlightRule[]) => setTermSettings({ highlightRules: next })
  const update = (i: number, patch: Partial<HighlightRule>) => setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const remove = (i: number) => setRules(rules.filter((_, idx) => idx !== i))
  const add = () => setRules([...rules, { pattern: '', color: '#845adf', regex: false }])
  return (
    <div>
      {rules.map((r, i) => (
        <div key={i} className="d-flex align-items-center gap-2 mb-2">
          <input
            className={numCls}
            style={{ flex: 1 }}
            placeholder="关键字或正则，如 error"
            value={r.pattern}
            onChange={(e) => update(i, { pattern: e.target.value })}
          />
          <input
            type="color"
            className="form-control form-control-sm p-0"
            style={{ width: 34, height: 31, flexShrink: 0 }}
            value={/^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#845adf'}
            onChange={(e) => update(i, { color: e.target.value })}
            title="颜色"
          />
          <label className="d-flex align-items-center gap-1 mb-0" style={{ color: muted, fontSize: 12, flexShrink: 0 }} title="按正则解析">
            <input type="checkbox" className="form-check-input mt-0" checked={!!r.regex} onChange={(e) => update(i, { regex: e.target.checked })} />
            正则
          </label>
          <button className={`btn btn-sm ${dark ? 'btn-dark border-secondary' : 'btn-light'}`} style={{ flexShrink: 0 }} title="删除" onClick={() => remove(i)}>
            <i className="bx bx-x" />
          </button>
        </div>
      ))}
      <div className="d-flex gap-2 mt-1">
        <button className={`btn btn-sm ${dark ? 'btn-dark border-secondary' : 'btn-light'}`} onClick={add}>
          <i className="bx bx-plus" /> 添加规则
        </button>
        <button className="btn btn-sm btn-link p-0 px-1" style={{ color: muted }} onClick={() => setRules(DEFAULT_HIGHLIGHT_RULES)}>
          恢复默认
        </button>
      </div>
    </div>
  )
}
