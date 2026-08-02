"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  Copy,
  Database,
  FilePlus2,
  FileText,
  FolderKanban,
  GitBranch,
  Grid3X3,
  LayoutDashboard,
  LineChart,
  Layers,
  ListOrdered,
  Paperclip,
  Pencil,
  PieChart,
  Play,
  RefreshCw,
  Send,
  Sparkles,
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
  type Dataset,
  type ExecutionResult,
  type Report,
  type RagContextItem,
  type Session,
  type StrategyAsset,
  type Strategy,
  type TaskFeedback,
  type TimelineItem
} from "../../lib/api";
import { ChartPanel, DataTable } from "../../components/ChartPanel";
import { StrategyFlow } from "../../components/StrategyFlow";
import { loadAnalysisPlan } from "../../lib/analysisPlan";

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

function assetIdsOfDatasets(datasets: Dataset[], datasetIds: string[]): string[] {
  const ids = new Set<string>();
  for (const dataset of datasets) {
    if (!datasetIds.includes(dataset.id)) continue;
    for (const assetId of dataset.asset_ids || []) ids.add(assetId);
  }
  return Array.from(ids);
}

function matchDatasetIds(datasets: Dataset[], assetIds: string[]): string[] {
  if (!assetIds.length) return [];
  const assetSet = new Set(assetIds);
  const covered = datasets.filter(
    (dataset) => dataset.asset_ids.length > 0 && dataset.asset_ids.every((id) => assetSet.has(id))
  );
  if (covered.length) return covered.map((item) => item.id);
  return datasets
    .filter((dataset) => dataset.asset_ids.some((id) => assetSet.has(id)))
    .map((item) => item.id);
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
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("分析销售金额按月份和区域的变化，并找出主要贡献项");
  const [strategyDrafts, setStrategyDrafts] = useState<Record<string, Strategy>>({});
  const [codeDrafts, setCodeDrafts] = useState<Record<string, string>>({});
  const [expandedCode, setExpandedCode] = useState<Record<string, boolean>>({});
  const [pendingReportModule, setPendingReportModule] = useState<ReportModuleDraft | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [datasetPickerOpen, setDatasetPickerOpen] = useState(false);
  const [strategyPickerOpen, setStrategyPickerOpen] = useState(false);
  const [strategyListOpen, setStrategyListOpen] = useState(false);
  const [datasetDraftSelection, setDatasetDraftSelection] = useState<string[]>([]);
  const [selectedStrategyAssets, setSelectedStrategyAssets] = useState<string[]>([]);
  const [useNewStrategy, setUseNewStrategy] = useState(false);
  const [analysisPlan, setAnalysisPlan] = useState<string[]>([]);
  const [planStepIndex, setPlanStepIndex] = useState(0);
  const [planRunMode, setPlanRunMode] = useState<"step" | "auto" | null>(null);
  const [planSendMenuOpen, setPlanSendMenuOpen] = useState(false);
  const [composerMetaCollapsed, setComposerMetaCollapsed] = useState(false);
  const [suggestMode, setSuggestMode] = useState<"questions" | "plan" | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [strategyPreview, setStrategyPreview] = useState<StrategyAsset | null>(null);
  const [ragContext, setRagContext] = useState<RagContextItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("准备就绪");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const timelineLengthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const planSendMenuRef = useRef<HTMLDivElement | null>(null);
  const planAutoStartedRef = useRef(false);

  const selectedAssets = useMemo(
    () => assetIdsOfDatasets(datasets, selectedDatasetIds).filter((id) => assets.some((asset) => asset.id === id)),
    [datasets, selectedDatasetIds, assets]
  );

  useEffect(() => {
    const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const sessionId = search?.get("session_id") || undefined;
    const datasetIds = (search?.get("dataset_ids") || "").split(",").filter(Boolean);
    const assetIds = (search?.get("asset_ids") || "").split(",").filter(Boolean);
    const initialPrompt = search?.get("prompt") || "";
    const planKey = search?.get("plan_key") || "";
    const plan = planKey ? loadAnalysisPlan(planKey) : [];
    const forceNewStrategy = search?.get("use_new_strategy") === "1" || plan.length > 0;
    if (plan.length) {
      setAnalysisPlan(plan);
      setPlanStepIndex(0);
      setSuggestMode("plan");
      setPrompt(plan[0]);
      setUseNewStrategy(true);
    } else if (initialPrompt) {
      setPrompt(initialPrompt);
    }
    if (forceNewStrategy) setUseNewStrategy(true);
    void refreshBootstrap(sessionId, datasetIds, assetIds, plan[0] || initialPrompt);
  }, []);

  useEffect(() => {
    if (timeline.length !== timelineLengthRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      timelineLengthRef.current = timeline.length;
    }
  }, [timeline.length]);

  useEffect(() => {
    void loadRagContext(selectedAssets, prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDatasetIds.join("|"), datasets.length]);

  const hasActivePlan = analysisPlan.length > 0 && planStepIndex < analysisPlan.length;

  useEffect(() => {
    if (!planSendMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!planSendMenuRef.current?.contains(event.target as Node)) setPlanSendMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [planSendMenuOpen]);

  async function refreshBootstrap(
    preferredSessionId?: string,
    preferredDatasetIds: string[] = [],
    preferredAssetIds: string[] = [],
    preferredPrompt = ""
  ) {
    const data = await api.bootstrap();
    setSessions(data.sessions || []);
    setAssets(data.assets || []);
    setReports(Array.isArray(data.reports) ? data.reports : data.reports.items || []);
    setDashboards(data.dashboards || []);
    const [library, datasetList] = await Promise.all([api.assetLibrary(), api.listDatasets()]);
    setAssets(library.data_assets);
    setStrategyAssets(library.strategy_assets);
    setDatasets(datasetList);
    const nextSession = data.sessions.find((item) => item.id === preferredSessionId) || activeSession || data.sessions?.[0] || null;
    if (nextSession) {
      await openSession(nextSession, preferredDatasetIds, preferredAssetIds, preferredPrompt, datasetList);
    } else if (preferredDatasetIds.length) {
      setSelectedDatasetIds(preferredDatasetIds);
    } else if (preferredAssetIds.length) {
      setSelectedDatasetIds(matchDatasetIds(datasetList, preferredAssetIds));
    }
  }

  async function openSession(
    session: Session,
    preferredDatasetIds: string[] = [],
    preferredAssetIds: string[] = [],
    preferredPrompt = "",
    datasetSource: Dataset[] = datasets
  ) {
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
    const nextDatasetIds = preferredDatasetIds.length
      ? preferredDatasetIds
      : preferredAssetIds.length
        ? matchDatasetIds(datasetSource, preferredAssetIds)
        : matchDatasetIds(datasetSource, restoredAssetIds);
    setSelectedDatasetIds(nextDatasetIds);
    const nextAssetIds = assetIdsOfDatasets(datasetSource, nextDatasetIds);
    await loadRagContext(nextAssetIds, preferredPrompt || prompt);
    if (nextDatasetIds.length) setNotice(`已选择 ${nextDatasetIds.length} 个数据集，可开始分析`);
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
    setSelectedDatasetIds([]);
    setRagContext([]);
    setNotice("新会话已创建，请先选择数据集");
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
        const dataset = await api.createDataset({
          name: uploadedAssets.length === 1
            ? `上传 · ${uploadedAssets[0].name}`
            : `上传数据集 · ${uploadedAssets.length} 个文件`,
          description: "由工作台上传自动创建，可用于分析",
          asset_ids: uploadedIds,
        });
        setDatasets((items) => [dataset, ...items.filter((item) => item.id !== dataset.id)]);
        const nextDatasetIds = Array.from(new Set([...selectedDatasetIds, dataset.id]));
        setSelectedDatasetIds(nextDatasetIds);
        await loadRagContext(assetIdsOfDatasets([dataset, ...datasets], nextDatasetIds), prompt);
        setNotice(`已创建并选中数据集「${dataset.name}」，可开始分析`);
      }
      if (failedFiles.length) {
        setNotice(`上传完成：成功 ${uploadedAssets.length}，失败 ${failedFiles.length}：${failedFiles.join("、")}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "批量上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendPrompt() {
    if (hasActivePlan) {
      setPlanSendMenuOpen((open) => !open);
      return;
    }
    await runAnalysisPrompt(prompt, { forceNewStrategy: useNewStrategy });
  }

  async function startPlanByStep() {
    if (!hasActivePlan || busy) return;
    setPlanSendMenuOpen(false);
    const stepText = analysisPlan[planStepIndex] || prompt;
    planAutoStartedRef.current = true;
    setPlanRunMode("step");
    setPrompt(stepText);
    setUseNewStrategy(true);
    await runAnalysisPrompt(stepText, { forceNewStrategy: true, fromPlan: true });
  }

  async function startPlanAutoConfirm() {
    if (!hasActivePlan || busy) return;
    setPlanSendMenuOpen(false);
    planAutoStartedRef.current = true;
    setPlanRunMode("auto");
    setUseNewStrategy(true);
    setBusy(true);
    try {
      for (let index = planStepIndex; index < analysisPlan.length; index += 1) {
        const stepText = analysisPlan[index];
        setPlanStepIndex(index);
        setPrompt(stepText);
        setNotice(`全确认执行：第 ${index + 1}/${analysisPlan.length} 步`);
        const ok = await runAnalysisPrompt(stepText, {
          forceNewStrategy: true,
          fromPlan: true,
          autoConfirm: true,
          skipBusyGuard: true,
          manageBusy: false,
          planStepOverride: index,
        });
        if (!ok) {
          setNotice(`计划第 ${index + 1} 步执行失败，已停止后续步骤`);
          return;
        }
      }
      setPlanStepIndex(analysisPlan.length);
      setNotice(`分析计划已全部自动完成（共 ${analysisPlan.length} 步）`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "计划执行失败");
    } finally {
      setBusy(false);
      setPlanRunMode(null);
    }
  }

  async function runAnalysisPrompt(
    rawText: string,
    options: {
      forceNewStrategy?: boolean;
      fromPlan?: boolean;
      skipBusyGuard?: boolean;
      autoConfirm?: boolean;
      manageBusy?: boolean;
      planStepOverride?: number;
    } = {}
  ): Promise<boolean> {
    const text = rawText.trim();
    const preferNewStrategy = options.forceNewStrategy ?? useNewStrategy;
    const manageBusy = options.manageBusy !== false;
    const currentPlanStep = options.planStepOverride ?? planStepIndex;
    if (!text || (busy && !options.skipBusyGuard)) return false;
    if (activeSession?.archived_at) {
      setNotice("该会话已关闭，只能查看历史内容");
      return false;
    }
    if (!selectedDatasetIds.length) {
      setNotice("请先选择数据集后再开始分析");
      return false;
    }
    const session = await ensureSession();
    const taskAssetIds = resolvePromptAssetIds(text);
    if (!taskAssetIds.length) {
      setNotice("所选数据集中没有可用数据资产，请先到数据集管理补充成员");
      return false;
    }
    if (manageBusy) setBusy(true);
    const waitForUserConfirm = preferNewStrategy && !options.autoConfirm;
    if (options.fromPlan && analysisPlan.length) {
      setNotice(
        waitForUserConfirm
          ? `分析计划 ${currentPlanStep + 1}/${analysisPlan.length}：正在生成策略，请确认后继续`
          : `分析计划 ${currentPlanStep + 1}/${analysisPlan.length}：正在生成并自动确认策略`
      );
    } else {
      setNotice(waitForUserConfirm ? "正在生成新的分析策略，请稍后确认" : "Planner Agent 正在生成本轮策略并执行分析");
    }
    try {
      const strategyRefs = preferNewStrategy ? [] : selectedStrategyAssets;
      const task = await api.createTaskWithStrategies(session.id, text, taskAssetIds, strategyRefs);
      const bundle = await api.getTask(task.id);
      setTimeline((items) => [
        ...items,
        { type: "message", id: `local_${task.id}`, session_id: session.id, role: "user", content: text, task_id: task.id, created_at: new Date().toISOString() },
        bundle
      ]);
      if (bundle.strategy) setStrategyDrafts((items) => ({ ...items, [task.id]: bundle.strategy! }));
      if (!options.fromPlan) setPrompt("");

      if (waitForUserConfirm) {
        setNotice(
          options.fromPlan && analysisPlan.length
            ? `计划第 ${currentPlanStep + 1}/${analysisPlan.length} 步策略已生成，请确认后继续下一步`
            : "新分析策略已生成，请在对话中核对后点击「确认策略并分析」"
        );
        await refreshCart(session.id);
        return false;
      }

      if (bundle.strategy) {
        setNotice(options.autoConfirm ? "正在自动确认策略并执行分析" : "策略已生成，正在自动确认并执行分析");
        const nextBundle = await api.confirmStrategy(bundle.task.id, bundle.strategy);
        updateTaskBundle(nextBundle);
        if (nextBundle.strategy) setStrategyDrafts((items) => ({ ...items, [nextBundle.task.id]: nextBundle.strategy! }));
        if (nextBundle.task.generated_code) {
          setCodeDrafts((items) => ({ ...items, [nextBundle.task.id]: nextBundle.task.generated_code! }));
        }
        const success = nextBundle.execution?.status === "success";
        if (!options.fromPlan || !options.autoConfirm) {
          setNotice(success ? "本轮分析完成" : "本轮执行失败，可在对话内修改代码重跑");
        }
        await refreshCart(session.id);
        return success;
      }
      setNotice("策略书已返回，请在对话中确认或修改");
      await refreshCart(session.id);
      return false;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "发送失败");
      return false;
    } finally {
      if (manageBusy) setBusy(false);
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

  function clearAnalysisPlanState() {
    setAnalysisPlan([]);
    setPlanStepIndex(0);
    setPlanRunMode(null);
    setPlanSendMenuOpen(false);
    planAutoStartedRef.current = false;
  }

  async function recommendQuestions() {
    if (!selectedAssets.length) {
      setNotice("请先选择数据集后再生成推荐问题");
      return;
    }
    if (suggestBusy || busy) return;
    // 与推荐 plan 互斥：只保留问题模式；仅生成 1 个问题
    clearAnalysisPlanState();
    setSuggestMode("questions");
    setSuggestBusy(true);
    setNotice("正在结合数据集与输入内容生成推荐问题…");
    try {
      const result = await api.generateAnalysisQuestions(prompt.trim(), selectedAssets, 1);
      const question = (result.questions || [])[0]?.trim();
      if (!question) {
        setSuggestMode(null);
        setNotice("未生成可用推荐问题，请调整输入后再试");
        return;
      }
      setPrompt(question);
      setComposerMetaCollapsed(false);
      setNotice("已生成 1 个推荐问题，并填入输入框");
      await loadRagContext(selectedAssets, question);
    } catch (error) {
      setSuggestMode(null);
      setNotice(error instanceof Error ? error.message : "生成推荐问题失败");
    } finally {
      setSuggestBusy(false);
    }
  }

  async function recommendPlan() {
    if (!selectedAssets.length) {
      setNotice("请先选择数据集后再生成分析计划");
      return;
    }
    if (suggestBusy || busy) return;
    // 与推荐问题互斥：只保留 plan 模式
    setSuggestMode("plan");
    setSuggestBusy(true);
    setNotice("正在结合数据集与输入内容生成分析计划…");
    try {
      const result = await api.generateAnalysisQuestions(prompt.trim(), selectedAssets, 8);
      const questions = result.questions || [];
      if (!questions.length) {
        setSuggestMode(null);
        setNotice("未生成可用分析计划，请调整输入后再试");
        return;
      }
      setAnalysisPlan(questions);
      setPlanStepIndex(0);
      setPlanRunMode(null);
      setPlanSendMenuOpen(false);
      planAutoStartedRef.current = false;
      setPrompt(questions[0]);
      setUseNewStrategy(true);
      setComposerMetaCollapsed(false);
      setNotice(`已生成 ${questions.length} 步分析计划，可点击「发送计划」继续`);
      await loadRagContext(selectedAssets, questions[0]);
    } catch (error) {
      setSuggestMode(null);
      setNotice(error instanceof Error ? error.message : "生成分析计划失败");
    } finally {
      setSuggestBusy(false);
    }
  }

  function openDatasetPicker() {
    setDatasetDraftSelection(selectedDatasetIds);
    setDatasetPickerOpen(true);
    setAttachMenuOpen(false);
  }

  async function confirmDatasetSelection() {
    setSelectedDatasetIds(datasetDraftSelection);
    setDatasetPickerOpen(false);
    const nextAssetIds = assetIdsOfDatasets(datasets, datasetDraftSelection);
    await loadRagContext(nextAssetIds, prompt);
    setNotice(
      datasetDraftSelection.length
        ? `已选择 ${datasetDraftSelection.length} 个数据集（${nextAssetIds.length} 个资产）`
        : "已清空数据集选择"
    );
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
    const scopedAssetIds = new Set(selectedAssets);
    if (!scopedAssetIds.size) return [];
    const normalized = text.toLowerCase();
    const matched = new Set<string>();

    // Match dataset names in the prompt → include that dataset's assets (within selection).
    datasets.forEach((dataset) => {
      if (!selectedDatasetIds.includes(dataset.id)) return;
      if (dataset.name && normalized.includes(dataset.name.toLowerCase())) {
        dataset.asset_ids.forEach((assetId) => {
          if (scopedAssetIds.has(assetId)) matched.add(assetId);
        });
      }
    });

    if (/(所有数据|全部数据|全部资产|多张表|多个数据集|全量|整个数据集)/.test(text)) {
      scopedAssetIds.forEach((assetId) => matched.add(assetId));
    }

    assets.forEach((asset) => {
      if (!scopedAssetIds.has(asset.id)) return;
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

    const picked = matched.size ? matched : scopedAssetIds;
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
    let nextPlanText: string | null = null;
    try {
      const nextBundle = await api.confirmStrategy(bundle.task.id, draft);
      updateTaskBundle(nextBundle);
      if (nextBundle.strategy) setStrategyDrafts((items) => ({ ...items, [nextBundle.task.id]: nextBundle.strategy! }));
      if (nextBundle.task.generated_code) setCodeDrafts((items) => ({ ...items, [nextBundle.task.id]: nextBundle.task.generated_code! }));
      if (activeSession) await refreshCart(activeSession.id);

      const hasPlan = analysisPlan.length > 0;
      const hasNext = hasPlan && planStepIndex < analysisPlan.length - 1;
      if (nextBundle.execution?.status !== "success") {
        setNotice(hasPlan
          ? `计划第 ${planStepIndex + 1} 步执行失败，可修改代码重跑或手动继续`
          : "本轮执行失败，可在对话内修改代码重跑");
        return;
      }
      if (hasNext && planRunMode !== "auto") {
        const nextIndex = planStepIndex + 1;
        nextPlanText = analysisPlan[nextIndex];
        setPlanStepIndex(nextIndex);
        setPrompt(nextPlanText);
        setUseNewStrategy(true);
        setPlanRunMode("step");
      } else if (hasPlan) {
        setPlanStepIndex(analysisPlan.length);
        setPlanRunMode(null);
        setNotice(`分析计划已完成（共 ${analysisPlan.length} 步）`);
      } else {
        setNotice("本轮分析完成");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "策略确认失败");
    } finally {
      setBusy(false);
    }
    if (nextPlanText) {
      await runAnalysisPrompt(nextPlanText, {
        forceNewStrategy: true,
        fromPlan: true,
        skipBusyGuard: true,
      });
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

  async function removeDataset(datasetId: string) {
    if (!window.confirm("确认删除该数据集？不会删除其中的数据资产。")) return;
    await api.deleteDataset(datasetId);
    setDatasets((items) => items.filter((item) => item.id !== datasetId));
    setSelectedDatasetIds((items) => items.filter((id) => id !== datasetId));
    setNotice("数据集已删除");
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

  const selectedDatasetModels = useMemo(
    () => datasets.filter((dataset) => selectedDatasetIds.includes(dataset.id)),
    [datasets, selectedDatasetIds]
  );
  const selectedStrategyModels = useMemo(
    () => strategyAssets.filter((strategy) => selectedStrategyAssets.includes(strategy.id)),
    [strategyAssets, selectedStrategyAssets]
  );
  const sessionStrategyBundles = useMemo(
    () => timeline.filter((item): item is ApiTaskBundle => item.type === "task" && Boolean(strategyDrafts[item.task.id] || item.strategy)),
    [timeline, strategyDrafts]
  );
  const latestDatasets = [...datasets].sort((a, b) => String(b.updated_at || b.created_at || "").localeCompare(String(a.updated_at || a.created_at || ""))).slice(0, 5);
  const latestStrategies = [...strategyAssets].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);
  const latestSessions = [...sessions].sort((a, b) => String(b.last_active_at || "").localeCompare(String(a.last_active_at || ""))).slice(0, 3);
  const activeSessionClosed = Boolean(activeSession?.archived_at);
  const toggleSection = (key: string) => setCollapsedSections((items) => ({ ...items, [key]: !items[key] }));

  return (
    <main className={`chatShell ${sidebarCollapsed ? "railCollapsed" : ""}`}>
      <aside className="rail">
        {sidebarCollapsed ? (
          <div className="railMiniNav" aria-label="收起的侧边栏">
            <a className="railMiniButton" href="/" title="返回首页" aria-label="返回首页">
              <Bot size={22} />
            </a>
            <button className="railMiniButton" title="展开侧边栏" aria-label="展开侧边栏" onClick={() => setSidebarCollapsed(false)}>
              <ChevronRight size={20} />
            </button>
            <button className="railMiniButton primaryMiniButton" title="新会话" aria-label="新会话" onClick={newSession}>
              <FilePlus2 size={20} />
            </button>
            <a className="railMiniButton" href="/sessions" title="会话列表" aria-label="会话列表">
              <FileText size={20} />
            </a>
            <a className="railMiniButton" href="/data-assets?view=datasets" title="数据集" aria-label="数据集">
              <FolderKanban size={20} />
            </a>
            <a className="railMiniButton" href="/strategies" title="策略资产" aria-label="策略资产">
              <GitBranch size={20} />
            </a>
          </div>
        ) : (
          <>
            <div className="railBrandRow">
              <a className="brand" href="/" aria-label="返回首页">
                <Bot size={22} />
                <div>
                  <strong>Data-RAG-Agent</strong>
                  <span>多轮数据诊断</span>
                </div>
              </a>
              <button className="railCollapseButton" title="收起侧边栏" aria-label="收起侧边栏" onClick={() => setSidebarCollapsed(true)}>
                <ChevronDown size={18} />
              </button>
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
              <button className="railSectionHeader" onClick={() => toggleSection("datasets")}>
                <span>数据集</span>
                <ChevronDown size={14} className={collapsedSections.datasets ? "chevron closed" : "chevron"} />
              </button>
              {!collapsedSections.datasets ? <div className="railList">
                {latestDatasets.map((dataset) => {
                  const active = selectedDatasetIds.includes(dataset.id);
                  return (
                    <div key={dataset.id} className={`assetRow ${active ? "active" : ""}`}>
                      <button
                        type="button"
                        className="strategyLink"
                        title={active ? "取消选择该数据集" : "选择该数据集用于分析"}
                        onClick={() => {
                          setSelectedDatasetIds((items) =>
                            items.includes(dataset.id)
                              ? items.filter((id) => id !== dataset.id)
                              : [...items, dataset.id]
                          );
                        }}
                      >
                        <FolderKanban size={14} />
                        <span>{dataset.name}</span>
                      </button>
                      <button className="railIconButton" title="删除数据集" onClick={() => void removeDataset(dataset.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
                {!latestDatasets.length ? <div className="railEmptyHint">暂无数据集，请先去数据管理构建</div> : null}
                <a className="railMore" href="/data-assets?view=datasets">更多数据集</a>
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
          </>
        )}
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
              <span>先选择数据集（或上传文件自动创建数据集），再在下方提问。每一轮策略、代码、图表和结论都会在对话中返回。</span>
            </div>
          )}
          {busy ? <div className="thinking"><Bot size={16} /> Agent 正在处理本轮请求...</div> : null}
          <div ref={bottomRef} />
        </div>

        {!activeSessionClosed ? (
          <footer className={`composer ${composerMetaCollapsed ? "composerCollapsedMeta" : ""}`}>
            <div className="composerMetaToggleRow">
              <button
                type="button"
                className="composerMetaToggle"
                onClick={() => setComposerMetaCollapsed((value) => !value)}
                aria-expanded={!composerMetaCollapsed}
                title={composerMetaCollapsed ? "展开输入框上方内容" : "折叠输入框上方内容"}
              >
                {composerMetaCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                <span>{composerMetaCollapsed ? "展开上下文" : "折叠上下文"}</span>
                {composerMetaCollapsed && analysisPlan.length ? (
                  <small>计划 {Math.min(planStepIndex + 1, analysisPlan.length)}/{analysisPlan.length}</small>
                ) : null}
                {composerMetaCollapsed && selectedDatasetModels.length ? (
                  <small>{selectedDatasetModels.length} 个数据集</small>
                ) : null}
              </button>
            </div>
            {!composerMetaCollapsed ? (
              <div className="composerMeta">
                <DatasetStrip datasets={selectedDatasetModels} assetCount={selectedAssets.length} />
                {analysisPlan.length && suggestMode !== "questions" ? (
                  <AnalysisPlanStrip
                    steps={analysisPlan}
                    currentIndex={planStepIndex}
                    onClear={() => {
                      clearAnalysisPlanState();
                      if (suggestMode === "plan") setSuggestMode(null);
                    }}
                  />
                ) : null}
                <StrategyStrip
                  strategies={selectedStrategyModels}
                  useNewStrategy={useNewStrategy}
                  onUseNewStrategyChange={setUseNewStrategy}
                  onOpen={() => setStrategyPickerOpen(true)}
                />
                <div className="composerAssistRow">
                  <RagContextStrip items={ragContext} assets={assets} />
                  <div className="composerRecommendActions" role="group" aria-label="推荐方式（二选一）">
                    <button
                      type="button"
                      className={suggestMode === "questions" ? "active" : undefined}
                      disabled={suggestBusy || busy || !selectedAssets.length}
                      title="生成推荐问题并填入输入框；与推荐 plan 互斥，会清除已有分析计划"
                      onClick={() => void recommendQuestions()}
                    >
                      <Sparkles size={14} /> 推荐问题
                    </button>
                    <button
                      type="button"
                      className={suggestMode === "plan" ? "active" : undefined}
                      disabled={suggestBusy || busy || !selectedAssets.length}
                      title="生成分析计划并填入计划区；与推荐问题互斥，会清除已有推荐问题"
                      onClick={() => void recommendPlan()}
                    >
                      <ListOrdered size={14} /> 推荐 plan
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="composerBox">
              <button className="attachButton" title="选择数据集或上传文件" onClick={() => setAttachMenuOpen((open) => !open)}>
                <Paperclip size={18} />
              </button>
              {attachMenuOpen ? (
                <div className="attachMenu">
                  <button onClick={openDatasetPicker}><FolderKanban size={15} /> 选择数据集</button>
                  <button onClick={triggerUpload}><Paperclip size={15} /> 上传文件并创建数据集</button>
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
                    if (hasActivePlan) setPlanSendMenuOpen(true);
                    else void sendPrompt();
                  }
                }}
                placeholder="先选择数据集，再输入分析问题；Shift + Enter 换行"
              />
              {hasActivePlan ? (
                <div className="sendPlanWrap" ref={planSendMenuRef}>
                  <button
                    className="sendButton sendPlanButton"
                    disabled={busy || !selectedDatasetIds.length || !analysisPlan[planStepIndex]?.trim()}
                    onClick={() => void sendPrompt()}
                    title="选择计划执行方式"
                    aria-haspopup="menu"
                    aria-expanded={planSendMenuOpen}
                  >
                    <Send size={18} /> 发送计划 <ChevronDown size={15} />
                  </button>
                  {planSendMenuOpen ? (
                    <div className="sendPlanMenu" role="menu">
                      <button type="button" role="menuitem" disabled={busy} onClick={() => void startPlanByStep()}>
                        <Check size={15} />
                        <span>
                          <strong>按步确认</strong>
                          <small>每步生成策略后由你确认，再进入下一步</small>
                        </span>
                      </button>
                      <button type="button" role="menuitem" disabled={busy} onClick={() => void startPlanAutoConfirm()}>
                        <Play size={15} />
                        <span>
                          <strong>全确认执行</strong>
                          <small>自动确认全部策略并按顺序执行完计划</small>
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  className="sendButton"
                  disabled={busy || !selectedDatasetIds.length || !prompt.trim()}
                  onClick={() => void sendPrompt()}
                  title="发送消息"
                >
                  <Send size={18} /> 发送
                </button>
              )}
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
      {datasetPickerOpen ? (
        <DatasetPicker
          datasets={datasets}
          selected={datasetDraftSelection}
          onToggle={(datasetId) =>
            setDatasetDraftSelection((items) =>
              items.includes(datasetId) ? items.filter((id) => id !== datasetId) : [...items, datasetId]
            )
          }
          onClose={() => setDatasetPickerOpen(false)}
          onConfirm={() => void confirmDatasetSelection()}
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
            hasResult={!!bundle.execution}
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
            objective={bundle.task.user_intent || strategy?.objective || ""}
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

function CollapsibleBlock({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsibleBlock ${open ? "open" : ""}`}>
      <button type="button" className="collapsibleToggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <strong>{title}</strong>
        {!open && summary ? <span className="collapsibleSummary">{summary}</span> : null}
      </button>
      {open ? <div className="collapsibleBody">{children}</div> : null}
    </div>
  );
}

function StrategyCard({
  strategy,
  setStrategy,
  confirmed,
  hasResult,
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
  hasResult?: boolean;
  busy: boolean;
  readOnly?: boolean;
  dimensionOptions: string[];
  metricOptions: string[];
  onConfirm: () => void;
  onCart: () => void;
}) {
  const [cardOpen, setCardOpen] = useState(!(confirmed || hasResult));
  useEffect(() => {
    if (confirmed || hasResult) setCardOpen(false);
  }, [confirmed, hasResult]);
  const updateList = (key: "dimensions" | "metrics", value: string) => {
    setStrategy({ ...strategy, [key]: value.split(",").map((item) => item.trim()).filter(Boolean) });
  };
  const addListItem = (key: "dimensions" | "metrics", value: string) => {
    if (!value || strategy[key].includes(value)) return;
    setStrategy({ ...strategy, [key]: [...strategy[key], value] });
  };
  const selectedChartType = String(strategy.chart_suggestions[0]?.type || "bar");
  const selectedChartLabel = CHART_TYPE_OPTIONS.find((item) => item.type === selectedChartType)?.label || selectedChartType;
  const updateChartType = (type: string) => {
    const suggestions = strategy.chart_suggestions.length
      ? strategy.chart_suggestions.map((item, index) => index === 0 ? { ...item, type } : item)
      : [{ type, title: "分析结果", dimensions: strategy.dimensions.slice(0, 2), metrics: strategy.metrics.slice(0, 2) }];
    setStrategy({ ...strategy, chart_suggestions: suggestions });
  };
  return (
    <section className={`inlineCard strategyCard ${cardOpen ? "expanded" : "collapsed"}`}>
      <div className="sectionHeader">
        <button type="button" className="collapsibleTitleBtn" onClick={() => setCardOpen((value) => !value)} aria-expanded={cardOpen}>
          {cardOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
          <h2>分析策略书</h2>
        </button>
        <div className="buttonRow">
          <button disabled={readOnly} onClick={onCart}><ShoppingCart size={15} /> 加入报告</button>
          <button className="confirmButton" disabled={readOnly || busy || confirmed} onClick={onConfirm}>
            <Check size={15} /> {confirmed ? "已确认" : "确认策略并分析"}
          </button>
        </div>
      </div>
      {!cardOpen ? (
        <div className="strategyCollapsedSummary">
          <p>{strategy.objective}</p>
          <div className="strategyChips">
            <span>维度：{strategy.dimensions.join(", ") || "-"}</span>
            <span>指标：{strategy.metrics.join(", ") || "-"}</span>
            <span>图表：{selectedChartLabel}</span>
            <span>流程：{strategy.methods.length} 步</span>
          </div>
        </div>
      ) : (
        <>
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
          <CollapsibleBlock title="回答图表形式" summary={selectedChartLabel} defaultOpen={!confirmed}>
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
          </CollapsibleBlock>
          <CollapsibleBlock title="分析流程" summary={`${strategy.methods.length} 个步骤`} defaultOpen={false}>
            <div className="strategyFlowPanel nested">
              <StrategyFlow methods={strategy.methods} />
            </div>
          </CollapsibleBlock>
          <CollapsibleBlock title="依据与限制" summary={`${strategy.assumptions.length} 条`} defaultOpen={false}>
            <div className="assumptions">{strategy.assumptions.map((item) => <span key={item}>{item}</span>)}</div>
          </CollapsibleBlock>
        </>
      )}
    </section>
  );
}

function parseAnalysisSummary(summary: string): { paragraphs: string[]; findings: string[] } {
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const findings: string[] = [];
  const paragraphs: string[] = [];
  let inFindings = false;
  for (const line of lines) {
    if (/^关键发现[:：]?$/.test(line)) {
      inFindings = true;
      continue;
    }
    if (/^结论仅基于/.test(line)) {
      inFindings = false;
      paragraphs.push(line);
      continue;
    }
    if (inFindings || /^[-•*]\s+/.test(line)) {
      findings.push(line.replace(/^[-•*]\s+/, "").trim());
      continue;
    }
    paragraphs.push(line);
  }
  return { paragraphs, findings: findings.filter(Boolean) };
}

function ResultCard({
  summary,
  objective,
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
  objective?: string;
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
  const processSteps = execution.process_steps || [];
  const parsedSummary = useMemo(() => parseAnalysisSummary(summary || ""), [summary]);
  const weakInsight = (text: string) => /用于检查|共处理|输出\s*\d+\s*个分组|行记录/.test(text);
  const chartInsights = displayCharts
    .map((chart) => chart.insight?.trim())
    .filter((item): item is string => Boolean(item))
    .filter((item) => !weakInsight(item));
  const findings = parsedSummary.findings.length
    ? parsedSummary.findings
    : chartInsights.filter((item, index, list) => list.indexOf(item) === index);
  const summaryParagraphs = parsedSummary.paragraphs;
  return (
    <section className="resultBlock">
      <div className="sectionHeader">
        <h2>执行结果</h2>
        <div className="buttonRow">
          <button disabled={readOnly} onClick={onAddResult}><ShoppingCart size={15} /> 加入报告</button>
          <button onClick={onToggleCode}><Code2 size={15} /> 代码 {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        </div>
      </div>
      {processSteps.length ? (
        <CollapsibleBlock title="分析过程" summary={`${processSteps.length} 个步骤`} defaultOpen={false}>
          <div className="processList">
            {processSteps.map((step, index) => (
              <div className="processLine" key={`${step.step || index}-${step.name || index}`}>
                <span className="stepBadge">{step.step || index + 1}</span>
                <div>
                  <strong>{step.name}</strong>
                  <p>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleBlock>
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
      {(summary || findings.length || objective) ? (
        <section className="analysisConclusion">
          <h3>结果分析总结</h3>
          {objective ? (
            <p className="analysisGoal"><span>分析目标</span>{objective}</p>
          ) : null}
          {summaryParagraphs.length ? (
            summaryParagraphs.map((paragraph) => <p key={paragraph.slice(0, 48)}>{paragraph}</p>)
          ) : summary ? (
            <p>{summary}</p>
          ) : null}
          {findings.length ? (
            <ul>
              {findings.map((insight) => (
                <li key={insight}>{insight}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function DatasetStrip({ datasets, assetCount }: { datasets: Dataset[]; assetCount: number }) {
  if (!datasets.length) {
    return <div className="assetStrip mutedStrip">未选择数据集，请点击回形针选择数据集，或上传文件自动创建</div>;
  }
  return (
    <div className="assetStrip">
      {datasets.map((dataset) => (
        <span key={dataset.id}>{dataset.name} · {dataset.asset_ids.length} 个资产</span>
      ))}
      <small>合计 {assetCount} 个分析资产</small>
    </div>
  );
}

function AnalysisPlanStrip({
  steps,
  currentIndex,
  onClear,
}: {
  steps: string[];
  currentIndex: number;
  onClear: () => void;
}) {
  return (
    <div className="analysisPlanStrip">
      <div className="analysisPlanHeader">
        <strong>分析计划</strong>
        <small>
          {currentIndex >= steps.length ? "已完成" : `${currentIndex + 1} / ${steps.length}`}
        </small>
        <button type="button" className="iconOnly" title="清除计划" onClick={onClear}><X size={14} /></button>
      </div>
      <ol className="analysisPlanSteps">
        {steps.map((step, index) => {
          const status = index < currentIndex ? "done" : index === currentIndex ? "current" : "pending";
          return (
            <li key={`${index}-${step.slice(0, 24)}`} className={status} title={step}>
              <em>{index + 1}</em>
              <span>{step}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StrategyStrip({
  strategies,
  useNewStrategy,
  onUseNewStrategyChange,
  onOpen,
}: {
  strategies: StrategyAsset[];
  useNewStrategy: boolean;
  onUseNewStrategyChange: (value: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <div className="strategyStrip">
      <button onClick={onOpen} disabled={useNewStrategy} title={useNewStrategy ? "已勾选使用新策略，将按问题重新生成" : "选择策略资产"}>
        <GitBranch size={15} /> 策略资产
      </button>
      <label className="strategyModeToggle" title="勾选后先生成分析策略并确认，再执行分析">
        <input
          type="checkbox"
          checked={useNewStrategy}
          onChange={(event) => onUseNewStrategyChange(event.target.checked)}
        />
        <span className="strategyCheckIcon" aria-hidden="true" />
        <span className="strategyModeText">使用新策略</span>
      </label>
      {useNewStrategy ? (
        <small>先出策略，确认后再分析</small>
      ) : strategies.length ? (
        strategies.map((strategy) => <span key={strategy.id}>{strategy.title}</span>)
      ) : (
        <small>未选策略资产，将自动匹配并直接分析</small>
      )}
    </div>
  );
}

function RagContextStrip({ items, assets }: { items: RagContextItem[]; assets: Asset[] }) {
  if (!items.length) return <div className="ragStrip ragStripEmpty" />;
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

function DatasetPicker({
  datasets,
  selected,
  onToggle,
  onClose,
  onConfirm
}: {
  datasets: Dataset[];
  selected: string[];
  onToggle: (datasetId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modalBackdrop">
      <section className="reportPicker">
        <div className="sectionHeader">
          <div>
            <h2>选择数据集</h2>
            <p>分析必须基于数据集；可多选，确认后将使用其中全部数据资产。</p>
          </div>
          <button className="iconOnly" onClick={onClose} title="关闭"><X size={16} /></button>
        </div>
        <div className="pickerList">
          {datasets.length ? datasets.map((dataset) => (
            <label key={dataset.id} className="pickerCheck">
              <input type="checkbox" checked={selected.includes(dataset.id)} onChange={() => onToggle(dataset.id)} />
              <span>{dataset.name}</span>
              <small>{dataset.asset_ids.length} 个资产{dataset.description ? ` · ${dataset.description}` : ""}</small>
            </label>
          )) : (
            <div className="emptyChoice">暂无数据集，请先到数据管理构建，或在此上传文件自动创建。</div>
          )}
        </div>
        <button className="confirmButton" onClick={onConfirm}><Check size={15} /> 确认选择 {selected.length} 个数据集</button>
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
