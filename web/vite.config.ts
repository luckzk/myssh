import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发态把 /api 反代到 Go 后端（:8088），与原版同源前缀 /api 对齐。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,            // 绑定 0.0.0.0，允许公网/内网访问（默认仅 localhost）
    port: 5173,
    allowedHosts: true,    // 允许任意 Host 头（用公网 IP/域名访问时不被拦）
    proxy: {
      '/api': { target: 'http://localhost:8088', changeOrigin: true, ws: true },
    },
  },
})
