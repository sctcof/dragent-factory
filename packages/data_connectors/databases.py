from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


SUPPORTED_HINTS = {
    "mysql": "mysql+pymysql://user:password@host:3306/database",
    "postgresql": "postgresql+psycopg2://user:password@host:5432/database",
    "sqlite": "sqlite:////absolute/path/to/database.db",
    "clickhouse": "clickhouse+native://user:password@host:9000/database",
    "mssql": "mssql+pymssql://user:password@host:1433/database",
    "duckdb": "duckdb:////absolute/path/to/database.duckdb",
}

# Display order for connection pool grouping / selectors.
SUPPORTED_KINDS = ["mysql", "postgresql", "sqlite", "clickhouse", "mssql", "duckdb"]


def mask_database_url(database_url: str) -> str:
    parsed = urlparse(database_url)
    if not parsed.scheme:
        return database_url
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    path = parsed.path or ""
    auth = "***:***@" if parsed.username or parsed.password else ""
    return f"{parsed.scheme}://{auth}{host}{port}{path}"


def database_kind(database_url: str) -> str:
    scheme = database_url.split("://", 1)[0]
    kind = scheme.split("+", 1)[0].lower()
    if kind in {"postgres", "postgresql"}:
        return "postgresql"
    if kind in {"mssql", "sqlserver"}:
        return "mssql"
    return kind


def test_database_connection(database_url: str) -> Dict[str, Any]:
    tables = list_database_tables(database_url)
    return {
        "ok": True,
        "kind": database_kind(database_url),
        "table_count": len(tables),
        "tables": tables,
        "database_url_masked": mask_database_url(database_url),
    }


def _clickhouse_client_from_url(database_url: str):
    import os
    from urllib.parse import urlparse

    import clickhouse_connect

    normalized = (
        database_url.replace("clickhouse+native://", "clickhouse://")
        .replace("clickhouse+http://", "http://")
    )
    parsed = urlparse(normalized)
    host = parsed.hostname or "127.0.0.1"
    user = parsed.username or "default"
    password = parsed.password or ""
    database = (parsed.path or "/default").lstrip("/") or "default"
    native_port = parsed.port or 9000
    env_http = os.getenv("CLICKHOUSE_HTTP_PORT") or os.getenv("ECOM_CH_HTTP_PORT")
    if env_http:
        http_port = int(env_http)
    elif "+http" in database_url or database_url.startswith("http"):
        http_port = native_port
    elif native_port == 9004:
        http_port = 8124
    else:
        http_port = 8123
    client = clickhouse_connect.get_client(
        host=host,
        port=http_port,
        username=user,
        password=password or "",
        database=database,
    )
    return client, database


def list_database_tables(database_url: str) -> List[str]:
    kind = database_kind(database_url)
    if kind == "clickhouse":
        try:
            client, database = _clickhouse_client_from_url(database_url)
            result = client.query(
                "SELECT name FROM system.tables WHERE database = {db:String} AND is_temporary = 0 ORDER BY name",
                parameters={"db": database},
            )
            return [str(row[0]) for row in result.result_rows]
        except Exception:
            pass

    try:
        from sqlalchemy import create_engine, inspect
    except ImportError as exc:
        raise RuntimeError("Database connection requires SQLAlchemy and the matching DB driver") from exc

    engine = create_engine(database_url)
    try:
        with engine.connect():
            return inspect(engine).get_table_names()
    finally:
        engine.dispose()


def extract_table_snapshot(
    database_url: str,
    output_path: Path,
    table_name: Optional[str] = None,
    limit: int = 5000,
) -> Dict[str, Any]:
    kind = database_kind(database_url)
    safe_limit = max(1, min(limit, 50000))

    if kind == "clickhouse":
        client, database = _clickhouse_client_from_url(database_url)
        tables = list_database_tables(database_url)
        if not tables:
            raise RuntimeError("No tables found in database")
        selected_table = table_name or tables[0]
        if selected_table not in tables:
            raise RuntimeError(f"Table {selected_table} not found. Available tables: {', '.join(tables[:20])}")
        result = client.query(f"SELECT * FROM {database}.{selected_table} LIMIT {safe_limit}")
        columns = list(result.column_names)
        rows = [dict(zip(columns, row)) for row in result.result_rows]
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            for row in rows:
                writer.writerow({column: row.get(column, "") for column in columns})
        return {
            "table_name": selected_table,
            "tables": tables,
            "columns": columns,
            "row_count": len(rows),
            "snapshot_path": str(output_path),
        }

    try:
        from sqlalchemy import create_engine, inspect, text
    except ImportError as exc:
        raise RuntimeError("Database connection requires SQLAlchemy and the matching DB driver") from exc

    engine = create_engine(database_url)
    with engine.connect() as connection:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        if not tables:
            raise RuntimeError("No tables found in database")
        selected_table = table_name or tables[0]
        if selected_table not in tables:
            raise RuntimeError(f"Table {selected_table} not found. Available tables: {', '.join(tables[:20])}")
        columns = [column["name"] for column in inspector.get_columns(selected_table)]
        quoted_table = engine.dialect.identifier_preparer.quote(selected_table)
        result = connection.execute(text(f"SELECT * FROM {quoted_table} LIMIT :limit"), {"limit": safe_limit})
        rows = [dict(row._mapping) for row in result]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in columns})

    return {
        "table_name": selected_table,
        "tables": tables,
        "columns": columns,
        "row_count": len(rows),
        "snapshot_path": str(output_path),
    }
