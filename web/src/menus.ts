// 菜单元数据：key → 中文标题与所属分组。
// key 列表与后端 model/menus.go、demo account/info 完全一致（事实来源）。
export interface MenuMeta {
  key: string
  label: string
  group?: string // 分组父节点的 key
}

// 分组父节点
export const GROUPS: Record<string, string> = {
  resource: '资源管理',
  'log-audit': '日志审计',
  sysops: '运维',
  identity: '身份',
  authorised: '授权',
}

// 叶子菜单（key → 标题 + 分组）
export const MENU_META: MenuMeta[] = [
  { key: 'dashboard', label: '仪表盘' },
  { key: 'asset', label: '主机资产', group: 'resource' },
  { key: 'database-asset', label: '数据库资产', group: 'resource' },
  { key: 'db-work-order', label: '数据库工单', group: 'resource' },
  { key: 'credential', label: '凭证', group: 'resource' },
  { key: 'snippet', label: '命令片段', group: 'resource' },
  { key: 'storage', label: '存储', group: 'resource' },
  { key: 'backup-destination', label: '备份目标', group: 'resource' },
  { key: 'website', label: '网站', group: 'resource' },
  { key: 'certificate', label: '证书', group: 'resource' },
  { key: 'gateway', label: '网关', group: 'resource' },
  { key: 'ssh-gateway', label: 'SSH 网关', group: 'resource' },
  { key: 'agent-gateway', label: 'Agent 网关', group: 'resource' },
  { key: 'gateway-group', label: '网关组', group: 'resource' },
  { key: 'online-session', label: '在线会话', group: 'log-audit' },
  { key: 'offline-session', label: '离线会话', group: 'log-audit' },
  { key: 'exec-command-log', label: '命令执行日志', group: 'log-audit' },
  { key: 'filesystem-log', label: '文件传输日志', group: 'log-audit' },
  { key: 'access-log', label: '访问日志', group: 'log-audit' },
  { key: 'access-log-stats', label: '访问统计', group: 'log-audit' },
  { key: 'login-log', label: '登录日志', group: 'log-audit' },
  { key: 'operation-log', label: '操作日志', group: 'log-audit' },
  { key: 'database-sql-log', label: '数据库 SQL 日志', group: 'log-audit' },
  { key: 'backup', label: '备份', group: 'sysops' },
  { key: 'scheduled-task', label: '计划任务', group: 'sysops' },
  { key: 'tools', label: '工具', group: 'sysops' },
  { key: 'monitoring', label: '监控', group: 'sysops' },
  { key: 'user', label: '用户', group: 'identity' },
  { key: 'user-group', label: '用户组', group: 'identity' },
  { key: 'department', label: '部门', group: 'identity' },
  { key: 'role', label: '角色', group: 'identity' },
  { key: 'login-policy', label: '登录策略', group: 'identity' },
  { key: 'login-locked', label: '登录锁定', group: 'identity' },
  { key: 'oidc-client', label: 'OIDC 客户端', group: 'identity' },
  { key: 'command-filter', label: '命令过滤', group: 'authorised' },
  { key: 'strategy', label: '策略', group: 'authorised' },
  { key: 'authorised-asset', label: '资产授权', group: 'authorised' },
  { key: 'authorised-website', label: '网站授权', group: 'authorised' },
  { key: 'authorised-database-asset', label: '数据库授权', group: 'authorised' },
  { key: 'setting', label: '设置' },
  { key: 'dev', label: '开发者' },
]
