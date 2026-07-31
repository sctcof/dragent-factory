from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from packages.shared_types.models import (
    Asset,
    AuditLog,
    CartItem,
    Dashboard,
    Datasource,
    ExecutionResult,
    ModelConfig,
    QueryBinding,
    Report,
    Session,
    Strategy,
    StrategyTemplate,
    Task,
    TaskFeedback,
    Message,
    now_iso,
)

from .config import DB_PATH, OBJECT_ROOT, PROJECT_ID


COLLECTIONS = [
    "sessions",
    "messages",
    "assets",
    "datasources",
    "datasource_credentials",
    "tasks",
    "strategies",
    "strategy_templates",
    "task_feedbacks",
    "executions",
    "cart_items",
    "reports",
    "query_bindings",
    "dashboards",
    "audit_logs",
]

PRIMARY_KEYS = {
    "executions": "execution_id",
}


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class ObjectStore:
    def __init__(self, root: Path = OBJECT_ROOT) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def put_bytes(self, key: str, payload: bytes) -> str:
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        return key

    def put_text(self, key: str, text: str) -> str:
        return self.put_bytes(key, text.encode("utf-8"))

    def put_json(self, key: str, value: Any) -> str:
        return self.put_text(key, json.dumps(value, ensure_ascii=False, indent=2))

    def get_text(self, key: str) -> str:
        return self.path(key).read_text(encoding="utf-8")

    def get_json(self, key: str) -> Any:
        return json.loads(self.get_text(key))

    def copy_from_path(self, key: str, source: Path) -> str:
        path = self.path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, path)
        return key

    def path(self, key: str) -> Path:
        return self.root / key


class JsonRepository:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.db_path.exists():
            self._write(self._empty())

    def _empty(self) -> Dict[str, Any]:
        data = {name: {} for name in COLLECTIONS}
        data["model_config"] = ModelConfig().model_dump()
        return data

    def _read(self) -> Dict[str, Any]:
        data = json.loads(self.db_path.read_text(encoding="utf-8"))
        changed = False
        for collection in COLLECTIONS:
            if collection not in data:
                data[collection] = {}
                changed = True
        if "model_config" not in data:
            data["model_config"] = ModelConfig().model_dump()
            changed = True
        if changed:
            self._write(data)
        return data

    def _write(self, data: Dict[str, Any]) -> None:
        self.db_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def all(self, collection: str) -> List[Dict[str, Any]]:
        data = self._read()
        return list(data[collection].values())

    def get(self, collection: str, item_id: str) -> Optional[Dict[str, Any]]:
        return self._read()[collection].get(item_id)

    def upsert(self, collection: str, item: Dict[str, Any]) -> Dict[str, Any]:
        data = self._read()
        key = PRIMARY_KEYS.get(collection, "id")
        data[collection][item[key]] = item
        self._write(data)
        return item

    def delete_soft(self, collection: str, item_id: str) -> None:
        data = self._read()
        if item_id in data[collection]:
            data[collection][item_id]["deleted_at"] = now_iso()
            self._write(data)

    def model_config(self) -> ModelConfig:
        return ModelConfig(**self._read().get("model_config", {}))

    def set_model_config(self, config: ModelConfig) -> ModelConfig:
        data = self._read()
        data["model_config"] = config.model_dump()
        self._write(data)
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
        self.upsert("audit_logs", log.model_dump())


def hydrate_session(raw: Dict[str, Any]) -> Session:
    return Session(**raw)


def hydrate_message(raw: Dict[str, Any]) -> Message:
    return Message(**raw)


def hydrate_asset(raw: Dict[str, Any]) -> Asset:
    return Asset(**raw)


def hydrate_datasource(raw: Dict[str, Any]) -> Datasource:
    return Datasource(**raw)


def hydrate_task(raw: Dict[str, Any]) -> Task:
    return Task(**raw)


def hydrate_strategy(raw: Dict[str, Any]) -> Strategy:
    return Strategy(**raw)


def hydrate_strategy_template(raw: Dict[str, Any]) -> StrategyTemplate:
    return StrategyTemplate(**raw)


def hydrate_task_feedback(raw: Dict[str, Any]) -> TaskFeedback:
    return TaskFeedback(**raw)


def hydrate_execution(raw: Dict[str, Any]) -> ExecutionResult:
    return ExecutionResult(**raw)


def hydrate_cart_item(raw: Dict[str, Any]) -> CartItem:
    return CartItem(**raw)


def hydrate_report(raw: Dict[str, Any]) -> Report:
    return Report(**raw)


def hydrate_binding(raw: Dict[str, Any]) -> QueryBinding:
    return QueryBinding(**raw)


def hydrate_dashboard(raw: Dict[str, Any]) -> Dashboard:
    return Dashboard(**raw)
