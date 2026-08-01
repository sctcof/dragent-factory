# 电商交易系统样例（14 表）

覆盖平台连接池枚举的全部数据库类型，用于多场景交易分析演示。

## 表清单

| 表名 | 说明 |
| --- | --- |
| suppliers | 供应商 |
| customers | 客户 |
| products | 商品 |
| stores | 门店/经营单元 |
| campaigns | 营销活动 |
| promotions | 促销规则 |
| orders | 订单头 |
| order_items | 订单明细 |
| payments | 支付流水 |
| shipments | 履约发货 |
| returns | 退货 |
| inventory_weekly | 周库存 |
| support_tickets | 客服工单 |
| reviews | 商品评价 |

## 快速开始

```bash
# 1) 生成 CSV
python examples/ecommerce_platform/generate_dataset.py

# 2)（可选）启动 ClickHouse / SQL Server / 独立 MySQL 样例库
docker compose -f infra/docker-compose.sample-dbs.yml up -d

# 3) 安装 API 驱动并灌库 + 注册连接
pip install -r apps/api/requirements.txt
python scripts/seed_ecommerce_samples.py --create-assets
```

默认目标：

| 类型 | 连接 |
| --- | --- |
| sqlite | `examples/ecommerce_platform/databases/ecommerce.sqlite` |
| duckdb | `examples/ecommerce_platform/databases/ecommerce.duckdb` |
| postgresql | `postgresql+psycopg2://dragent:dragent@127.0.0.1:5432/ecommerce`（复用本机 Compose Postgres，独立库） |
| mysql | 优先本机 `3306`（RAGFlow MySQL，`root/infini_rag_flow`）；也可用 sample-mysql `3307` |
| clickhouse | `127.0.0.1:9004` / HTTP `8124` |
| mssql | `sa/Dragent_Sample_123@127.0.0.1:1433`（需 `--profile mssql`，本机内存紧张时可能无法启动） |

可用环境变量覆盖：`ECOM_PG_URL`、`ECOM_MYSQL_URL`、`ECOM_CH_URL`、`ECOM_MSSQL_URL`、`ECOM_CH_HTTP_PORT`。

仅灌部分引擎：

```bash
python scripts/seed_ecommerce_samples.py --kinds sqlite,duckdb,postgresql,mysql,clickhouse --create-assets
```

启用 SQL Server 样例库：

```bash
docker compose -f infra/docker-compose.sample-dbs.yml --profile mssql up -d
python scripts/seed_ecommerce_samples.py --kinds mssql --create-assets
```
