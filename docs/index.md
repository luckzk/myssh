---
layout: home

hero:
  name: Next Terminal 复制方案
  text: 开源堡垒机 / 运维审计系统的完整复刻规划
  tagline: Go + React + Apache Guacamole(guacd)·完整对标 44 功能模块
  actions:
    - theme: brand
      text: 阅读方案
      link: /plan/01-overview
    - theme: alt
      text: 现网探查结论
      link: /plan/02-recon
    - theme: alt
      text: 原项目 GitHub
      link: https://github.com/dushixiang/next-terminal

features:
  - icon: 🔍
    title: 基于真实探查
    details: 方案不是凭空设计，而是登录 live demo（next.typesafe.cn，v3.4.0）实测前端资源、API 与菜单结构后逆向归纳得出。
  - icon: 🏗️
    title: 同栈复刻
    details: 后端沿用 Go，前端 React + Ant Design，RDP/VNC 复用 guacd，最大化贴近原版架构，降低踩坑成本。
  - icon: 🧩
    title: 全模块对标
    details: 资源、审计、运维、身份、授权、系统六大域共 44 个菜单模块，逐一拆解数据模型与接口设计。
  - icon: 🛡️
    title: 审计为核心
    details: 在线会话监控、离线录像回放、命令/文件/SQL 日志，围绕"可审计、可追溯、可合规"组织全套架构。
  - icon: 🗺️
    title: 可执行路线图
    details: 从 MVP 到完整平台分 6 个里程碑（约 30 周），每个里程碑都有明确交付物与验收标准。
  - icon: ⚖️
    title: 合规与风险前置
    details: 明确开源许可、协议转换安全边界、会话录制的合规要点与自研成本，避免事后返工。
---

## 这是什么

本站用 **VitePress** 记录一份**复制 [Next Terminal](https://github.com/dushixiang/next-terminal) 的实施方案**。Next Terminal 是一款简洁、轻量的开源堡垒机（运维审计系统），支持 RDP / SSH / VNC / Telnet / Kubernetes 等远程访问协议，能记录与回放会话，用于安全审计与合规追踪。

方案目标：**用 Go 后端 + React 前端 + guacd 协议网关，完整对标其 44 个功能模块**，并给出可落地的里程碑路线图。

## 关键决策（已确认）

| 维度 | 选择 | 说明 |
| --- | --- | --- |
| 后端技术栈 | **Go**（同原版） | 复制度最高，可直接参考其 guacd 集成与会话流处理 |
| 实现范围 | **完整对标 44 模块** | 一次性规划全部功能，分里程碑交付 |
| 协议转换 | **复用 Apache Guacamole(guacd)** | 自己只对接 guacamole 协议，RDP/VNC/Telnet 交给 guacd |

## 如何阅读

按侧边栏顺序从 **01 项目概览** 读起即可。前两章是调研结论，中间是架构与模块设计，最后是部署、路线图与风险。

> ⚠️ 说明：本方案为**技术学习 / 复刻规划**用途。原项目遵循其开源许可证，复制实现时请遵守相应协议与所在地法律法规（尤其是会话录制相关的合规要求）。

## 调研 / 设计笔记

- [Netcatty 借鉴分析](/netcatty-analysis) —— 对标 Electron 桌面 SSH 客户端 Netcatty，评估可借鉴点（结论：值得做 AI 运维 Agent）。
- [Docker 资产:连接 Docker 的几种方式](/docker-connection-methods) —— 触达远程 Docker daemon 的 4 种方式对比与选型（现状：SSH + CLI）。
