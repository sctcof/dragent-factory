# Data-RAG-Agent Factory

基于 `dragent.md` 与 `docs/engineering-architecture.md` 落地的可运行工程实现。系统按六层架构拆分为 Web 工作台、FastAPI 应用服务、多 Agent 编排、模型网关、本地 RAG/图谱适配、数据接入、执行沙箱、报告与看板模块。

![Data-RAG-Agent 首页预览](docs/images/homepage-preview.png)

支持两种本地落地方式：

| 模式 | 适用场景 | 依赖 |
| --- | --- | --- |
| **轻量模式** | 快速试用、演示、无 Docker | Python 3.11+、Node 22+，元数据落 JSON |
| **目标架构模式** | 接近生产的本机/私有化联调 | Docker Compose：PostgreSQL、Redis、Neo4j、MinIO（+ 可选 RAGFlow / LLM） |

---

## 本地化部署要求

### 软件依赖

| 组件 | 最低版本 | 说明 |
| --- | --- | --- |
| Python | 3.11+ | API、Agent、连接器、沙箱 |
| Node.js | 20+（推荐 22） | Next.js 工作台；仓库使用 npm workspaces |
| npm | 随 Node 安装 | `npm ci` / `npm install` |
| Docker | 24+ | 目标架构与样例库 |
| Docker Compose | v2.26+ | `infra/docker-compose*.yml` |
| Git | 任意近期版本 | 拉取代码 |

操作系统：macOS / Linux 均已验证；Windows 建议 WSL2 + Docker Desktop。

### 硬件建议

| 部署形态 | CPU | 内存 | 磁盘 | 备注 |
| --- | --- | --- | --- | --- |
| 轻量 JSON | 2 核 | ≥ 4 GB | ≥ 5 GB | 仅 API + Web |
| Compose 核心栈（无 RAGFlow） | 4 核 | ≥ 8 GB | ≥ 20 GB | Postgres + Redis + Neo4j + MinIO + API + Web |
| 含官方 RAGFlow | ≥ 4 核 | ≥ 16 GB | ≥ 50 GB | 见 [infra/ragflow/README.md](infra/ragflow/README.md) |

Apple Silicon 运行官方 RAGFlow 镜像需启用 amd64 / Rosetta 模拟，或把 RAGFlow 部署到 Linux x86 后仅填写 `RAGFLOW_BASE_URL`。

### 默认端口（勿冲突）

| 服务 | 端口 | 来源 |
| --- | --- | --- |
| Web（Next.js） | `3000` | `apps/web` |
| API（FastAPI / Uvicorn） | `8000` | `apps/api` |
| PostgreSQL | `5432` | Compose |
| Redis | `6379` | Compose |
| Neo4j HTTP / Bolt | `7474` / `7687` | Compose |
| MinIO API / Console | `9000` / `9001` | Compose |
| RAGFlow HTTP（可选） | `9380` | 官方子栈 |

### 目录与持久化

| 路径 | 用途 |
| --- | --- |
| `.env` | 本地配置（从 `.env.example` 复制，**勿提交**） |
| `local_data/metadata.json` | `DRAGENT_STORE=json` 时的元数据 |
| `local_data/objects/` | 上传文件与对象落盘 |
| Compose volumes | `dragent_pg` / `dragent_neo4j` / `dragent_minio` |

---

## 产品配置信息

根目录提供 [`.env.example`](.env.example)。本地部署请先：

```bash
cp .env.example .env
```

API 启动时会通过 `python-dotenv` 自动加载仓库根目录 `.env`。

### 核心环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DRAGENT_STORE` | `json`（代码默认）/ Compose 常用 `postgres` | 元数据仓储：`json` 或 `postgres`；Postgres 不可用时 API 可回退 JSON |
| `PROJECT_ID` | `p_local` | 默认项目 ID |
| `DATABASE_URL` | `postgresql+psycopg2://dragent:dragent@localhost:5432/dragent` | SQLAlchemy 连接串；Compose 内 API 应指向 `postgres` 主机名 |
| `REDIS_URL` | `redis://localhost:6379/0` | 缓存与任务进度；连不上自动降级 |
| `NEO4J_URI` | `bolt://localhost:7687` | 知识图谱 |
| `NEO4J_USER` / `NEO4J_PASSWORD` | `neo4j` / `dragent-neo4j` | Neo4j 认证 |
| `VECTOR_BACKEND` | `local` | `local` 或 `ragflow` |
| `RAGFLOW_BASE_URL` | 空 | 例：`http://localhost:9380`；未配置时回退本地 RAG |
| `RAGFLOW_API_KEY` | 空 | RAGFlow API Key |
| `RAGFLOW_TIMEOUT_SECONDS` | `30` | RAGFlow 请求超时 |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8000` | 前端请求的 API 根地址（浏览器可达） |
| `MINIO_*` | 见 `.env.example` | 预留对象存储；当前文件仍写 `local_data/objects` |

### 可选：外部大模型

未配置时 Planner / Analyzer 等使用本地启发式，产品仍可完整跑通。  
推荐在 Web「模型管理」页为 **DeepSeek / OpenRouter / 其它兼容网关** 分别配置 Base URL 与 API Key（模型级优先于环境变量）。

| 变量 | 说明 |
| --- | --- |
| `LLM_BASE_URL` 或 `OPENAI_BASE_URL` | OpenAI 兼容 Chat Completions 地址（全局回退） |
| `LLM_API_KEY` 或 `OPENAI_API_KEY` | API Key（全局回退） |
| `OPENROUTER_HTTP_REFERER` | 可选；调用 OpenRouter 时的 `HTTP-Referer` |
| `OPENROUTER_APP_TITLE` | 可选；调用 OpenRouter 时的 `X-Title` |

常用预设（也可在页面一键添加）：

| 提供方 | 模型 ID | Base URL |
| --- | --- | --- |
| DeepSeek | `deepseek-chat` / `deepseek-reasoner` | `https://api.deepseek.com/v1` |
| OpenRouter | 如 `deepseek/deepseek-chat` | `https://openrouter.ai/api/v1` |
| OpenAI 或其它兼容网关 | 提供方文档中的 model 名 | 对应 `/v1` 根地址 |

### Compose 主机端口覆盖

可在 `.env` 中覆盖映射端口（见 `infra/docker-compose.yml`）：`POSTGRES_PORT`、`REDIS_PORT`、`NEO4J_HTTP_PORT`、`NEO4J_BOLT_PORT`、`MINIO_API_PORT`、`MINIO_CONSOLE_PORT`，以及 `POSTGRES_*` / `NEO4J_*` / `MINIO_*` 账号密码。

### 推荐配置组合

**A. 最快试用（无 Docker）**

```bash
DRAGENT_STORE=json
VECTOR_BACKEND=local
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

**B. 本机目标架构（Docker Compose）**

```bash
DRAGENT_STORE=postgres
VECTOR_BACKEND=local
DATABASE_URL=postgresql+psycopg2://dragent:dragent@postgres:5432/dragent
REDIS_URL=redis://redis:6379/0
NEO4J_URI=bolt://neo4j:7687
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

> 若 API 跑在宿主机、依赖跑在 Compose 中，请把 `DATABASE_URL` / `REDIS_URL` / `NEO4J_URI` 改回 `localhost` 端口。

**C. 接入 RAGFlow + LLM**

```bash
VECTOR_BACKEND=ragflow
RAGFLOW_BASE_URL=http://localhost:9380
RAGFLOW_API_KEY=ragflow-xxxxxxxx
LLM_BASE_URL=https://your-llm-gateway/v1
LLM_API_KEY=sk-xxxxxxxx
```

---

## 本地启动

### 方式一：轻量 JSON 回退（推荐首次体验）

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r apps/api/requirements.txt
export DRAGENT_STORE=json VECTOR_BACKEND=local
PYTHONPATH=. uvicorn apps.api.dragent_api.main:app --reload --host 0.0.0.0 --port 8000
```

另开终端：

```bash
npm install
npm --workspace apps/web run dev
# 或：npm run dev:web
```

访问：

- Web：http://localhost:3000
- 工作台：http://localhost:3000/workspace
- API 健康检查：http://localhost:8000/api/health
- OpenAPI：http://localhost:8000/docs

### 方式二：Docker Compose 一键联调

```bash
cp .env.example .env
# 按「推荐配置组合 B」调整 .env；Compose 内 API 请使用服务名主机

docker compose -f infra/docker-compose.yml up --build
```

仅启动依赖、本机跑 API/Web：

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis neo4j minio
cp .env.example .env
# DATABASE_URL / REDIS_URL / NEO4J_URI 使用 localhost
export DRAGENT_STORE=postgres VECTOR_BACKEND=local
source .venv/bin/activate
pip install -r apps/api/requirements.txt
PYTHONPATH=. uvicorn apps.api.dragent_api.main:app --reload --host 0.0.0.0 --port 8000
```

另开终端启动 Web（同上）。

### JSON → PostgreSQL 迁移（可选）

```bash
export DATABASE_URL=postgresql+psycopg2://dragent:dragent@localhost:5432/dragent
PYTHONPATH=. python scripts/migrate_json_to_postgres.py
```

### 本地验收清单

1. 访问 `/api/health`，确认 `stack.store_ok`；Compose 模式下检查 redis / neo4j。
2. 打开工作台，上传 `examples/sales.csv` 或选择数据集。
3. 生成策略 → 确认执行 → 查看图表与「结果分析总结」。
4. （可选）`VECTOR_BACKEND=ragflow` 时上传资产后检索 `POST /api/rag/context`。
5. 关闭 Redis / Neo4j / RAGFlow 后 API 仍应可降级运行。

RAGFlow 独立安装见 [infra/ragflow/README.md](infra/ragflow/README.md)。

---

## Docker / GHCR 部署

### 本机构建运行

```bash
docker compose -f infra/docker-compose.yml up --build
```

### 使用 GitHub 发布的镜像

```bash
export DRAGENT_API_IMAGE=ghcr.io/<owner>/<repo>-api:latest
export DRAGENT_WEB_IMAGE=ghcr.io/<owner>/<repo>-web:latest
export NEXT_PUBLIC_API_BASE=http://localhost:8000
docker compose -f infra/docker-compose.ghcr.yml up -d
```

私有镜像需先：`echo $GHCR_READ_TOKEN | docker login ghcr.io -u <user> --password-stdin`。

### GitHub 主分支自动部署

推送到 `main` 后，[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 会：

1. 校验 Python / Next.js
2. 构建并推送 API / Web 镜像到 GHCR
3. 当 `ENABLE_SSH_DEPLOY=true` 时，SSH 到目标机执行 `infra/deploy/remote-up.sh`

**Repository variables**

| Name | 示例 | 说明 |
| --- | --- | --- |
| `ENABLE_SSH_DEPLOY` | `true` | 开启 SSH 部署 |
| `DEPLOY_PATH` | `/opt/dragent-factory` | 服务器部署目录 |
| `DEPLOY_SSH_PORT` | `22` | SSH 端口 |
| `DEPLOY_URL` | `https://app.example.com` | Environment 展示 URL |
| `NEXT_PUBLIC_API_BASE` | `https://api.example.com` | 前端 API 地址 |

**Repository secrets**

| Name | 说明 |
| --- | --- |
| `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` | SSH 目标与私钥 |
| `GHCR_READ_TOKEN` / `GHCR_USERNAME` | 可选，私有 GHCR 拉取 |

服务器一次性准备：

```bash
# 安装 Docker + Compose，部署用户加入 docker 组
sudo mkdir -p /opt/dragent-factory
sudo chown "$USER" /opt/dragent-factory
```

未设置 `ENABLE_SSH_DEPLOY=true` 时只发镜像，不连服务器。

---

## 已覆盖能力

- CSV / Excel 上传、数据字典、字段统计、敏感字段标记、知识图谱派生。
- 会话列表、创建、回放、归档/删除接口。
- Planner → 策略确认 → Coder → Sandbox → Analyzer 的白盒工作流。
- 生成代码查看、人工修改、重新执行、stdout/stderr/耗时/哈希/血缘记录。
- ECharts 图表协议、图表快照、表格结果展示；结果分析总结结合真实数据回写目标。
- 推荐问题 / 推荐 plan、数据集知识图、报告购物车与导出、活性看板。
- 模型配置、模型路由适配层、审计日志。

## 操作分析流程

首页与工作台围绕「业务目标 → 策略 → 执行 → 图表 → 报告」闭环设计：

![Data-RAG-Agent 操作分析流程](docs/images/home-operation-flow.png)

1. **接入数据**：对话框回形针选择数据集 / 上传 CSV·Excel，或在数据资产页接入数据库。
2. **补充上下文**：数据字典、字段画像、图谱与 RAG 自动进入分析上下文。
3. **生成策略**：输入业务目标；也可使用「推荐问题 / 推荐 plan」。
4. **确认执行**：确认策略后沙箱执行，保留任务、代码与血缘。
5. **查看洞察**：图表、明细与「结果分析总结」；可切换图表样式并追问。
6. **沉淀报告**：策略 / 结果 / 图表加入报告并导出。

```text
打开工作台 → 选择或上传 examples/sales.csv → 输入分析目标 → 生成策略 → 确认执行 → 查看图表 → 加入报告
```

## 复杂样例与数据库连接

### 电商交易系统样例（14 表）

`examples/ecommerce_platform/` 可灌入：`mysql` · `postgresql` · `sqlite` · `clickhouse` · `mssql` · `duckdb`

```bash
docker compose -f infra/docker-compose.sample-dbs.yml up -d   # 可选样例库
pip install -r apps/api/requirements.txt
python scripts/seed_ecommerce_samples.py --create-assets     # 需 API 已启动
```

详见 [examples/ecommerce_platform/README.md](examples/ecommerce_platform/README.md)。

### 轻量零售样例

`examples/retail_complex/`、`examples/retail_deep_dive_10csv/`。

推荐分析问题：

```text
分析 2026 上半年收入增长质量：请结合订单、客户、商品、营销和库存数据，分至少 6 步完成趋势、贡献、毛利、投放效率、库存风险和行动建议分析。
```

连接串示例：

```text
mysql+pymysql://user:password@host:3306/database
postgresql+psycopg2://user:password@host:5432/database
sqlite:////absolute/path/to/database.db
clickhouse+native://default:@host:9004/ecommerce
mssql+pymssql://sa:password@host:1433/ecommerce
duckdb:////absolute/path/to/database.duckdb
```

## 工程边界

- 元数据：`DRAGENT_STORE=json` → `local_data/metadata.json`；`postgres` → PostgreSQL。
- 对象文件：短期落 `local_data/objects`（Compose 已提供 MinIO）。
- RAG：`RagFlowClient` / `LocalRagClient` 工厂切换。
- 图谱：Neo4j 优先，失败回退资产内嵌图。
- Redis：连接失败自动降级。
- Agent：启发式默认可跑；LLM 可并行接入。
- 沙箱：本地 subprocess；Firecracker / Docker 池为后续阶段。
