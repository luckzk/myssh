# 11 部署与运维

## 11.1 组件清单

| 组件 | 说明 | 必需 |
| --- | --- | --- |
| 后端 Go 服务 | API + 会话网关 + 审计 + 调度 | ✅ |
| guacd | RDP/VNC/Telnet 协议转换 | 图形协议时必需 |
| 数据库 | PostgreSQL（生产）/ SQLite（单机演示） | ✅ |
| Redis | 会话/在线状态/限流（小规模可省） | 可选 |
| 对象存储 | 录像与文件（本地盘 / MinIO / S3） | ✅ |
| 反向代理 | Nginx/Caddy：TLS + WebSocket 升级 | 生产推荐 |

## 11.2 docker-compose（小规模一键起）

```yaml
services:
  app:
    image: next-terminal-clone:latest
    environment:
      DB_DSN: postgres://nt:nt@db:5432/nt
      GUACD_ADDR: guacd:4822
      STORAGE: /data/recordings
    volumes: [ "nt-data:/data" ]
    ports: [ "8088:8088" ]
    depends_on: [ db, guacd ]
  guacd:
    image: guacamole/guacd
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: nt
      POSTGRES_PASSWORD: nt
      POSTGRES_DB: nt
    volumes: [ "pg:/var/lib/postgresql/data" ]
volumes: { nt-data: {}, pg: {} }
```
前面再挂一个 Nginx/Caddy 终止 TLS、转发 `/api` 与 `/ws`（注意 WebSocket `Upgrade` 头）。

## 11.3 Nginx 关键片段

```nginx
location /ws/ {
    proxy_pass http://app:8088;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400s;   # 长连接会话
}
location / { proxy_pass http://app:8088; }
```

## 11.4 规模化（Kubernetes）

- **后端会话网关水平扩展**：多副本 + LB；会话状态放 Redis，录像放 S3（无状态化）。
- **guacd 多副本**：按负载横向扩展，网关侧做 guacd 路由。
- **数据库**：PG 主从 + 连接池；审计表分区/归档。
- Helm chart 管理配置；HPA 按连接数/CPU 扩缩。

## 11.5 配置与初始化

- 首次启动执行数据库迁移、内建超级管理员、默认角色与菜单权限。
- 全局配置走 `setting` 表 + 环境变量（品牌、演示模式、会话默认策略、保留期）。
- **演示模式**开关（对应探查到的 demo 拦截），对外演示时开启只读。

## 11.6 运维与可观测

| 关注点 | 做法 |
| --- | --- |
| 指标 | Prometheus 暴露在线会话数、guacd 连接、错误率；Grafana 看板 |
| 日志 | 结构化 `slog`，集中采集（Loki/ELK） |
| 备份 | 数据库定时备份；录像随对象存储生命周期策略归档 |
| 升级 | 蓝绿/滚动；迁移前备份；会话优雅排空后再下线实例 |
| 安全加固 | 最小权限运行、凭证加密密钥用 KMS、定期轮换、限制 guacd 仅内网可达 |

## 11.7 容量与性能提示

- 单会话网关进程可承载数百并发终端，瓶颈通常在录像 I/O 与 guacd（图形）CPU。
- 录像异步批量落盘；图形会话按 guacd 实例数规划并发上限。
- 长连接数据库连接数、文件描述符上限需调优。
