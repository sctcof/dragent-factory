const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export type ApiTaskBundle = {
  type: "task";
  task: DrTask;
  strategy?: Strategy;
  execution?: ExecutionResult;
  charts: ChartConfig[];
  feedback?: TaskFeedback | null;
};

export type MessageItem = {
  type: "message";
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  task_id?: string | null;
  created_at: string;
};

export type TimelineItem = MessageItem | ApiTaskBundle;

export type Asset = {
  id: string;
  project_id?: string;
  name: string;
  type: string;
  source?: string;
  datasource_id?: string | null;
  source_table?: string | null;
  object_key?: string;
  parse_status: string;
  tags?: string[];
  created_at?: string;
  deleted_at?: string | null;
  data_dictionary?: {
    row_count: number;
    table_name: string;
    columns: Array<{ name: string; logical_type: string; unique_count: number; null_count: number; sensitive: boolean }>;
    metrics: Array<{ name: string; formula: string }>;
  };
  graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
};
export type CombinedKnowledgeGraph = {
  title: string;
  asset_ids: string[];
  assets: Array<{
    id: string;
    name: string;
    table: string;
    row_count: number;
    column_count: number;
    metric_count: number;
    type: string;
    source: string;
    created_at: string;
  }>;
  graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
  recommended_questions: string[];
  inferred_joins: Array<{
    field: string;
    source_asset_id: string;
    source_asset: string;
    target_asset_id: string;
    target_asset: string;
  }>;
  field_profiles: Array<{
    asset_id: string;
    asset_name: string;
    table: string;
    name: string;
    logical_type: string;
    null_count: number;
    unique_count: number;
    sample_values: unknown[];
    min_value?: number | null;
    max_value?: number | null;
    sensitive: boolean;
  }>;
};

export type Datasource = {
  id: string;
  project_id: string;
  name: string;
  type: string;
  database_url_masked: string;
  table_name?: string | null;
  tables?: string[];
  status: string;
  asset_id?: string | null;
  error?: string | null;
  created_at: string;
};

export type AssetTag = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  parent_id?: string | null;
  path?: string;
  depth?: number;
  is_system?: boolean;
  created_at: string;
  deleted_at?: string | null;
};

export type Dataset = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  asset_ids: string[];
  tags?: string[];
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type DatasetDetail = {
  dataset: Dataset;
  assets: Asset[];
  missing_asset_ids: string[];
};

export type StrategyAsset = {
  id: string;
  kind?: string;
  task_id: string;
  session_id?: string | null;
  title: string;
  objective: string;
  dimensions: string[];
  metrics: string[];
  methods: string[];
  confirmed_at?: string | null;
  created_at: string;
  source?: string;
  markdown?: string;
  created_from_task_ids?: string[];
};

export type Session = { id: string; title: string; last_active_at: string; archived_at?: string | null };
export type DrTask = {
  id: string;
  session_id: string;
  status: string;
  user_intent: string;
  selected_assets: string[];
  strategy_id?: string;
  generated_code?: string;
  execution_id?: string;
  analysis_summary?: string;
  errors: string[];
};
export type Strategy = {
  id: string;
  task_id: string;
  objective: string;
  dimensions: string[];
  metrics: string[];
  methods: string[];
  chart_suggestions: Array<Record<string, unknown>>;
  evidence_policy: string;
  assumptions: string[];
  confirmed_at?: string | null;
};
export type ChartConfig = {
  id: string;
  type: string;
  title: string;
  x_field?: string | null;
  y_fields: string[];
  dataset: Array<Record<string, string | number>>;
  dataset_ref?: string | null;
  insight?: string | null;
};
export type ExecutionResult = {
  execution_id: string;
  task_id: string;
  language: string;
  code_hash: string;
  stdout: string;
  stderr: string;
  duration_ms: number;
  status: string;
  table: Array<Record<string, string | number>>;
  charts: ChartConfig[];
  process_steps: Array<Record<string, string | number>>;
  quality_table: Array<Record<string, string | number>>;
  lineage: Array<Record<string, unknown>>;
};
export type TaskFeedback = { id: string; session_id: string; task_id: string; rating: "up" | "down"; note?: string | null; updated_at: string };
export type RagContextItem = { id: string; kb_kind: string; asset_id: string; text: string; score: number };
export type CartItem = { id: string; title: string; type: string; ref_id: string; snapshot: Record<string, unknown> };
export type Report = { id: string; project_id?: string; session_id: string; title: string; status?: string; versions: Array<{ version: number; export_keys: Record<string, string>; cart_snapshot?: ReportModule[] }>; created_at?: string; deleted_at?: string | null };
export type ReportModule = { id: string; session_id: string; type: string; ref_id: string; title: string; sort_order: number; snapshot: Record<string, unknown>; created_at: string };
export type ReportDetail = { report: Report; session: Session; version?: { version: number; cart_snapshot: ReportModule[]; export_keys: Record<string, string> }; items: ReportModule[] };
export type AssetDetail = {
  asset: Asset;
  metadata: Record<string, string | number | null>;
  field_profiles: Array<{ name: string; logical_type: string; null_count: number; unique_count: number; sample_values: unknown[]; min_value?: unknown; max_value?: unknown; sensitive: boolean }>;
  graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
  insights: string[];
  relationships: Array<Record<string, unknown>>;
  preview_rows: Array<Record<string, string | number>>;
};
export type Dashboard = { id: string; name: string; share_token?: string; items: Array<{ id: string; chart_config: ChartConfig; query_binding_id?: string }> };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store"
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  base: API_BASE,
  bootstrap: () => request<{ project_id: string; sessions: Session[]; assets: Asset[]; reports: { items?: Report[] } | Report[]; dashboards: Dashboard[]; datasources?: Datasource[]; model_config: Record<string, unknown> }>("/api/bootstrap"),
  listSessions: (status = "active") => request<{ items: Session[]; total: number }>(`/api/sessions?status=${encodeURIComponent(status)}&page_size=100`),
  assetLibrary: () => request<{ data_assets: Asset[]; strategy_assets: StrategyAsset[] }>("/api/asset-library"),
  supportedDatasources: () =>
    request<{ supported: Record<string, string>; kinds?: string[]; labels?: Record<string, string> }>("/api/datasources/supported"),
  datasources: () => request<Datasource[]>("/api/datasources"),
  testDatasource: (database_url: string) =>
    request<{ ok: boolean; kind: string; table_count: number; tables: string[]; database_url_masked: string }>(
      "/api/datasources/test",
      { method: "POST", body: JSON.stringify({ database_url }) }
    ),
  createDatasource: (payload: { name: string; database_url: string; table_name?: string; sample_limit?: number }) =>
    request<Datasource>("/api/datasources", { method: "POST", body: JSON.stringify(payload) }),
  updateDatasource: (datasourceId: string, payload: { name: string; database_url?: string }) =>
    request<Datasource>(`/api/datasources/${datasourceId}`, { method: "PUT", body: JSON.stringify(payload) }),
  datasourceTables: (datasourceId: string) =>
    request<{ datasource_id: string; tables: string[] }>(`/api/datasources/${datasourceId}/tables`),
  createDatasourceAssets: (datasourceId: string, table_names: string[], sample_limit = 5000, tags: string[] = ["public"]) =>
    request<{ assets: Asset[]; created: number; reused: number; failures: Array<{ table: string; error: string }> }>(
      `/api/datasources/${datasourceId}/assets`,
      { method: "POST", body: JSON.stringify({ table_names, sample_limit, tags }) }
    ),
  deleteDatasource: (datasourceId: string) => request<{ status: string }>(`/api/datasources/${datasourceId}`, { method: "DELETE" }),
  createSession: (title: string) => request<Session>("/api/sessions", { method: "POST", body: JSON.stringify({ title }) }),
  cloneSession: (sessionId: string, title?: string) =>
    request<Session>(`/api/sessions/${sessionId}/clone`, { method: "POST", body: JSON.stringify({ title }) }),
  updateSession: (sessionId: string, payload: { title?: string; archived?: boolean }) =>
    request<Session>(`/api/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteSession: (sessionId: string) => request<{ status: string }>(`/api/sessions/${sessionId}`, { method: "DELETE" }),
  replaySession: (sessionId: string) => request<{ session: Session; timeline: TimelineItem[] }>(`/api/sessions/${sessionId}/replay`),
  assetDetail: (assetId: string) => request<AssetDetail>(`/api/assets/${assetId}/detail`),
  combinedKnowledgeGraph: (asset_ids: string[], title = "多数据集整体知识图") =>
    request<CombinedKnowledgeGraph>("/api/assets/knowledge-graph", {
      method: "POST",
      body: JSON.stringify({ asset_ids, title })
    }),
  generateAnalysisQuestions: (goal: string, asset_ids: string[], count = 8) =>
    request<{
      goal: string;
      questions: string[];
      source: string;
      goal_inferred?: boolean;
      generation?: Record<string, unknown>;
    }>("/api/assets/analysis-questions", {
      method: "POST",
      body: JSON.stringify({ goal, asset_ids, count }),
    }),
  updateAssetTags: (assetId: string, tags: string[]) =>
    request<Asset>(`/api/assets/${assetId}/tags`, { method: "PATCH", body: JSON.stringify({ tags }) }),
  batchUpdateAssetTags: (asset_ids: string[], tags: string[], mode: "add" | "replace" = "add") =>
    request<{ updated: Asset[]; updated_count: number; missing: string[]; mode: string; tags: string[] }>(
      "/api/assets/tags/batch",
      { method: "POST", body: JSON.stringify({ asset_ids, tags, mode }) }
    ),
  listTags: () => request<AssetTag[]>("/api/tags"),
  createTag: (payload: { name: string; description?: string; parent_id?: string | null }) =>
    request<AssetTag>("/api/tags", { method: "POST", body: JSON.stringify(payload) }),
  updateTag: (tagId: string, payload: { name?: string; description?: string; parent_id?: string | null; move_parent?: boolean }) =>
    request<AssetTag>(`/api/tags/${tagId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteTag: (tagId: string) => request<{ status: string }>(`/api/tags/${tagId}`, { method: "DELETE" }),
  listDatasets: () => request<Dataset[]>("/api/datasets"),
  getDataset: (datasetId: string) => request<DatasetDetail>(`/api/datasets/${datasetId}`),
  createDataset: (payload: { name: string; description?: string; asset_ids?: string[]; tags?: string[] }) =>
    request<Dataset>("/api/datasets", { method: "POST", body: JSON.stringify(payload) }),
  updateDataset: (datasetId: string, payload: { name?: string; description?: string; asset_ids?: string[]; tags?: string[] }) =>
    request<Dataset>(`/api/datasets/${datasetId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  mutateDatasetAssets: (datasetId: string, asset_ids: string[], mode: "add" | "remove" | "replace" = "add") =>
    request<Dataset>(`/api/datasets/${datasetId}/assets`, { method: "POST", body: JSON.stringify({ asset_ids, mode }) }),
  deleteDataset: (datasetId: string) => request<{ status: string }>(`/api/datasets/${datasetId}`, { method: "DELETE" }),
  deleteAsset: (assetId: string) => request<{ status: string }>(`/api/assets/${assetId}`, { method: "DELETE" }),
  deleteStrategyAsset: (strategyId: string) => request<{ status: string }>(`/api/strategy-assets/${strategyId}`, { method: "DELETE" }),
  uploadAsset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Asset>("/api/assets/upload", { method: "POST", body: form });
  },
  createTask: (session_id: string, message: string, asset_ids: string[]) =>
    request<DrTask>("/api/tasks", { method: "POST", body: JSON.stringify({ session_id, message, asset_ids }) }),
  createTaskWithStrategies: (session_id: string, message: string, asset_ids: string[], strategy_asset_ids: string[]) =>
    request<DrTask>("/api/tasks", { method: "POST", body: JSON.stringify({ session_id, message, asset_ids, strategy_asset_ids }) }),
  getTask: (taskId: string) => request<ApiTaskBundle>(`/api/tasks/${taskId}`),
  ragContext: (query: string, asset_ids: string[], limit = 8) =>
    request<{ items: RagContextItem[] }>("/api/rag/context", { method: "POST", body: JSON.stringify({ query, asset_ids, limit }) }),
  rateTask: (taskId: string, rating: "up" | "down", note?: string) =>
    request<TaskFeedback>(`/api/tasks/${taskId}/feedback`, { method: "POST", body: JSON.stringify({ rating, note }) }),
  createStrategyFromMarkdown: (payload: { title: string; markdown: string }) =>
    request<StrategyAsset>("/api/strategy-assets/from-markdown", { method: "POST", body: JSON.stringify(payload) }),
  updateStrategyAsset: (strategyId: string, payload: { title: string; markdown: string }) =>
    request<StrategyAsset>(`/api/strategy-assets/${strategyId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  polishStrategyAsset: (payload: { title: string; markdown: string }) =>
    request<{ title: string; markdown: string; methods: string[]; dimensions: string[]; metrics: string[] }>("/api/strategy-assets/polish", { method: "POST", body: JSON.stringify(payload) }),
  mergeStrategyAssets: (payload: { title: string; strategy_asset_ids: string[] }) =>
    request<StrategyAsset>("/api/strategy-assets/merge", { method: "POST", body: JSON.stringify(payload) }),
  createStrategyFromFeedback: (sessionId: string, payload: { title: string; task_ids: string[] }) =>
    request<StrategyAsset>(`/api/sessions/${sessionId}/strategy-assets/from-feedback`, { method: "POST", body: JSON.stringify(payload) }),
  confirmStrategy: (taskId: string, strategy: Strategy) =>
    request<ApiTaskBundle>(`/api/tasks/${taskId}/strategy/confirm`, {
      method: "POST",
      body: JSON.stringify({ strategy_id: strategy.id, confirmed_strategy: strategy })
    }),
  rerunCode: (task_id: string, code: string, asset_ids: string[]) =>
    request<ExecutionResult>("/api/executions", { method: "POST", body: JSON.stringify({ task_id, code, asset_ids, language: "python" }) }),
  addCart: (payload: { session_id: string; type: string; ref_id: string; title: string; snapshot: Record<string, unknown> }) =>
    request<CartItem>("/api/cart-items", { method: "POST", body: JSON.stringify(payload) }),
  cartItems: (sessionId: string) => request<CartItem[]>(`/api/cart-items?session_id=${sessionId}`),
  createReport: (session_id: string, cart_item_ids: string[], title?: string) =>
    request<Report>("/api/reports", { method: "POST", body: JSON.stringify({ session_id, cart_item_ids, title }) }),
  listReports: () => request<{ items: Report[]; total: number }>("/api/reports"),
  reportDetail: (reportId: string) => request<ReportDetail>(`/api/reports/${reportId}`),
  runReportModule: (reportId: string, moduleId: string, params: Record<string, unknown> = {}) =>
    request<ReportDetail>(`/api/reports/${reportId}/items/${moduleId}/run`, { method: "POST", body: JSON.stringify({ params }) }),
  deleteReportModule: (reportId: string, moduleId: string) =>
    request<ReportDetail>(`/api/reports/${reportId}/items/${moduleId}`, { method: "DELETE" }),
  generateReportStrategy: (reportId: string, title?: string) =>
    request<{ strategy: StrategyAsset; generation: { model: string; status: string; reason?: string; latency_ms: number } }>(
      `/api/reports/${reportId}/strategy`,
      { method: "POST", body: JSON.stringify({ title }) }
    ),
  appendReportItem: (reportId: string, payload: { session_id: string; type: string; ref_id: string; title: string; snapshot: Record<string, unknown> }) =>
    request<Report>(`/api/reports/${reportId}/items`, { method: "POST", body: JSON.stringify(payload) }),
  createReportFromModule: (payload: { session_id: string; type: string; ref_id: string; title: string; snapshot: Record<string, unknown>; report_title?: string }) =>
    request<Report>("/api/reports/from-module", { method: "POST", body: JSON.stringify(payload) }),
  deleteReport: (reportId: string) => request<{ status: string }>(`/api/reports/${reportId}`, { method: "DELETE" }),
  createDashboard: (name: string) => request<Dashboard>("/api/dashboards", { method: "POST", body: JSON.stringify({ name }) }),
  pinChart: (dashboardId: string, chart_id: string, source_execution_id: string) =>
    request<Dashboard>(`/api/dashboards/${dashboardId}/items`, { method: "POST", body: JSON.stringify({ chart_id, source_execution_id, param_mapping: {} }) }),
  executeBinding: (bindingId: string, dashboard_id?: string) =>
    request<Record<string, unknown>>(`/api/query-bindings/${bindingId}/execute`, { method: "POST", body: JSON.stringify({ dashboard_id, params: {} }) })
};
