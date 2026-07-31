from __future__ import annotations

import csv
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


SUPPORTED_HINTS = {
    "mysql": "mysql+pymysql://user:password@host:3306/database",
    "postgresql": "postgresql+psycopg2://user:password@host:5432/database",
    "sqlite": "sqlite:////absolute/path/to/database.db",
}


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
    return scheme.split("+", 1)[0]


def list_database_tables(database_url: str) -> List[str]:
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
        result = connection.execute(text(f"SELECT * FROM {quoted_table} LIMIT :limit"), {"limit": max(1, min(limit, 50000))})
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
