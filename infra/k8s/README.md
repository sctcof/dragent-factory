# Kubernetes Deployment Notes

生产环境建议将 API、Web、Agent Worker、Sandbox Pool 分成独立 Deployment，并把 PostgreSQL、Redis、对象存储、RAGFlow、图数据库作为托管或专用组件接入。当前仓库提供可执行的本地 `docker-compose` 部署，Kubernetes 清单可按相同容器镜像和环境变量扩展。
