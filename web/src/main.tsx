import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ToastHost } from './ui/toast'
import './ynex-overrides.css'
import './flat-theme.css'
import './clay-theme.css'
import { applyUITheme, getUITheme } from './store/theme'
import { applyColorMode, getColorMode } from './store/colorMode'

// 启动时按注册表校正外观（皮肤 + 颜色模式），使 store 成为唯一真源、
// 自动修正内联脚本可能的漂移（如浅色专用主题下钉 light）。
applyUITheme(getUITheme())
applyColorMode(getColorMode())

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <ToastHost />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
