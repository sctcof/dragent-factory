"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Database,
  FilePlus2,
  FileText,
  GitBranch,
  Grid3X3,
  LayoutDashboard,
  LineChart,
  Layers,
  Paperclip,
  Pencil,
  PieChart,
  Play,
  RefreshCw,
  Send,
  ShoppingCart,
  Table2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X
} from "lucide-react";
import {
  api,
  type ApiTaskBundle,
  type Asset,
  type CartItem,
  type ChartConfig,
  type Dashboard,
  type ExecutionResult,
  type Report,
  type RagContextItem,
  type Session,
  type StrategyAsset,
  type Strategy,
  type TaskFeedback,
  type TimelineItem
} from "../lib/api";
import { ChartPanel, DataTable } from "../components/ChartPanel";
import { StrategyFlow } from "../components/StrategyFlow";

type ReportModuleDraft = {
  session_id: string;
  type: string;
  ref_id: string;
  title: string;
  snapshot: Record<string, unknown>;
};

function collectFieldOptions(assets: Asset[], assetIds: string[], logicalTypes: string[]) {
  const names = assets
    .filter((asset) => assetIds.includes(asset.id))
    .flatMap((asset) => asset.data_dictionary?.columns || [])
    .filter((column) => logicalTypes.includes(column.logical_type))
    .map((column) => column.name);
  return Array.from(new Set(names));
}

const CHART_TYPE_OPTIONS = [
  { type: "line", label: "曲线图", icon: LineChart },
  { type: "bar", label: "柱状图", icon: BarChart3 },
  { type: "pie", label: "饼图", icon: PieChart },
  { type: "heatmap", label: "热力图", icon: Grid3X3 },
];

export default function WorkspacePage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [strategyAssets, setStrategyAssets] = useState<StrategyAsset[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("分析销售金额按月份和区域的变化，并找出主要贡献项");
  const [strategyDrafts, setStrategyDrafts] = useState<Record<string, Strategy>>({});
  const [codeDrafts, setCodeDrafts] = useState<Record<string, string>>({});
  const [expandedCode, setExpandedCode] = useState<Record<string, boolean>>({});
  const [pendingReportModule, setPendingReportModule] = useState<ReportModuleDraft | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [strategyPickerOpen, setStrategyPickerOpen] = useState(false);
  const [strategyListOpen, setStrategyListOpen] = useState(false);
  const [assetDraftSelection, setAssetDraftSelection] = useState<string[]>([]);
  const [selectedStrategyAssets, setSelectedStrategyAssets] = useState<string[]>([]);
  const [strategyPreview, setStrategyPreview] = useState<StrategyAsset | null>(null);
  const [ragContext, setRagContext] = useState<RagContextItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("准备就绪");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const sessionId = search?.get("session_id") || undefined;
    const assetIds = (search?.get("asset_ids") || "").split(",").filter(Boolean);
    const initialPrompt = search?.get("prompt") || "";
    if (initialPrompt) setPrompt(initialPrompt);
    refreshBootstrap(sessionId, assetIds, initialPrompt);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [timeline, busy]);

  async function refreshBootstrap(preferredSessionId?: string, preferredAssetIds: string[] = [], preferredPrompt = "") {
    const data = await api.bootstrap();
    setSessions(data.sessions || []);
    setAssets(data.assets || []);
    setReports(Array.isArray(data.reports) ? data.reports : data.reports.items || []);
    setDashboards(data.dashboards || []);
    const library = await api.assetLibrary();
    setAssets(library.data_assets);
    setStrategyAssets(library.strategy_assets);
    const nextSession = data.sessions.find((item) => item.id === preferredSessionId) || activeSession || data.sessions?.[0] || null;
    if (nextSession) {
      await openSession(nextSession, preferredAssetIds, preferredPrompt);
    }
  }

  async function openSession(session: Session, preferredAssetIds: string[] = [], preferredPrompt = "") {
    setActiveSession(session);
    setTitleDraft(session.title);
    setEditingTitle(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("session_id", session.id);
      window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
    }
    const replay = await api.replaySession(session.id);
    setTimeline(replay.timeline);
    setCart(await api.cartItems(session.id));
    const drafts: Record<string, Strategy> = {};
    const codes: Record<string, string> = {};
    let restoredAssetIds: string[] = [];
    replay.timeline.forEach((item) => {
      if (item.type === "task") {
        if (item.strategy) drafts[item.task.id] = item.strategy;
        if (item.task.generated_code) codes[item.task.id] = item.task.generated_code;
        if (item.task.selected_assets.length) restoredAssetIds = item.task.selected_assets;
      }
    });
    setStrategyDrafts(drafts);
    setCodeDrafts(codes);
    const nextAssetIds = preferredAssetIds.length ? preferredAssetIds : restoredAssetIds;
    setSelectedAssets(nextAssetIds);
    await loadRagContext(nextAssetIds, preferredPrompt || prompt);
    if (preferredAssetIds.length) setNotice(`已带入 ${preferredAssetIds.length} 个数据资产，可开始联合分析`);
  }

  async function ensureSession() {
    if (activeSession) return activeSession;
    const created = await api.createSession("商业数据诊断");
    setSessions((items) => [created, ...items]);
    setActiveSession(created);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("session_id", created.id);
      window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
    }
    setTimeline([]);
    return created;
  }

  async function newSession() {
    const created = await api.createSession("新的分析会话");
    setSessions((items) => [created, ...items]);
    setActiveSession(created);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("session_id", created.id);
      window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
    }
    setTimeline([]);
    setCart([]);
    setNotice("新会话已创建");
  }

  async function cloneActiveSession() {
    if (!activeSession) return;
    setBusy(true);
    setNotice("正在复制会话上下文");
    try {
      const cloned = await api.cloneSession(activeSession.id, `${activeSession.title} 续聊`);
      setSessions((items) => [cloned, ...items.filter((item) => item.id !== cloned.id)]);
      await openSession(cloned);
      setNotice("已复制为新的可编辑会话，可以继续对话");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "复制会话失败");
    } finally {
      setBusy(false);
    }
  }

  async function upload(files?: FileList | File[]) {
    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    setBusy(true);
    const uploadedAssets: Asset[] = [];
    const failedFiles: string[] = [];
    try {
      for (const [index, file] of selectedFiles.entries()) {
        setNotice(`正在上传并解析 ${index + 1}/${selectedFiles.length}：${file.name}`);
        try {
          uploadedAssets.push(await api.uploadAsset(file));
        } catch {
          failedFiles.push(file.name);
        }
      }
      if (uploadedAssets.length) {
        const uploadedIds = uploadedAssets.map((asset) => asset.id);
        setAssets((items) => [
          ...uploadedAssets,
          ...items.filter((item) => !uploadedIds.includes(item.id))
        ]);
        const nextAssets = Array.from(new Set([...selectedAssets, ...uploadedIds]));
        setSelectedAssets(nextAssets);
        await loadRagContext(nextAssets, prompt);
      }
      if (failedFiles.length) {
        setNotice(`成功接入 ${uploadedAssets.length} 个数据集，${failedFiles.length} 个失败：${failedFiles.join("、")}`);
      } else {
        setNotice(`已接入并选中 ${uploadedAssets.length} 个数据集，可直接进行联合分析`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "批量上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendPrompt() {
    const text = prompt.trim();
    if (!text || busy) return;
    if (activeSession?.archived_at) {
      setNotice("该会话已关闭，只能查看历史内容");
      return;
    }
    const session = await ensureSession();
    const taskAssetIds = resolvePromptAssetIds(text);
    if (!taskAssetIds.length) {
      setNotice("请在问题中输入资产名称/表名，或点击回形针上传新数据");
      return;
    }
    setBusy(true);
    setNotice("Planner Agent 正在生成本轮策略");
    try {
      const task = await api.createTaskWithStrategies(session.id, text, taskAssetIds, selectedStrategyAssets);
      const bundle = await api.getTask(task.id);
      setSelectedAssets(taskAssetIds);
      setTimeline((items) => [
        ...items,
        { type: "message", id: `local_${task.id}`, session_id: session.id, role: "user", content: text, task_id: task.id, created_at: new Date().toISOString() },
        bundle
      ]);
      if (bundle.strategy) setStrategyDrafts((items) => ({ ...items, [task.id]: bundle.strategy! }));
      setPrompt("");
      setNotice("策略书已返回，请在对话中确认或修改");
      await refreshCart(session.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }

  async function loadRagContext(assetIds = selectedAssets, query = prompt) {
    if (!assetIds.length) {
      setRagContext([]);
      return;
    }
    try {
      const context = await api.ragContext(query, assetIds, 8);
      setRagContext(context.items);
    } catch {
      setRagContext([]);
    }
  }

  function openAssetPicker() {
    setAssetDraftSelection(selectedAssets);
    setAssetPickerOpen(true);
    setAttachMenuOpen(false);
  }

  async function confirmAssetSelection() {
    setSelectedAssets(assetDraftSelection);
    setAssetPickerOpen(false);
    await loadRagContext(assetDraftSelection, prompt);
    setNotice(assetDraftSelection.length ? "已选择数据资产并补充 RAG 上下文" : "已清空数据资产选择");
  }

  function triggerUpload() {
    setAttachMenuOpen(false);
    fileInputRef.current?.click();
  }

  function toggleSelectedStrategy(strategyId: string) {
    setSelectedStrategyAssets((items) =>
      items.includes(strategyId) ? items.filter((id) => id !== strategyId) : [...items, strategyId]
    );
  }

  async function rateTask(bundle: ApiTaskBundle, rating: "up" | "down") {
    const feedback = await api.rateTask(bundle.task.id, rating);
    setTimeline((items) =>
      items.map((item) => (item.type === "task" && item.task.id === bundle.task.id ? { ...item, feedback } : item))
    );
    setNotice(rating === "up" ? "已点赞，本轮结果会用于后续策略生成" : "已点踩，后续策略会降低参考权重");
  }

  function resolvePromptAssetIds(text: string) {
    const normalized = text.toLowerCase();
    const matched = new Set<string>();
    if (/(所有数据|全部数据|全部资产|多张表|多个数据集|全量)/.test(text)) {
      assets.forEach((asset) => matched.add(asset.id));
    }
    assets.forEach((asset) => {
      const candidates = [
        asset.id,
        asset.name,
        asset.name.split("/")[0]?.trim(),
        asset.data_dictionary?.table_name,
      ].filter(Boolean).map((item) => String(item).toLowerCase());
      if (candidates.some((candidate) => candidate && normalized.includes(candidate))) {
        matched.add(asset.id);
      }
    });
    const picked = matched.size ? matched : new Set(selectedAssets);
    return Array.from(picked).filter((assetId) => assets.some((asset) => asset.id === assetId));
  }

  async function saveSessionTitle() {
    if (!activeSession) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setNotice("会话标题不能为空");
      return;
    }
    setBusy(true);
    try {
      const updated = await api.updateSession(activeSession.id, { title: nextTitle });
      setActiveSession(updated);
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setEditingTitle(false);
      setNotice("会话标题已更新");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "标题更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmStrategy(bundle: ApiTaskBundle) {
    const draft = strategyDrafts[bundle.task.id] || bundle.strategy;
    if (!draft || busy) return;
    setBusy(true);
    setNotice("策略已确认，正在生成代码、执行并返回图表");
    try {
      const nextBundle = await api.confirmStrategy(bundle.task.id, draft);
      updateTaskBundle(nextBundle);
      if (nextBundle.task.generated_code) setCodeDrafts((items) => ({ ...items, [nextBundle.task.id]: nextBundle.task.generated_code! }));
      setNotice(nextBundle.execution?.status === "success" ? "本轮分析完成" : "本轮执行失败，可在对话内修改代码重跑");
      if (activeSession) await refreshCart(activeSession.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "策略确认失败");
    } finally {
      setBusy(false);
    }
  }

  async function rerunCode(bundle: ApiTaskBundle) {
    const code = codeDrafts[bundle.task.id] || bundle.task.generated_code || "";
    if (!code || busy) return;
    setBusy(true);
    setNotice("正在运行修改后的代码");
    try {
      await api.rerunCode(bundle.task.id, code, bundle.task.selected_assets);
      const nextBundle = await api.getTask(bundle.task.id);
      updateTaskBundle(nextBundle);
      setNotice(nextBundle.execution?.status === "success" ? "修改后的代码运行成功" : "修改后的代码运行失败");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "运行失败");
    } finally {
      setBusy(false);
    }
  }

  function updateTaskBundle(nextBundle: ApiTaskBundle) {
    setTimeline((items) => items.map((item) => (item.type === "task" && item.task.id === nextBundle.task.id ? nextBundle : item)));
  }

  async function addToCart(type: string, ref_id: string, title: string, snapshot: Record<string, unknown>) {
    const session = await ensureSession();
    await api.addCart({ session_id: session.id, type, ref_id, title, snapshot });
    await refreshCart(session.id);
    setNotice(`${title} 已加入报告购物车`);
  }

  function requestAddToReport(module: ReportModuleDraft) {
    setPendingReportModule(module);
  }

  async function addModuleToReport(reportId?: string, title?: string) {
    if (!pendingReportModule) return;
    setBusy(true);
    try {
      const payload = {
        session_id: pendingReportModule.session_id,
        type: pendingReportModule.type,
        ref_id: pendingReportModule.ref_id,
        title: pendingReportModule.title,
        snapshot: pendingReportModule.snapshot,
      };
      const report = reportId
        ? await api.appendReportItem(reportId, payload)
        : await api.createReportFromModule({ ...payload, report_title: title || `${pendingReportModule.title} 报告` });
      setReports((items) => [report, ...items.filter((item) => item.id !== report.id)]);
      setPendingReportModule(null);
      setNotice(reportId ? "已加入历史报告" : "已创建新报告");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "加入报告失败");
    } finally {
      setBusy(false);
    }
  }

  async function refreshCart(sessionId = activeSession?.id) {
    if (!sessionId) return;
    setCart(await api.cartItems(sessionId));
  }

  async function makeReport() {
    const session = await ensureSession();
    if (!cart.length) {
      setNotice("报告购物车为空，请先在某轮结果里加入片段");
      return;
    }
    const report = await api.createReport(session.id, cart.map((item) => item.id), `${session.title} 报告`);
    setReports((items) => [report, ...items]);
    setNotice("报告已生成");
  }

  async function removeAsset(assetId: string) {
    await api.deleteAsset(assetId);
    setAssets((items) => items.filter((item) => item.id !== assetId));
    setSelectedAssets((items) => items.filter((id) => id !== assetId));
    setNotice("数据资产已删除");
  }

  async function removeStrategyAsset(strategyId: string) {
    await api.deleteStrategyAsset(strategyId);
    setStrategyAssets((items) => items.filter((item) => item.id !== strategyId));
    setNotice("策略资产已删除");
  }

  async function removeReport(reportId: string) {
    await api.deleteReport(reportId);
    setReports((items) => items.filter((item) => item.id !== reportId));
    setNotice("报告已删除");
  }

  async function pinChart(bundle: ApiTaskBundle, chart: ChartConfig) {
    const executionId = bundle.execution?.execution_id;
    if (!executionId) return;
    const dashboard = dashboards[0] || (await api.createDashboard("经营活性看板"));
    const updated = await api.pinChart(dashboard.id, chart.id, executionId);
    setDashboards((items) => [updated, ...items.filter((item) => item.id !== updated.id)]);
    setNotice("图表已钉到活性看板");
  }

  const selectedAssetModels = useMemo(
    () => assets.filter((asset) => selectedAssets.includes(asset.id)),
    [assets, selectedAssets]
  );
  const selectedStrategyModels = useMemo(
    () => strategyAssets.filter((strategy) => selectedStrategyAssets.includes(strategy.id)),
    [strategyAssets, selectedStrategyAssets]
  );
  const sessionStrategyBundles = useMemo(
    () => timeline.filter((item): item is ApiTaskBundle => item.type === "task" && Boolean(strategyDrafts[item.task.id] || item.strategy)),
    [timeline, strategyDrafts]
  );
  const latestAssets = [...assets].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 3);
  const latestStrategies = [...strategyAssets].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);
  const latestSessions = [...sessions].sort((a, b) => String(b.last_active_at || "").localeCompare(String(a.last_active_at || ""))).slice(0, 3);
  const activeSessionClosed = Boolean(activeSession?.archived_at);
  const toggleSection = (key: string) => setCollapsedSections((items) => ({ ...items, [key]: !items[key] }));

  return (
    <main className="chatShell">
      <aside className="rail">
        <div className="brand">
          <Bot size={22} />
          <div>
            <strong>Data-RAG-Agent</strong>
            <span>多轮数据诊断</span>
          </div>
        </div>

        <button className="primaryButton" onClick={newSession}>
          <FilePlus2 size={16} /> 新会话
        </button>

        <section className="railSection">
          <h2>会话</h2>
          <div className="railList">
            {latestSessions.map((session) => (
              <button key={session.id} className={session.id === activeSession?.id ? "railItem active" : "railItem"} onClick={() => openSession(session)}>
                <span>{session.title}</span>
                <small>{session.last_active_at.slice(0, 10)}</small>
              </button>
            ))}
            <a className="railMore" href="/sessions">更多会话</a>
          </div>
        </section>

        <section className="railSection">
          <button className="railSectionHeader" onClick={() => toggleSection("dataAssets")}>
            <span>数据资产</span>
            <ChevronDown size={14} className={collapsedSections.dataAssets ? "chevron closed" : "chevron"} />
          </button>
          {!collapsedSections.dataAssets ? <div className="railList">
            {latestAssets.map((asset) => (
              <div key={asset.id} className="assetRow">
                <a className="strategyLink" href={`/assets/${asset.id}`}>
                  <Database size={14} />
                  <span>{asset.name}</span>
                </a>
                <button className="railIconButton" title="删除数据资产" onClick={() => removeAsset(asset.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <a className="railMore" href="/data-assets">更多数据资产</a>
          </div> : null}
        </section>

        <section className="railSection">
          <button className="railSectionHeader" onClick={() => toggleSection("strategyAssets")}>
            <span>策略资产</span>
            <ChevronDown size={14} className={collapsedSections.strategyAssets ? "chevron closed" : "chevron"} />
          </button>
          {!collapsedSections.strategyAssets ? <div className="railList">
            {latestStrategies.map((strategy) => (
              <div key={strategy.id} className="assetRow">
                <button className="strategyLink" onClick={() => setStrategyPreview(strategy)}>
                  <GitBranch size={14} />
                  <span>{strategy.title}</span>
                </button>
                <button className="railIconButton" title="删除策略资产" onClick={() => removeStrategyAsset(strategy.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <a className="railMore" href="/strategies">更多策略资产</a>
          </div> : null}
        </section>

      </aside>

      <section className="chatPane">
        <header className="chatHeader">
          <div>
            {editingTitle ? (
              <div className="titleEditor">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveSessionTitle();
                    if (event.key === "Escape") {
                      setEditingTitle(false);
                      setTitleDraft(activeSession?.title || "");
                    }
                  }}
                  autoFocus
                />
                <button className="iconOnly" title="保存标题" disabled={busy} onClick={saveSessionTitle}><Check size={16} /></button>
                <button className="iconOnly" title="取消编辑" onClick={() => { setEditingTitle(false); setTitleDraft(activeSession?.title || ""); }}><X size={16} /></button>
              </div>
            ) : (
              <div className="titleLine">
                <h1>{activeSession?.title || "商业数据诊断"}</h1>
                <button className="iconOnly" title="编辑会话标题" disabled={!activeSession} onClick={() => { setTitleDraft(activeSession?.title || ""); setEditingTitle(true); }}>
                  <Pencil size={15} />
                </button>
              </div>
            )}
            <p>{activeSessionClosed ? "该会话已关闭，只能查看历史记录" : notice}</p>
          </div>
          <div className="headerActions">
            {activeSessionClosed ? (
              <button className="confirmButton" disabled={busy} onClick={cloneActiveSession}>
                <Copy size={15} /> 复制继续
              </button>
            ) : null}
            <button title="查看当前对话的分析策略" onClick={() => setStrategyListOpen(true)}>
              <GitBranch size={15} /> 分析策略
            </button>
            <button title="刷新" onClick={() => refreshBootstrap(activeSession?.id)}>
              <RefreshCw size={16} /> 刷新
            </button>
            <a className="linkButton counterPill" href="/reports"><FileText size={15} /> 报告 {reports.length}</a>
            {reports[0] ? (
              <a className="linkButton" href={`/reports/${reports[0].id}`}>
                最新报告
              </a>
            ) : null}
          </div>
        </header>

        <div className="conversation" aria-live="polite">
          {timeline.length ? (
            timeline.map((item, index) =>
              item.type === "message" ? (
                <MessageBubble key={`${item.id}-${index}`} role={item.role} content={item.content} />
              ) : (
                <TaskBubble
                  key={item.task.id}
                  bundle={item}
                  strategy={strategyDrafts[item.task.id] || item.strategy}
                  code={codeDrafts[item.task.id] || item.task.generated_code || ""}
                  expanded={!!expandedCode[item.task.id]}
                  busy={busy}
                  readOnly={activeSessionClosed}
                  dimensionOptions={collectFieldOptions(assets, item.task.selected_assets, ["date", "category"])}
                  metricOptions={collectFieldOptions(assets, item.task.selected_assets, ["number"])}
                  onStrategyChange={(strategy) => setStrategyDrafts((drafts) => ({ ...drafts, [item.task.id]: strategy }))}
                  onConfirm={() => confirmStrategy(item)}
                  onToggleCode={() => setExpandedCode((values) => ({ ...values, [item.task.id]: !values[item.task.id] }))}
                  onCodeChange={(code) => setCodeDrafts((codes) => ({ ...codes, [item.task.id]: code }))}
                  onRerun={() => rerunCode(item)}
                  onAddStrategy={() =>
                    item.strategy &&
                    requestAddToReport({
                      session_id: item.task.session_id,
                      type: item.execution ? "analysis" : "strategy",
                      ref_id: item.strategy.id,
                      title: item.execution ? "分析结果模块" : "分析策略书",
                      snapshot: {
                        task_id: item.task.id,
                        intent: item.task.user_intent,
                        summary: item.task.analysis_summary,
                        task: item.task,
                        strategy: item.strategy,
                        execution: item.execution,
                        charts: item.charts,
                        process_steps: item.execution?.process_steps || [],
                        quality_table: item.execution?.quality_table || [],
                        table: item.execution?.table || [],
                      } as unknown as Record<string, unknown>,
                    })
                  }
                  onAddResult={() =>
                    item.execution &&
                    requestAddToReport({
                      session_id: item.task.session_id,
                      type: "conclusion",
                      ref_id: item.execution.execution_id,
                      title: "分析结果模块",
                      snapshot: {
                        task_id: item.task.id,
                        intent: item.task.user_intent,
                        task: item.task,
                        summary: item.task.analysis_summary,
                        charts: item.charts,
                        process_steps: item.execution.process_steps || [],
                        quality_table: item.execution.quality_table || [],
                        table: item.execution.table,
                        execution: item.execution,
                        strategy: item.strategy,
                      }
                    })
                  }
                  onPinChart={(chart) => pinChart(item, chart)}
                  onFeedback={(rating) => rateTask(item, rating)}
                />
              )
            )
          ) : (
            <div className="welcomeCard">
              <BarChart3 size={30} />
              <strong>从一句问题开始</strong>
              <span>上传或选择数据资产后，直接在下方对话框提问。每一轮策略、代码、图表和结论都会在对话中返回。</span>
            </div>
          )}
          {busy ? <div className="thinking"><Bot size={16} /> Agent 正在处理本轮请求...</div> : null}
          <div ref={bottomRef} />
        </div>

        {!activeSessionClosed ? (
          <footer className="composer">
            <AssetStrip assets={selectedAssetModels} />
            <StrategyStrip strategies={selectedStrategyModels} onOpen={() => setStrategyPickerOpen(true)} />
            <RagContextStrip items={ragContext} assets={assets} />
            <div className="composerBox">
              <button className="attachButton" title="选择或上传数据" onClick={() => setAttachMenuOpen((open) => !open)}>
                <Paperclip size={18} />
              </button>
              {attachMenuOpen ? (
                <div className="attachMenu">
                  <button onClick={openAssetPicker}><Database size={15} /> 选择已有数据资产</button>
                  <button onClick={triggerUpload}><Paperclip size={15} /> 上传一个或多个数据集</button>
                </div>
              ) : null}
              <input
                ref={fileInputRef}
                className="hiddenFileInput"
                type="file"
                accept=".csv,.xlsx,.xls"
                multiple
                onChange={(event) => {
                  void upload(event.target.files || undefined);
                  event.target.value = "";
                }}
              />
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendPrompt();
                  }
                }}
                placeholder="输入分析问题，可写入资产名/表名选择已有数据，Shift + Enter 换行"
              />
              <button className="sendButton" disabled={busy || !prompt.trim()} onClick={sendPrompt}>
                <Send size={18} /> 发送
              </button>
            </div>
          </footer>
        ) : null}
      </section>
      {pendingReportModule ? (
        <ReportPicker
          reports={reports}
          module={pendingReportModule}
          busy={busy}
          onClose={() => setPendingReportModule(null)}
          onSelect={(reportId) => addModuleToReport(reportId)}
          onCreate={(title) => addModuleToReport(undefined, title)}
        />
      ) : null}
      {assetPickerOpen ? (
        <AssetPicker
          assets={assets}
          selected={assetDraftSelection}
          onToggle={(assetId) =>
            setAssetDraftSelection((items) =>
              items.includes(assetId) ? items.filter((id) => id !== assetId) : [...items, assetId]
            )
          }
          onClose={() => setAssetPickerOpen(false)}
          onConfirm={confirmAssetSelection}
        />
      ) : null}
      {strategyPickerOpen ? (
        <StrategyPicker
          strategies={strategyAssets}
          selected={selectedStrategyAssets}
          onToggle={toggleSelectedStrategy}
          onClose={() => setStrategyPickerOpen(false)}
        />
      ) : null}
      {strategyListOpen ? (
        <SessionStrategyModal
          bundles={sessionStrategyBundles}
          drafts={strategyDrafts}
          onClose={() => setStrategyListOpen(false)}
        />
      ) : null}
      {strategyPreview ? (
        <StrategyPreviewModal strategy={strategyPreview} onClose={() => setStrategyPreview(null)} />
      ) : null}
    </main>
  );
}

function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  return (
    <article className={`messageBubble ${role}`}>
      <div className="avatar">{role === "user" ? "我" : <Bot size={16} />}</div>
      <div className="bubbleBody">{content}</div>
    </article>
  );
}

function TaskBubble({
  bundle,
  strategy,
  code,
  expanded,
  busy,
  readOnly,
  dimensionOptions,
  metricOptions,
  onStrategyChange,
  onConfirm,
  onToggleCode,
  onCodeChange,
  onRerun,
  onAddStrategy,
  onAddResult,
  onPinChart,
  onFeedback
}: {
  bundle: ApiTaskBundle;
  strategy?: Strategy;
  code: string;
  expanded: boolean;
  busy: boolean;
  readOnly?: boolean;
  dimensionOptions: string[];
  metricOptions: string[];
  onStrategyChange: (strategy: Strategy) => void;
  onConfirm: () => void;
  onToggleCode: () => void;
  onCodeChange: (code: string) => void;
  onRerun: () => void;
  onAddStrategy: () => void;
  onAddResult: () => void;
  onPinChart: (chart: ChartConfig) => void;
  onFeedback: (rating: "up" | "down") => void;
}) {
  return (
    <article className="messageBubble assistant taskMessage">
      <div className="avatar"><Bot size={16} /></div>
      <div className="taskCard">
        <div className="taskMeta">
          <span>{bundle.task.status === "waiting_confirmation" ? "等待确认" : bundle.task.status}</span>
          <small>{bundle.task.id}</small>
        </div>

        {strategy ? (
          <StrategyCard
            strategy={strategy}
            setStrategy={onStrategyChange}
            confirmed={!!strategy.confirmed_at}
            busy={busy}
            readOnly={readOnly}
            dimensionOptions={dimensionOptions}
            metricOptions={metricOptions}
            onConfirm={onConfirm}
            onCart={onAddStrategy}
          />
        ) : null}

        {bundle.execution ? (
          <ResultCard
            summary={bundle.task.analysis_summary || ""}
            execution={bundle.execution}
            charts={bundle.charts}
            code={code}
            codeChanged={code !== (bundle.task.generated_code || "")}
            expanded={expanded}
            busy={busy}
            readOnly={readOnly}
            onToggleCode={onToggleCode}
            onCodeChange={onCodeChange}
            onRerun={onRerun}
            onAddResult={onAddResult}
            onPinChart={onPinChart}
          />
        ) : (
          <div className="statusLine">
            <Database size={16} />
            <span>已读取数据字典，策略确认后会继续生成代码、执行并返回图表。</span>
          </div>
        )}
        <div className="answerFeedback">
          <button className="iconOnly" title="点赞" disabled={readOnly} onClick={() => onFeedback("up")}>
            <ThumbsUp size={15} className={bundle.feedback?.rating === "up" ? "rated" : ""} />
          </button>
          <button className="iconOnly" title="点踩" disabled={readOnly} onClick={() => onFeedback("down")}>
            <ThumbsDown size={15} className={bundle.feedback?.rating === "down" ? "ratedDown" : ""} />
          </button>
        </div>
      </div>
    </article>
  );
}

function StrategyCard({
  strategy,
  setStrategy,
  confirmed,
  busy,
  readOnly,
  dimensionOptions,
  metricOptions,
  onConfirm,
  onCart
}: {
  strategy: Strategy;
  setStrategy: (strategy: Strategy) => void;
  confirmed: boolean;
  busy: boolean;
  readOnly?: boolean;
  dimensionOptions: string[];
  metricOptions: string[];
  onConfirm: () => void;
  onCart: () => void;
}) {
  const updateList = (key: "dimensions" | "metrics", value: string) => {
    setStrategy({ ...strategy, [key]: value.split(",").map((item) => item.trim()).filter(Boolean) });
  };
  const addListItem = (key: "dimensions" | "metrics", value: string) => {
    if (!value || strategy[key].includes(value)) return;
    setStrategy({ ...strategy, [key]: [...strategy[key], value] });
  };
  const selectedChartType = String(strategy.chart_suggestions[0]?.type || "bar");
  const updateChartType = (type: string) => {
    const suggestions = strategy.chart_suggestions.length
      ? strategy.chart_suggestions.map((item, index) => index === 0 ? { ...item, type } : item)
      : [{ type, title: "分析结果", dimensions: strategy.dimensions.slice(0, 2), metrics: strategy.metrics.slice(0, 2) }];
    setStrategy({ ...strategy, chart_suggestions: suggestions });
  };
  return (
    <section className="inlineCard">
      <div className="sectionHeader">
        <h2>分析策略书</h2>
        <div className="buttonRow">
          <button disabled={readOnly} onClick={onCart}><ShoppingCart size={15} /> 加入报告</button>
          <button className="confirmButton" disabled={readOnly || busy || confirmed} onClick={onConfirm}><Check size={15} /> {confirmed ? "已确认" : "确认执行"}</button>
        </div>
      </div>
      <label>目标<textarea disabled={readOnly} value={strategy.objective} onChange={(event) => setStrategy({ ...strategy, objective: event.target.value })} /></label>
      <div className="fieldGrid strategyFieldGrid">
        <label>
          维度
          <div className="fieldWithSelect">
            <input disabled={readOnly} value={strategy.dimensions.join(", ")} onChange={(event) => updateList("dimensions", event.target.value)} />
            <select
              disabled={readOnly || !dimensionOptions.length}
              value=""
              title="从数据字典选择维度字段"
              onChange={(event) => addListItem("dimensions", event.target.value)}
            >
              <option value="">选择维度</option>
              {dimensionOptions.map((option) => (
                <option key={option} value={option} disabled={strategy.dimensions.includes(option)}>{option}</option>
              ))}
            </select>
          </div>
        </label>
        <label>
          指标
          <div className="fieldWithSelect">
            <input disabled={readOnly} value={strategy.metrics.join(", ")} onChange={(event) => updateList("metrics", event.target.value)} />
            <select
              disabled={readOnly || !metricOptions.length}
              value=""
              title="从数据字典选择指标字段"
              onChange={(event) => addListItem("metrics", event.target.value)}
            >
              <option value="">选择指标</option>
              {metricOptions.map((option) => (
                <option key={option} value={option} disabled={strategy.metrics.includes(option)}>{option}</option>
              ))}
            </select>
          </div>
        </label>
      </div>
      <div className="strategyChartType">
        <strong>回答图表形式</strong>
        <div className="chartTypePicker">
          {CHART_TYPE_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                className={selectedChartType === option.type ? "active" : ""}
                disabled={readOnly || confirmed}
                onClick={() => updateChartType(option.type)}
              >
                <Icon size={15} /> {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="strategyFlowPanel">
        <strong>分析流程</strong>
        <StrategyFlow methods={strategy.methods} />
      </div>
      <div className="strategyEvidence">
        <strong>依据与限制</strong>
        <div className="assumptions">{strategy.assumptions.map((item) => <span key={item}>{item}</span>)}</div>
      </div>
    </section>
  );
}

function ResultCard({
  summary,
  execution,
  charts,
  code,
  codeChanged,
  expanded,
  busy,
  readOnly,
  onToggleCode,
  onCodeChange,
  onRerun,
  onAddResult,
  onPinChart
}: {
  summary: string;
  execution: ExecutionResult;
  charts: ChartConfig[];
  code: string;
  codeChanged: boolean;
  expanded: boolean;
  busy: boolean;
  readOnly?: boolean;
  onToggleCode: () => void;
  onCodeChange: (code: string) => void;
  onRerun: () => void;
  onAddResult: () => void;
  onPinChart: (chart: ChartConfig) => void;
}) {
  const [chartTypes, setChartTypes] = useState<Record<string, string>>({});
  const [detailChartId, setDetailChartId] = useState<string | null>(null);
  const displayCharts = useMemo(
    () => charts.map((chart) => ({ ...chart, type: chartTypes[chart.id] || chart.type })),
    [charts, chartTypes]
  );
  const detailChart = displayCharts.find((chart) => chart.id === detailChartId);
  return (
    <section className="resultBlock">
      <div className="sectionHeader">
        <h2>执行结果</h2>
        <div className="buttonRow">
          <button disabled={readOnly} onClick={onAddResult}><ShoppingCart size={15} /> 加入报告</button>
          <button onClick={onToggleCode}><Code2 size={15} /> 代码 <ChevronDown size={14} /></button>
        </div>
      </div>
      <p className="summary">{summary}</p>
      {execution.process_steps?.length ? (
        <div className="processList">
          {execution.process_steps.map((step, index) => (
            <div className="processLine" key={`${step.step || index}-${step.name || index}`}>
              <span className="stepBadge">{step.step || index + 1}</span>
              <div>
                <strong>{step.name}</strong>
                <p>{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {expanded ? (
        <div className="codePanel">
          <div className="sectionHeader">
            <span>Python 沙箱 · {execution.duration_ms}ms · {execution.code_hash.slice(0, 10)}</span>
          </div>
          <textarea className="codeBox" disabled={readOnly} value={code} onChange={(event) => onCodeChange(event.target.value)} />
          {execution.stderr ? <pre className="stderr">{execution.stderr}</pre> : null}
        </div>
      ) : null}
      {expanded ? (
        <div className="codeRunRow">
          <button
            className="confirmButton"
            disabled={readOnly || busy || !code || !codeChanged}
            title={codeChanged ? "运行修改后的代码" : "请先修改代码后再运行"}
            onClick={onRerun}
          >
            <Play size={15} /> {busy ? "运行中..." : "运行"}
          </button>
        </div>
      ) : null}
      <div className="chartGrid">
        {displayCharts.map((chart) => (
          <div className="chartWithActions" key={chart.id}>
            <div className="chartToolbar" aria-label="图表样式切换">
              {CHART_TYPE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = chart.type === option.type;
                return (
                  <button
                    key={option.type}
                    className={active ? "active" : ""}
                    title={`切换为${option.label}`}
                    onClick={() => setChartTypes((items) => ({ ...items, [chart.id]: option.type }))}
                  >
                    <Icon size={14} />
                    <span>{option.label}</span>
                  </button>
                );
              })}
            </div>
            <ChartPanel chart={chart} />
            <div className="chartActionRow">
              <button onClick={() => setDetailChartId((current) => current === chart.id ? null : chart.id)}>
                <Table2 size={15} /> {detailChartId === chart.id ? "收起详情" : "详情"}
              </button>
              <button disabled={readOnly} onClick={() => onPinChart(chart)}><LayoutDashboard size={15} /> 钉到看板</button>
            </div>
          </div>
        ))}
      </div>
      {detailChart ? (
        <div className="resultDetailPanel">
          <div className="sectionHeader">
            <strong>{detailChart.title} · 数据详情</strong>
            <button className="iconOnly" title="关闭详情" onClick={() => setDetailChartId(null)}><X size={15} /></button>
          </div>
          <DataTable rows={detailChart.dataset} />
        </div>
      ) : null}
    </section>
  );
}

function AssetStrip({ assets }: { assets: Asset[] }) {
  if (!assets.length) {
    return <div className="assetStrip mutedStrip">未选择数据资产，可点击回形针选择已有资产或上传 CSV / Excel</div>;
  }
  return (
    <div className="assetStrip">
      {assets.map((asset) => (
        <span key={asset.id}>{asset.name} · {asset.data_dictionary?.row_count ?? 0} 行</span>
      ))}
    </div>
  );
}

function StrategyStrip({ strategies, onOpen }: { strategies: StrategyAsset[]; onOpen: () => void }) {
  return (
    <div className="strategyStrip">
      <button onClick={onOpen}><GitBranch size={15} /> 策略资产</button>
      {strategies.length ? strategies.map((strategy) => (
        <span key={strategy.id}>{strategy.title}</span>
      )) : <small>未选择策略资产，将使用系统和个性化策略自动匹配</small>}
    </div>
  );
}

function RagContextStrip({ items, assets }: { items: RagContextItem[]; assets: Asset[] }) {
  if (!items.length) return null;
  const names = Array.from(new Set(items.map((item) => assets.find((asset) => asset.id === item.asset_id)?.name).filter(Boolean)));
  return (
    <div className="ragStrip">
      <Layers size={14} />
      {names.slice(0, 3).map((name) => (
        <span key={name}>{name}</span>
      ))}
    </div>
  );
}

function AssetPicker({
  assets,
  selected,
  onToggle,
  onClose,
  onConfirm
}: {
  assets: Asset[];
  selected: string[];
  onToggle: (assetId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modalBackdrop">
      <section className="reportPicker">
        <div className="sectionHeader">
          <div>
            <h2>选择数据资产</h2>
            <p>支持单选或多选，确认后会自动补充 RAG 上下文。</p>
          </div>
          <button className="iconOnly" onClick={onClose} title="关闭"><X size={16} /></button>
        </div>
        <div className="pickerList">
          {assets.map((asset) => (
            <label key={asset.id} className="pickerCheck">
              <input type="checkbox" checked={selected.includes(asset.id)} onChange={() => onToggle(asset.id)} />
              <span>{asset.name}</span>
              <small>{asset.data_dictionary?.table_name || asset.type} · {asset.data_dictionary?.row_count ?? 0} 行</small>
            </label>
          ))}
        </div>
        <button className="confirmButton" onClick={onConfirm}><Check size={15} /> 确认选择 {selected.length} 个资产</button>
      </section>
    </div>
  );
}

function StrategyPicker({
  strategies,
  selected,
  onToggle,
  onClose
}: {
  strategies: StrategyAsset[];
  selected: string[];
  onToggle: (strategyId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modalBackdrop">
      <section className="reportPicker">
        <div className="sectionHeader">
          <div>
            <h2>选择策略资产</h2>
            <p>选中的策略会参与下一轮分析策略生成。</p>
          </div>
          <button className="iconOnly" onClick={onClose} title="关闭"><X size={16} /></button>
        </div>
        <div className="pickerList">
          {strategies.map((strategy) => (
            <label key={strategy.id} className="pickerCheck">
              <input type="checkbox" checked={selected.includes(strategy.id)} onChange={() => onToggle(strategy.id)} />
              <span>{strategy.title}</span>
              <small>{strategy.kind === "template" ? "模板策略" : "已确认策略"} · {strategy.methods.length} 步</small>
            </label>
          ))}
        </div>
        <button className="confirmButton" onClick={onClose}><Check size={15} /> 完成</button>
      </section>
    </div>
  );
}

function SessionStrategyModal({
  bundles,
  drafts,
  onClose
}: {
  bundles: ApiTaskBundle[];
  drafts: Record<string, Strategy>;
  onClose: () => void;
}) {
  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="strategyModal" role="dialog" aria-modal="true" aria-labelledby="session-strategy-title">
        <div className="sectionHeader">
          <div>
            <h2 id="session-strategy-title">当前对话的分析策略</h2>
            <p>共 {bundles.length} 份，按对话中的生成顺序展示。</p>
          </div>
          <button className="iconOnly" onClick={onClose} title="关闭"><X size={16} /></button>
        </div>
        {bundles.length ? (
          <div className="sessionStrategyList">
            {bundles.map((bundle, index) => {
              const strategy = drafts[bundle.task.id] || bundle.strategy;
              if (!strategy) return null;
              return (
                <article className="sessionStrategyItem" key={bundle.task.id}>
                  <div className="sessionStrategyHeading">
                    <div>
                      <small>策略 {index + 1} · {strategy.confirmed_at ? "已确认" : "待确认"}</small>
                      <h3>{bundle.task.user_intent}</h3>
                    </div>
                    <span>{bundle.task.id}</span>
                  </div>
                  <p className="sessionStrategyObjective">{strategy.objective}</p>
                  <div className="strategyChips">
                    <span>维度：{strategy.dimensions.join(", ") || "-"}</span>
                    <span>指标：{strategy.metrics.join(", ") || "-"}</span>
                  </div>
                  <div className="strategyFlowPanel">
                    <strong>分析流程</strong>
                    <StrategyFlow methods={strategy.methods} />
                  </div>
                  {strategy.assumptions.length ? (
                    <div className="assumptions">
                      {strategy.assumptions.map((item) => <span key={item}>{item}</span>)}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="emptyChoice">当前对话还没有分析策略</div>
        )}
      </section>
    </div>
  );
}

function StrategyPreviewModal({ strategy, onClose }: { strategy: StrategyAsset; onClose: () => void }) {
  return (
    <div className="modalBackdrop">
      <section className="strategyModal">
        <div className="sectionHeader">
          <div>
            <h2>{strategy.title}</h2>
            <p>{strategy.kind === "template" ? "模板策略" : "已确认策略"} · {strategy.methods.length} 个步骤</p>
          </div>
          <button className="iconOnly" onClick={onClose} title="关闭"><X size={16} /></button>
        </div>
        <div className="strategyChips">
          <span>维度：{strategy.dimensions.join(", ") || "-"}</span>
          <span>指标：{strategy.metrics.join(", ") || "-"}</span>
          <span>来源：{strategy.source || strategy.kind || "confirmed"}</span>
        </div>
        <StrategyFlow methods={strategy.methods} />
      </section>
    </div>
  );
}

function ReportPicker({
  reports,
  module,
  busy,
  onClose,
  onSelect,
  onCreate
}: {
  reports: Report[];
  module: ReportModuleDraft;
  busy: boolean;
  onClose: () => void;
  onSelect: (reportId: string) => void;
  onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState(`${module.title} 报告`);
  return (
    <div className="modalBackdrop">
      <section className="reportPicker">
        <div className="sectionHeader">
          <div>
            <h2>加入报告</h2>
            <p>选择当前会话下的历史报告，或创建一份新报告。</p>
          </div>
          <button className="iconOnly" onClick={onClose} title="关闭"><X size={16} /></button>
        </div>
        <div className="reportChoices">
          {reports.length ? reports.map((report) => (
            <button key={report.id} className="reportChoice" disabled={busy} onClick={() => onSelect(report.id)}>
              <FileText size={16} />
              <span>{report.title}</span>
              <small>{report.versions?.length || 0} 个版本</small>
            </button>
          )) : <div className="emptyChoice">当前会话还没有历史报告</div>}
        </div>
        <div className="createReportRow">
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
          <button className="confirmButton" disabled={busy || !title.trim()} onClick={() => onCreate(title.trim())}>
            <Check size={15} /> 新建并加入
          </button>
        </div>
      </section>
    </div>
  );
}
