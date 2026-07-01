import { type ReactNode, useState } from 'react'

// 表单字段包装：label + 控件 + 必填星标。
// col 提供时作为栅格列（Ynex「Input Types」网格布局）；否则默认 mb-3 竖排。
export function Field({
  label,
  required,
  extra,
  col,
  children,
}: {
  label: ReactNode
  required?: boolean
  extra?: ReactNode
  col?: string
  children: ReactNode
}) {
  return (
    <div className={col ?? 'mb-3'}>
      <label className="form-label">
        {label}
        {required && <span className="text-danger ms-1">*</span>}
      </label>
      {children}
      {extra && <div className="form-text">{extra}</div>}
    </div>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`form-control ${props.className ?? ''}`} />
}

export function Password(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-group">
      <input
        {...props}
        type={show ? 'text' : 'password'}
        className={`form-control ${props.className ?? ''}`}
      />
      <button
        type="button"
        className="btn btn-light"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
      >
        <i className={`bx ${show ? 'bx-hide' : 'bx-show'}`} />
      </button>
    </div>
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea {...props} className={`form-control ${props.className ?? ''}`} rows={props.rows ?? 4} />
  )
}

export function Select({
  options,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: any; label: string }[]
}) {
  return (
    <select {...rest} className={`form-select ${className ?? ''}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
}) {
  return (
    <div className="form-check form-switch">
      <input
        className="form-check-input"
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label && <label className="form-check-label">{label}</label>}
    </div>
  )
}
