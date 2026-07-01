# 现网探查原始证据（recon evidence）

> **用途**：本目录存放对 Live Demo `https://next.typesafe.cn`（v3.4.0，账号 `manager/manager`，只读演示）
> 的**真实抓取证据**，用 Playwright 驱动真实 UI（登录→逐个点开菜单页），记录每个页面实际发出的
> 网络请求（方法 + 状态 + 响应结构）。这些证据是 [plan/14 真实 API 契约](../plan/14-api-contract) 的事实来源，
> **供开发直接对照实现使用**。
>
> 原则：端点不靠猜测拼路径，而是以"UI 实际发出的请求"和"返回数据结构"为准（见 raw/ 下按页面分组的 JSON）。
