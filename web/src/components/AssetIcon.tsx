// 资产图标解析：优先级 用户上传(logo) > 系统探测(os) > 默认(协议)。

const OS_ICON: Record<string, string> = {
  linux: 'bxl-tux',
  macos: 'bxl-apple',
  windows: 'bxl-windows',
}
export const PROTO_ICON: Record<string, string> = {
  ssh: 'bx-terminal',
  docker: 'bxl-docker',
  rdp: 'bx-windows',
  vnc: 'bx-desktop',
  telnet: 'bx-chip',
  serial: 'bx-microchip',
  local: 'bxs-terminal',
}

export interface AssetLike {
  logo?: string
  os?: string
  protocol?: string
}

// resolveIcon 返回 { img } 或 { cls }，供需要自定义渲染的场景使用。
export function resolveIcon(a: AssetLike): { img?: string; cls?: string } {
  if (a.logo) return { img: a.logo }
  if (a.os && OS_ICON[a.os]) return { cls: OS_ICON[a.os] }
  return { cls: PROTO_ICON[a.protocol || 'ssh'] || 'bx-server' }
}

export default function AssetIcon({ asset, size = 16, color, className }: { asset: AssetLike; size?: number; color?: string; className?: string }) {
  const { img, cls } = resolveIcon(asset)
  if (img) {
    return <img src={img} alt="" width={size} height={size} style={{ objectFit: 'contain', borderRadius: 3, verticalAlign: 'middle' }} className={className} />
  }
  return <i className={`bx ${cls} ${className || ''}`} style={{ fontSize: size, color, verticalAlign: 'middle' }} />
}
