"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Check,
  Copy,
  Database,
  FileText,
  GitBranch,
  HeartPulse,
  Info,
  Layers,
  Network,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShoppingCart,
  Tags,
  TerminalSquare,
  X,
  type LucideIcon
} from "lucide-react";
import {
  api,
  type HealthResponse,
  type OpenApiOperation,
  type OpenApiParameter,
  type OpenApiSchema,
  type OpenApiSpec
} from "../../lib/api";

/* ------------------------------------------------------------------ */
/* 接口分组：基于路径前缀归类，展示顺序即分组顺序                        */
/* ------------------------------------------------------------------ */

type ApiGroup = {
  key: string;
  label: string;
  icon: LucideIcon;
  hint: string;
  match: (path: string) => boolean;
};

const API_GROUPS: ApiGroup[] = [
  {
    key: "system",
    label: "系统与引导",
    icon: HeartPulse,
    hint: "健康检查、启动引导与审计日志",
    match: (path) => path === "/api/health" || path === "/api/bootstrap" || path.startsWith("/api/audit-logs"),
  },
  {
    key: "sessions",
    label: "会话",
    icon: Layers,
    hint: "分析会话的创建、列表、克隆、归档、回放与策略沉淀",
    match: (path) => path.startsWith("/api/sessions"),
  },
  {
    key: "assets",
    label: "数据资产",
    icon: Database,
    hint: "文件/数据库资产的画像、标签、知识图谱与分析问题生成",
    match: (path) => path.startsWith("/api/assets") || path === "/api/asset-library",
  },
  {
    key: "datasources",
    label: "数据连接",
    icon: Network,
    hint: "数据库连接的管理、测试、表清单与批量资产化",
    match: (path) => path.startsWith("/api/datasources"),
  },
  {
    key: "tags",
    label: "标签",
    icon: Tags,
    hint: "资产标签树的创建、改名、移动与删除",
    match: (path) => path.startsWith("/api/tags"),
  },
  {
    key: "datasets",
    label: "数据集",
    icon: Layers,
    hint: "多资产数据集的组合、维护与删除",
    match: (path) => path.startsWith("/api/datasets"),
  },
  {
    key: "strategies",
    label: "策略资产",
    icon: GitBranch,
    hint: "分析策略的 Markdown 创建、润色、合并与复用",
    match: (path) => path.startsWith("/api/strategy-assets"),
  },
  {
    key: "tasks",
    label: "任务与执行",
    icon: TerminalSquare,
    hint: "分析任务的策略草稿、确认执行、反馈与代码重跑",
    match: (path) => path.startsWith("/api/tasks") || path === "/api/executions",
  },
  {
    key: "rag",
    label: "知识检索",
    icon: BookOpen,
    hint: "基于数据字典与图谱的 RAG 上下文检索",
    match: (path) => path.startsWith("/api/rag"),
  },
  {
    key: "reports",
    label: "购物车与报告",
    icon: ShoppingCart,
    hint: "报告模块编排、版本管理与下载导出",
    match: (path) => path.startsWith("/api/cart-items") || path.startsWith("/api/reports"),
  },
  {
    key: "models",
    label: "模型配置",
    icon: Settings,
    hint: "LLM 模型目录、默认模型与各 Agent 的模型指派",
    match: (path) => path.startsWith("/api/model-config") || path === "/api/models",
  },
  {
    key: "dashboards",
    label: "看板",
    icon: BarChart3,
    hint: "图表看板、查询绑定与参数化执行",
    match: (path) => path.startsWith("/api/dashboards") || path.startsWith("/api/query-bindings"),
  },
];

const FALLBACK_GROUP: ApiGroup = {
  key: "other",
  label: "其他",
  icon: Server,
  hint: "未归类的接口",
  match: () => false,
};

/* ------------------------------------------------------------------ */
/* 接口中文说明：对后端 main.py 全部路由的人工分析                        */
/* key = "METHOD path"（与 OpenAPI 路径模板一致）                        */
/* ------------------------------------------------------------------ */

const API_DESCRIPTIONS: Record<string, string> = {
  // 系统与引导
  "GET /api/health": "服务健康检查。返回服务状态、项目 ID、存储后端（json/postgres）、向量后端（local/ragflow）以及 Redis / Neo4j 连通性。",
  "GET /api/system-config": "系统基础服务配置。返回应用信息、存储/向量/缓存/图数据库/对象存储的配置与连通状态、LLM 模型配置和数据连接摘要，密钥均脱敏。",
  "GET /api/bootstrap": "启动引导数据。一次性返回当前项目下的会话、资产、报告、看板、数据连接与模型配置，供前端工作台初始化。",
  "GET /api/audit-logs": "审计日志列表。按创建时间倒序返回操作审计记录，支持 limit 限制条数。",

  // 会话
  "POST /api/sessions": "创建新的分析会话。标题默认「新的分析会话」，归属指定 project_id。",
  "GET /api/sessions": "会话列表。支持 project_id、关键字（标题/消息内容）、状态（active 排除已归档）与分页查询。",
  "POST /api/sessions/{session_id}/clone": "复制会话。连同任务、策略、执行结果、消息与反馈一起克隆为新会话，标题默认追加「续聊」。",
  "PATCH /api/sessions/{session_id}": "更新会话。可修改标题或归档/取消归档，并刷新最后活跃时间。",
  "DELETE /api/sessions/{session_id}": "删除会话（软删除）。",
  "GET /api/sessions/{session_id}/replay": "会话回放。按时间顺序返回消息与任务执行时间线，用于历史回顾。",
  "POST /api/sessions/{session_id}/strategy-assets/from-feedback": "从用户点赞（up）反馈中归纳生成个性化分析策略模板，可作为后续任务的策略资产复用。",

  // 数据资产
  "POST /api/assets/upload": "上传数据资产。支持 CSV / Excel（.xlsx/.xls），自动解析数据字典、字段画像与知识图谱，并写入 RAG 索引。",
  "GET /api/assets": "数据资产列表。返回当前项目未删除的全部资产。",
  "GET /api/assets/summary": "资产摘要列表。返回轻量化的资产信息（不携带完整字段画像与图谱）。",
  "POST /api/assets/knowledge-graph": "合并知识图谱。对多个资产生成统一知识图，自动推断跨表关联字段（SAME_AS / JOINED_BY），并给出推荐分析问题。",
  "POST /api/assets/analysis-questions": "生成递进式分析问题。基于用户目标与资产字段，由 LLM 或启发式模板生成层层深入的分析问题阶梯。",
  "GET /api/assets/{asset_id}": "资产详情。返回单个数据资产的完整模型。",
  "PATCH /api/assets/{asset_id}/tags": "更新资产标签。替换资产上的标签集合，并自动登记标签树。",
  "POST /api/assets/tags/batch": "批量更新资产标签。支持 add（追加）与 replace（替换）两种模式。",
  "DELETE /api/assets/{asset_id}": "删除数据资产（软删除）。",
  "GET /api/assets/{asset_id}/detail": "资产完整画像。重新解析原始文件，返回字段画像、知识图谱、洞察结论、关系边与预览行。",
  "GET /api/assets/{asset_id}/preview": "资产数据预览。返回原始文件前 limit 行数据与数据字典（默认 25 行）。",
  "GET /api/asset-library": "资产库。合并返回数据资产与策略资产（含确认策略与模板），按创建时间倒序。",

  // 数据连接
  "GET /api/datasources/supported": "支持的数据库类型。返回连接串提示、数据库种类（mysql/postgresql/sqlite/clickhouse/mssql/duckdb）与展示名称。",
  "GET /api/datasources": "数据连接列表。返回当前项目未删除的连接。",
  "POST /api/datasources/test": "测试数据库连接。探测连接串是否可用，返回数据库种类与表清单。",
  "POST /api/datasources": "创建数据连接。探测连接、读取表清单，屏蔽敏感连接串后持久化，凭据单独加密存储。",
  "GET /api/datasources/{datasource_id}": "数据连接详情。",
  "PUT /api/datasources/{datasource_id}": "更新数据连接。可改名称与连接串；连接串留空或含 *** 时复用已存凭据刷新表清单。",
  "DELETE /api/datasources/{datasource_id}": "删除数据连接（软删除，已生成资产保留）。",
  "GET /api/datasources/{datasource_id}/tables": "连接表清单。返回该连接下的数据库表名列表。",
  "POST /api/datasources/{datasource_id}/assets": "批量资产化。将选中数据表抽样导出并解析为数据资产，已存在同名表资产时直接复用。",

  // 标签
  "GET /api/tags": "标签列表。按树形路径排序返回，自动保证系统根标签 public 存在。",
  "POST /api/tags": "创建标签。支持指定父级形成层级路径，同级与路径冲突返回 409。",
  "PATCH /api/tags/{tag_id}": "更新标签。可改名、移动父级（move_parent），并自动重写后代路径与资产引用。",
  "DELETE /api/tags/{tag_id}": "删除标签。系统根标签 public 不可删除；删除时自动解绑关联资产并至少保留 public。",

  // 数据集
  "GET /api/datasets": "数据集列表。按更新时间倒序返回当前项目的数据集。",
  "POST /api/datasets": "创建数据集。聚合多个数据资产，可附带描述与标签。",
  "GET /api/datasets/{dataset_id}": "数据集详情。返回数据集及其包含的资产列表，缺失资产单独标注。",
  "PATCH /api/datasets/{dataset_id}": "更新数据集。可改名称、描述、资产列表与标签。",
  "POST /api/datasets/{dataset_id}/assets": "维护数据集资产。支持 add / remove / replace 三种模式增删改资产成员。",
  "DELETE /api/datasets/{dataset_id}": "删除数据集（软删除）。",

  // 策略资产
  "GET /api/strategy-assets": "策略资产列表。合并返回已确认策略与策略模板，按创建时间倒序。",
  "POST /api/strategy-assets/from-markdown": "从 Markdown 创建策略模板。自动抽取分析步骤、维度与指标。",
  "PATCH /api/strategy-assets/{strategy_id}": "更新策略资产。策略模板与已确认策略均支持按标题/Markdown 更新并重新抽取结构化信息。",
  "DELETE /api/strategy-assets/{strategy_id}": "删除策略资产（策略模板或已确认策略）。",
  "POST /api/strategy-assets/polish": "润色策略。将标题与 Markdown 重组为规范化策略文档，返回结构化步骤/维度/指标。",
  "POST /api/strategy-assets/merge": "合并策略。将多个策略资产合并为一个新策略模板，去重步骤、维度与指标。",

  // 任务与执行
  "POST /api/tasks": "创建分析任务。生成策略草稿（Planner 结合资产画像、模板与历史反馈），任务进入等待确认状态。",
  "GET /api/tasks/{task_id}": "任务时间线。返回任务、策略、执行结果、图表与反馈快照，以及当前进度状态。",
  "GET /api/tasks/{task_id}/events": "任务进度事件流（SSE）。按行推送 data: 事件，用于前端展示任务进行中的阶段。",
  "POST /api/tasks/{task_id}/feedback": "任务反馈。对任务结果点赞（up）或点踩（down），附可选备注，快照存为 TaskFeedback。",
  "POST /api/tasks/{task_id}/strategy/confirm": "确认策略并执行。校验策略归属后运行 Coder/Analyzer 生成代码、沙箱执行，写回任务、执行记录、图表与助手消息。",
  "POST /api/executions": "重跑代码执行。以指定资产路径与代码在沙箱中重新执行，返回 ExecutionResult 并刷新任务状态与图表快照。",

  // 知识检索
  "POST /api/rag/context": "RAG 上下文检索。基于查询与资产列表从知识库检索相关分片，结果缓存 120 秒。",

  // 购物车与报告
  "POST /api/cart-items": "加入报告购物车。将策略/执行/图表等模块快照加入购物车，供生成报告使用。",
  "GET /api/cart-items": "购物车列表。按 sort_order 返回指定会话的购物车项。",
  "POST /api/reports": "创建报告。由购物车项经 Report Agent 编排生成 Markdown 与 HTML 版本。",
  "POST /api/reports/from-module": "从单个模块创建报告。以某一报告模块为起点直接生成报告。",
  "POST /api/reports/{report_id}/items": "追加报告模块。在最新版本快照上追加新模块并生成新版本。",
  "GET /api/reports": "报告列表。支持关键字与分页，按创建时间倒序。",
  "GET /api/reports/{report_id}": "报告详情。返回报告、会话、最新版本与富化后的模块列表（含任务/策略/执行上下文）。",
  "PATCH /api/reports/{report_id}": "更新报告。修改报告标题（不可为空），并写入 report.update 审计日志。",
  "POST /api/reports/{report_id}/strategy": "从报告生成综合策略。基于报告模块内容由 LLM 生成可执行分析策略并保存为模板。",
  "DELETE /api/reports/{report_id}/items/{module_id}": "删除报告模块。从最新版本移除模块并生成新版本。",
  "POST /api/reports/{report_id}/items/{module_id}/run": "重跑报告模块。重放模块关联任务代码，刷新模块快照中的表格、图表与执行信息。",
  "GET /api/reports/{report_id}/versions": "报告版本列表。",
  "GET /api/reports/{report_id}/versions/{version}/download": "下载报告版本。支持 markdown 与 html 两种格式，返回文件流。",
  "DELETE /api/reports/{report_id}": "删除报告（软删除）。",

  // 模型配置
  "GET /api/model-config": "获取模型配置。返回全局默认模型、各 Agent 指派、参数与模型目录（API Key 脱敏）。",
  "PUT /api/model-config": "更新模型配置。支持保留/覆盖/清除（__CLEAR__）API Key，并自动补全默认模型目录。",
  "GET /api/models": "模型列表。返回模型目录与网关配置状态，支持 enabled_only 过滤已启用模型。",

  // 看板
  "POST /api/dashboards": "创建看板。包含页面参数、刷新间隔与分享令牌。",
  "GET /api/dashboards": "看板列表。返回当前项目的全部看板。",
  "POST /api/dashboards/{dashboard_id}/items": "看板固定图表。将某次执行的图表固定到看板，同时生成可参数化的查询绑定。",
  "POST /api/query-bindings/{binding_id}/execute": "执行查询绑定。按参数执行绑定并返回图表结果，结果按参数哈希缓存。",
};

function groupOf(path: string): ApiGroup {
  return API_GROUPS.find((group) => group.match(path)) || FALLBACK_GROUP;
}

/* ------------------------------------------------------------------ */
/* OpenAPI schema 解析助手                                              */
/* ------------------------------------------------------------------ */

function resolveSchema(spec: OpenApiSpec, schema: OpenApiSchema | undefined): OpenApiSchema | undefined {
  if (!schema) return undefined;
  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    return spec.components?.schemas?.[name];
  }
  if (schema.allOf) {
    const merged: OpenApiSchema = { type: "object", properties: {}, required: [] };
    for (const part of schema.allOf) {
      const resolved = resolveSchema(spec, part);
      if (!resolved) continue;
      merged.properties = { ...merged.properties, ...(resolved.properties || {}) };
      merged.required = [...(merged.required || []), ...(resolved.required || [])];
    }
    return merged;
  }
  return schema;
}

function schemaName(spec: OpenApiSpec, schema: OpenApiSchema | undefined): string {
  if (!schema) return "—";
  if (schema.$ref) return schema.$ref.replace("#/components/schemas/", "");
  if (schema.allOf) return (schema.allOf.map((part) => schemaName(spec, part)).filter(Boolean) as string[]).join(" + ");
  if (schema.type === "array") return `Array<${schemaName(spec, schema.items)}>`;
  if (schema.enum) return `${schema.type || "enum"}(${schema.enum.join(" | ")})`;
  return schema.type || schema.title || "any";
}

function schemaSummary(spec: OpenApiSpec, schema: OpenApiSchema | undefined, depth = 0): string {
  const resolved = resolveSchema(spec, schema);
  if (!resolved) return "";
  if (resolved.type === "object" && resolved.properties) {
    const entries = Object.entries(resolved.properties);
    const max = depth === 0 ? 14 : 6;
    const shown = entries.slice(0, max);
    const parts = shown.map(([name, prop]) => {
      const required = resolved.required?.includes(name) ? "" : "?";
      const propName = schemaName(spec, prop);
      const nested = prop.type === "object" && prop.properties ? schemaSummary(spec, prop, depth + 1) : "";
      return `${name}${required}: ${propName}${nested ? ` ${nested}` : ""}`;
    });
    if (entries.length > shown.length) parts.push(`…共 ${entries.length} 个字段`);
    return `{ ${parts.join(" · ")} }`;
  }
  if (resolved.type === "array") {
    const item = schemaSummary(spec, resolved.items, depth + 1);
    return `Array<${item || schemaName(spec, resolved.items)}>`;
  }
  return schemaName(spec, resolved);
}

function paramsOf(operation: OpenApiOperation): OpenApiParameter[] {
  return operation.parameters || [];
}

function requestBodyOf(spec: OpenApiSpec, operation: OpenApiOperation): { name: string; summary: string } | null {
  const content = operation.requestBody?.content;
  const media = content?.["application/json"];
  const schema = media?.schema;
  if (!schema) return null;
  const name = schemaName(spec, schema);
  return { name, summary: schemaSummary(spec, schema) };
}

function responseOf(spec: OpenApiSpec, operation: OpenApiOperation): { status: string; summary: string } | null {
  const responses = operation.responses || {};
  const status = Object.keys(responses).find((key) => key.startsWith("2")) || Object.keys(responses)[0];
  if (!status) return null;
  const response = responses[status];
  const schema = response?.content?.["application/json"]?.schema;
  if (!schema) return { status, summary: "" };
  return { status, summary: schemaSummary(spec, schema) };
}

function curlOf(method: string, path: string, base: string): string {
  const readable = path.replace(/\{([^}]+)\}/g, ":$1");
  const hasBody = ["POST", "PUT", "PATCH"].includes(method);
  const bodyArg = hasBody ? ` -H "Content-Type: application/json" -d '{}'` : "";
  return `curl -X ${method} "${base}${readable}"${bodyArg}`;
}

/* ------------------------------------------------------------------ */
/* 页面                                                                */
/* ------------------------------------------------------------------ */

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type MethodFilter = (typeof METHODS)[number] | "ALL";

export default function HelpPage() {
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [notice, setNotice] = useState("加载中");
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [methodFilter, setMethodFilter] = useState<MethodFilter>("ALL");
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  async function refresh() {
    setLoading(true);
    setNotice("加载中");
    try {
      const [openapi, healthResult] = await Promise.all([api.openapi(), api.health()]);
      setSpec(openapi);
      setHealth(healthResult);
      setNotice(healthResult.status === "ok" ? "已连接 API 服务" : "API 服务状态异常");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "接口文档加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const endpoints = useMemo(() => {
    if (!spec) return [];
    const result: Array<{
      key: string;
      method: string;
      path: string;
      description: string;
      operation: OpenApiOperation;
      group: ApiGroup;
    }> = [];
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const upper = method.toUpperCase();
        if (!METHODS.includes(upper as (typeof METHODS)[number])) continue;
        result.push({
          key: `${upper} ${path}`,
          method: upper,
          path,
          description: API_DESCRIPTIONS[`${upper} ${path}`] || operation.summary || operation.description || "（暂无说明）",
          operation,
          group: groupOf(path),
        });
      }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }, [spec]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof endpoints>();
    for (const endpoint of endpoints) {
      const key = endpoint.group.key;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(endpoint);
    }
    return API_GROUPS.map((group) => ({
      group,
      items: map.get(group.key) || [],
    })).filter((entry) => entry.items.length > 0);
  }, [endpoints]);

  const filteredGroups = useMemo(() => {
    const lower = keyword.trim().toLowerCase();
    const methodOk = (method: string) => methodFilter === "ALL" || method === methodFilter;
    if (!lower && methodFilter === "ALL") return grouped;
    return grouped
      .map((entry) => ({
        group: entry.group,
        items: entry.items.filter((item) => {
          const text = `${item.method} ${item.path} ${item.description}`.toLowerCase();
          return text.includes(lower) && methodOk(item.method);
        }),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [grouped, keyword, methodFilter]);

  const totalCount = endpoints.length;
  const methodCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of endpoints) counts[item.method] = (counts[item.method] || 0) + 1;
    return counts;
  }, [endpoints]);

  const toggleGroup = (key: string) =>
    setExpandedGroups((state) => ({ ...state, [key]: !state[key] }));

  async function copyCurl(method: string, path: string) {
    const text = curlOf(method, path, api.base);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${method} ${path}`);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard 不可用时静默失败 */
    }
  }

  return (
    <main className="detailPage helpPage">
      <header className="detailTopbar">
        <a className="linkButton" href="/workspace"><ArrowLeft size={16} /> 返回工作台</a>
        <div className="helpTopbarActions">
          <a className="linkButton" href={`${api.base}/docs`} target="_blank" rel="noreferrer">
            <BookOpen size={15} /> Swagger UI
          </a>
          <a className="linkButton" href={`${api.base}/openapi.json`} target="_blank" rel="noreferrer">
            OpenAPI 原文
          </a>
          <button onClick={() => void refresh()}><RefreshCw size={15} /> 刷新</button>
        </div>
      </header>

      <section className="detailHero helpHero">
        <div>
          <Info size={26} />
          <h1>后端接口文档</h1>
          <p>
            {spec ? `${spec.info.title} · v${spec.info.version} · ${api.base}` : "正在从 API 服务加载 OpenAPI 规范…"}
            {" · "}
            {notice}
          </p>
          {health ? (
            <div className="helpHealthRow">
              <span className={health.status === "ok" ? "healthChip ok" : "healthChip bad"}>
                <HeartPulse size={13} /> {health.status === "ok" ? "服务正常" : "服务异常"}
              </span>
              <span className="healthChip">项目 {health.project_id}</span>
              <span className="healthChip">存储 {health.stack.store}{health.stack.store_ok ? "" : "（异常）"}</span>
              <span className="healthChip">向量 {health.stack.vector_backend}</span>
              <span className="healthChip">Redis {health.stack.redis ? "✓" : "✗"}</span>
              <span className="healthChip">Neo4j {health.stack.neo4j ? "✓" : "✗"}</span>
            </div>
          ) : null}
          <div className="helpStatRow">
            <span><strong>{totalCount}</strong> 个接口</span>
            <span><strong>{grouped.length}</strong> 个分组</span>
            {METHODS.map((method) => (
              <span key={method}><strong>{methodCounts[method] || 0}</strong> {method}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="helpToolbar">
        <label className="helpSearch">
          <Search size={16} />
          <input
            value={keyword}
            placeholder="搜索接口路径、方法或说明，例如 sessions / 报告 / confirm"
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword ? (
            <button className="helpSearchClear" title="清空" onClick={() => setKeyword("")}>
              <X size={14} />
            </button>
          ) : null}
        </label>
        <div className="helpMethodFilter" role="group" aria-label="按请求方法筛选">
          <button
            className={methodFilter === "ALL" ? "methodFilterChip active" : "methodFilterChip"}
            onClick={() => setMethodFilter("ALL")}
          >
            全部
          </button>
          {METHODS.map((method) => (
            <button
              key={method}
              className={methodFilter === method ? `methodFilterChip active method-${method.toLowerCase()}` : "methodFilterChip"}
              onClick={() => setMethodFilter(methodFilter === method ? "ALL" : method)}
            >
              {method} <small>{methodCounts[method] || 0}</small>
            </button>
          ))}
        </div>
      </section>

      {loading && !spec ? (
        <section className="detailPanel helpEmpty">正在加载接口规范…</section>
      ) : !spec ? (
        <section className="detailPanel helpEmpty">
          <p>无法获取接口文档：{notice}</p>
          <p>请确认 API 服务（{api.base}）已启动，然后重试。</p>
          <button className="confirmButton" onClick={() => void refresh()}><RefreshCw size={15} /> 重试</button>
        </section>
      ) : filteredGroups.length === 0 ? (
        <section className="detailPanel helpEmpty">
          <p>没有匹配「{keyword || methodFilter}」的接口，换个关键字试试。</p>
        </section>
      ) : (
        filteredGroups.map(({ group, items }) => {
          const Icon = group.icon;
          const collapsed = expandedGroups[group.key];
          return (
            <section key={group.key} className="detailPanel helpGroup">
              <button className="helpGroupHeader" onClick={() => toggleGroup(group.key)}>
                <Icon size={17} />
                <div>
                  <h2>{group.label}</h2>
                  <p>{group.hint}</p>
                </div>
                <span className="helpGroupCount">{items.length}</span>
                <span className="helpGroupToggle">{collapsed ? "展开" : "收起"}</span>
              </button>
              {!collapsed ? (
                <div className="helpEndpointList">
                  {items.map((item) => (
                    <EndpointCard
                      key={item.key}
                      spec={spec}
                      method={item.method}
                      path={item.path}
                      description={item.description}
                      operation={item.operation}
                      copied={copied === item.key}
                      onCopy={() => void copyCurl(item.method, item.path)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })
      )}

      <footer className="helpFooter">
        接口信息由 FastAPI 自动生成的 OpenAPI 规范实时提供；说明文字来自对后端路由的人工整理，若与实际行为不一致以代码为准。
      </footer>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* 单条接口卡片                                                        */
/* ------------------------------------------------------------------ */

function EndpointCard({
  spec,
  method,
  path,
  description,
  operation,
  copied,
  onCopy,
}: {
  spec: OpenApiSpec;
  method: string;
  path: string;
  description: string;
  operation: OpenApiOperation;
  copied: boolean;
  onCopy: () => void;
}) {
  const params = paramsOf(operation);
  const requestBody = requestBodyOf(spec, operation);
  const response = responseOf(spec, operation);
  const hasDetail = params.length > 0 || requestBody || response;

  return (
    <article className="helpEndpointCard">
      <div className="helpEndpointMain">
        <div className="helpEndpointPathRow">
          <span className={`methodBadge method-${method.toLowerCase()}`}>{method}</span>
          <code className="helpEndpointPath">{path}</code>
          <button className="helpCopyButton" title="复制 curl 命令" onClick={onCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? "已复制" : "curl"}</span>
          </button>
        </div>
        <p className="helpEndpointDesc">{description}</p>
        {operation.deprecated ? <em className="helpDeprecated">已废弃</em> : null}
      </div>

      {hasDetail ? (
        <div className="helpEndpointMeta">
          {params.length > 0 ? (
            <div className="helpMetaBlock">
              <span className="helpMetaLabel">参数</span>
              <div className="helpParamChips">
                {params.map((param) => (
                  <span key={`${param.in}-${param.name}`} className={`paramChip param-${param.in}`} title={param.description || ""}>
                    {param.in === "path" ? "路径" : param.in} · {param.name}
                    {param.required ? "" : "?"}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {requestBody ? (
            <div className="helpMetaBlock">
              <span className="helpMetaLabel">请求体</span>
              <code className="helpSchemaLine">{requestBody.name}</code>
              {requestBody.summary ? <span className="helpSchemaDetail">{requestBody.summary}</span> : null}
            </div>
          ) : null}
          {response ? (
            <div className="helpMetaBlock">
              <span className="helpMetaLabel">响应 {response.status}</span>
              {response.summary ? <code className="helpSchemaLine">{response.summary}</code> : <span className="helpSchemaDetail">文件流 / 事件流 / 无 JSON 响应体</span>}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
