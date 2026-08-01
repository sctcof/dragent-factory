#!/usr/bin/env python3
"""Migrate local_data/metadata.json into PostgreSQL documents table."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from apps.api.dragent_api.config import DATABASE_URL, DB_PATH
from apps.api.dragent_api.postgres_repo import PostgresRepository
from apps.api.dragent_api.storage import COLLECTIONS


def main() -> int:
    source = Path(os.getenv("DRAGENT_JSON_PATH", str(DB_PATH)))
    if not source.exists():
        print(f"JSON metadata not found: {source}")
        return 1
    data = json.loads(source.read_text(encoding="utf-8"))
    repo = PostgresRepository(os.getenv("DATABASE_URL", DATABASE_URL))
    migrated = 0
    for collection in COLLECTIONS:
        items = data.get(collection, {})
        if not isinstance(items, dict):
            continue
        for item in items.values():
            if isinstance(item, dict):
                repo.upsert(collection, item)
                migrated += 1
    model_config = data.get("model_config")
    if isinstance(model_config, dict):
        from packages.shared_types.models import ModelConfig

        repo.set_model_config(ModelConfig(**model_config))
        print("model_config migrated")
    print(f"Migrated {migrated} documents from {source} -> PostgreSQL")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
