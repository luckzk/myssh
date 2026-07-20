// 资产图标解析：优先级 用户上传(logo) > 发行版(distro) > 系统家族(os) > 默认(协议)。
// 关键约束：仅当图标为「默认」时才按 os/distro 变化；用户上传了自定义图标(logo)则永不覆盖。

// os 家族图标：linux 用 font-logos 企鹅，mac/win 用 boxicons 品牌图标。
const OS_ICON: Record<string, string> = {
  linux: 'fl-tux',
  macos: 'bx bxl-apple',
  windows: 'bx bxl-windows',
}
export const PROTO_ICON: Record<string, string> = {
  ssh: 'bx bx-terminal',
  docker: 'bx bxl-docker',
  rdp: 'bx bx-windows',
  vnc: 'bx bx-desktop',
  telnet: 'bx bx-chip',
  serial: 'bx bx-microchip',
  local: 'bx bxs-terminal',
}

// 发行版 → 官方 logo(font-logos，MIT/OFL) + 品牌色。id 对齐 /etc/os-release 的 ID 字段。
// cls 以 `fl-` 开头者走 font-logos 字体；以 `bx ` 开头者走 boxicons（font-logos 无对应 logo 时）。
const DISTRO: Record<string, { label: string; color: string; cls: string }> = {
  ubuntu: { label: 'Ubuntu', color: '#E95420', cls: 'fl-ubuntu' },
  debian: { label: 'Debian', color: '#A81D33', cls: 'fl-debian' },
  centos: { label: 'CentOS', color: '#932279', cls: 'fl-centos' },
  rhel: { label: 'RHEL', color: '#EE0000', cls: 'fl-redhat' },
  redhat: { label: 'Red Hat', color: '#EE0000', cls: 'fl-redhat' },
  fedora: { label: 'Fedora', color: '#51A2DA', cls: 'fl-fedora' },
  alpine: { label: 'Alpine', color: '#0D597F', cls: 'fl-alpine' },
  arch: { label: 'Arch', color: '#1793D1', cls: 'fl-archlinux' },
  archarm: { label: 'Arch ARM', color: '#1793D1', cls: 'fl-archlinux' },
  manjaro: { label: 'Manjaro', color: '#35BF5C', cls: 'fl-manjaro' },
  rocky: { label: 'Rocky Linux', color: '#10B981', cls: 'fl-rocky-linux' },
  almalinux: { label: 'AlmaLinux', color: '#1B5E9B', cls: 'fl-almalinux' },
  alma: { label: 'AlmaLinux', color: '#1B5E9B', cls: 'fl-almalinux' },
  opensuse: { label: 'openSUSE', color: '#73BA25', cls: 'fl-opensuse' },
  'opensuse-leap': { label: 'openSUSE Leap', color: '#73BA25', cls: 'fl-opensuse' },
  'opensuse-tumbleweed': { label: 'openSUSE Tumbleweed', color: '#73BA25', cls: 'fl-opensuse' },
  sles: { label: 'SUSE', color: '#30BA78', cls: 'fl-opensuse' },
  gentoo: { label: 'Gentoo', color: '#54487A', cls: 'fl-gentoo' },
  kali: { label: 'Kali', color: '#367BF0', cls: 'fl-kali-linux' },
  linuxmint: { label: 'Linux Mint', color: '#87CF3E', cls: 'fl-linuxmint' },
  mint: { label: 'Linux Mint', color: '#87CF3E', cls: 'fl-linuxmint' },
  nixos: { label: 'NixOS', color: '#5277C3', cls: 'fl-nixos' },
  devuan: { label: 'Devuan', color: '#2D2D2D', cls: 'fl-devuan' },
  void: { label: 'Void', color: '#478061', cls: 'fl-void' },
  slackware: { label: 'Slackware', color: '#000000', cls: 'fl-slackware' },
  mageia: { label: 'Mageia', color: '#2397D4', cls: 'fl-mageia' },
  raspbian: { label: 'Raspberry Pi OS', color: '#C51A4A', cls: 'fl-raspberry-pi' },
  elementary: { label: 'elementary', color: '#64BAFF', cls: 'fl-elementary' },
  pop: { label: 'Pop!_OS', color: '#48B9C7', cls: 'fl-pop-os' },
  endeavouros: { label: 'EndeavourOS', color: '#7F3FBF', cls: 'fl-endeavour' },
  freebsd: { label: 'FreeBSD', color: '#AB2B28', cls: 'fl-freebsd' },
  // font-logos 无专属 logo → 退回 boxicons
  amzn: { label: 'Amazon Linux', color: '#FF9900', cls: 'bx bxl-amazon' },
  amazon: { label: 'Amazon Linux', color: '#FF9900', cls: 'bx bxl-amazon' },
  ol: { label: 'Oracle Linux', color: '#F80000', cls: 'fl-tux' },
  oracle: { label: 'Oracle Linux', color: '#F80000', cls: 'fl-tux' },
}

export interface AssetLike {
  logo?: string
  os?: string
  distro?: string
  protocol?: string
}

// resolveIcon 返回 { img } 或 { cls, color?, title? }。cls 已含字体前缀（`bx ...` 或 `fl-...`）。
export function resolveIcon(a: AssetLike): { img?: string; cls?: string; color?: string; title?: string } {
  if (a.logo) return { img: a.logo } // 自定义图标：永远优先，不被 os/distro 覆盖
  if (a.distro && DISTRO[a.distro]) {
    const d = DISTRO[a.distro]
    return { cls: d.cls, color: d.color, title: d.label }
  }
  if (a.os && OS_ICON[a.os]) return { cls: OS_ICON[a.os] }
  return { cls: PROTO_ICON[a.protocol || 'ssh'] || 'bx bx-server' }
}

export default function AssetIcon({ asset, size = 16, color, className }: { asset: AssetLike; size?: number; color?: string; className?: string }) {
  const { img, cls, color: dc, title } = resolveIcon(asset)
  if (img) {
    return <img src={img} alt="" width={size} height={size} style={{ objectFit: 'contain', borderRadius: 3, verticalAlign: 'middle' }} className={className} title={title} />
  }
  return <i className={`${cls} ${className || ''}`} style={{ fontSize: size, color: color ?? dc, verticalAlign: 'middle' }} title={title} />
}
