import { type ReactNode } from 'react'

// Ynex 卡片：.card.custom-card + 可选 header(title/extra) + body
export function Card({
  title,
  extra,
  children,
  bodyClassName,
  className,
}: {
  title?: ReactNode
  extra?: ReactNode
  children: ReactNode
  bodyClassName?: string
  className?: string
}) {
  return (
    <div className={`card custom-card ${className ?? ''}`}>
      {(title || extra) && (
        <div className="card-header justify-content-between">
          <div className="card-title">{title}</div>
          {extra}
        </div>
      )}
      <div className={`card-body ${bodyClassName ?? ''}`}>{children}</div>
    </div>
  )
}

// 页头：标题 + 面包屑（Ynex page-header-breadcrumb 风格）
export function PageHeader({
  title,
  crumbs,
  extra,
}: {
  title: ReactNode
  crumbs?: string[]
  extra?: ReactNode
}) {
  return (
    <div className="d-md-flex d-block align-items-center justify-content-between my-3 page-header-breadcrumb">
      <div>
        <h1 className="page-title fw-medium fs-18 mb-1">{title}</h1>
        {crumbs && crumbs.length > 0 && (
          <nav>
            <ol className="breadcrumb mb-0">
              {crumbs.map((c, i) => (
                <li
                  key={i}
                  className={`breadcrumb-item ${i === crumbs.length - 1 ? 'active' : ''}`}
                >
                  {c}
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>
      {extra && <div className="d-flex gap-2">{extra}</div>}
    </div>
  )
}
