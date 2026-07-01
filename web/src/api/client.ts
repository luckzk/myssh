// 统一请求封装。对齐 demo bundle 行为：
// - 前缀 /api；令牌走 X-Auth-Token 头（同时后端也下发 HttpOnly Cookie）
// - 401 → 跳登录；418 → 跳 /setup；错误体 {code,message}
const BASE = '/api'
export const TOKEN_KEY = 'X-Auth-Token'

export class ApiError extends Error {
  code: number
  status: number
  constructor(status: number, code: number, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem(TOKEN_KEY)
  return t ? { [TOKEN_KEY]: t } : {}
}

async function handle(resp: Response): Promise<any> {
  if (resp.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    if (location.pathname !== '/login') location.href = '/login'
    throw new ApiError(401, 401, 'Unauthorized')
  }
  if (resp.status === 418) {
    location.href = '/setup'
    throw new ApiError(418, 418, 'Redirect to setup')
  }
  const ct = resp.headers.get('content-type') || ''
  const body = ct.includes('application/json') ? await resp.json() : await resp.text()
  // demo 错误包络 {code,message}；code 非 2xx 视为失败
  if (body && typeof body === 'object' && 'code' in body && body.code && body.code >= 400) {
    throw new ApiError(resp.status, body.code, body.message)
  }
  return body
}

export const api = {
  get: (path: string) => fetch(BASE + path, { headers: authHeaders() }).then(handle),
  post: (path: string, data?: any) =>
    fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }).then(handle),
  put: (path: string, data?: any) =>
    fetch(BASE + path, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(data),
    }).then(handle),
  delete: (path: string) => fetch(BASE + path, { method: 'DELETE', headers: authHeaders() }).then(handle),
}
