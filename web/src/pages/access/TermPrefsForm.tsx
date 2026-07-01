import { useTermSettings, setTermSettings, THEMES, FONT_FAMILIES, type TermSettings } from '../../store/termSettings'

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
    </div>
  )
}
