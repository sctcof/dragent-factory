# Data-RAG-Agent Factory

基于 `dragent.md` 与 `docs/engineering-architecture.md` 落地的可运行工程实现。系统按六层架构拆分为 Web 工作台、FastAPI 应用服务、多 Agent 编排、模型网关、本地 RAG/图谱适配、数据接入、执行沙箱、报告与看板模块。

## 本地启动（轻量 JSON 回退）

默认可不启依赖栈，使用 `local_data/metadata.json` + `LocalRagClient`：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
export DRAGENT_STORE=json VECTOR_BACKEND=local
PYTHONPATH=. uvicorn apps.api.dragent_api.main:app --reload --host 0.0.0.0 --port 8000
```

另开终端：

```bash
npm install
npm --workspace apps/web run dev
```

访问：

- Web: http://localhost:3000
- API: http://localhost:8000/api/health
- OpenAPI: http://localhost:8000/docs

## 本机目标架构联调

本机 Docker Compose 已覆盖 PostgreSQL(pgvector)、Redis、Neo4j、MinIO、API、Web。RAGFlow 因镜像体积与架构限制，作为独立子栈启动（见 [infra/ragflow/README.md](infra/ragflow/README.md)）。

**硬件建议**：CPU ≥ 4、内存 ≥ 16GB。Apple Silicon 跑官方 RAGFlow 镜像需启用 amd64 模拟，或远端部署后只填 `RAGFLOW_BASE_URL`。

```bash
cp .env.example .env
# 按需修改 DRAGENT_STORE / VECTOR_BACKEND / RAGFLOW_* 

docker compose -f infra/docker-compose.yml up --build
```

常用开关（`.env`）：

| 变量 | 说明 |
| --- | --- |
| `DRAGENT_STORE=postgres\|json` | 元数据仓储；Postgres 不可用时 API 会回退 JSON |
| `VECTOR_BACKEND=ragflow\|local` | RAG 后端；未配置 `RAGFLOW_BASE_URL` 时回退本地关键词检索 |
| `DATABASE_URL` / `REDIS_URL` / `NEO4J_URI` | 依赖连接串 |
| `RAGFLOW_BASE_URL` / `RAGFLOW_API_KEY` | 接入独立 RAGFlow |

JSON → PostgreSQL 一次性迁移：

```bash
export DATABASE_URL=postgresql+psycopg2://dragent:dragent@localhost:5432/dragent
PYTHONPATH=. python scripts/migrate_json_to_postgres.py
```

### 联调验收清单

1. `docker compose -f infra/docker-compose.yml up -d` 后访问 `/api/health`，确认 `stack.store_ok` / `redis` / `neo4j`。
2. 上传 CSV → 资产自动索引；若 `VECTOR_BACKEND=ragflow`，文档进入 RAGFlow KB。
3. `POST /api/rag/context` 返回检索 chunk；Redis 对相同 query 短缓存。
4. 多选资产打开整体知识图：优先 Neo4j，失败回退内存合并。
5. 关闭 RAGFlow / 设 `VECTOR_BACKEND=local` 后 API 仍可用。

## Docker 部署

```bash
docker compose -f infra/docker-compose.yml up --build
```

## GitHub 主分支部署

项目包含 `.github/workflows/deploy.yml`。推送到 `main` 后，GitHub Actions 会执行：

- Python 后端依赖安装与编译校验。
- Next.js 前端构建校验。
- 构建并发布 API 镜像到 `ghcr.io/<owner>/<repo>-api:latest`。
- 构建并发布 Web 镜像到 `ghcr.io/<owner>/<repo>-web:latest`。
- 创建 `github-container-registry` GitHub deployment 状态。

部署后可使用 GHCR 镜像运行：

```bash
export DRAGENT_API_IMAGE=ghcr.io/<owner>/<repo>-api:latest
export DRAGENT_WEB_IMAGE=ghcr.io/<owner>/<repo>-web:latest
export NEXT_PUBLIC_API_BASE=http://localhost:8000
docker compose -f infra/docker-compose.ghcr.yml up -d
```

## 已覆盖能力

- CSV / Excel 上传、数据字典、字段统计、敏感字段标记、知识图谱派生。
- 会话列表、创建、回放、归档/删除接口。
- Planner -> 策略确认 -> Coder -> Sandbox -> Analyzer 的白盒工作流。
- 生成代码查看、人工修改、重新执行、stdout/stderr/耗时/哈希/血缘记录。
- ECharts 图表协议、图表快照、表格结果展示。
- 报告购物车、Markdown/HTML 报告导出、报告中心与版本接口。
- 活性看板、图表钉入、查询绑定固化、刷新缓存。
- 模型配置、模型路由适配层、审计日志。

## 试用流程

1. 打开 Web 工作台。
2. 上传 `examples/sales.csv`。
3. 保持默认问题或输入新的分析目标。
4. 点击“生成策略”，检查并修改策略书。
5. 点击“确认并执行”，查看代码、图表、表格与结论。
6. 将策略或结论加入报告购物车，生成报告。
7. 将图表钉入活性看板。

## 复杂样例与数据库连接

### 电商交易系统样例（14 表，覆盖全部连接类型）

`examples/ecommerce_platform/` 提供电商交易场景样例（供应商/客户/商品/门店/营销/促销/订单/明细/支付/发货/退货/库存/工单/评价），可灌入平台枚举的全部数据库类型：

`mysql` · `postgresql` · `sqlite` · `clickhouse` · `mssql` · `duckdb`

```bash
# 可选：启动 ClickHouse / SQL Server / 独立 MySQL 样例库
docker compose -f infra/docker-compose.sample-dbs.yml up -d

# 生成 CSV、灌库，并注册到连接池（需 API 已启动）
pip install -r apps/api/requirements.txt
python scripts/seed_ecommerce_samples.py --create-assets
```

详见 [examples/ecommerce_platform/README.md](examples/ecommerce_platform/README.md)。

### 轻量零售样例

`examples/retail_complex/` 提供五表零售样例与 SQLite；`examples/retail_deep_dive_10csv/` 提供更大的 10 CSV 深潜集。

推荐分析问题：

```text
分析 2026 上半年收入增长质量：请结合订单、客户、商品、营销和库存数据，分至少 6 步完成趋势、贡献、毛利、投放效率、库存风险和行动建议分析。
```

数据资产页支持创建数据库连接并抽样生成数据资产。连接串示例：

```text
mysql+pymysql://user:password@host:3306/database
postgresql+psycopg2://user:password@host:5432/database
sqlite:////absolute/path/to/database.db
clickhouse+native://default:@host:9004/ecommerce
mssql+pymssql://sa:password@host:1433/ecommerce
duckdb:////absolute/path/to/database.duckdb
```

## 工程边界

- 元数据：`DRAGENT_STORE=json` 用 `local_data/metadata.json`；`postgres` 用 PostgreSQL `documents` / `chunks` / `knowledge_bases`。
- 对象文件：短期仍落 `local_data/objects`（Compose 已提供 MinIO 供后续切换）。
- RAG：`RagFlowClient` / `LocalRagClient` 工厂切换，接口兼容。
- 图谱：Neo4j 优先，失败回退资产内嵌 `KnowledgeGraph`。
- Redis：RAG 缓存与任务进度，连接失败自动降级。
- Agent：仍以确定性实现为主；真实 LLM 可并行接入，不阻塞本栈。
- 沙箱：仍为本地 subprocess；Firecracker/Docker 池属后续阶段。

