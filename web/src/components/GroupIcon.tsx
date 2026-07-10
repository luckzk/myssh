// 分组图标：icon 为 data URL(上传图片) → <img>；否则按 boxicons 类名 + 颜色渲染。
// 默认 bx-folder / 琥珀色。GroupTree（资产页）与 AssetTree（终端工作区）共用，保持一致。
export const GROUP_ICON_DEFAULT = 'bx-folder'
export const GROUP_COLOR_DEFAULT = '#e0a23b'

export default function GroupIcon({ icon, color, size = 16 }: { icon?: string; color?: string; size?: number }) {
  const ic = icon || GROUP_ICON_DEFAULT
  if (ic.startsWith('data:')) {
    return <img src={ic} alt="" width={size} height={size} style={{ objectFit: 'contain', borderRadius: 3, verticalAlign: 'middle', flexShrink: 0 }} />
  }
  return <i className={`bx ${ic}`} style={{ color: color || GROUP_COLOR_DEFAULT, fontSize: size, verticalAlign: 'middle', flexShrink: 0 }} />
}
