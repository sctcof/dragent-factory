from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from packages.shared_types.models import (
    DEFAULT_ASSET_TAG,
    Asset,
    AssetTag,
    AuditLog,
    CartItem,
    Dashboard,
    Dataset,
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
    "asset_tags",
    "datasets",
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


@runtime_checkable
class Repository(Protocol):
    def all(self, collection: str) -> List[Dict[str, Any]]: ...

    def get(self, collection: str, item_id: str) -> Optional[Dict[str, Any]]: ...

    def upsert(self, collection: str, item: Dict[str, Any]) -> Dict[str, Any]: ...

    def delete_soft(self, collection: str, item_id: str) -> None: ...

    def audit(self, action: str, target_type: str, target_id: str, detail: Dict[str, Any]) -> None: ...


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


def normalize_asset_tags(tags: Any) -> List[str]:
    if not isinstance(tags, list):
        return [DEFAULT_ASSET_TAG]
    cleaned: List[str] = []
    seen = set()
    for item in tags:
        tag = str(item or "").strip()
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(tag)
    # public 与其它一级目录互斥：已归属非 public 时不再保留 public。
    public_prefix = f"{DEFAULT_ASSET_TAG}/"
    has_non_public = any(
        item != DEFAULT_ASSET_TAG and not item.startswith(public_prefix)
        for item in cleaned
    )
    if has_non_public:
        cleaned = [
            item
            for item in cleaned
            if item != DEFAULT_ASSET_TAG and not item.startswith(public_prefix)
        ]
    return cleaned or [DEFAULT_ASSET_TAG]


def hydrate_asset(raw: Dict[str, Any]) -> Asset:
    payload = dict(raw)
    payload["tags"] = normalize_asset_tags(payload.get("tags"))
    return Asset(**payload)


def hydrate_asset_tag(raw: Dict[str, Any]) -> AssetTag:
    payload = dict(raw)
    name = str(payload.get("name") or "").strip() or DEFAULT_ASSET_TAG
    path = str(payload.get("path") or "").strip() or name
    payload["name"] = name
    payload["path"] = path
    payload["parent_id"] = payload.get("parent_id") or None
    try:
        payload["depth"] = int(payload.get("depth") or path.count("/"))
    except (TypeError, ValueError):
        payload["depth"] = path.count("/")
    return AssetTag(**payload)


def hydrate_dataset(raw: Dict[str, Any]) -> Dataset:
    payload = dict(raw)
    asset_ids: List[str] = []
    seen = set()
    for item in payload.get("asset_ids") or []:
        asset_id = str(item or "").strip()
        if not asset_id or asset_id in seen:
            continue
        seen.add(asset_id)
        asset_ids.append(asset_id)
    payload["asset_ids"] = asset_ids
    tags = payload.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    payload["tags"] = [str(item).strip() for item in tags if str(item).strip()]
    payload["description"] = str(payload.get("description") or "")
    payload["updated_at"] = str(payload.get("updated_at") or payload.get("created_at") or now_iso())
    return Dataset(**payload)


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
