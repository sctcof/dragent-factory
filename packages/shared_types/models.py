from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


class AssetType(str, Enum):
    csv = "csv"
    excel = "excel"
    markdown = "markdown"
    database = "database"


class TaskStatus(str, Enum):
    draft_strategy = "draft_strategy"
    waiting_confirmation = "waiting_confirmation"
    running = "running"
    success = "success"
    failed = "failed"
    manual_edit_required = "manual_edit_required"


class AgentType(str, Enum):
    data = "data"
    planner = "planner"
    coder = "coder"
    executor = "executor"
    analyzer = "analyzer"
    report = "report"


class ChartType(str, Enum):
    metric = "metric"
    line = "line"
    bar = "bar"
    pie = "pie"
    heatmap = "heatmap"
    scatter = "scatter"
    table = "table"
    graph = "graph"


class FieldProfile(BaseModel):
    name: str
    logical_type: str
    null_count: int = 0
    unique_count: int = 0
    sample_values: List[Any] = Field(default_factory=list)
    min_value: Optional[Any] = None
    max_value: Optional[Any] = None
    sensitive: bool = False


class DataDictionary(BaseModel):
    asset_id: str
    asset_name: str
    table_name: str
    row_count: int
    columns: List[FieldProfile]
    metrics: List[Dict[str, Any]] = Field(default_factory=list)
    supporting_ids: List[str] = Field(default_factory=list)


class KnowledgeGraph(BaseModel):
    nodes: List[Dict[str, Any]] = Field(default_factory=list)
    edges: List[Dict[str, Any]] = Field(default_factory=list)


DEFAULT_ASSET_TAG = "public"


class AssetTag(BaseModel):
    id: str
    project_id: str
    name: str
    description: str = ""
    parent_id: Optional[str] = None
    path: str = ""
    depth: int = 0
    is_system: bool = False
    created_at: str = Field(default_factory=now_iso)
    deleted_at: Optional[str] = None


class Asset(BaseModel):
    id: str
    project_id: str
    type: AssetType
    name: str
    source: str
    object_key: str
    parse_status: str = "pending"
    version: int = 1
    datasource_id: Optional[str] = None
    source_table: Optional[str] = None
    tags: List[str] = Field(default_factory=lambda: [DEFAULT_ASSET_TAG])
    data_dictionary: Optional[DataDictionary] = None
    graph: KnowledgeGraph = Field(default_factory=KnowledgeGraph)
    created_at: str = Field(default_factory=now_iso)
    deleted_at: Optional[str] = None


class Dataset(BaseModel):
    """Named reusable collection of data assets for multi-table analysis."""

    id: str
    project_id: str
    name: str
    description: str = ""
    asset_ids: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
    deleted_at: Optional[str] = None


class Datasource(BaseModel):
    id: str
    project_id: str
    name: str
    type: str
    database_url_masked: str
    table_name: Optional[str] = None
    tables: List[str] = Field(default_factory=list)
    status: str = "ready"
    asset_id: Optional[str] = None
    error: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    deleted_at: Optional[str] = None


class Strategy(BaseModel):
    id: str
    task_id: str
    version: int = 1
    objective: str
    dimensions: List[str]
    metrics: List[str]
    methods: List[str]
    chart_suggestions: List[Dict[str, Any]]
    evidence_policy: str
    assumptions: List[str] = Field(default_factory=list)
    source_strategy_ids: List[str] = Field(default_factory=list)
    rag_context: List[Dict[str, Any]] = Field(default_factory=list)
    confirmed_by: Optional[str] = None
    confirmed_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)
    deleted_at: Optional[str] = None


class ChartConfig(BaseModel):
    id: str
    type: ChartType
    title: str
    x_field: Optional[str] = None
    y_fields: List[str] = Field(default_factory=list)
    dataset: List[Dict[str, Any]] = Field(default_factory=list)
    dataset_ref: Optional[str] = None
    query_binding: Optional[Dict[str, Any]] = None
    insight: Optional[str] = None


class ExecutionResult(BaseModel):
    execution_id: str
    task_id: str
    language: str
    code_hash: str
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0
    status: str
    table: List[Dict[str, Any]] = Field(default_factory=list)
    charts: List[ChartConfig] = Field(default_factory=list)
    process_steps: List[Dict[str, Any]] = Field(default_factory=list)
    quality_table: List[Dict[str, Any]] = Field(default_factory=list)
    lineage: List[Dict[str, Any]] = Field(default_factory=list)


class Task(BaseModel):
    id: str
    session_id: str
    project_id: str
    user_intent: str
    selected_assets: List[str]
    status: TaskStatus = TaskStatus.draft_strategy
    strategy_id: Optional[str] = None
    generated_code: Optional[str] = None
    execution_id: Optional[str] = None
    analysis_summary: Optional[str] = None
    chart_ids: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class TaskFeedback(BaseModel):
    id: str
    session_id: str
    task_id: str
    rating: str
    note: Optional[str] = None
    snapshot: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class Message(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    task_id: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class Session(BaseModel):
    id: str
    project_id: str
    user_id: str = "local-user"
    title: str
    status: str = "active"
    archived_at: Optional[str] = None
    deleted_at: Optional[str] = None
    last_active_at: str = Field(default_factory=now_iso)


class StrategyTemplate(BaseModel):
    id: str
    project_id: str
    title: str
    markdown: str
    source: str = "markdown"
    methods: List[str] = Field(default_factory=list)
    dimensions: List[str] = Field(default_factory=list)
    metrics: List[str] = Field(default_factory=list)
    created_from_task_ids: List[str] = Field(default_factory=list)
    usage_count: int = 0
    created_at: str = Field(default_factory=now_iso)
    deleted_at: Optional[str] = None


class CartItem(BaseModel):
    id: str
    session_id: str
    type: str
    ref_id: str
    title: str
    sort_order: int
    snapshot: Dict[str, Any]
    created_at: str = Field(default_factory=now_iso)


class ReportVersion(BaseModel):
    id: str
    report_id: str
    version: int
    content_key: str
    cart_snapshot: List[Dict[str, Any]]
    export_keys: Dict[str, str]
    created_at: str = Field(default_factory=now_iso)


class Report(BaseModel):
    id: str
    project_id: str
    session_id: str
    title: str
    status: str = "ready"
    versions: List[ReportVersion] = Field(default_factory=list)
    deleted_at: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)


class QueryBinding(BaseModel):
    id: str
    project_id: str
    source_execution_id: str
    version: int = 1
    language: str
    code_template: str
    params_schema: List[Dict[str, Any]]
    datasource_ids: List[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)


class DashboardItem(BaseModel):
    id: str
    dashboard_id: str
    chart_config: ChartConfig
    query_binding_id: Optional[str] = None
    param_mapping: Dict[str, str] = Field(default_factory=dict)
    sort_order: int = 0


class Dashboard(BaseModel):
    id: str
    project_id: str
    name: str
    layout: Dict[str, Any] = Field(default_factory=dict)
    page_params: List[Dict[str, Any]] = Field(default_factory=list)
    refresh_interval: Optional[int] = None
    share_token: Optional[str] = None
    status: str = "active"
    items: List[DashboardItem] = Field(default_factory=list)
    created_at: str = Field(default_factory=now_iso)


class ModelConfig(BaseModel):
    global_default: str = "local-heuristic"
    agents: Dict[str, str] = Field(
        default_factory=lambda: {
            "data": "local-heuristic",
            "planner": "local-heuristic",
            "coder": "local-codegen",
            "analyzer": "local-heuristic",
            "report": "local-writer",
        }
    )
    params: Dict[str, Any] = Field(default_factory=lambda: {"temperature": 0.2})


class AuditLog(BaseModel):
    id: str
    project_id: str
    actor_id: str = "local-user"
    action: str
    target_type: str
    target_id: str
    detail: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=now_iso)
