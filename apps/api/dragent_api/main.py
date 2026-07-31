from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from packages.agent_graph import AgentWorkflow
from packages.llm_gateway import ModelRouter
from packages.rag_client import LocalRagClient
from packages.sandbox_client import LocalSandboxExecutor
from packages.shared_types.models import (
    Asset,
    AssetType,
    CartItem,
    ChartConfig,
    Dashboard,
    DashboardItem,
    Datasource,
    ExecutionResult,
    Message,
    ModelConfig,
    QueryBinding,
    Report,
    ReportVersion,
    Session,
    Strategy,
    StrategyTemplate,
    Task,
    TaskFeedback,
    TaskStatus,
    now_iso,
)
from packages.data_connectors import SUPPORTED_HINTS, database_kind, extract_table_snapshot, list_database_tables, mask_database_url, parse_uploaded_table

from .config import PROJECT_ID
from .dependencies import objects, repo
from .storage import (
    hydrate_asset,
    hydrate_binding,
    hydrate_cart_item,
    hydrate_dashboard,
    hydrate_datasource,
    hydrate_execution,
    hydrate_report,
    hydrate_session,
    hydrate_strategy,
    hydrate_strategy_template,
    hydrate_task,
    hydrate_task_feedback,
    new_id,
)


app = FastAPI(title="Data-RAG-Agent API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateSessionRequest(BaseModel):
    title: str = "新的分析会话"
    project_id: str = PROJECT_ID


class CloneSessionRequest(BaseModel):
    title: Optional[str] = None


class CreateTaskRequest(BaseModel):
    session_id: str
    message: str
    asset_ids: List[str]
    strategy_asset_ids: List[str] = []
    agent_model_config: Optional[Dict[str, str]] = Field(default=None, alias="model_config")


class ConfirmStrategyRequest(BaseModel):
    strategy_id: str
    confirmed_strategy: Dict[str, Any]
    confirmed_by: str = "local-user"


class ExecutionRequest(BaseModel):
    task_id: str
    language: str = "python"
    code: str
    asset_ids: List[str]


class CartItemRequest(BaseModel):
    session_id: str
    type: str
    ref_id: str
    title: str
    snapshot: Dict[str, Any]


class ReportRequest(BaseModel):
    session_id: str
    cart_item_ids: List[str]
    format: str = "markdown"
    title: Optional[str] = None


class ReportModuleRequest(BaseModel):
    session_id: str
    type: str
    ref_id: str
    title: str
    snapshot: Dict[str, Any]


class CreateReportFromModuleRequest(ReportModuleRequest):
    report_title: Optional[str] = None


class DashboardRequest(BaseModel):
    name: str
    project_id: str = PROJECT_ID
    page_params: List[Dict[str, Any]] = []
    refresh_interval: Optional[int] = None


class DashboardItemRequest(BaseModel):
    chart_id: str
    source_execution_id: str
    param_mapping: Dict[str, str] = {}


class BindingExecuteRequest(BaseModel):
    dashboard_id: Optional[str] = None
    params: Dict[str, Any] = {}


class ReportRunRequest(BaseModel):
    params: Dict[str, Any] = {}


class ReportStrategyRequest(BaseModel):
    title: Optional[str] = None


class CreateDatasourceRequest(BaseModel):
    name: str
    database_url: str
    table_name: Optional[str] = None
    sample_limit: int = 5000
    project_id: str = PROJECT_ID


class CreateDatasourceAssetsRequest(BaseModel):
    table_names: List[str]
    sample_limit: int = 5000


class RagContextRequest(BaseModel):
    query: str = ""
    asset_ids: List[str]
    limit: int = 8


class CombinedKnowledgeGraphRequest(BaseModel):
    asset_ids: List[str]
    title: str = "多数据集整体知识图"


class TaskFeedbackRequest(BaseModel):
    rating: str
    note: Optional[str] = None


class StrategyMarkdownRequest(BaseModel):
    title: str
    markdown: str
    project_id: str = PROJECT_ID


class StrategyAssetUpdateRequest(BaseModel):
    title: str
    markdown: str


class StrategyPolishRequest(BaseModel):
    title: str
    markdown: str


class StrategyMergeRequest(BaseModel):
    title: str
    strategy_asset_ids: List[str]
    project_id: str = PROJECT_ID


class StrategyFromFeedbackRequest(BaseModel):
    task_ids: List[str] = []
    title: str = "个性化分析策略"
    project_id: str = PROJECT_ID


@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {"status": "ok", "project_id": PROJECT_ID, "time": now_iso()}


@app.get("/api/bootstrap")
def bootstrap() -> Dict[str, Any]:
    sessions = [session for session in _sessions() if not session.deleted_at]
    assets = [asset for asset in _assets() if not asset.deleted_at]
    dashboards = _dashboards()
    return {
        "project_id": PROJECT_ID,
        "sessions": sessions,
        "assets": assets,
        "reports": [report for report in _reports() if not report.deleted_at],
        "dashboards": dashboards,
        "datasources": [datasource for datasource in _datasources() if not datasource.deleted_at],
        "model_config": repo.model_config(),
    }


@app.post("/api/sessions")
def create_session(payload: CreateSessionRequest) -> Session:
    session = Session(id=new_id("sess"), project_id=payload.project_id, title=payload.title)
    repo.upsert("sessions", session.model_dump())
    repo.audit("session.create", "session", session.id, {"title": session.title})
    return session


@app.post("/api/sessions/{session_id}/clone")
def clone_session(session_id: str, payload: CloneSessionRequest = CloneSessionRequest()) -> Session:
    source = _require_session(session_id)
    created_at = now_iso()
    cloned = Session(
        id=new_id("sess"),
        project_id=source.project_id,
        user_id=source.user_id,
        title=payload.title or f"{source.title} 续聊",
        status="active",
        archived_at=None,
        deleted_at=None,
        last_active_at=created_at,
    )
    repo.upsert("sessions", cloned.model_dump())

    task_id_map: Dict[str, str] = {}
    strategy_id_map: Dict[str, str] = {}
    execution_id_map: Dict[str, str] = {}
    source_tasks = sorted([task for task in _tasks() if task.session_id == source.id], key=lambda item: item.created_at)
    for task in source_tasks:
        task_id_map[task.id] = new_id("task")

    for task in source_tasks:
        cloned_task_id = task_id_map[task.id]
        task_data = task.model_dump()
        task_data.update({"id": cloned_task_id, "session_id": cloned.id, "updated_at": created_at})

        if task.strategy_id:
            strategy_raw = repo.get("strategies", task.strategy_id)
            if strategy_raw and not strategy_raw.get("deleted_at"):
                strategy = hydrate_strategy(strategy_raw)
                cloned_strategy_id = new_id("strategy")
                strategy_id_map[strategy.id] = cloned_strategy_id
                strategy_data = strategy.model_dump()
                strategy_data.update({"id": cloned_strategy_id, "task_id": cloned_task_id})
                repo.upsert("strategies", strategy_data)
                task_data["strategy_id"] = cloned_strategy_id

        if task.execution_id:
            execution_raw = repo.get("executions", task.execution_id)
            if execution_raw:
                execution = hydrate_execution(execution_raw)
                cloned_execution_id = new_id("exec")
                execution_id_map[execution.execution_id] = cloned_execution_id
                execution_data = execution.model_dump()
                execution_data.update({"execution_id": cloned_execution_id, "task_id": cloned_task_id})
                cloned_execution = ExecutionResult(**execution_data)
                repo.upsert("executions", cloned_execution.model_dump())
                _persist_chart_snapshots(cloned.project_id, cloned_execution)
                task_data["execution_id"] = cloned_execution_id

        repo.upsert("tasks", task_data)

    for message in sorted(_messages(source.id), key=lambda item: item.created_at):
        message_data = message.model_dump()
        message_data.update({"id": new_id("msg"), "session_id": cloned.id})
        if message.task_id:
            message_data["task_id"] = task_id_map.get(message.task_id)
        repo.upsert("messages", message_data)

    for feedback in _feedbacks(session_id=source.id):
        if feedback.task_id not in task_id_map:
            continue
        feedback_data = feedback.model_dump()
        feedback_data.update({
            "id": new_id("fb"),
            "session_id": cloned.id,
            "task_id": task_id_map[feedback.task_id],
            "updated_at": created_at,
        })
        repo.upsert("task_feedbacks", feedback_data)

    repo.audit(
        "session.clone",
        "session",
        cloned.id,
        {"source_session_id": source.id, "tasks": len(task_id_map), "strategies": len(strategy_id_map), "executions": len(execution_id_map)},
    )
    return cloned


@app.get("/api/sessions")
def list_sessions(
    project_id: str = PROJECT_ID,
    keyword: str = "",
    status: str = "active",
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
    sessions = [item for item in _sessions() if item.project_id == project_id and not item.deleted_at]
    if status == "active":
        sessions = [item for item in sessions if not item.archived_at]
    if keyword:
        lowered = keyword.lower()
        sessions = [item for item in sessions if lowered in item.title.lower() or _session_message_hit(item.id, lowered)]
    sessions.sort(key=lambda item: item.last_active_at, reverse=True)
    start = (page - 1) * page_size
    return {"items": sessions[start : start + page_size], "total": len(sessions)}


@app.patch("/api/sessions/{session_id}")
def patch_session(session_id: str, payload: Dict[str, Any]) -> Session:
    session = _require_session(session_id)
    if "title" in payload:
        session.title = str(payload["title"])
    if "archived" in payload:
        session.archived_at = now_iso() if payload["archived"] else None
    session.last_active_at = now_iso()
    repo.upsert("sessions", session.model_dump())
    repo.audit("session.update", "session", session.id, payload)
    return session


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str) -> Dict[str, Any]:
    _require_session(session_id)
    repo.delete_soft("sessions", session_id)
    repo.audit("session.delete", "session", session_id, {})
    return {"status": "deleted"}


@app.get("/api/sessions/{session_id}/replay")
def replay_session(session_id: str) -> Dict[str, Any]:
    session = _require_session(session_id)
    timeline: List[Dict[str, Any]] = []
    messages = sorted(_messages(session_id), key=lambda item: item.created_at)
    rendered_tasks = set()
    for message in messages:
        timeline.append({"type": "message", **message.model_dump()})
        if message.task_id and message.role == "user" and message.task_id not in rendered_tasks:
            task = _task_or_none(message.task_id)
            if task:
                timeline.append(_task_timeline(task))
                rendered_tasks.add(message.task_id)
    return {"session": session, "timeline": timeline}


@app.post("/api/assets/upload")
async def upload_asset(
    file: UploadFile = File(...),
    project_id: str = Form(PROJECT_ID),
) -> Asset:
    suffix = "." + file.filename.split(".")[-1].lower() if "." in file.filename else ""
    if suffix not in [".csv", ".xlsx", ".xls"]:
        raise HTTPException(status_code=400, detail="当前实现支持 CSV / Excel 上传")
    asset_id = new_id("asset")
    object_key = f"raw/{project_id}/{asset_id}/1/{file.filename}"
    payload = await file.read()
    objects.put_bytes(object_key, payload)
    parsed = parse_uploaded_table(asset_id, file.filename, objects.path(object_key))
    parsed_key = f"parsed/{project_id}/{asset_id}/1/profile.json"
    objects.put_json(
        parsed_key,
        {
            "dictionary": parsed["dictionary"].model_dump(),
            "rows_preview": parsed["rows"][:50],
            "graph": parsed["graph"].model_dump(),
        },
    )
    asset = Asset(
        id=asset_id,
        project_id=project_id,
        type=AssetType.excel if suffix in [".xlsx", ".xls"] else AssetType.csv,
        name=file.filename,
        source="file",
        object_key=object_key,
        parse_status="ready",
        data_dictionary=parsed["dictionary"],
        graph=parsed["graph"],
    )
    repo.upsert("assets", asset.model_dump())
    repo.audit("asset.upload", "asset", asset.id, {"filename": file.filename, "parsed_key": parsed_key})
    return asset


@app.get("/api/datasources/supported")
def supported_datasources() -> Dict[str, Any]:
    return {"supported": SUPPORTED_HINTS}


@app.get("/api/datasources")
def list_datasources(project_id: str = PROJECT_ID) -> List[Datasource]:
    return [datasource for datasource in _datasources() if datasource.project_id == project_id and not datasource.deleted_at]


@app.post("/api/datasources")
def create_datasource(payload: CreateDatasourceRequest) -> Datasource:
    datasource_id = new_id("ds")
    try:
        tables = list_database_tables(payload.database_url)
        if not tables:
            raise RuntimeError("数据库中没有可用的数据表")
        datasource = Datasource(
            id=datasource_id,
            project_id=payload.project_id,
            name=payload.name,
            type=database_kind(payload.database_url),
            database_url_masked=mask_database_url(payload.database_url),
            tables=tables,
            status="ready",
        )
        repo.upsert("datasources", datasource.model_dump())
        repo.upsert("datasource_credentials", {
            "id": datasource.id,
            "database_url": payload.database_url,
            "created_at": now_iso(),
            "deleted_at": None,
        })
        repo.audit("datasource.create", "datasource", datasource.id, {"table_count": len(tables)})
        return datasource
    except Exception as exc:
        repo.audit("datasource.create_failed", "datasource", datasource_id, {"error": str(exc)})
        raise HTTPException(status_code=400, detail=str(exc))


def _datasource_database_url(datasource: Datasource) -> str:
    credential = repo.get("datasource_credentials", datasource.id)
    if credential and not credential.get("deleted_at") and credential.get("database_url"):
        return str(credential["database_url"])
    if "***" not in datasource.database_url_masked:
        return datasource.database_url_masked
    raise HTTPException(status_code=409, detail="该历史连接没有可复用凭据，请重新创建连接")


@app.get("/api/datasources/{datasource_id}/tables")
def datasource_tables(datasource_id: str) -> Dict[str, Any]:
    datasource = _require_datasource(datasource_id)
    tables = datasource.tables
    if not tables:
        tables = list_database_tables(_datasource_database_url(datasource))
        datasource.tables = tables
        repo.upsert("datasources", datasource.model_dump())
    return {"datasource_id": datasource.id, "tables": tables}


@app.post("/api/datasources/{datasource_id}/assets")
def create_datasource_assets(datasource_id: str, payload: CreateDatasourceAssetsRequest) -> Dict[str, Any]:
    datasource = _require_datasource(datasource_id)
    table_names = list(dict.fromkeys(name.strip() for name in payload.table_names if name.strip()))
    if not table_names:
        raise HTTPException(status_code=400, detail="请至少选择一张数据表")
    database_url = _datasource_database_url(datasource)
    available_tables = datasource.tables or list_database_tables(database_url)
    missing = [name for name in table_names if name not in available_tables]
    if missing:
        raise HTTPException(status_code=400, detail=f"数据表不存在：{', '.join(missing)}")

    existing_assets = {
        asset.source_table: asset
        for asset in _assets()
        if not asset.deleted_at and asset.datasource_id == datasource.id and asset.source_table
    }
    created_assets: List[Asset] = []
    reused_assets: List[Asset] = []
    failures: List[Dict[str, str]] = []
    for table_name in table_names:
        if table_name in existing_assets:
            reused_assets.append(existing_assets[table_name])
            continue
        asset_id = new_id("asset")
        object_key = f"raw/{datasource.project_id}/{asset_id}/1/{table_name}.csv"
        try:
            extract_table_snapshot(
                database_url=database_url,
                output_path=objects.path(object_key),
                table_name=table_name,
                limit=payload.sample_limit,
            )
            parsed = parse_uploaded_table(asset_id, f"{table_name}.csv", objects.path(object_key))
            asset = Asset(
                id=asset_id,
                project_id=datasource.project_id,
                type=AssetType.database,
                name=f"{datasource.name} / {table_name}",
                source="database",
                object_key=object_key,
                parse_status="ready",
                datasource_id=datasource.id,
                source_table=table_name,
                data_dictionary=parsed["dictionary"],
                graph=parsed["graph"],
            )
            repo.upsert("assets", asset.model_dump())
            created_assets.append(asset)
        except Exception as exc:
            failures.append({"table": table_name, "error": str(exc)})

    repo.audit(
        "datasource.assets.create",
        "datasource",
        datasource.id,
        {
            "table_names": table_names,
            "created_asset_ids": [asset.id for asset in created_assets],
            "reused_asset_ids": [asset.id for asset in reused_assets],
            "failures": failures,
        },
    )
    return {"assets": created_assets + reused_assets, "created": len(created_assets), "reused": len(reused_assets), "failures": failures}


@app.delete("/api/datasources/{datasource_id}")
def delete_datasource(datasource_id: str) -> Dict[str, Any]:
    datasource = _require_datasource(datasource_id)
    repo.delete_soft("datasources", datasource.id)
    repo.delete_soft("datasource_credentials", datasource.id)
    repo.audit("datasource.delete", "datasource", datasource.id, {"assets_preserved": True})
    return {"status": "deleted"}


@app.get("/api/assets")
def list_assets(project_id: str = PROJECT_ID) -> List[Asset]:
    return [asset for asset in _assets() if asset.project_id == project_id and not asset.deleted_at]


@app.get("/api/asset-library")
def asset_library(project_id: str = PROJECT_ID) -> Dict[str, Any]:
    data_assets = [asset for asset in _assets() if asset.project_id == project_id and not asset.deleted_at]
    strategy_assets = [
        _strategy_asset_summary(strategy)
        for strategy in _strategies()
        if not strategy.deleted_at and _task_or_none(strategy.task_id) and _task_or_none(strategy.task_id).project_id == project_id
    ]
    strategy_assets.extend(_strategy_template_summary(template) for template in _strategy_templates() if template.project_id == project_id and not template.deleted_at)
    strategy_assets.sort(key=lambda item: item["created_at"], reverse=True)
    return {"data_assets": data_assets, "strategy_assets": strategy_assets}


@app.post("/api/assets/knowledge-graph")
def combined_knowledge_graph(payload: CombinedKnowledgeGraphRequest) -> Dict[str, Any]:
    asset_ids = list(dict.fromkeys(payload.asset_ids))
    if len(asset_ids) < 2:
        raise HTTPException(status_code=400, detail="至少选择两个数据资产生成整体知识图")
    assets = [_require_asset(asset_id) for asset_id in asset_ids]
    project_ids = {asset.project_id for asset in assets}
    if len(project_ids) != 1:
        raise HTTPException(status_code=400, detail="只能合并同一项目下的数据资产")

    root_id = "collection:" + ":".join(sorted(asset_ids))
    nodes: List[Dict[str, Any]] = [{
        "id": root_id,
        "type": "Collection",
        "label": payload.title,
        "asset_count": len(assets),
    }]
    edges: List[Dict[str, Any]] = []
    field_occurrences: Dict[str, List[Dict[str, str]]] = {}

    for asset in assets:
        nodes.extend(asset.graph.nodes)
        edges.extend(asset.graph.edges)
        dataset_id = f"dataset:{asset.id}"
        table_name = asset.data_dictionary.table_name if asset.data_dictionary else asset.name
        table_id = f"table:{asset.id}:{table_name}"
        edges.append({"source": root_id, "target": dataset_id, "type": "INCLUDES"})
        if not asset.data_dictionary:
            continue
        for column in asset.data_dictionary.columns:
            field_occurrences.setdefault(column.name.lower(), []).append({
                "asset_id": asset.id,
                "asset_name": asset.name,
                "table_id": table_id,
                "column_id": f"column:{asset.id}:{column.name}",
                "field": column.name,
            })

    join_dimensions = {
        "month", "date", "order_date", "region", "channel",
        "customer_id", "product_id", "order_id", "store_id",
        "campaign_id", "promotion_id", "warehouse_id",
    }
    inferred_joins: List[Dict[str, str]] = []
    seen_table_edges = set()
    for field_name, occurrences in field_occurrences.items():
        if len(occurrences) < 2 or not (field_name.endswith("_id") or field_name in join_dimensions):
            continue
        for left_index, left in enumerate(occurrences):
            for right in occurrences[left_index + 1:]:
                if left["asset_id"] == right["asset_id"]:
                    continue
                edges.append({
                    "source": left["column_id"],
                    "target": right["column_id"],
                    "type": "SAME_AS",
                    "field": field_name,
                })
                table_key = tuple(sorted([left["table_id"], right["table_id"]])) + (field_name,)
                if table_key not in seen_table_edges:
                    edges.append({
                        "source": left["table_id"],
                        "target": right["table_id"],
                        "type": f"JOINED_BY:{field_name}",
                    })
                    seen_table_edges.add(table_key)
                inferred_joins.append({
                    "field": field_name,
                    "source_asset_id": left["asset_id"],
                    "source_asset": left["asset_name"],
                    "target_asset_id": right["asset_id"],
                    "target_asset": right["asset_name"],
                })

    unique_nodes = {str(node.get("id")): node for node in nodes if node.get("id")}
    recommended_questions = _combined_graph_questions(assets, inferred_joins)
    repo.audit(
        "assets.combined_graph",
        "asset_collection",
        root_id,
        {"asset_ids": asset_ids, "joins": len(inferred_joins)},
    )
    return {
        "title": payload.title,
        "asset_ids": asset_ids,
        "assets": [
            {
                "id": asset.id,
                "name": asset.name,
                "table": asset.data_dictionary.table_name if asset.data_dictionary else asset.name,
                "row_count": asset.data_dictionary.row_count if asset.data_dictionary else 0,
                "column_count": len(asset.data_dictionary.columns) if asset.data_dictionary else 0,
                "metric_count": len(asset.data_dictionary.metrics) if asset.data_dictionary else 0,
                "type": asset.type.value,
                "source": asset.source,
                "created_at": asset.created_at,
            }
            for asset in assets
        ],
        "graph": {"nodes": list(unique_nodes.values()), "edges": edges},
        "inferred_joins": inferred_joins,
        "recommended_questions": recommended_questions,
        "field_profiles": [
            {
                "asset_id": asset.id,
                "asset_name": asset.name,
                "table": asset.data_dictionary.table_name,
                **column.model_dump(),
            }
            for asset in assets
            if asset.data_dictionary
            for column in asset.data_dictionary.columns
        ],
    }


def _combined_graph_questions(assets: List[Asset], inferred_joins: List[Dict[str, str]]) -> List[str]:
    table_names = [
        asset.data_dictionary.table_name
        for asset in assets
        if asset.data_dictionary
    ]
    columns = [
        column
        for asset in assets
        if asset.data_dictionary
        for column in asset.data_dictionary.columns
    ]
    numeric_names = [
        column.name
        for column in columns
        if column.logical_type == "number" and not column.name.lower().endswith("_id")
    ]
    date_names = [
        column.name
        for column in columns
        if column.logical_type == "date"
        or any(token in column.name.lower() for token in ["date", "time", "month", "year", "日期", "月份"])
    ]
    category_names = [
        column.name
        for column in columns
        if column.logical_type == "category" and not column.name.lower().endswith("_id")
    ]
    metric = next(
        (name for name in numeric_names if any(token in name.lower() for token in ["revenue", "sales", "amount", "quantity", "profit", "销量", "销售额", "利润"])),
        numeric_names[0] if numeric_names else "核心业务指标",
    )
    date_dimension = date_names[0] if date_names else "时间"
    dimensions = list(dict.fromkeys(category_names))[:3]
    dimension_text = "、".join(dimensions) if dimensions else "业务分类维度"
    tables_text = "、".join(table_names[:5])
    if len(table_names) > 5:
        tables_text += f"等 {len(table_names)} 张表"
    join_fields = list(dict.fromkeys(join["field"] for join in inferred_joins))[:4]
    join_text = "、".join(join_fields) if join_fields else "潜在关联字段"

    questions = [
        f"请联合分析 {tables_text}，统一指标口径后概览 {metric} 的整体表现，并指出最值得继续下钻的异常。",
        f"请以 {date_dimension} 为时间轴分析 {metric} 的变化趋势，识别拐点、异常区间及其对应业务事件。",
        f"请按 {dimension_text} 逐层下钻，对比各分组对 {metric} 的贡献、增减变化和结构差异。",
        f"请基于 {join_text} 串联所选数据集，分析影响 {metric} 的直接因素并给出证据排序。",
        f"请检查所选数据集之间的完整性、一致性和关联覆盖率，说明哪些数据质量问题可能影响分析结论。",
    ]
    return list(dict.fromkeys(questions))


@app.get("/api/assets/{asset_id}")
def get_asset(asset_id: str) -> Asset:
    return _require_asset(asset_id)


@app.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: str) -> Dict[str, Any]:
    _require_asset(asset_id)
    repo.delete_soft("assets", asset_id)
    repo.audit("asset.delete", "asset", asset_id, {})
    return {"status": "deleted"}


@app.get("/api/assets/{asset_id}/detail")
def asset_detail(asset_id: str) -> Dict[str, Any]:
    asset = _require_asset(asset_id)
    parsed = parse_uploaded_table(asset.id, asset.name, objects.path(asset.object_key))
    rows = parsed["rows"]
    dictionary = asset.data_dictionary
    columns = dictionary.columns if dictionary else []
    numeric_columns = [column for column in columns if column.logical_type == "number"]
    category_columns = [column for column in columns if column.logical_type == "category"]
    insights = [
        f"资产包含 {dictionary.row_count if dictionary else len(rows)} 行、{len(columns)} 个字段。",
        f"识别出 {len(numeric_columns)} 个数值指标字段、{len(category_columns)} 个分类维度字段。",
    ]
    sensitive_columns = [column.name for column in columns if column.sensitive]
    if sensitive_columns:
        insights.append("检测到可能敏感字段：" + "、".join(sensitive_columns))
    if numeric_columns:
        top_metric = numeric_columns[0]
        values = [_to_float(row.get(top_metric.name)) for row in rows]
        values = [value for value in values if value is not None]
        if values:
            insights.append(f"{top_metric.name} 合计 {round(sum(values), 2)}，均值 {round(sum(values) / len(values), 2)}。")
    return {
        "asset": asset,
        "metadata": {
            "name": asset.name,
            "type": asset.type,
            "source": asset.source,
            "object_key": asset.object_key,
            "version": asset.version,
            "parse_status": asset.parse_status,
            "created_at": asset.created_at,
            "row_count": dictionary.row_count if dictionary else len(rows),
            "column_count": len(columns),
        },
        "field_profiles": columns,
        "graph": asset.graph,
        "insights": insights,
        "relationships": asset.graph.edges,
        "preview_rows": rows[:30],
    }


@app.get("/api/assets/{asset_id}/preview")
def preview_asset(asset_id: str, limit: int = 25) -> Dict[str, Any]:
    asset = _require_asset(asset_id)
    parsed = parse_uploaded_table(asset.id, asset.name, objects.path(asset.object_key))
    return {"rows": parsed["rows"][:limit], "dictionary": asset.data_dictionary}


@app.post("/api/rag/context")
def rag_context(payload: RagContextRequest) -> Dict[str, Any]:
    assets = [_require_asset(asset_id) for asset_id in payload.asset_ids]
    chunks = LocalRagClient().retrieve(payload.query, assets, limit=max(1, min(payload.limit, 20)))
    return {"items": chunks}


@app.get("/api/strategy-assets")
def list_strategy_assets(project_id: str = PROJECT_ID) -> List[Dict[str, Any]]:
    strategy_assets = [
        _strategy_asset_summary(strategy)
        for strategy in _strategies()
        if not strategy.deleted_at and _task_or_none(strategy.task_id) and _task_or_none(strategy.task_id).project_id == project_id
    ]
    strategy_assets.extend(_strategy_template_summary(template) for template in _strategy_templates() if template.project_id == project_id and not template.deleted_at)
    return sorted(strategy_assets, key=lambda item: item["created_at"], reverse=True)


@app.delete("/api/strategy-assets/{strategy_id}")
def delete_strategy_asset(strategy_id: str) -> Dict[str, Any]:
    template_raw = repo.get("strategy_templates", strategy_id)
    if template_raw and not template_raw.get("deleted_at"):
        repo.delete_soft("strategy_templates", strategy_id)
        repo.audit("strategy_asset.delete", "strategy_template", strategy_id, {})
        return {"status": "deleted"}
    strategy = _require_strategy(strategy_id)
    strategy.deleted_at = now_iso()
    repo.upsert("strategies", strategy.model_dump())
    repo.audit("strategy_asset.delete", "strategy", strategy.id, {})
    return {"status": "deleted"}


@app.post("/api/strategy-assets/from-markdown")
def create_strategy_asset_from_markdown(payload: StrategyMarkdownRequest) -> Dict[str, Any]:
    template = StrategyTemplate(
        id=new_id("stpl"),
        project_id=payload.project_id,
        title=payload.title,
        markdown=payload.markdown,
        source="markdown",
        methods=_extract_strategy_steps(payload.markdown),
        dimensions=_extract_markdown_values(payload.markdown, ["维度", "dimensions"]),
        metrics=_extract_markdown_values(payload.markdown, ["指标", "metrics"]),
    )
    repo.upsert("strategy_templates", template.model_dump())
    repo.audit("strategy_asset.create_markdown", "strategy_template", template.id, {"title": template.title})
    return _strategy_template_summary(template)


@app.patch("/api/strategy-assets/{strategy_id}")
def update_strategy_asset(strategy_id: str, payload: StrategyAssetUpdateRequest) -> Dict[str, Any]:
    template_raw = repo.get("strategy_templates", strategy_id)
    if template_raw and not template_raw.get("deleted_at"):
        template = hydrate_strategy_template(template_raw)
        template.title = payload.title
        template.markdown = payload.markdown
        template.methods = _extract_strategy_steps(payload.markdown)
        template.dimensions = _extract_markdown_values(payload.markdown, ["维度", "dimensions"])
        template.metrics = _extract_markdown_values(payload.markdown, ["指标", "metrics"])
        repo.upsert("strategy_templates", template.model_dump())
        repo.audit("strategy_asset.update", "strategy_template", template.id, {"title": template.title})
        return _strategy_template_summary(template)

    strategy = _require_strategy(strategy_id)
    strategy.objective = payload.title
    strategy.methods = _extract_strategy_steps(payload.markdown)
    dimensions = _extract_markdown_values(payload.markdown, ["维度", "dimensions"])
    metrics = _extract_markdown_values(payload.markdown, ["指标", "metrics"])
    if dimensions:
        strategy.dimensions = dimensions
    if metrics:
        strategy.metrics = metrics
    repo.upsert("strategies", strategy.model_dump())
    repo.audit("strategy_asset.update", "strategy", strategy.id, {"title": strategy.objective})
    return _strategy_asset_summary(strategy)


@app.post("/api/strategy-assets/polish")
def polish_strategy_asset(payload: StrategyPolishRequest) -> Dict[str, Any]:
    markdown = _polish_strategy_markdown(payload.title, payload.markdown)
    return {
        "title": payload.title.strip() or "润色后的分析策略",
        "markdown": markdown,
        "methods": _extract_strategy_steps(markdown),
        "dimensions": _extract_markdown_values(markdown, ["维度", "dimensions"]),
        "metrics": _extract_markdown_values(markdown, ["指标", "metrics"]),
    }


@app.post("/api/strategy-assets/merge")
def merge_strategy_assets(payload: StrategyMergeRequest) -> Dict[str, Any]:
    templates = [_strategy_asset_as_template(strategy_id) for strategy_id in payload.strategy_asset_ids]
    markdown = _merge_strategy_markdown(payload.title, templates)
    template = StrategyTemplate(
        id=new_id("stpl"),
        project_id=payload.project_id,
        title=payload.title,
        markdown=markdown,
        source="merge",
        methods=_extract_strategy_steps(markdown),
        dimensions=_extract_markdown_values(markdown, ["维度", "dimensions"]),
        metrics=_extract_markdown_values(markdown, ["指标", "metrics"]),
        created_from_task_ids=list(dict.fromkeys(task_id for item in templates for task_id in item.created_from_task_ids)),
    )
    repo.upsert("strategy_templates", template.model_dump())
    repo.audit("strategy_asset.merge", "strategy_template", template.id, {"sources": payload.strategy_asset_ids})
    return _strategy_template_summary(template)


@app.post("/api/sessions/{session_id}/strategy-assets/from-feedback")
def create_strategy_asset_from_feedback(session_id: str, payload: StrategyFromFeedbackRequest) -> Dict[str, Any]:
    session = _require_writable_session(session_id)
    task_ids = payload.task_ids or [feedback.task_id for feedback in _feedbacks(session_id=session.id) if feedback.rating == "up"]
    tasks = [_require_task(task_id) for task_id in dict.fromkeys(task_ids)]
    markdown = _compose_strategy_markdown_from_tasks(tasks)
    template = StrategyTemplate(
        id=new_id("stpl"),
        project_id=payload.project_id,
        title=payload.title,
        markdown=markdown,
        source="feedback",
        methods=_extract_strategy_steps(markdown),
        dimensions=_extract_markdown_values(markdown, ["维度", "dimensions"]),
        metrics=_extract_markdown_values(markdown, ["指标", "metrics"]),
        created_from_task_ids=[task.id for task in tasks],
    )
    repo.upsert("strategy_templates", template.model_dump())
    repo.audit("strategy_asset.create_feedback", "strategy_template", template.id, {"tasks": template.created_from_task_ids})
    return _strategy_template_summary(template)


@app.post("/api/tasks")
def create_task(payload: CreateTaskRequest) -> Task:
    session = _require_writable_session(payload.session_id)
    assets = [_require_asset(asset_id) for asset_id in payload.asset_ids]
    selected_templates = [_require_strategy_template(strategy_id) for strategy_id in payload.strategy_asset_ids if repo.get("strategy_templates", strategy_id)]
    selected_templates.extend(_strategy_to_template(_require_strategy(strategy_id)) for strategy_id in payload.strategy_asset_ids if repo.get("strategies", strategy_id))
    feedback_context = [_feedback_strategy_context(feedback) for feedback in _feedbacks(session_id=session.id) if feedback.rating == "up"]
    task = Task(
        id=new_id("task"),
        session_id=session.id,
        project_id=session.project_id,
        user_intent=payload.message,
        selected_assets=payload.asset_ids,
        status=TaskStatus.waiting_confirmation,
    )
    user_message = Message(
        id=new_id("msg"),
        session_id=session.id,
        role="user",
        content=payload.message,
        task_id=task.id,
    )
    strategy = _workflow().draft_strategy(
        new_id("strategy"),
        task.id,
        payload.message,
        assets,
        strategy_templates=selected_templates or _active_strategy_templates(session.project_id),
        feedback_context=feedback_context,
    )
    task.strategy_id = strategy.id
    repo.upsert("tasks", task.model_dump())
    repo.upsert("messages", user_message.model_dump())
    repo.upsert("strategies", strategy.model_dump())
    _touch_session(session)
    repo.audit("task.create", "task", task.id, {"assets": payload.asset_ids})
    return task


@app.post("/api/tasks/{task_id}/feedback")
def rate_task(task_id: str, payload: TaskFeedbackRequest) -> TaskFeedback:
    task = _require_task(task_id)
    if payload.rating not in {"up", "down"}:
        raise HTTPException(status_code=400, detail="rating must be up or down")
    existing = next((item for item in _feedbacks(task_id=task.id) if item.session_id == task.session_id), None)
    snapshot = _task_timeline(task)
    feedback = existing or TaskFeedback(id=new_id("fb"), session_id=task.session_id, task_id=task.id, rating=payload.rating)
    feedback.rating = payload.rating
    feedback.note = payload.note
    feedback.snapshot = snapshot
    feedback.updated_at = now_iso()
    repo.upsert("task_feedbacks", feedback.model_dump())
    repo.audit("task.feedback", "task", task.id, {"rating": feedback.rating})
    return feedback


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str) -> Dict[str, Any]:
    task = _require_task(task_id)
    return _task_timeline(task)


@app.get("/api/tasks/{task_id}/events")
def task_events(task_id: str) -> StreamingResponse:
    _require_task(task_id)

    def stream():
        for event in [
            {"event": "retrieval", "message": "数据字典已加载"},
            {"event": "strategy_draft", "message": "策略已生成，等待用户确认"},
        ]:
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/api/tasks/{task_id}/strategy/confirm")
def confirm_strategy(task_id: str, payload: ConfirmStrategyRequest) -> Dict[str, Any]:
    task = _require_task(task_id)
    _require_writable_session(task.session_id)
    strategy = _require_strategy(payload.strategy_id)
    if strategy.task_id != task.id:
        raise HTTPException(status_code=400, detail="strategy_id 不属于当前 task")
    strategy.version += 1
    strategy.dimensions = list(payload.confirmed_strategy.get("dimensions", strategy.dimensions))
    strategy.metrics = list(payload.confirmed_strategy.get("metrics", strategy.metrics))
    strategy.methods = list(payload.confirmed_strategy.get("methods", strategy.methods))
    strategy.chart_suggestions = list(payload.confirmed_strategy.get("chart_suggestions", strategy.chart_suggestions))
    strategy.confirmed_by = payload.confirmed_by
    strategy.confirmed_at = now_iso()
    assets = [_require_asset(asset_id) for asset_id in task.selected_assets]
    result = _workflow().run_confirmed_strategy(
        execution_id=new_id("exec"),
        strategy=strategy,
        assets=assets,
        asset_paths={asset.id: objects.path(asset.object_key) for asset in assets},
    )
    execution = result["execution"]
    task.status = TaskStatus.success if execution.status == "success" else TaskStatus.failed
    task.generated_code = result["code"]
    task.execution_id = execution.execution_id
    task.analysis_summary = result["analysis"]["summary"]
    task.chart_ids = [chart.id for chart in execution.charts]
    task.updated_at = now_iso()
    if execution.status != "success":
        task.errors.append(execution.stderr)
    assistant_message = Message(
        id=new_id("msg"),
        session_id=task.session_id,
        role="assistant",
        content=task.analysis_summary or "",
        task_id=task.id,
    )
    repo.upsert("strategies", strategy.model_dump())
    repo.upsert("executions", execution.model_dump())
    repo.upsert("tasks", task.model_dump())
    repo.upsert("messages", assistant_message.model_dump())
    _persist_chart_snapshots(task.project_id, execution)
    repo.audit("strategy.confirm", "strategy", strategy.id, {"task_id": task.id, "status": execution.status})
    return _task_timeline(task)


@app.post("/api/executions")
def rerun_execution(payload: ExecutionRequest) -> ExecutionResult:
    task = _require_task(payload.task_id)
    _require_writable_session(task.session_id)
    execution = _workflow().rerun_code(
        execution_id=new_id("exec"),
        task_id=task.id,
        code=payload.code,
        asset_paths={asset_id: objects.path(_require_asset(asset_id).object_key) for asset_id in payload.asset_ids},
    )
    task.execution_id = execution.execution_id
    task.generated_code = payload.code
    task.status = TaskStatus.success if execution.status == "success" else TaskStatus.failed
    task.updated_at = now_iso()
    repo.upsert("executions", execution.model_dump())
    repo.upsert("tasks", task.model_dump())
    _persist_chart_snapshots(task.project_id, execution)
    repo.audit("execution.rerun", "execution", execution.execution_id, {"task_id": task.id, "status": execution.status})
    return execution


@app.post("/api/cart-items")
def add_cart_item(payload: CartItemRequest) -> CartItem:
    existing = [item for item in _cart_items(payload.session_id)]
    item = CartItem(
        id=new_id("cart"),
        session_id=payload.session_id,
        type=payload.type,
        ref_id=payload.ref_id,
        title=payload.title,
        sort_order=len(existing) + 1,
        snapshot=payload.snapshot,
    )
    repo.upsert("cart_items", item.model_dump())
    repo.audit("cart.add", "cart_item", item.id, {"type": item.type, "ref_id": item.ref_id})
    return item


@app.get("/api/cart-items")
def list_cart_items(session_id: str) -> List[CartItem]:
    return _cart_items(session_id)


@app.post("/api/reports")
def create_report(payload: ReportRequest) -> Report:
    session = _require_session(payload.session_id)
    cart_items = [_require_cart_item(item_id) for item_id in payload.cart_item_ids]
    title = payload.title or f"{session.title} 分析报告"
    markdown = _workflow().report_agent.compose_markdown(title, [item.model_dump() for item in cart_items])
    report = Report(id=new_id("report"), project_id=session.project_id, session_id=session.id, title=title)
    content_key = f"reports/{session.project_id}/{report.id}/1.md"
    html_key = f"reports/{session.project_id}/{report.id}/1.html"
    objects.put_text(content_key, markdown)
    objects.put_text(html_key, _markdown_to_html(markdown))
    version = ReportVersion(
        id=new_id("rver"),
        report_id=report.id,
        version=1,
        content_key=content_key,
        cart_snapshot=[item.model_dump() for item in cart_items],
        export_keys={"markdown": content_key, "html": html_key},
    )
    report.versions.append(version)
    repo.upsert("reports", report.model_dump())
    repo.audit("report.create", "report", report.id, {"cart_items": payload.cart_item_ids})
    return report


@app.post("/api/reports/from-module")
def create_report_from_module(payload: CreateReportFromModuleRequest) -> Report:
    session = _require_session(payload.session_id)
    report = Report(
        id=new_id("report"),
        project_id=session.project_id,
        session_id=session.id,
        title=payload.report_title or f"{payload.title} 报告",
    )
    item = _module_to_cart_snapshot(payload, sort_order=1)
    version = _write_report_version(report, [item])
    report.versions.append(version)
    repo.upsert("reports", report.model_dump())
    repo.audit("report.create_from_module", "report", report.id, {"ref_id": payload.ref_id, "type": payload.type})
    return report


@app.post("/api/reports/{report_id}/items")
def append_report_item(report_id: str, payload: ReportModuleRequest) -> Report:
    report = _require_report(report_id)
    latest = report.versions[-1] if report.versions else None
    snapshot = list(latest.cart_snapshot if latest else [])
    snapshot.append(_module_to_cart_snapshot(payload, sort_order=len(snapshot) + 1))
    version = _write_report_version(report, snapshot)
    report.versions.append(version)
    repo.upsert("reports", report.model_dump())
    repo.audit("report.append_item", "report", report.id, {"ref_id": payload.ref_id, "type": payload.type})
    return report


@app.get("/api/reports")
def list_reports(project_id: str = PROJECT_ID, keyword: str = "", page: int = 1, page_size: int = 20) -> Dict[str, Any]:
    reports = [item for item in _reports() if item.project_id == project_id and not item.deleted_at]
    if keyword:
        reports = [item for item in reports if keyword.lower() in item.title.lower()]
    reports.sort(key=lambda item: item.created_at, reverse=True)
    start = (page - 1) * page_size
    return {"items": reports[start : start + page_size], "total": len(reports)}


@app.get("/api/reports/{report_id}")
def get_report(report_id: str) -> Dict[str, Any]:
    report = _require_report(report_id)
    session = _require_session(report.session_id)
    latest = report.versions[-1] if report.versions else None
    items = [_enrich_report_module(item) for item in (latest.cart_snapshot if latest else [])]
    return {
        "report": report,
        "session": session,
        "version": latest,
        "items": items,
    }


@app.post("/api/reports/{report_id}/strategy")
def generate_report_strategy(report_id: str, payload: ReportStrategyRequest) -> Dict[str, Any]:
    report = _require_report(report_id)
    latest = report.versions[-1] if report.versions else None
    if not latest or not latest.cart_snapshot:
        raise HTTPException(status_code=400, detail="报告中没有可用于生成策略的模块")

    context = _report_strategy_context(latest.cart_snapshot)
    router = ModelRouter(repo.model_config())
    generated, generation = router.generate_json(
        "planner",
        (
            "你是商业数据分析策略规划专家。请根据报告中的问题、已有策略、执行结果和结论，"
            "生成一份可执行、可追溯的综合分析策略。方法必须使用清晰的中文动作描述，"
            "禁止输出代码、函数名、下划线标识符。只返回 JSON。"
        ),
        (
            "返回结构："
            '{"title":"策略名称","objective":"综合目标","methods":["步骤1"],'
            '"dimensions":["维度"],"metrics":["指标"]}。'
            f"\n报告标题：{report.title}\n报告内容：{json.dumps(context, ensure_ascii=False)[:24000]}"
        ),
    )
    strategy_data = _normalize_report_strategy(generated, report, context)
    title = payload.title or strategy_data["title"]
    markdown = _report_strategy_markdown(
        title,
        strategy_data["objective"],
        strategy_data["methods"],
        strategy_data["dimensions"],
        strategy_data["metrics"],
    )
    task_ids = list(dict.fromkeys(
        task.id
        for module in latest.cart_snapshot
        for task in [_task_from_report_module(module)]
        if task
    ))
    template = StrategyTemplate(
        id=new_id("stpl"),
        project_id=report.project_id,
        title=title,
        markdown=markdown,
        source="report_llm" if generation["status"] == "success" else "report_fallback",
        methods=strategy_data["methods"],
        dimensions=strategy_data["dimensions"],
        metrics=strategy_data["metrics"],
        created_from_task_ids=task_ids,
    )
    repo.upsert("strategy_templates", template.model_dump())
    repo.audit(
        "report.generate_strategy",
        "report",
        report.id,
        {"strategy_id": template.id, **generation},
    )
    return {
        "strategy": _strategy_template_summary(template),
        "generation": generation,
    }


@app.delete("/api/reports/{report_id}/items/{module_id}")
def delete_report_module(report_id: str, module_id: str) -> Dict[str, Any]:
    report = _require_report(report_id)
    latest = report.versions[-1] if report.versions else None
    if not latest:
        raise HTTPException(status_code=404, detail="report version not found")
    if not any(item.get("id") == module_id for item in latest.cart_snapshot):
        raise HTTPException(status_code=404, detail="report module not found")

    snapshot = [
        {**item, "sort_order": index}
        for index, item in enumerate(
            (item for item in latest.cart_snapshot if item.get("id") != module_id),
            start=1,
        )
    ]
    version = _write_report_version(report, snapshot)
    report.versions.append(version)
    repo.upsert("reports", report.model_dump())
    repo.audit("report.delete_module", "report", report.id, {"module_id": module_id})
    return get_report(report_id)


@app.post("/api/reports/{report_id}/items/{module_id}/run")
def run_report_module(report_id: str, module_id: str, payload: ReportRunRequest) -> Dict[str, Any]:
    report = _require_report(report_id)
    latest = report.versions[-1] if report.versions else None
    if not latest:
        raise HTTPException(status_code=404, detail="report version not found")
    snapshot = list(latest.cart_snapshot)
    module = next((item for item in snapshot if item.get("id") == module_id), None)
    if not module:
        raise HTTPException(status_code=404, detail="report module not found")
    task = _task_from_report_module(module)
    if not task:
        raise HTTPException(status_code=400, detail="该模块未关联可运行的分析任务")
    if not task.generated_code:
        raise HTTPException(status_code=400, detail="该模块没有可重放代码")
    execution = _workflow().rerun_code(
        execution_id=new_id("exec"),
        task_id=task.id,
        code=task.generated_code,
        asset_paths={asset_id: objects.path(_require_asset(asset_id).object_key) for asset_id in task.selected_assets},
    )
    task.execution_id = execution.execution_id
    task.status = TaskStatus.success if execution.status == "success" else TaskStatus.failed
    task.analysis_summary = (
        f"报告模块重新运行完成，返回 {len(execution.table)} 行结果。"
        if execution.status == "success"
        else "报告模块重新运行失败，请查看执行错误。"
    )
    task.updated_at = now_iso()
    repo.upsert("executions", execution.model_dump())
    repo.upsert("tasks", task.model_dump())
    _persist_chart_snapshots(task.project_id, execution)

    module_snapshot = dict(module.get("snapshot", {}))
    module_snapshot.update(
        {
            "task_id": task.id,
            "summary": task.analysis_summary,
            "charts": [chart.model_dump() for chart in execution.charts],
            "process_steps": execution.process_steps,
            "quality_table": execution.quality_table,
            "table": execution.table,
            "execution": execution.model_dump(),
            "task": task.model_dump(),
            "ran_at": now_iso(),
            "run_params": payload.params,
        }
    )
    module["snapshot"] = module_snapshot
    version = _write_report_version(report, snapshot)
    report.versions.append(version)
    repo.upsert("reports", report.model_dump())
    repo.audit("report.run_module", "report", report.id, {"module_id": module_id, "task_id": task.id})
    return get_report(report_id)


@app.get("/api/reports/{report_id}/versions")
def report_versions(report_id: str) -> List[ReportVersion]:
    return _require_report(report_id).versions


@app.get("/api/reports/{report_id}/versions/{version}/download")
def download_report(report_id: str, version: int, format: str = Query("markdown")) -> FileResponse:
    report = _require_report(report_id)
    match = next((item for item in report.versions if item.version == version), None)
    if not match:
        raise HTTPException(status_code=404, detail="version not found")
    key = match.export_keys.get(format)
    if not key:
        raise HTTPException(status_code=404, detail="format not found")
    return FileResponse(objects.path(key), filename=objects.path(key).name)


@app.delete("/api/reports/{report_id}")
def delete_report(report_id: str) -> Dict[str, Any]:
    _require_report(report_id)
    repo.delete_soft("reports", report_id)
    repo.audit("report.delete", "report", report_id, {})
    return {"status": "deleted"}


@app.get("/api/model-config")
def get_model_config() -> ModelConfig:
    return repo.model_config()


@app.put("/api/model-config")
def put_model_config(payload: ModelConfig) -> ModelConfig:
    config = repo.set_model_config(payload)
    repo.audit("model_config.update", "model_config", "global", payload.model_dump())
    return config


@app.post("/api/dashboards")
def create_dashboard(payload: DashboardRequest) -> Dashboard:
    dashboard = Dashboard(
        id=new_id("dash"),
        project_id=payload.project_id,
        name=payload.name,
        page_params=payload.page_params,
        refresh_interval=payload.refresh_interval,
        share_token=new_id("share"),
    )
    repo.upsert("dashboards", dashboard.model_dump())
    repo.audit("dashboard.create", "dashboard", dashboard.id, {"name": dashboard.name})
    return dashboard


@app.get("/api/dashboards")
def list_dashboards(project_id: str = PROJECT_ID) -> List[Dashboard]:
    return [dashboard for dashboard in _dashboards() if dashboard.project_id == project_id]


@app.post("/api/dashboards/{dashboard_id}/items")
def pin_dashboard_item(dashboard_id: str, payload: DashboardItemRequest) -> Dashboard:
    dashboard = _require_dashboard(dashboard_id)
    chart, execution = _find_chart(payload.chart_id, payload.source_execution_id)
    binding = QueryBinding(
        id=new_id("qb"),
        project_id=dashboard.project_id,
        source_execution_id=execution.execution_id,
        language=execution.language,
        code_template="# Immutable binding generated from execution\n" + (_task_or_none(execution.task_id).generated_code or ""),
        params_schema=[{"name": key, "type": "string", "default": value} for key, value in payload.param_mapping.items()],
    )
    item = DashboardItem(
        id=new_id("ditem"),
        dashboard_id=dashboard.id,
        chart_config=chart,
        query_binding_id=binding.id,
        param_mapping=payload.param_mapping,
        sort_order=len(dashboard.items) + 1,
    )
    dashboard.items.append(item)
    repo.upsert("query_bindings", binding.model_dump())
    repo.upsert("dashboards", dashboard.model_dump())
    repo.audit("dashboard.pin_chart", "dashboard", dashboard.id, {"chart_id": payload.chart_id, "binding_id": binding.id})
    return dashboard


@app.post("/api/query-bindings/{binding_id}/execute")
def execute_binding(binding_id: str, payload: BindingExecuteRequest) -> Dict[str, Any]:
    binding = _require_binding(binding_id)
    source_task = next((task for task in _tasks() if task.execution_id == binding.source_execution_id), None)
    if not source_task:
        raise HTTPException(status_code=404, detail="source task not found")
    execution = _require_execution(binding.source_execution_id)
    cache_key = f"charts/{binding.project_id}/cache/{binding.id}-{abs(hash(json.dumps(payload.params, sort_keys=True)))}.json"
    if objects.path(cache_key).exists():
        return {"cached": True, "artifact_key": cache_key, "result": objects.get_json(cache_key)}
    result = {
        "binding_id": binding.id,
        "params": payload.params,
        "charts": [chart.model_dump() for chart in execution.charts],
        "refreshed_at": now_iso(),
    }
    objects.put_json(cache_key, result)
    repo.audit("query_binding.execute", "query_binding", binding.id, {"dashboard_id": payload.dashboard_id, "params": payload.params})
    return {"cached": False, "artifact_key": cache_key, "result": result}


@app.get("/api/audit-logs")
def list_audit_logs(project_id: str = PROJECT_ID, limit: int = 100) -> List[Dict[str, Any]]:
    logs = [item for item in repo.all("audit_logs") if item.get("project_id") == project_id]
    return sorted(logs, key=lambda item: item["created_at"], reverse=True)[:limit]


def _workflow() -> AgentWorkflow:
    return AgentWorkflow(router=ModelRouter(repo.model_config()), rag=LocalRagClient(), sandbox=LocalSandboxExecutor())


def _sessions() -> List[Session]:
    return [hydrate_session(item) for item in repo.all("sessions")]


def _messages(session_id: Optional[str] = None) -> List[Message]:
    messages = [Message(**item) for item in repo.all("messages")]
    return [item for item in messages if item.session_id == session_id] if session_id else messages


def _assets() -> List[Asset]:
    return [hydrate_asset(item) for item in repo.all("assets")]


def _datasources() -> List[Datasource]:
    return [hydrate_datasource(item) for item in repo.all("datasources")]


def _strategies() -> List[Strategy]:
    return [hydrate_strategy(item) for item in repo.all("strategies")]


def _strategy_templates() -> List[StrategyTemplate]:
    return [hydrate_strategy_template(item) for item in repo.all("strategy_templates")]


def _active_strategy_templates(project_id: str) -> List[StrategyTemplate]:
    return [template for template in _strategy_templates() if template.project_id == project_id and not template.deleted_at]


def _feedbacks(session_id: Optional[str] = None, task_id: Optional[str] = None) -> List[TaskFeedback]:
    feedbacks = [hydrate_task_feedback(item) for item in repo.all("task_feedbacks")]
    if session_id:
        feedbacks = [item for item in feedbacks if item.session_id == session_id]
    if task_id:
        feedbacks = [item for item in feedbacks if item.task_id == task_id]
    return feedbacks


def _tasks() -> List[Task]:
    return [hydrate_task(item) for item in repo.all("tasks")]


def _reports() -> List[Report]:
    return [hydrate_report(item) for item in repo.all("reports")]


def _dashboards() -> List[Dashboard]:
    return [hydrate_dashboard(item) for item in repo.all("dashboards")]


def _cart_items(session_id: str) -> List[CartItem]:
    return sorted(
        [hydrate_cart_item(item) for item in repo.all("cart_items") if item["session_id"] == session_id],
        key=lambda item: item.sort_order,
    )


def _require_session(session_id: str) -> Session:
    raw = repo.get("sessions", session_id)
    if not raw or raw.get("deleted_at"):
        raise HTTPException(status_code=404, detail="session not found")
    return hydrate_session(raw)


def _require_writable_session(session_id: str) -> Session:
    session = _require_session(session_id)
    if session.archived_at:
        raise HTTPException(status_code=409, detail="会话已关闭，只能查看历史内容")
    return session


def _require_asset(asset_id: str) -> Asset:
    raw = repo.get("assets", asset_id)
    if not raw or raw.get("deleted_at"):
        raise HTTPException(status_code=404, detail="asset not found")
    return hydrate_asset(raw)


def _require_datasource(datasource_id: str) -> Datasource:
    raw = repo.get("datasources", datasource_id)
    if not raw or raw.get("deleted_at"):
        raise HTTPException(status_code=404, detail="datasource not found")
    return hydrate_datasource(raw)


def _task_or_none(task_id: str) -> Optional[Task]:
    raw = repo.get("tasks", task_id)
    return hydrate_task(raw) if raw else None


def _require_task(task_id: str) -> Task:
    task = _task_or_none(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


def _require_strategy(strategy_id: str) -> Strategy:
    raw = repo.get("strategies", strategy_id)
    if not raw or raw.get("deleted_at"):
        raise HTTPException(status_code=404, detail="strategy not found")
    return hydrate_strategy(raw)


def _require_strategy_template(strategy_id: str) -> StrategyTemplate:
    raw = repo.get("strategy_templates", strategy_id)
    if not raw or raw.get("deleted_at"):
        raise HTTPException(status_code=404, detail="strategy template not found")
    return hydrate_strategy_template(raw)


def _require_execution(execution_id: str):
    raw = repo.get("executions", execution_id)
    if not raw:
        raise HTTPException(status_code=404, detail="execution not found")
    return hydrate_execution(raw)


def _require_cart_item(item_id: str) -> CartItem:
    raw = repo.get("cart_items", item_id)
    if not raw:
        raise HTTPException(status_code=404, detail="cart item not found")
    return hydrate_cart_item(raw)


def _require_report(report_id: str) -> Report:
    raw = repo.get("reports", report_id)
    if not raw or raw.get("deleted_at"):
        raise HTTPException(status_code=404, detail="report not found")
    return hydrate_report(raw)


def _require_dashboard(dashboard_id: str) -> Dashboard:
    raw = repo.get("dashboards", dashboard_id)
    if not raw:
        raise HTTPException(status_code=404, detail="dashboard not found")
    return hydrate_dashboard(raw)


def _require_binding(binding_id: str) -> QueryBinding:
    raw = repo.get("query_bindings", binding_id)
    if not raw:
        raise HTTPException(status_code=404, detail="query binding not found")
    return hydrate_binding(raw)


def _touch_session(session: Session) -> None:
    session.last_active_at = now_iso()
    repo.upsert("sessions", session.model_dump())


def _session_message_hit(session_id: str, lowered: str) -> bool:
    return any(lowered in message.content.lower() for message in _messages(session_id))


def _task_timeline(task: Task) -> Dict[str, Any]:
    strategy_raw = repo.get("strategies", task.strategy_id) if task.strategy_id else None
    strategy = hydrate_strategy(strategy_raw) if strategy_raw and not strategy_raw.get("deleted_at") else None
    execution = hydrate_execution(repo.get("executions", task.execution_id)) if task.execution_id else None
    return {
        "type": "task",
        "task": task,
        "strategy": strategy,
        "execution": execution,
        "charts": execution.charts if execution else [],
        "feedback": _latest_feedback(task.id).model_dump() if _latest_feedback(task.id) else None,
    }


def _persist_chart_snapshots(project_id: str, execution) -> None:
    for chart in execution.charts:
        key = f"charts/{project_id}/{execution.execution_id}/{chart.id}.json"
        chart.dataset_ref = key
        objects.put_json(key, chart.model_dump())
    repo.upsert("executions", execution.model_dump())


def _find_chart(chart_id: str, execution_id: str) -> tuple[ChartConfig, Any]:
    execution = _require_execution(execution_id)
    for chart in execution.charts:
        if chart.id == chart_id:
            return chart, execution
    raise HTTPException(status_code=404, detail="chart not found")


def _strategy_asset_summary(strategy: Strategy) -> Dict[str, Any]:
    task = _task_or_none(strategy.task_id)
    return {
        "id": strategy.id,
        "kind": "confirmed_strategy",
        "task_id": strategy.task_id,
        "session_id": task.session_id if task else None,
        "title": strategy.objective[:48] or "分析策略",
        "objective": strategy.objective,
        "dimensions": strategy.dimensions,
        "metrics": strategy.metrics,
        "methods": strategy.methods,
        "confirmed_at": strategy.confirmed_at,
        "created_at": strategy.created_at,
    }


def _strategy_template_summary(template: StrategyTemplate) -> Dict[str, Any]:
    return {
        "id": template.id,
        "kind": "template",
        "task_id": "",
        "session_id": None,
        "title": template.title,
        "objective": template.markdown.splitlines()[0].lstrip("# ").strip() if template.markdown.strip() else template.title,
        "dimensions": template.dimensions,
        "metrics": template.metrics,
        "methods": template.methods,
        "confirmed_at": None,
        "created_at": template.created_at,
        "source": template.source,
        "markdown": template.markdown,
        "created_from_task_ids": template.created_from_task_ids,
    }


def _latest_feedback(task_id: str) -> Optional[TaskFeedback]:
    matches = sorted(_feedbacks(task_id=task_id), key=lambda item: item.updated_at, reverse=True)
    return matches[0] if matches else None


def _strategy_to_template(strategy: Strategy) -> StrategyTemplate:
    return StrategyTemplate(
        id=strategy.id,
        project_id=_task_or_none(strategy.task_id).project_id if _task_or_none(strategy.task_id) else PROJECT_ID,
        title=strategy.objective[:48] or "已确认策略",
        source="confirmed_strategy",
        markdown=_strategy_to_markdown(strategy),
        methods=strategy.methods,
        dimensions=strategy.dimensions,
        metrics=strategy.metrics,
        created_from_task_ids=[strategy.task_id],
        created_at=strategy.created_at,
    )


def _strategy_asset_as_template(strategy_id: str) -> StrategyTemplate:
    template_raw = repo.get("strategy_templates", strategy_id)
    if template_raw and not template_raw.get("deleted_at"):
        return hydrate_strategy_template(template_raw)
    return _strategy_to_template(_require_strategy(strategy_id))


def _strategy_to_markdown(strategy: Strategy) -> str:
    lines = [
        f"# {strategy.objective}",
        "",
        "## 维度",
        ", ".join(strategy.dimensions) or "-",
        "",
        "## 指标",
        ", ".join(strategy.metrics) or "-",
        "",
        "## 分析步骤",
    ]
    lines.extend(f"- {method}" for method in strategy.methods)
    return "\n".join(lines)


def _polish_strategy_markdown(title: str, markdown: str) -> str:
    methods = _extract_strategy_steps(markdown)
    dimensions = _extract_markdown_values(markdown, ["维度", "dimensions"])
    metrics = _extract_markdown_values(markdown, ["指标", "metrics"])
    lines = [
        f"# {title.strip() or '润色后的分析策略'}",
        "",
        "## 适用场景",
        "用于多轮对话中的商业数据诊断，要求结论可追溯到数据字典、执行结果和图表证据。",
        "",
        "## 分析步骤",
    ]
    lines.extend(f"- {method}" for method in methods)
    lines.extend(
        [
            "",
            "## 维度",
            ", ".join(dimensions) if dimensions else "-",
            "",
            "## 指标",
            ", ".join(metrics) if metrics else "-",
            "",
            "## 输出要求",
            "- 输出过程步骤、核心图表、明细表和可复核结论。",
            "- 未经执行验证的推断只能作为风险备注。",
        ]
    )
    return "\n".join(lines)


def _merge_strategy_markdown(title: str, templates: List[StrategyTemplate]) -> str:
    methods: List[str] = []
    dimensions: List[str] = []
    metrics: List[str] = []
    sources: List[str] = []
    for template in templates:
        sources.append(template.title)
        methods.extend(method for method in template.methods if method not in methods)
        dimensions.extend(item for item in template.dimensions if item not in dimensions)
        metrics.extend(item for item in template.metrics if item not in metrics)
    lines = [
        f"# {title.strip() or '合并分析策略'}",
        "",
        "## 来源策略",
        *[f"- {source}" for source in sources],
        "",
        "## 分析步骤",
        *[f"- {method}" for method in methods],
        "",
        "## 维度",
        ", ".join(dimensions) if dimensions else "-",
        "",
        "## 指标",
        ", ".join(metrics) if metrics else "-",
    ]
    return "\n".join(lines)


def _extract_strategy_steps(markdown: str) -> List[str]:
    steps: List[str] = []
    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        match = re.match(r"^(?:[-*]|\d+[.)、])\s*(.+)$", stripped)
        if match:
            value = match.group(1).strip()
            if value and value not in steps:
                steps.append(value[:120])
    return steps[:12] or [
        "1_data_scope_and_quality_check",
        "2_metric_definition_and_field_mapping",
        "3_time_trend_decomposition",
        "4_dimension_group_comparison",
        "5_contribution_and_outlier_drilldown",
        "6_cross_dataset_consistency_check",
        "7_business_summary_and_risk_notes",
    ]


def _extract_markdown_values(markdown: str, labels: List[str]) -> List[str]:
    result: List[str] = []
    lines = markdown.splitlines()
    for index, line in enumerate(lines):
        lowered = line.lower()
        if any(label.lower() in lowered for label in labels):
            text = re.sub(r"^[#*\-\s]*", "", line)
            text = re.sub(r"^(维度|指标|dimensions|metrics)\s*[:：]?", "", text, flags=re.IGNORECASE).strip()
            if not text or text in labels:
                for next_line in lines[index + 1 :]:
                    candidate = next_line.strip()
                    if not candidate:
                        continue
                    if candidate.startswith("#"):
                        break
                    text = candidate
                    break
            for item in re.split(r"[,，、/ ]+", text):
                item = item.strip(" -:*`")
                if item and item not in labels and item not in result:
                    result.append(item)
    return result[:8]


def _compose_strategy_markdown_from_tasks(tasks: List[Task]) -> str:
    lines = [
        "# 个性化分析策略",
        "",
        "## 来源",
        f"基于 {len(tasks)} 条用户认可的问答结果归纳。",
        "",
        "## 分析步骤",
    ]
    method_seen: List[str] = []
    dimensions: List[str] = []
    metrics: List[str] = []
    for task in tasks:
        strategy_raw = repo.get("strategies", task.strategy_id) if task.strategy_id else None
        strategy = hydrate_strategy(strategy_raw) if strategy_raw else None
        if strategy:
            for method in strategy.methods:
                if method not in method_seen:
                    method_seen.append(method)
            dimensions.extend(item for item in strategy.dimensions if item not in dimensions)
            metrics.extend(item for item in strategy.metrics if item not in metrics)
    for method in method_seen or _extract_strategy_steps(""):
        lines.append(f"- {method}")
    lines.extend(["", "## 维度", ", ".join(dimensions[:8]) or "-", "", "## 指标", ", ".join(metrics[:8]) or "-"])
    lines.append("")
    lines.append("## 偏好")
    for task in tasks:
        lines.append(f"- 问题：{task.user_intent}；结果：{task.analysis_summary or '已确认'}")
    return "\n".join(lines)


def _feedback_strategy_context(feedback: TaskFeedback) -> Dict[str, Any]:
    task = _task_or_none(feedback.task_id)
    return {
        "task_id": feedback.task_id,
        "rating": feedback.rating,
        "intent": task.user_intent if task else "",
        "summary": task.analysis_summary if task else "",
    }


def _report_strategy_context(modules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    context: List[Dict[str, Any]] = []
    for module in modules:
        snapshot = module.get("snapshot", {}) or {}
        strategy = snapshot.get("strategy", {}) if isinstance(snapshot.get("strategy"), dict) else {}
        context.append(
            {
                "module_title": module.get("title"),
                "module_type": module.get("type"),
                "intent": snapshot.get("intent"),
                "summary": snapshot.get("summary"),
                "objective": strategy.get("objective"),
                "methods": strategy.get("methods", []),
                "dimensions": strategy.get("dimensions", []),
                "metrics": strategy.get("metrics", []),
                "process_steps": snapshot.get("process_steps", []),
            }
        )
    return context


def _normalize_report_strategy(
    generated: Optional[Dict[str, Any]],
    report: Report,
    context: List[Dict[str, Any]],
) -> Dict[str, Any]:
    dimensions: List[str] = []
    metrics: List[str] = []
    text_parts = [report.title]
    for item in context:
        text_parts.extend(str(item.get(key) or "") for key in ["intent", "summary", "objective"])
        dimensions.extend(value for value in item.get("dimensions", []) if isinstance(value, str) and value not in dimensions)
        metrics.extend(value for value in item.get("metrics", []) if isinstance(value, str) and value not in metrics)
    report_text = " ".join(text_parts)

    fallback_methods = [
        "梳理报告各模块的问题边界、数据范围与证据完整性",
        "统一各模块的指标口径、维度定义和数据版本",
    ]
    if any(keyword in report_text for keyword in ["趋势", "变化", "增长", "下降", "月度"]):
        fallback_methods.append("综合比较各时间阶段的指标变化趋势")
    if any(keyword in report_text for keyword in ["贡献", "占比", "主要来源"]):
        fallback_methods.append("拆解各业务维度的贡献并定位主要贡献项")
    if any(keyword in report_text for keyword in ["影响", "因素", "原因", "驱动", "归因"]):
        fallback_methods.extend([
            "筛选跨模块重复出现的候选影响因素",
            "校验候选因素与目标指标的关联强度及稳定性",
        ])
    fallback_methods.extend([
        "交叉验证不同模块结论之间的一致性与冲突",
        "形成按证据强弱排序的综合结论和行动建议",
    ])

    result = generated if isinstance(generated, dict) else {}
    generated_methods = [
        value.strip()
        for value in result.get("methods", [])
        if isinstance(value, str) and value.strip() and "_" not in value
    ]
    generated_dimensions = [value.strip() for value in result.get("dimensions", []) if isinstance(value, str) and value.strip()]
    generated_metrics = [value.strip() for value in result.get("metrics", []) if isinstance(value, str) and value.strip()]
    return {
        "title": str(result.get("title") or f"{report.title} 综合分析策略").strip(),
        "objective": str(result.get("objective") or f"综合报告《{report.title}》中的分析模块，形成一致、可追溯且可执行的后续分析路径。").strip(),
        "methods": list(dict.fromkeys(generated_methods or fallback_methods))[:10],
        "dimensions": list(dict.fromkeys(generated_dimensions or dimensions))[:10],
        "metrics": list(dict.fromkeys(generated_metrics or metrics))[:10],
    }


def _report_strategy_markdown(
    title: str,
    objective: str,
    methods: List[str],
    dimensions: List[str],
    metrics: List[str],
) -> str:
    return "\n".join([
        f"# {title}",
        "",
        "## 分析目标",
        objective,
        "",
        "## 分析步骤",
        *(f"- {method}" for method in methods),
        "",
        "## 维度",
        ", ".join(dimensions) or "-",
        "",
        "## 指标",
        ", ".join(metrics) or "-",
    ])


def _module_to_cart_snapshot(payload: ReportModuleRequest, sort_order: int) -> Dict[str, Any]:
    return {
        "id": new_id("module"),
        "session_id": payload.session_id,
        "type": payload.type,
        "ref_id": payload.ref_id,
        "title": payload.title,
        "sort_order": sort_order,
        "snapshot": payload.snapshot,
        "created_at": now_iso(),
    }


def _write_report_version(report: Report, cart_snapshot: List[Dict[str, Any]]) -> ReportVersion:
    version_number = len(report.versions) + 1
    markdown = _workflow().report_agent.compose_markdown(report.title, cart_snapshot)
    content_key = f"reports/{report.project_id}/{report.id}/{version_number}.md"
    html_key = f"reports/{report.project_id}/{report.id}/{version_number}.html"
    objects.put_text(content_key, markdown)
    objects.put_text(html_key, _markdown_to_html(markdown))
    return ReportVersion(
        id=new_id("rver"),
        report_id=report.id,
        version=version_number,
        content_key=content_key,
        cart_snapshot=cart_snapshot,
        export_keys={"markdown": content_key, "html": html_key},
    )


def _enrich_report_module(module: Dict[str, Any]) -> Dict[str, Any]:
    enriched = dict(module)
    snapshot = dict(enriched.get("snapshot", {}))
    task = _task_from_report_module(enriched)
    if task:
        snapshot.setdefault("task_id", task.id)
        snapshot.setdefault("task", task.model_dump())
        if task.strategy_id:
            strategy_raw = repo.get("strategies", task.strategy_id)
            if strategy_raw and not strategy_raw.get("deleted_at"):
                snapshot.setdefault("strategy", hydrate_strategy(strategy_raw).model_dump())
        if task.analysis_summary:
            snapshot.setdefault("summary", task.analysis_summary)
        if task.execution_id:
            execution_raw = repo.get("executions", task.execution_id)
            if execution_raw:
                execution = hydrate_execution(execution_raw)
                snapshot.setdefault("execution", execution.model_dump())
                if not snapshot.get("charts"):
                    snapshot["charts"] = [chart.model_dump() for chart in execution.charts]
                if not snapshot.get("table"):
                    snapshot["table"] = execution.table
    enriched["snapshot"] = snapshot
    return enriched


def _task_from_report_module(module: Dict[str, Any]) -> Optional[Task]:
    snapshot = module.get("snapshot", {}) or {}
    task_id = snapshot.get("task_id")
    if not task_id and isinstance(snapshot.get("task"), dict):
        task_id = snapshot["task"].get("id")
    if not task_id and isinstance(snapshot.get("strategy"), dict):
        task_id = snapshot["strategy"].get("task_id")
    if not task_id and module.get("type") == "strategy":
        strategy_raw = repo.get("strategies", module.get("ref_id"))
        if strategy_raw:
            task_id = strategy_raw.get("task_id")
    if not task_id and module.get("type") in ["conclusion", "execution", "analysis"]:
        execution_raw = repo.get("executions", module.get("ref_id"))
        if execution_raw:
            task_id = execution_raw.get("task_id")
    return _task_or_none(task_id) if task_id else None


def _to_float(value: Any) -> Optional[float]:
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _markdown_to_html(markdown: str) -> str:
    lines = []
    for line in markdown.splitlines():
        if line.startswith("# "):
            lines.append(f"<h1>{line[2:]}</h1>")
        elif line.startswith("## "):
            lines.append(f"<h2>{line[3:]}</h2>")
        elif line.startswith("### "):
            lines.append(f"<h3>{line[4:]}</h3>")
        elif line.startswith("- "):
            lines.append(f"<li>{line[2:]}</li>")
        elif line:
            lines.append(f"<p>{line}</p>")
    return "<!doctype html><meta charset='utf-8'><body>" + "\n".join(lines) + "</body>"
