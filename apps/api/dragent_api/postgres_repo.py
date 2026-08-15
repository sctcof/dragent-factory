from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from packages.shared_types.models import AuditLog, ModelConfig, now_iso

from .config import DATABASE_URL, PROJECT_ID
from .storage import COLLECTIONS, PRIMARY_KEYS, new_id


class PostgresRepository:
    """Document-style repository backed by PostgreSQL, mirroring JsonRepository APIs."""

    def __init__(self, database_url: str = DATABASE_URL) -> None:
        # connect_timeout 避免 Postgres 不可达时请求无限挂起（表现为前端保存弹窗不关闭）
        self.engine: Engine = create_engine(
            database_url,
            pool_pre_ping=True,
            pool_timeout=10,
            connect_args={"connect_timeout": 5},
        )
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with self.engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS documents (
                      collection text NOT NULL,
                      item_id text NOT NULL,
                      payload jsonb NOT NULL DEFAULT '{}',
                      deleted_at timestamptz,
                      updated_at timestamptz NOT NULL DEFAULT now(),
                      PRIMARY KEY (collection, item_id)
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS model_config (
                      id text PRIMARY KEY DEFAULT 'default',
                      payload jsonb NOT NULL DEFAULT '{}'
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS knowledge_bases (
                      id text PRIMARY KEY,
                      project_id text NOT NULL,
                      kind text NOT NULL,
                      ragflow_kb_id text,
                      name text NOT NULL,
                      meta jsonb NOT NULL DEFAULT '{}',
                      created_at timestamptz NOT NULL DEFAULT now(),
                      deleted_at timestamptz
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS chunks (
                      id text PRIMARY KEY,
                      asset_id text,
                      kb_id text,
                      project_id text NOT NULL,
                      object_key text,
                      position_ref text,
                      text text NOT NULL DEFAULT '',
                      embedding_version text,
                      meta jsonb NOT NULL DEFAULT '{}',
                      created_at timestamptz NOT NULL DEFAULT now(),
                      deleted_at timestamptz
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS audit_logs (
                      id text PRIMARY KEY,
                      project_id text NOT NULL,
                      actor_id text NOT NULL DEFAULT 'system',
                      action text NOT NULL,
                      target_type text NOT NULL,
                      target_id text NOT NULL,
                      detail jsonb NOT NULL DEFAULT '{}',
                      created_at timestamptz NOT NULL DEFAULT now()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    INSERT INTO model_config (id, payload)
                    VALUES ('default', CAST(:payload AS jsonb))
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {"payload": json.dumps(ModelConfig().model_dump())},
            )

    def all(self, collection: str) -> List[Dict[str, Any]]:
        with self.engine.connect() as conn:
            rows = conn.execute(
                text("SELECT payload FROM documents WHERE collection = :collection"),
                {"collection": collection},
            ).mappings()
            items = [dict(row["payload"]) for row in rows]
        return items

    def get(self, collection: str, item_id: str) -> Optional[Dict[str, Any]]:
        with self.engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT payload FROM documents
                    WHERE collection = :collection AND item_id = :item_id
                    """
                ),
                {"collection": collection, "item_id": item_id},
            ).mappings().first()
        return dict(row["payload"]) if row else None

    def upsert(self, collection: str, item: Dict[str, Any]) -> Dict[str, Any]:
        key = PRIMARY_KEYS.get(collection, "id")
        item_id = str(item[key])
        deleted_at = item.get("deleted_at")
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO documents (collection, item_id, payload, deleted_at, updated_at)
                    VALUES (:collection, :item_id, CAST(:payload AS jsonb), :deleted_at, now())
                    ON CONFLICT (collection, item_id) DO UPDATE
                    SET payload = EXCLUDED.payload,
                        deleted_at = EXCLUDED.deleted_at,
                        updated_at = now()
                    """
                ),
                {
                    "collection": collection,
                    "item_id": item_id,
                    "payload": json.dumps(item, ensure_ascii=False, default=str),
                    "deleted_at": deleted_at,
                },
            )
        return item

    def delete_soft(self, collection: str, item_id: str) -> None:
        item = self.get(collection, item_id)
        if not item:
            return
        item["deleted_at"] = now_iso()
        self.upsert(collection, item)

    def model_config(self) -> ModelConfig:
        with self.engine.connect() as conn:
            row = conn.execute(
                text("SELECT payload FROM model_config WHERE id = 'default'")
            ).mappings().first()
        payload = dict(row["payload"]) if row else {}
        return ModelConfig(**payload)

    def set_model_config(self, config: ModelConfig) -> ModelConfig:
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO model_config (id, payload)
                    VALUES ('default', CAST(:payload AS jsonb))
                    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload
                    """
                ),
                {"payload": json.dumps(config.model_dump(), ensure_ascii=False)},
            )
        return config

    def audit(self, action: str, target_type: str, target_id: str, detail: Dict[str, Any]) -> None:
        log = AuditLog(
            id=new_id("audit"),
            project_id=PROJECT_ID,
            action=action,
            target_type=target_type,
            target_id=target_id,
            detail=detail,
        )
        payload = log.model_dump()
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO audit_logs (id, project_id, actor_id, action, target_type, target_id, detail, created_at)
                    VALUES (:id, :project_id, :actor_id, :action, :target_type, :target_id, CAST(:detail AS jsonb), :created_at)
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": payload["id"],
                    "project_id": payload["project_id"],
                    "actor_id": payload.get("actor_id", "system"),
                    "action": payload["action"],
                    "target_type": payload["target_type"],
                    "target_id": payload["target_id"],
                    "detail": json.dumps(payload.get("detail", {}), ensure_ascii=False),
                    "created_at": payload.get("created_at") or now_iso(),
                },
            )
        # Also mirror into documents for uniform listing if needed
        self.upsert("audit_logs", payload)

    def upsert_knowledge_base(self, item: Dict[str, Any]) -> Dict[str, Any]:
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO knowledge_bases (id, project_id, kind, ragflow_kb_id, name, meta, created_at, deleted_at)
                    VALUES (:id, :project_id, :kind, :ragflow_kb_id, :name, CAST(:meta AS jsonb), :created_at, :deleted_at)
                    ON CONFLICT (id) DO UPDATE
                    SET ragflow_kb_id = EXCLUDED.ragflow_kb_id,
                        name = EXCLUDED.name,
                        meta = EXCLUDED.meta,
                        deleted_at = EXCLUDED.deleted_at
                    """
                ),
                {
                    "id": item["id"],
                    "project_id": item.get("project_id", PROJECT_ID),
                    "kind": item["kind"],
                    "ragflow_kb_id": item.get("ragflow_kb_id"),
                    "name": item["name"],
                    "meta": json.dumps(item.get("meta", {}), ensure_ascii=False),
                    "created_at": item.get("created_at") or now_iso(),
                    "deleted_at": item.get("deleted_at"),
                },
            )
        return item

    def list_knowledge_bases(self, project_id: str = PROJECT_ID) -> List[Dict[str, Any]]:
        with self.engine.connect() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT id, project_id, kind, ragflow_kb_id, name, meta, created_at, deleted_at
                    FROM knowledge_bases
                    WHERE project_id = :project_id AND deleted_at IS NULL
                    """
                ),
                {"project_id": project_id},
            ).mappings()
            return [dict(row) for row in rows]

    def upsert_chunk(self, item: Dict[str, Any]) -> Dict[str, Any]:
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO chunks (
                      id, asset_id, kb_id, project_id, object_key, position_ref,
                      text, embedding_version, meta, created_at, deleted_at
                    )
                    VALUES (
                      :id, :asset_id, :kb_id, :project_id, :object_key, :position_ref,
                      :text, :embedding_version, CAST(:meta AS jsonb), :created_at, :deleted_at
                    )
                    ON CONFLICT (id) DO UPDATE
                    SET text = EXCLUDED.text,
                        kb_id = EXCLUDED.kb_id,
                        meta = EXCLUDED.meta,
                        embedding_version = EXCLUDED.embedding_version,
                        deleted_at = EXCLUDED.deleted_at
                    """
                ),
                {
                    "id": item["id"],
                    "asset_id": item.get("asset_id"),
                    "kb_id": item.get("kb_id"),
                    "project_id": item.get("project_id", PROJECT_ID),
                    "object_key": item.get("object_key"),
                    "position_ref": item.get("position_ref"),
                    "text": item.get("text", ""),
                    "embedding_version": item.get("embedding_version"),
                    "meta": json.dumps(item.get("meta", {}), ensure_ascii=False),
                    "created_at": item.get("created_at") or now_iso(),
                    "deleted_at": item.get("deleted_at"),
                },
            )
        return item

    def list_chunks(self, asset_id: Optional[str] = None, project_id: str = PROJECT_ID) -> List[Dict[str, Any]]:
        query = """
            SELECT id, asset_id, kb_id, project_id, object_key, position_ref,
                   text, embedding_version, meta, created_at, deleted_at
            FROM chunks
            WHERE project_id = :project_id AND deleted_at IS NULL
        """
        params: Dict[str, Any] = {"project_id": project_id}
        if asset_id:
            query += " AND asset_id = :asset_id"
            params["asset_id"] = asset_id
        with self.engine.connect() as conn:
            rows = conn.execute(text(query), params).mappings()
            result = []
            for row in rows:
                item = dict(row)
                if isinstance(item.get("meta"), str):
                    item["meta"] = json.loads(item["meta"])
                result.append(item)
            return result
