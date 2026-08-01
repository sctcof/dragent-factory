# RAGFlow 本机联调

目标架构中的知识检索由 [RAGFlow](https://github.com/infiniflow/ragflow) 承担。官方镜像依赖 Elasticsearch / MySQL / MinIO / Redis，资源占用较大，因此作为独立子栈启动。

## 硬件要求

- CPU ≥ 4 核
- 内存 ≥ 16 GB
- 磁盘 ≥ 50 GB
- Docker ≥ 24 / Compose ≥ v2.26

**Apple Silicon**：官方镜像以 x86 为主，请在 Docker Desktop 中启用 Rosetta / amd64 模拟，或在 Linux x86 主机上运行 RAGFlow，本机仅配置 `RAGFLOW_BASE_URL`。

## 启动官方栈

```bash
git clone https://github.com/infiniflow/ragflow.git /tmp/ragflow
cd /tmp/ragflow
git checkout v0.26.4   # 或当前稳定版
cd docker

# 可选：中国镜像
# 编辑 .env，设置 RAGFLOW_IMAGE=swr.cn-north-4.myhuaweicloud.com/infiniflow/ragflow:v0.26.4

# Linux 需保证 vm.max_map_count >= 262144
docker compose -f docker-compose.yml up -d
```

默认 HTTP API：`http://localhost:9380`

## 接入 dragent-factory

1. 在 RAGFlow Web UI 注册并创建 API Key。
2. 复制仓库根目录 `.env.example` 为 `.env`，填写：

```bash
VECTOR_BACKEND=ragflow
RAGFLOW_BASE_URL=http://localhost:9380
RAGFLOW_API_KEY=ragflow-xxxxxxxx
```

3. 启动本项目依赖（可不带 ragflow profile）：

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis neo4j minio
# 本地直接跑 API 时：
export $(grep -v '^#' .env | xargs)
PYTHONPATH=. uvicorn apps.api.dragent_api.main:app --reload --host 0.0.0.0 --port 8000
```

4. 上传数据资产后，系统会自动将数据字典写入 RAGFlow 知识库；`POST /api/rag/context` 走真实检索。

## 未配置时的回退

`VECTOR_BACKEND=local` 或未设置 `RAGFLOW_BASE_URL` 时，自动使用 `LocalRagClient`（关键词打分），API 仍可正常工作。
