# Agent Worker

当前本地部署将 `packages/agent_graph` 作为 API 进程内工作流执行，保持与独立 Worker 相同的模块边界。生产部署时可将 `AgentWorkflow` 包装为 Celery/ARQ/Temporal Worker，并复用相同的 `Task`、`Strategy`、`ExecutionResult` 协议。
