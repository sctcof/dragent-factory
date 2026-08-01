#!/usr/bin/env python3
"""Seed ecommerce sample data into all supported DB kinds and register datasources."""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

ROOT = Path(__file__).resolve().parents[1]
CSV_DIR = ROOT / "examples" / "ecommerce_platform" / "csv"
DB_DIR = ROOT / "examples" / "ecommerce_platform" / "databases"
GENERATOR = ROOT / "examples" / "ecommerce_platform" / "generate_dataset.py"

TABLE_FILES = [
    ("suppliers", "01_suppliers.csv"),
    ("customers", "02_customers.csv"),
    ("products", "03_products.csv"),
    ("stores", "04_stores.csv"),
    ("campaigns", "05_campaigns.csv"),
    ("promotions", "06_promotions.csv"),
    ("orders", "07_orders.csv"),
    ("order_items", "08_order_items.csv"),
    ("payments", "09_payments.csv"),
    ("shipments", "10_shipments.csv"),
    ("returns", "11_returns.csv"),
    ("inventory_weekly", "12_inventory_weekly.csv"),
    ("support_tickets", "13_support_tickets.csv"),
    ("reviews", "14_reviews.csv"),
]

DEFAULT_CONNECTIONS: Dict[str, Dict[str, str]] = {
    "sqlite": {
        "name": "电商样例 · SQLite",
        "url": f"sqlite:///{(DB_DIR / 'ecommerce.sqlite').as_posix()}",
    },
    "duckdb": {
        "name": "电商样例 · DuckDB",
        "url": f"duckdb:///{(DB_DIR / 'ecommerce.duckdb').as_posix()}",
    },
    "postgresql": {
        "name": "电商样例 · PostgreSQL",
        "url": os.getenv(
            "ECOM_PG_URL",
            "postgresql+psycopg2://dragent:dragent@127.0.0.1:5432/ecommerce",
        ),
    },
    "mysql": {
        "name": "电商样例 · MySQL",
        "url": os.getenv(
            "ECOM_MYSQL_URL",
            "mysql+pymysql://root:infini_rag_flow@127.0.0.1:3306/ecommerce",
        ),
    },
    "clickhouse": {
        "name": "电商样例 · ClickHouse",
        "url": os.getenv(
            "ECOM_CH_URL",
            "clickhouse+native://default:@127.0.0.1:9004/ecommerce",
        ),
    },
    "mssql": {
        "name": "电商样例 · SQL Server",
        "url": os.getenv(
            "ECOM_MSSQL_URL",
            "mssql+pymssql://sa:Dragent_Sample_123@127.0.0.1:1433/ecommerce",
        ),
    },
}


def ensure_csvs() -> None:
    if all((CSV_DIR / filename).exists() for _, filename in TABLE_FILES):
        return
    print(">> generating CSV sample dataset")
    subprocess.check_call([sys.executable, str(GENERATOR)], cwd=str(ROOT))


def load_tables() -> Dict[str, List[Dict[str, Any]]]:
    tables: Dict[str, List[Dict[str, Any]]] = {}
    for table, filename in TABLE_FILES:
        path = CSV_DIR / filename
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        tables[table] = rows
        print(f"  loaded {table}: {len(rows)} rows")
    return tables


def coerce_value(value: str) -> Any:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    try:
        if "." in text:
            return float(text)
        return int(text)
    except ValueError:
        return text


def normalized_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{key: coerce_value(value) for key, value in row.items()} for row in rows]


def ensure_postgres_database(admin_url: str, db_name: str = "ecommerce") -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": db_name}).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
            print(f"  created postgres database {db_name}")
    engine.dispose()


def ensure_mysql_database(admin_url: str, db_name: str = "ecommerce") -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(admin_url)
    with engine.connect() as conn:
        conn.execute(text(f"CREATE DATABASE IF NOT EXISTS `{db_name}` CHARACTER SET utf8mb4"))
        conn.commit()
        print(f"  ensured mysql database {db_name}")
    engine.dispose()


def ensure_mssql_database(admin_url: str, db_name: str = "ecommerce") -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        exists = conn.execute(text("SELECT database_id FROM sys.databases WHERE name = :name"), {"name": db_name}).scalar()
        if not exists:
            conn.execute(text(f"CREATE DATABASE [{db_name}]"))
            print(f"  created mssql database {db_name}")
    engine.dispose()


def _infer_column_type(rows: List[Dict[str, Any]], key: str):
    from sqlalchemy import Float, Integer, String

    for row in rows[:50]:
        value = coerce_value(row.get(key))
        if value is None:
            continue
        if isinstance(value, bool):
            return String(32)
        if isinstance(value, int):
            return Integer()
        if isinstance(value, float):
            return Float()
        return String(512)
    return String(512)


def seed_sqlalchemy(url: str, tables: Dict[str, List[Dict[str, Any]]], *, recreate: bool = True) -> int:
    from sqlalchemy import MetaData, Table, Column, create_engine, inspect, insert

    engine = create_engine(url)
    metadata = MetaData()
    if recreate:
        metadata.reflect(bind=engine)
        metadata.drop_all(bind=engine)
        metadata.clear()

    with engine.begin() as conn:
        for table_name, rows in tables.items():
            if not rows:
                continue
            columns = [Column(key, _infer_column_type(rows, key)) for key in rows[0]]
            table = Table(table_name, metadata, *columns)
            table.create(bind=conn)
            payload = normalized_rows(rows)
            # SQL Server sample container is memory-tight on laptops.
            chunk = 50 if url.startswith("mssql") else 500
            for index in range(0, len(payload), chunk):
                conn.execute(insert(table), payload[index : index + chunk])
            print(f"    {table_name}: {len(payload)}")
    count = len(inspect(engine).get_table_names())
    engine.dispose()
    return count


def seed_clickhouse(url: str, tables: Dict[str, List[Dict[str, Any]]]) -> int:
    """Prefer clickhouse-connect; fall back to sqlalchemy dialect if available."""
    host = "127.0.0.1"
    port = 8123
    user = "default"
    password = ""
    database = "ecommerce"
    # Parse lightweight from env-friendly URL if needed.
    if "://" in url:
        # clickhouse+native://user:pass@host:9000/db  OR http://host:8123
        from urllib.parse import urlparse

        parsed = urlparse(url.replace("clickhouse+native://", "clickhouse://").replace("clickhouse+http://", "http://"))
        host = parsed.hostname or host
        user = parsed.username or user
        password = parsed.password or password
        database = (parsed.path or "/ecommerce").lstrip("/") or database
        if parsed.port:
            # native 9000/9004 -> http 8123/8124 commonly
            port = 8123 if parsed.port in {9000, 9004} else parsed.port

    try:
        import clickhouse_connect
    except ImportError as exc:
        raise RuntimeError("clickhouse-connect is required for ClickHouse seeding") from exc

    if os.getenv("ECOM_CH_HTTP_PORT"):
        http_port = int(os.environ["ECOM_CH_HTTP_PORT"])
    elif port == 9004:
        http_port = 8124
    elif port in {9000, 8123}:
        http_port = 8123
    else:
        http_port = port
    print(f"  clickhouse http://{host}:{http_port} db={database}")
    client = clickhouse_connect.get_client(host=host, port=http_port, username=user, password=password or "")
    client.command(f"CREATE DATABASE IF NOT EXISTS {database}")
    client.command(f"USE {database}")

    for table_name, rows in tables.items():
        if not rows:
            continue
        payload = normalized_rows(rows)
        columns = list(payload[0])
        col_defs = []
        for key in columns:
            value = payload[0][key]
            if isinstance(value, int) and not isinstance(value, bool):
                col_defs.append(f"`{key}` Int64")
            elif isinstance(value, float):
                col_defs.append(f"`{key}` Float64")
            else:
                col_defs.append(f"`{key}` String")
        client.command(f"DROP TABLE IF EXISTS {database}.{table_name}")
        client.command(
            f"CREATE TABLE {database}.{table_name} ({', '.join(col_defs)}) ENGINE = MergeTree ORDER BY tuple()"
        )
        values = [[row.get(col) if row.get(col) is not None else "" for col in columns] for row in payload]
        client.insert(f"{database}.{table_name}", values, column_names=columns)
        print(f"    {table_name}: {len(payload)}")
    result = client.query(f"SELECT name FROM system.tables WHERE database = '{database}'")
    return len(result.result_rows)


def prepare_targets(kinds: List[str]) -> Dict[str, str]:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    urls: Dict[str, str] = {}
    for kind in kinds:
        urls[kind] = DEFAULT_CONNECTIONS[kind]["url"]

    if "postgresql" in kinds:
        admin = os.getenv("ECOM_PG_ADMIN_URL", "postgresql+psycopg2://dragent:dragent@127.0.0.1:5432/postgres")
        try:
            ensure_postgres_database(admin)
        except Exception as exc:
            print(f"  ! postgres prepare failed: {exc}")

    if "mysql" in kinds:
        mysql_admins = [
            os.getenv("ECOM_MYSQL_ADMIN_URL", ""),
            "mysql+pymysql://root:infini_rag_flow@127.0.0.1:3306/",
            "mysql+pymysql://root:dragent@127.0.0.1:3307/",
            "mysql+pymysql://dragent:dragent@127.0.0.1:3307/",
        ]
        prepared = False
        for admin in mysql_admins:
            if not admin:
                continue
            try:
                ensure_mysql_database(admin)
                # Align connection URL with successful admin host/password.
                if "3307" in admin and "dragent:dragent" in admin:
                    urls["mysql"] = "mysql+pymysql://dragent:dragent@127.0.0.1:3307/ecommerce"
                elif "3307" in admin:
                    urls["mysql"] = "mysql+pymysql://root:dragent@127.0.0.1:3307/ecommerce"
                elif "infini_rag_flow" in admin:
                    urls["mysql"] = "mysql+pymysql://root:infini_rag_flow@127.0.0.1:3306/ecommerce"
                prepared = True
                break
            except Exception as exc:
                print(f"  ! mysql prepare candidate failed: {exc}")
        if not prepared:
            print("  ! mysql prepare failed for all candidates")

    if "mssql" in kinds:
        admin = os.getenv(
            "ECOM_MSSQL_ADMIN_URL",
            "mssql+pymssql://sa:Dragent_Sample_123@127.0.0.1:1433/master",
        )
        try:
            ensure_mssql_database(admin)
        except Exception as exc:
            print(f"  ! mssql prepare failed: {exc}")

    if "sqlite" in kinds:
        path = DB_DIR / "ecommerce.sqlite"
        if path.exists():
            path.unlink()
        urls["sqlite"] = f"sqlite:///{path.as_posix()}"

    if "duckdb" in kinds:
        path = DB_DIR / "ecommerce.duckdb"
        if path.exists():
            path.unlink()
        urls["duckdb"] = f"duckdb:///{path.as_posix()}"

    return urls


def seed_kind(kind: str, url: str, tables: Dict[str, List[Dict[str, Any]]]) -> Tuple[bool, str]:
    print(f">> seeding {kind}")
    try:
        payload = tables
        if kind == "mssql":
            # Keep >10 tables but drop the heaviest weekly inventory on constrained MSSQL containers.
            payload = {name: rows for name, rows in tables.items() if name != "inventory_weekly"}
            print(f"  mssql subset tables: {len(payload)} (skipped inventory_weekly for memory)")
        if kind == "clickhouse":
            count = seed_clickhouse(url, payload)
        else:
            count = seed_sqlalchemy(url, payload)
        msg = f"ok · {count} tables"
        print(f"  {msg}")
        return True, msg
    except Exception as exc:
        msg = f"failed: {exc}"
        print(f"  {msg}")
        return False, msg


def api_request(base: str, method: str, path: str, payload: Optional[dict] = None) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data is not None else {},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else None


def register_datasources(api_base: str, seeded: Dict[str, str], create_assets: bool) -> None:
    print(">> registering datasources via API")
    existing = api_request(api_base, "GET", "/api/datasources")
    by_name = {item.get("name"): item for item in existing or []}
    for kind, url in seeded.items():
        name = DEFAULT_CONNECTIONS[kind]["name"]
        try:
            probe = api_request(api_base, "POST", "/api/datasources/test", {"database_url": url})
            print(f"  test {kind}: {probe.get('table_count')} tables")
            if name in by_name:
                ds = api_request(
                    api_base,
                    "PUT",
                    f"/api/datasources/{by_name[name]['id']}",
                    {"name": name, "database_url": url},
                )
                print(f"  updated {name} ({ds['id']})")
            else:
                ds = api_request(api_base, "POST", "/api/datasources", {"name": name, "database_url": url})
                print(f"  created {name} ({ds['id']})")
            if create_assets:
                tables = ds.get("tables") or []
                if tables:
                    result = api_request(
                        api_base,
                        "POST",
                        f"/api/datasources/{ds['id']}/assets",
                        {
                            "table_names": tables,
                            "sample_limit": 3000,
                            "tags": ["retail"],
                        },
                    )
                    failures = result.get("failures") or []
                    print(
                        f"  assets: created={result.get('created', 0)} "
                        f"reused={result.get('reused', 0)} "
                        f"failed={len(failures)}"
                    )
                    if failures:
                        print(f"    first failure: {failures[0]}")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            print(f"  ! register {kind} failed: HTTP {exc.code} {detail}")
        except Exception as exc:
            print(f"  ! register {kind} failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed ecommerce samples into supported databases")
    parser.add_argument(
        "--kinds",
        default="sqlite,duckdb,postgresql,mysql,clickhouse,mssql",
        help="Comma-separated kinds to seed",
    )
    parser.add_argument("--api-base", default=os.getenv("API_BASE", "http://127.0.0.1:8000"))
    parser.add_argument("--skip-register", action="store_true")
    parser.add_argument("--create-assets", action="store_true", help="Also create data assets from all tables")
    args = parser.parse_args()

    kinds = [item.strip() for item in args.kinds.split(",") if item.strip()]
    unknown = [item for item in kinds if item not in DEFAULT_CONNECTIONS]
    if unknown:
        raise SystemExit(f"unsupported kinds: {unknown}")

    ensure_csvs()
    tables = load_tables()
    if len(tables) < 11:
        raise SystemExit("expected more than 10 tables")

    urls = prepare_targets(kinds)
    seeded: Dict[str, str] = {}
    for kind in kinds:
        ok, _ = seed_kind(kind, urls[kind], tables)
        if ok:
            seeded[kind] = urls[kind]

    summary_path = DB_DIR / "seed_summary.json"
    summary_path.write_text(json.dumps({"seeded": seeded, "tables": list(tables)}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f">> summary written to {summary_path}")

    if not args.skip_register and seeded:
        # brief wait if API just restarted
        for _ in range(10):
            try:
                api_request(args.api_base, "GET", "/api/datasources/supported")
                break
            except Exception:
                time.sleep(1)
        register_datasources(args.api_base, seeded, create_assets=args.create_assets)

    print("done")
    print(json.dumps({"seeded_kinds": list(seeded), "table_count": len(tables)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
