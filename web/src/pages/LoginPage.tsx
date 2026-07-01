import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { authApi } from '../api/auth'
import { TOKEN_KEY } from '../api/client'
import { toast } from '../ui'

// 登录页：Ynex sign-in 风格。按 /api/login-status 决定渲染哪些登录方式。
export default function LoginPage() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const { data: branding } = useQuery({ queryKey: ['branding'], queryFn: authApi.branding })
  const { data: status } = useQuery({ queryKey: ['login-status'], queryFn: authApi.loginStatus })

  useEffect(() => {
    if (status?.status === 'Logged In') nav('/dashboard')
  }, [status, nav])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const r = await authApi.login(username, password)
      if (r.needTotp) {
        toast.info('需要两步验证（TOTP）')
        return
      }
      localStorage.setItem(TOKEN_KEY, r.token)
      nav('/dashboard')
    } catch (e: any) {
      toast.error(e.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="d-flex align-items-center justify-content-center p-3"
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(1200px 600px at 50% -10%, rgba(132,90,223,.18) 0%, var(--default-body-bg-color) 45%)',
      }}
    >
      <div className="card custom-card" style={{ width: 410 }}>
        <div className="card-body p-5">
          <div className="text-center mb-4">
            <span
              className="d-inline-flex align-items-center justify-content-center text-white fw-bold mb-3"
              style={{
                width: 54,
                height: 54,
                borderRadius: 14,
                fontSize: 26,
                background: 'linear-gradient(135deg, #845ADF 0%, #6f42c1 100%)',
              }}
            >
              N
            </span>
            <h4 className="fw-semibold mb-1">{branding?.name || 'Next Terminal'}</h4>
            <p className="text-muted mb-0">登录以继续</p>
          </div>

          {status?.passwordEnabled !== false && (
            <form onSubmit={onSubmit}>
              <div className="mb-3">
                <label className="form-label">用户名</label>
                <input
                  className="form-control"
                  placeholder="用户名"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="mb-4">
                <label className="form-label">密码</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="密码"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary w-100" disabled={loading}>
                {loading && <span className="spinner-border spinner-border-sm me-2" />}
                登录
              </button>
            </form>
          )}

          {status?.webauthnEnabled && (
            <button className="btn btn-light w-100 mt-2">使用通行密钥登录（WebAuthn）</button>
          )}
          {status?.wechatWorkEnabled && (
            <button className="btn btn-light w-100 mt-2">企业微信登录</button>
          )}

          {branding?.copyright && (
            <p className="text-muted text-center small mt-4 mb-0">{branding.copyright}</p>
          )}
        </div>
      </div>
    </div>
  )
}
