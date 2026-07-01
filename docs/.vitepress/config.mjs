import { defineConfig } from 'vitepress'

// VitePress 站点配置：记录"复制 Next Terminal"的完整实施方案
export default defineConfig({
  lang: 'zh-CN',
  title: 'Next Terminal 复制方案',
  description: '基于 Go + React + guacd 复制开源堡垒机 Next Terminal 的完整实施方案',
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,

  // VitePress 独立跑在自己的端口（见 package.json docs:dev / docs:preview），
  // 绑 0.0.0.0 暴露公网。
  vite: {
    server: { host: true, port: 5174, allowedHosts: true },
    preview: { host: true, port: 5174, allowedHosts: true },
  },

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '方案', link: '/plan/01-overview' },
      { text: '实现进度', link: '/progress' },
      { text: '探查证据', link: '/recon/' },
      { text: '测试账号', link: '/testing' },
      { text: '原项目', link: 'https://github.com/dushixiang/next-terminal' },
    ],

    sidebar: {
      '/plan/': [
        {
          text: '一、调研与目标',
          collapsed: false,
          items: [
            { text: '01 项目概览与功能图谱', link: '/plan/01-overview' },
            { text: '02 现网探查结论', link: '/plan/02-recon' },
          ],
        },
        {
          text: '二、架构与选型',
          collapsed: false,
          items: [
            { text: '03 总体架构', link: '/plan/03-architecture' },
            { text: '04 技术选型', link: '/plan/04-tech-stack' },
            { text: '05 数据模型', link: '/plan/05-data-model' },
          ],
        },
        {
          text: '三、模块设计',
          collapsed: false,
          items: [
            { text: '06 后端模块设计', link: '/plan/06-backend' },
            { text: '07 前端设计', link: '/plan/07-frontend' },
            { text: '08 协议接入与 guacd', link: '/plan/08-protocols' },
            { text: '09 审计与会话录像', link: '/plan/09-audit' },
            { text: '10 身份、授权与策略', link: '/plan/10-rbac' },
          ],
        },
        {
          text: '四、落地',
          collapsed: false,
          items: [
            { text: '11 部署与运维', link: '/plan/11-deployment' },
            { text: '12 里程碑路线图', link: '/plan/12-roadmap' },
            { text: '13 风险、合规与成本', link: '/plan/13-risks' },
            { text: '15 源码复用可行性', link: '/plan/15-reuse-feasibility' },
          ],
        },
      ],
    },

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最后更新',

    socialLinks: [
      { icon: 'github', link: 'https://github.com/dushixiang/next-terminal' },
    ],

    footer: {
      message: '本方案为技术复制/学习用途的实施规划文档。',
      copyright: '参考原项目 Next Terminal（Apache-2.0 协议，dushixiang）',
    },

    search: { provider: 'local' },
  },
})
