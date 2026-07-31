# Data-RAG-Agent Factory

基于 `dragent.md` 与 `docs/engineering-architecture.md` 落地的可运行工程实现。系统按六层架构拆分为 Web 工作台、FastAPI 应用服务、多 Agent 编排、模型网关、本地 RAG/图谱适配、数据接入、执行沙箱、报告与看板模块。

## 本地启动

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
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

`examples/retail_complex/` 提供了一个多数据集零售经营样例，包含订单、客户、商品、营销投放、库存五类数据，以及同结构的 SQLite 数据库：

- `orders.csv`
- `customers.csv`
- `products.csv`
- `marketing.csv`
- `inventory.csv`
- `retail_complex.sqlite`

推荐分析问题：

```text
分析 2026 上半年收入增长质量：请结合订单、客户、商品、营销和库存数据，分至少 6 步完成趋势、贡献、毛利、投放效率、库存风险和行动建议分析。
```

数据资产页支持创建数据库连接并抽样生成数据资产。连接串示例：

```text
mysql+pymysql://user:password@host:3306/database
postgresql+psycopg2://user:password@host:5432/database
sqlite:////absolute/path/to/database.db
```

SQLite 样例可使用绝对路径连接，例如：

```text
sqlite:////Users/guanwenzheng/Desktop/workspace/dragent-factory/examples/retail_complex/retail_complex.sqlite
```

## 工程边界

本地 MVP 使用 `local_data/metadata.json` 和 `local_data/objects` 作为元数据与对象存储事实源，以确定性 Agent 替代真实 LLM 调用。RAGFlow、图数据库、PostgreSQL、Redis、Docker 沙箱均保留独立适配边界，生产替换时不需要改动前端协议和 API 路径。
