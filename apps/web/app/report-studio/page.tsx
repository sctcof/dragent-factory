"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Orbit,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  Sparkles,
  Trash2,
  WandSparkles,
  X
} from "lucide-react";
import {
  api,
  type ApiTaskBundle,
  type Asset,
  type Dataset,
  type Report,
  type Strategy
} from "../../lib/api";
import { ChartPanel } from "../../components/ChartPanel";

type StudioStep = "compose" | "orbs" | "launch" | "done";
type OrbStatus = "draft" | "queued" | "running" | "success" | "failed";

type ReportOrb = {
  id: string;
  order: number;
  question: string;
  chartType: string;
  selected: boolean;
  status: OrbStatus;
  x: number;
  y: number;
  dx: number;
  dy: number;
  duration: number;
  delay: number;
  summary?: string;
  bundle?: ApiTaskBundle;
};

type OrbMotion = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  turnIn: number;
};

type ReportStudioSnapshot = {
  selectedDatasetId: string;
  reportTitle: string;
  analysisGoal: string;
  divergenceGoal: string;
  recommendations: string[];
  orbs: ReportOrb[];
  step: StudioStep;
  notice: string;
  report: Report | null;
  conclusion: string;
  launchSettled: boolean;
  progressCollapsed: boolean;
  executionPaused: boolean;
  progressPosition: { x: number; y: number } | null;
  updatedAt: string;
};

const chartTypes = [
  { type: "line", label: "曲线图" },
  { type: "bar", label: "柱状图" },
  { type: "pie", label: "饼图" },
  { type: "heatmap", label: "热力图" },
  { type: "scatter", label: "散点图" },
  { type: "area", label: "面积图" },
  { type: "funnel", label: "漏斗图" },
  { type: "treemap", label: "矩形树图" }
];

const fallbackQuestions = [
  "按时间维度观察核心指标趋势，识别高峰、低谷和异常波动。",
  "按区域、渠道或品类拆解贡献，找出主要增长来源。",
  "对比不同分组的结构差异，定位表现突出的细分对象。",
  "检查数据质量、口径一致性和多表关联覆盖情况。",
  "结合前序结论输出经营动作建议和后续监控指标。"
];

/* 从发散维度文本中解析期望的问题数量，默认 7 个，支持阿拉伯/中文数字。 */
const CHINESE_COUNT_DIGITS: Record<string, number> = {
  "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
  "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
};

function clampQuestionCount(value: number) {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function parseQuestionCount(text: string): number {
  const source = String(text || "");
  const arabicPatterns = [
    /(\d{1,2})\s*个\s*(?:问题|小球|模块)/,
    /(?:问题|小球|模块)\s*(?:数量|数|个)?\s*[为是至到：:]\s*(\d{1,2})/,
    /(\d{1,2})\s*个/,
  ];
  for (const pattern of arabicPatterns) {
    const match = source.match(pattern);
    if (match) return clampQuestionCount(parseInt(match[1], 10));
  }
  const chinesePatterns = [
    /([一两二三四五六七八九十])\s*个\s*(?:问题|小球|模块)/,
    /(?:问题|小球|模块)\s*(?:数量|数)?\s*[为是至到：:]\s*([一两二三四五六七八九十])/,
    /([一两二三四五六七八九十])\s*个/,
  ];
  for (const pattern of chinesePatterns) {
    const match = source.match(pattern);
    if (match && CHINESE_COUNT_DIGITS[match[1]]) return clampQuestionCount(CHINESE_COUNT_DIGITS[match[1]]);
  }
  return 7;
}

export default function ReportStudioPage() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [reportTitle, setReportTitle] = useState("纯图表报表");
  const [analysisGoal, setAnalysisGoal] = useState("");
  const [divergenceGoal, setDivergenceGoal] = useState("围绕趋势、贡献、异常、质量和经营动作发散分析");
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [orbs, setOrbs] = useState<ReportOrb[]>([]);
  const [activeOrbId, setActiveOrbId] = useState<string | null>(null);
  const [step, setStep] = useState<StudioStep>("compose");
  const [notice, setNotice] = useState("加载数据集中");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [studioSessionId, setStudioSessionId] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [datasetPickerOpen, setDatasetPickerOpen] = useState(false);
  const [launchSettled, setLaunchSettled] = useState(false);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const [executionPaused, setExecutionPaused] = useState(false);
  const [progressPosition, setProgressPosition] = useState<{ x: number; y: number } | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const statusPanelRef = useRef<HTMLElement | null>(null);
  const progressPanelRef = useRef<HTMLDivElement | null>(null);
  const panelDragRef = useRef<{ offsetX: number; offsetY: number; containerLeft: number; containerTop: number; maxX: number; maxY: number } | null>(null);
  const pauseRef = useRef(false);
  const orbFieldRef = useRef<HTMLDivElement | null>(null);
  const orbMotionRef = useRef<Map<string, OrbMotion>>(new Map());
  const orbDragRef = useRef<{
    orbId: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!persistenceReady || !studioSessionId) return;
    saveStudioSnapshot(studioSessionId, {
      selectedDatasetId,
      reportTitle,
      analysisGoal,
      divergenceGoal,
      recommendations,
      orbs,
      step,
      notice,
      report,
      conclusion,
      launchSettled,
      progressCollapsed,
      executionPaused,
      progressPosition,
      updatedAt: new Date().toISOString(),
    });
  }, [
    persistenceReady,
    studioSessionId,
    selectedDatasetId,
    reportTitle,
    analysisGoal,
    divergenceGoal,
    recommendations,
    orbs,
    step,
    notice,
    report,
    conclusion,
    launchSettled,
    progressCollapsed,
    executionPaused,
    progressPosition,
  ]);

  const selectedDataset = datasets.find((item) => item.id === selectedDatasetId);
  const selectedAssetIds = selectedDataset?.asset_ids || [];
  const selectedAssets = assets.filter((asset) => selectedAssetIds.includes(asset.id));
  const activeOrb = orbs.find((orb) => orb.id === activeOrbId) || null;
  const selectedReportOrbs = [...orbs].filter((orb) => orb.selected).sort((a, b) => a.order - b.order);
  const activeProgressIndex = Math.max(0, selectedReportOrbs.findIndex((orb) => orb.status === "running"));
  const completedCount = selectedReportOrbs.filter((orb) => orb.status === "success" || orb.status === "failed").length;
  const executionComplete = selectedReportOrbs.length > 0 && completedCount === selectedReportOrbs.length;
  const reportTheme = selectedDataset ? `纯图表报告 · ${selectedDataset.name}` : "纯图表报告";

  useEffect(() => {
    if (step !== "launch" && step !== "done") return;
    const activeItem = progressPanelRef.current?.querySelector(".reportProgressItem.active");
    activeItem?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [orbs, step]);

  /* Step 02：问题小球随机自由漂移（直接操作 DOM，避免每帧触发 React 渲染）。 */
  useEffect(() => {
    if (step !== "orbs") return undefined;
    const field = orbFieldRef.current;
    if (!field) return undefined;

    const particles = orbMotionRef.current;
    const activeIds = new Set(orbs.map((orb) => orb.id));
    for (const id of [...particles.keys()]) {
      if (!activeIds.has(id)) particles.delete(id);
    }
    const seedParticle = (orb: ReportOrb): OrbMotion => {
      const existing = particles.get(orb.id);
      if (existing) return existing;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.02 + Math.random() * 0.035; // px/ms ≈ 20~55 px/s
      const particle: OrbMotion = {
        x: (orb.x / 100) * field.clientWidth,
        y: (orb.y / 100) * field.clientHeight,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        turnIn: 400 + Math.random() * 1400,
      };
      particles.set(orb.id, particle);
      return particle;
    };
    for (const orb of orbs) seedParticle(orb);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const width = field.clientWidth;
      const height = field.clientHeight;
      for (const orb of orbs) {
        if (orbDragRef.current?.orbId === orb.id) continue;
        const element = field.querySelector<HTMLElement>(`[data-orb-id="${orb.id}"]`);
        if (!element) continue;
        const particle = seedParticle(orb);
        particle.turnIn -= dt;
        if (particle.turnIn <= 0) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 0.02 + Math.random() * 0.035;
          particle.vx = Math.cos(angle) * speed;
          particle.vy = Math.sin(angle) * speed;
          particle.turnIn = 400 + Math.random() * 1400;
        }
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        const margin = 10;
        const orbWidth = element.offsetWidth || 110;
        const orbHeight = element.offsetHeight || 80;
        const maxX = Math.max(margin, width - orbWidth - margin);
        const maxY = Math.max(margin, height - orbHeight - margin);
        if (particle.x < margin) {
          particle.x = margin;
          particle.vx = Math.abs(particle.vx);
        } else if (particle.x > maxX) {
          particle.x = maxX;
          particle.vx = -Math.abs(particle.vx);
        }
        if (particle.y < margin) {
          particle.y = margin;
          particle.vy = Math.abs(particle.vy);
        } else if (particle.y > maxY) {
          particle.y = maxY;
          particle.vy = -Math.abs(particle.vy);
        }
        element.style.left = `${particle.x}px`;
        element.style.top = `${particle.y}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [orbs, step]);

  const datasetMeta = useMemo(() => {
    const rowCount = selectedAssets.reduce((sum, asset) => sum + (asset.data_dictionary?.row_count || 0), 0);
    const fieldCount = selectedAssets.reduce((sum, asset) => sum + (asset.data_dictionary?.columns.length || 0), 0);
    return { rowCount, fieldCount, assetCount: selectedAssets.length };
  }, [selectedAssets]);

  async function load() {
    setPersistenceReady(false);
    setBusy(true);
    try {
      const urlSessionId = getStudioSessionIdFromUrl();
      if (urlSessionId) setStudioSessionId(urlSessionId);
      const [datasetItems, assetItems] = await Promise.all([api.listDatasets(), api.listAssetSummaries()]);
      setDatasets(datasetItems);
      setAssets(assetItems);
      const first = datasetItems[0];
      if (first) {
        let restoredFromSnapshot = false;
        if (urlSessionId) {
          restoredFromSnapshot = restoreStudioSnapshot(urlSessionId);
        }
        if (!restoredFromSnapshot) setSelectedDatasetId(first.id);
        const initialTitle = `纯图表报表 · ${first.name}`;
        if (!restoredFromSnapshot) {
          setReportTitle(initialTitle);
          setAnalysisGoal(`围绕「${first.name}」生成纯图表报表`);
        }
        if (urlSessionId) {
          void api.replaySession(urlSessionId).catch(async () => {
            const session = await api.createSession(initialTitle);
            setStudioSessionId(session.id);
            setStudioSessionUrl(session.id);
          });
        } else {
          const session = await api.createSession(initialTitle);
          setStudioSessionId(session.id);
          setStudioSessionUrl(session.id);
        }
        if (!restoredFromSnapshot) await loadRecommendations(first, assetItems);
        const restoredFromReport = !restoredFromSnapshot && urlSessionId ? await restoreReportFromSession(urlSessionId) : false;
        if (!restoredFromSnapshot && !restoredFromReport) setNotice("准备就绪");
      } else {
        setNotice("暂无数据集，请先在数据资产页创建数据集");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "加载失败");
    } finally {
      setPersistenceReady(true);
      setBusy(false);
    }
  }

  function restoreStudioSnapshot(sessionId: string) {
    const snapshot = readStudioSnapshot(sessionId);
    if (!snapshot) return false;
    setSelectedDatasetId(snapshot.selectedDatasetId);
    setReportTitle(snapshot.reportTitle);
    setAnalysisGoal(snapshot.analysisGoal);
    setDivergenceGoal(snapshot.divergenceGoal);
    setRecommendations(snapshot.recommendations);
    setOrbs(snapshot.orbs);
    setActiveOrbId(null);
    setStep(snapshot.step);
    setNotice(snapshot.notice || "已复原报表生成状态");
    setReport(snapshot.report);
    setConclusion(snapshot.conclusion);
    setLaunchSettled(snapshot.launchSettled);
    setProgressCollapsed(snapshot.progressCollapsed);
    setExecutionPaused(snapshot.executionPaused);
    pauseRef.current = snapshot.executionPaused;
    setProgressPosition(snapshot.progressPosition);
    return true;
  }

  async function loadRecommendations(dataset: Dataset, assetSource = assets, goal = "") {
    const assetIds = dataset.asset_ids || [];
    if (!assetIds.length) {
      setRecommendations(fallbackQuestions);
      return;
    }
    try {
      const result = await api.generateAnalysisQuestions(goal || `基于数据集 ${dataset.name} 推荐报表分析问题`, assetIds, 5);
      const next = result.questions.length ? result.questions : fallbackQuestions;
      setRecommendations(next);
      if (!analysisGoal && next[0]) setAnalysisGoal(next[0]);
    } catch {
      const assetNames = assetSource.filter((asset) => assetIds.includes(asset.id)).map((asset) => asset.name).slice(0, 3).join("、");
      setRecommendations([
        `概览 ${assetNames || dataset.name} 的核心指标趋势和异常点。`,
        ...fallbackQuestions.slice(1),
      ]);
    }
  }

  async function onDatasetChange(datasetId: string) {
    setSelectedDatasetId(datasetId);
    setDatasetPickerOpen(false);
    const dataset = datasets.find((item) => item.id === datasetId);
    if (!dataset) return;
    const nextTitle = `纯图表报表 · ${dataset.name}`;
    setReportTitle(nextTitle);
    setAnalysisGoal(`围绕「${dataset.name}」生成纯图表报表`);
    setNotice("正在读取数据集画像并生成推荐问题");
    if (studioSessionId) void api.updateSession(studioSessionId, { title: nextTitle }).catch(() => undefined);
    await loadRecommendations(dataset, assets, `围绕数据集 ${dataset.name} 生成推荐报表问题`);
    setNotice("推荐问题已生成，可继续编辑");
  }

  async function generateOrbs() {
    await runOrbGeneration("generate");
  }

  async function regenerateOrbs() {
    if (busy) return;
    await runOrbGeneration("regenerate");
  }

  async function runOrbGeneration(kind: "generate" | "regenerate") {
    if (!selectedDataset || !selectedAssetIds.length) {
      setNotice("请先选择包含数据资产的数据集");
      return;
    }
    setBusy(true);
    const desiredCount = parseQuestionCount(divergenceGoal);
    setNotice(kind === "regenerate" ? `正在重新发散报表问题（目标 ${desiredCount} 个）` : `正在调用模型发散报表问题（目标 ${desiredCount} 个）`);
    try {
      const prompt = [
        analysisGoal,
        divergenceGoal,
        `数据集：${selectedDataset.name}`,
        `资产数量：${datasetMeta.assetCount}，字段数量：${datasetMeta.fieldCount}`,
      ].filter(Boolean).join("\n");
      const result = await api.generateAnalysisQuestions(prompt, selectedAssetIds, desiredCount);
      const questions = (result.questions.length ? result.questions : recommendations.length ? recommendations : fallbackQuestions).slice(0, desiredCount);
      setOrbs(questions.map((question, index) => ({
        id: `orb_${Date.now()}_${index}`,
        order: index + 1,
        question,
        chartType: chartTypes[index % chartTypes.length].type,
        selected: true,
        status: "draft",
        ...orbMotion(index, questions.length),
      })));
      setActiveOrbId(null);
      setStep("orbs");
      setNotice(kind === "regenerate" ? `已重新生成 ${questions.length} 个报表模块小球，可继续编辑` : `已生成 ${questions.length} 个报表模块小球，可编辑问题、图表类型和顺序`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "生成问题失败");
    } finally {
      setBusy(false);
    }
  }

  function patchOrb(orbId: string, patch: Partial<ReportOrb>) {
    setOrbs((items) => items.map((orb) => orb.id === orbId ? { ...orb, ...patch } : orb));
  }

  function removeOrb(orbId: string) {
    setOrbs((items) => {
      const remaining = items.filter((orb) => orb.id !== orbId);
      return remaining.map((orb, index) => ({ ...orb, order: index + 1 }));
    });
    setActiveOrbId(null);
    setNotice("已删除该报表模块小球");
  }

  function beginOrbDrag(event: ReactPointerEvent<HTMLButtonElement>, orb: ReportOrb) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const element = event.currentTarget;
    const field = orbFieldRef.current;
    if (!field) return;
    const fieldRect = field.getBoundingClientRect();
    orbDragRef.current = {
      orbId: orb.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - fieldRect.left - element.offsetLeft,
      offsetY: event.clientY - fieldRect.top - element.offsetTop,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
  }

  function moveOrbDrag(event: ReactPointerEvent<HTMLButtonElement>, orb: ReportOrb) {
    const drag = orbDragRef.current;
    if (!drag || drag.orbId !== orb.id) return;
    const field = orbFieldRef.current;
    if (!field) return;
    const fieldRect = field.getBoundingClientRect();
    const maxX = Math.max(0, field.clientWidth - event.currentTarget.offsetWidth);
    const maxY = Math.max(0, field.clientHeight - event.currentTarget.offsetHeight);
    const x = Math.max(0, Math.min(maxX, event.clientX - fieldRect.left - drag.offsetX));
    const y = Math.max(0, Math.min(maxY, event.clientY - fieldRect.top - drag.offsetY));
    if (Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4) {
      drag.moved = true;
    }
    event.currentTarget.style.left = `${x}px`;
    event.currentTarget.style.top = `${y}px`;
    const particle = orbMotionRef.current.get(orb.id);
    if (particle) {
      particle.x = x;
      particle.y = y;
    }
  }

  function endOrbDrag(event: ReactPointerEvent<HTMLButtonElement>, orb: ReportOrb) {
    const drag = orbDragRef.current;
    if (!drag || drag.orbId !== orb.id) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    orbDragRef.current = null;
    // 位移小于阈值视为点击选中；拖拽不改变选中状态。
    if (!drag.moved) setActiveOrbId(orb.id);
  }

  function normalizeOrbOrder() {
    setOrbs((items) => [...items].sort((a, b) => a.order - b.order).map((orb, index) => ({ ...orb, order: index + 1 })));
  }

  async function launchReport() {
    const selectedOrbs = [...orbs].filter((orb) => orb.selected).sort((a, b) => a.order - b.order);
    if (!selectedDataset || !selectedAssetIds.length || !selectedOrbs.length) {
      setNotice("请至少保留一个报表模块小球");
      return;
    }
    setBusy(true);
    setStep("launch");
    setReport(null);
    setConclusion("");
    setExecutionPaused(false);
    pauseRef.current = false;
    setLaunchSettled(false);
    setOrbs((items) => items.map((orb) => orb.selected ? { ...orb, status: "queued", summary: undefined, bundle: undefined } : orb));
    try {
      const normalizedTitle = reportTitle.trim() || `纯图表报表 · ${selectedDataset.name}`;
      const sessionId = await ensureStudioSession(normalizedTitle);
      saveStudioSnapshot(sessionId, {
        selectedDatasetId,
        reportTitle: normalizedTitle,
        analysisGoal,
        divergenceGoal,
        recommendations,
        orbs: selectedOrbs.map((orb) => ({ ...orb, status: "queued", summary: undefined, bundle: undefined })),
        step: "launch",
        notice: "正在将问题小球投放到报表模块",
        report: null,
        conclusion: "",
        launchSettled: false,
        progressCollapsed,
        executionPaused: false,
        progressPosition,
        updatedAt: new Date().toISOString(),
      });
      let nextReport: Report | null = null;
      let previousSummary = "";

      setNotice("正在将问题小球投放到报表模块");
      await wait(1900 + selectedOrbs.length * 90);
      setLaunchSettled(true);
      await wait(260);

      for (const orb of selectedOrbs) {
        await waitWhilePaused(pauseRef, () => setNotice("任务已暂停，点击继续后执行后续模块"));
        patchOrb(orb.id, { status: "running" });
        setNotice(`正在生成模块 ${orb.order}：${orb.question}`);
        const taskPrompt = [
          orb.question,
          `请以 ${chartLabel(orb.chartType)} 作为优先展示方式，优先输出图表和 200 字以内的可复核短结论。`,
          divergenceGoal ? `拓展分析维度：${divergenceGoal}` : "",
          previousSummary ? `请结合前序模块结论继续分析：${previousSummary}` : "",
        ].filter(Boolean).join("\n");
        const task = await api.createTask(sessionId, taskPrompt, selectedAssetIds);
        const draft = await api.getTask(task.id);
        const strategy = withPreferredChart(draft.strategy, orb.chartType);
        if (!strategy) throw new Error(`模块 ${orb.order} 未生成策略`);
        const bundle = await api.confirmStrategy(task.id, strategy);
        const summary = bundle.task.analysis_summary || `模块 ${orb.order} 已完成分析。`;
        const payload = {
          session_id: sessionId,
          type: "visual_report_module",
          ref_id: bundle.execution?.execution_id || bundle.task.id,
          title: `${String(orb.order).padStart(2, "0")} · ${orb.question.slice(0, 34)}`,
          snapshot: {
            task_id: bundle.task.id,
            intent: orb.question,
            requested_chart_type: orb.chartType,
            summary,
            charts: bundle.charts,
            process_steps: bundle.execution?.process_steps || [],
            quality_table: bundle.execution?.quality_table || [],
            table: bundle.execution?.table || [],
            execution: bundle.execution,
            strategy: bundle.strategy,
            task: bundle.task,
          } as Record<string, unknown>,
        };
        nextReport = nextReport
          ? await api.appendReportItem(nextReport.id, payload)
          : await api.createReportFromModule({ ...payload, report_title: normalizedTitle });
        setReport(nextReport);
        previousSummary = [previousSummary, compactText(summary, 320)].filter(Boolean).join("\n").slice(-1600);
        patchOrb(orb.id, { status: bundle.execution?.status === "failed" ? "failed" : "success", summary, bundle });
      }

      setConclusion(buildConclusion(selectedOrbs.length, previousSummary));
      setExecutionPaused(false);
      pauseRef.current = false;
      setStep("done");
      setNotice("所有模块已完成，报表已生成");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "报表生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function ensureStudioSession(title: string) {
    if (studioSessionId) {
      try {
        await api.replaySession(studioSessionId);
        void api.updateSession(studioSessionId, { title }).catch(() => undefined);
        setStudioSessionUrl(studioSessionId);
        return studioSessionId;
      } catch {
        // URL 中可能是过期会话，重新创建一个可复原的报表会话。
      }
    }
    const session = await api.createSession(title);
    setStudioSessionId(session.id);
    setStudioSessionUrl(session.id);
    return session.id;
  }

  async function startFreshReportSession() {
    const title = reportTitle.trim() || reportTheme;
    setBusy(true);
    setNotice("正在创建新的报表会话");
    try {
      const session = await api.createSession(title);
      setStudioSessionId(session.id);
      setStudioSessionUrl(session.id);
      setReport(null);
      setConclusion("");
      setOrbs([]);
      setActiveOrbId(null);
      setLaunchSettled(false);
      setProgressCollapsed(false);
      setExecutionPaused(false);
      pauseRef.current = false;
      setStep("compose");
      setNotice("新的报表会话已创建");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "新建报表会话失败");
    } finally {
      setBusy(false);
    }
  }

  async function restoreReportFromSession(sessionId: string) {
    try {
      const reportsResult = await api.listReports();
      const matchedReport = reportsResult.items.find((item) => item.session_id === sessionId);
      if (!matchedReport) return false;
      const detail = await api.reportDetail(matchedReport.id);
      const pureItems = detail.items.filter((item) => item.type === "visual_report_module");
      if (!pureItems.length || pureItems.length !== detail.items.length) return false;
      const restoredOrbs = pureItems.map((item, index) => {
        const snapshot = item.snapshot as Record<string, unknown>;
        const question = typeof snapshot.intent === "string" ? snapshot.intent : item.title;
        const summary = typeof snapshot.summary === "string" ? snapshot.summary : "模块分析完成。";
        const chartType = typeof snapshot.requested_chart_type === "string" ? snapshot.requested_chart_type : "line";
        const task = isObjectRecord(snapshot.task)
          ? snapshot.task as ApiTaskBundle["task"]
          : {
              id: typeof snapshot.task_id === "string" ? snapshot.task_id : item.ref_id,
              session_id: sessionId,
              status: "success",
              user_intent: question,
              selected_assets: selectedAssetIds,
              analysis_summary: summary,
              errors: [],
            };
        const bundle: ApiTaskBundle = {
          type: "task",
          task,
          strategy: isObjectRecord(snapshot.strategy) ? snapshot.strategy as Strategy : undefined,
          execution: isObjectRecord(snapshot.execution) ? snapshot.execution as ApiTaskBundle["execution"] : undefined,
          charts: Array.isArray(snapshot.charts) ? snapshot.charts as ApiTaskBundle["charts"] : [],
          feedback: null,
        };
        return {
          id: item.id || `restored_orb_${index}`,
          order: index + 1,
          question,
          chartType,
          selected: true,
          status: "success" as OrbStatus,
          summary,
          bundle,
          ...orbMotion(index, pureItems.length),
        };
      });
      setReport(detail.report);
      setReportTitle(detail.report.title);
      setOrbs(restoredOrbs);
      setActiveOrbId(null);
      setLaunchSettled(true);
      setStep("done");
      setConclusion(buildConclusion(restoredOrbs.length, restoredOrbs.map((orb) => orb.summary || "").join("\n")));
      setNotice("已复原该报表会话");
      return true;
    } catch {
      // 复原失败不阻塞新建报表流程。
      return false;
    }
  }

  function beginProgressDrag(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    const panel = statusPanelRef.current;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    panelDragRef.current = {
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
      containerLeft: 0,
      containerTop: 0,
      maxX: Math.max(0, window.innerWidth - panelRect.width - 12),
      maxY: Math.max(0, window.innerHeight - panelRect.height - 12),
    };
    panel.setPointerCapture(event.pointerId);
  }

  function moveProgressPanel(event: ReactPointerEvent<HTMLElement>) {
    const drag = panelDragRef.current;
    if (!drag) return;
    setProgressPosition({
      x: clamp(event.clientX - drag.containerLeft - drag.offsetX, 12, drag.maxX),
      y: clamp(event.clientY - drag.containerTop - drag.offsetY, 12, drag.maxY),
    });
  }

  function endProgressDrag(event: ReactPointerEvent<HTMLElement>) {
    panelDragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function toggleExecutionPaused() {
    setExecutionPaused((current) => {
      const next = !current;
      pauseRef.current = next;
      setNotice(next ? "任务已暂停，当前模块完成后会暂停后续执行" : "任务已继续执行");
      return next;
    });
  }

  return (
    <main className="reportStudioPage">
      <div className="reportStudioStars" aria-hidden="true" />
      <header className="reportStudioTopbar">
        <a className="reportStudioBack" href="/workspace"><ArrowLeft size={16} /> 返回工作台</a>
        <div>
          <span>Pure BI Report Mode</span>
          <strong>{notice}</strong>
        </div>
        <a className="reportStudioBack" href="/reports"><FileText size={16} /> 报告列表</a>
      </header>

      <section className={`reportStudioHero ${step === "launch" || step === "done" ? "compact" : ""}`}>
        <div>
          <span className="reportStudioEyebrow"><Orbit size={16} /> AI Report Orchestration</span>
          <h1>纯报表生成舱</h1>
          <p>选择数据集，输入分析方向，系统会将发散问题编排成可编辑小球，再逐个生成策略、脚本、图表和最终报告。</p>
        </div>
        <div className="reportStudioTelemetry">
          <span><strong>{datasetMeta.assetCount}</strong> 数据资产</span>
          <span><strong>{datasetMeta.fieldCount}</strong> 字段画像</span>
          <span><strong>{orbs.filter((orb) => orb.selected).length || "-"}</strong> 报表模块</span>
        </div>
      </section>

      <section className={`reportStudioConsole step-${step}`}>
        <div className="reportStudioGrid" aria-hidden="true" />
        <div className="reportStudioRobot"><Bot size={28} /><span>BI</span></div>

        {step === "compose" ? (
          <div className="reportStudioGlass">
            <div className="glassHeader">
              <div><Sparkles size={18} /><strong>新建纯报表</strong></div>
              <span>Step 01 / 04</span>
            </div>
            <label className="reportStudioField">
              <span>报告标题</span>
              <input value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} placeholder="输入报告标题" />
            </label>
            <div className="reportStudioField">
              <span>选择数据集</span>
              <div className="reportDatasetPicker">
                <button
                  className="reportDatasetSelectButton"
                  disabled={!datasets.length}
                  type="button"
                  onClick={() => setDatasetPickerOpen((open) => !open)}
                >
                  <span>
                    <strong>{selectedDataset?.name || "请选择数据集"}</strong>
                    <small>
                      {selectedDataset
                        ? `${datasetMeta.assetCount || selectedDataset.asset_ids.length} 个资产 · ${datasetMeta.fieldCount || "-"} 个字段`
                        : "选择后自动生成推荐问题和报表上下文"}
                    </small>
                  </span>
                  <ChevronDown size={17} />
                </button>
                {datasetPickerOpen ? (
                  <div className="reportDatasetMenu">
                    {datasets.map((dataset) => (
                      <button
                        key={dataset.id}
                        className={dataset.id === selectedDatasetId ? "active" : ""}
                        type="button"
                        onClick={() => void onDatasetChange(dataset.id)}
                      >
                        <span>
                          <strong>{dataset.name}</strong>
                          <small>{dataset.asset_ids.length} 个资产 · {dataset.created_at?.slice(0, 10) || "未记录日期"}</small>
                        </span>
                        {dataset.id === selectedDatasetId ? <Check size={16} /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <label className="reportStudioField">
              <span>希望分析的维度 / 目标</span>
              <textarea value={analysisGoal} onChange={(event) => setAnalysisGoal(event.target.value)} />
            </label>
            {recommendations.length ? (
              <label className="reportStudioField reportStudioRecommendationSelect">
                <span>数据集推荐问题</span>
                <select value="" onChange={(event) => event.target.value && setAnalysisGoal(event.target.value)}>
                  <option value="">选择一个推荐问题写入上方目标</option>
                  {recommendations.map((question, index) => (
                    <option key={question} value={question}>{index + 1}. {question}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="reportStudioField">
              <span>拓展的发散维度<small className="reportStudioFieldHint">可在描述中指定问题数量，如「发散 5 个问题」，默认 7 个</small></span>
              <textarea value={divergenceGoal} onChange={(event) => setDivergenceGoal(event.target.value)} />
            </label>
            <button className="reportStudioPrimary" disabled={busy || !selectedDatasetId} onClick={generateOrbs}>
              {busy ? <Loader2 size={18} className="spinIcon" /> : <WandSparkles size={18} />} 下一步：生成问题小球
            </button>
          </div>
        ) : null}

        {step === "orbs" ? (
          <div className="reportStudioGlass wideGlass">
            <div className="glassHeader">
              <div><Orbit size={18} /><strong>选择和编排小球</strong></div>
              <span>Step 02 / 04</span>
            </div>
            <div className="orbField" ref={orbFieldRef}>
              {orbs.map((orb, index) => (
                <button
                  key={orb.id}
                  data-orb-id={orb.id}
                  className={`analysisOrb ${orb.selected ? "selected" : ""} ${activeOrbId === orb.id ? "active" : ""}`}
                  style={orbStyle(orb, index)}
                  onPointerDown={(event) => beginOrbDrag(event, orb)}
                  onPointerMove={(event) => moveOrbDrag(event, orb)}
                  onPointerUp={(event) => endOrbDrag(event, orb)}
                  onPointerCancel={(event) => endOrbDrag(event, orb)}
                  type="button"
                  aria-label={`问题小球 ${orb.order}：${orb.question}`}
                >
                  <span>{orb.order}</span>
                  <strong>{chartLabel(orb.chartType)}</strong>
                  <em>{orb.question}</em>
                </button>
              ))}
              {!orbs.length ? (
                <div className="orbEmptyHint">
                  <Orbit size={22} />
                  <span>暂无问题小球，点击下方「重新生成」重新发散问题</span>
                </div>
              ) : null}
            </div>
            {activeOrb ? (
              <div className="orbEditor">
                <div>
                  <button className={activeOrb.selected ? "active" : ""} onClick={() => patchOrb(activeOrb.id, { selected: !activeOrb.selected })}>
                    <Check size={15} /> {activeOrb.selected ? "已选中" : "未选中"}
                  </button>
                  <button onClick={() => setActiveOrbId(null)}><X size={15} /> 关闭编辑</button>
                  <button className="orbDeleteButton" onClick={() => removeOrb(activeOrb.id)}>
                    <Trash2 size={15} /> 删除该小球
                  </button>
                </div>
                <label>
                  <span>问题</span>
                  <textarea value={activeOrb.question} onChange={(event) => patchOrb(activeOrb.id, { question: event.target.value })} />
                </label>
                <label>
                  <span>图表类型</span>
                  <select value={activeOrb.chartType} onChange={(event) => patchOrb(activeOrb.id, { chartType: event.target.value })}>
                    {chartTypes.map((chart) => <option key={chart.type} value={chart.type}>{chart.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>顺序</span>
                  <input
                    type="number"
                    min={1}
                    max={orbs.length}
                    value={activeOrb.order}
                    onChange={(event) => patchOrb(activeOrb.id, { order: Number(event.target.value) || activeOrb.order })}
                    onBlur={normalizeOrbOrder}
                  />
                </label>
              </div>
            ) : null}
            <div className="reportStudioActions">
              <button className="reportStudioGhost" onClick={() => setStep("compose")}>
                <ArrowLeft size={16} /> 上一步
              </button>
              <button className="reportStudioGhost reportStudioRegenerate" disabled={busy} onClick={regenerateOrbs}>
                {busy ? <Loader2 size={16} className="spinIcon" /> : <RefreshCw size={16} />} 重新生成
              </button>
              <button className="reportStudioPrimary" disabled={busy || !orbs.some((orb) => orb.selected)} onClick={launchReport}>
                <Rocket size={18} /> 下一步：发射到报表
              </button>
            </div>
          </div>
        ) : null}

        {step === "launch" || step === "done" ? (
          <div className="reportLaunchLayer">
            {!launchSettled ? (
              <div className="flyingOrbLayer" aria-hidden="true">
                {selectedReportOrbs.map((orb, index) => (
                  <div key={`flight_${orb.id}`} className="flyingReportOrb" style={flyingOrbStyle(index)}>
                    <span>{orb.order}</span>
                    <strong>{chartLabel(orb.chartType)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="reportExecutionLayout">
              <div className={`reportCanvas ${launchSettled ? "active" : "deploying"}`}>
                <section className="pureReportHeader">
                  <span>BI Chart Report</span>
                  <h2>{reportTitle.trim() || reportTheme}</h2>
                  <p>{analysisGoal || "围绕所选数据集生成图表化分析报告。"}</p>
                </section>
                {selectedReportOrbs.length ? selectedReportOrbs.map((orb, index) => {
                  const isLastWide = selectedReportOrbs.length % 2 === 1 && index === selectedReportOrbs.length - 1;
                  return orb.bundle ? (
                    <ReportPreviewModule key={orb.bundle.task.id} index={index + 1} orb={orb} bundle={orb.bundle} wide={isLastWide} />
                  ) : (
                    <ReportModuleSlot key={orb.id} index={index + 1} orb={orb} settled={launchSettled} wide={isLastWide} />
                  );
                }) : (
                  <div className="emptyReportCanvas">
                    <Rocket size={28} />
                    <span>小球正在发射到报表版面，随后将在模块中开始分析。</span>
                  </div>
                )}
                {step === "done" ? (
                  <section className="reportStudioConclusion">
                    <h2>最终分析结论</h2>
                    <p>{conclusion}</p>
                    <div className="reportStudioActions">
                      {report ? <a className="reportStudioPrimary" href={`/reports/${report.id}`}>打开完整报告 <ChevronRight size={17} /></a> : null}
                      <button disabled={busy} onClick={() => void startFreshReportSession()}><RefreshCw size={16} /> 新建下一份</button>
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
            <aside
              className={`reportProgressPanel ${progressCollapsed ? "collapsed" : ""}`}
              ref={statusPanelRef}
              style={progressPosition ? ({ left: progressPosition.x, top: progressPosition.y, right: "auto" } as CSSProperties) : undefined}
              onPointerMove={moveProgressPanel}
              onPointerUp={endProgressDrag}
              onPointerCancel={endProgressDrag}
            >
              {progressCollapsed ? (
                <div
                  className="progressFloatingBall"
                  style={{ "--progress-value": `${selectedReportOrbs.length ? (completedCount / selectedReportOrbs.length) * 100 : 0}%` } as CSSProperties}
                  onPointerDown={beginProgressDrag}
                >
                  <button type="button" className="progressBallMain" onClick={() => setProgressCollapsed(false)} aria-label="展开执行状态">
                    <span>{completedCount}/{selectedReportOrbs.length}</span>
                    <em>{executionComplete ? "完成" : executionPaused ? "暂停" : "执行"}</em>
                  </button>
                  {!executionComplete ? (
                    <button type="button" className="progressBallPause" onClick={toggleExecutionPaused} aria-label={executionPaused ? "继续任务" : "暂停任务"}>
                      {executionPaused ? <Play size={13} /> : <Pause size={13} />}
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="reportProgressHeader" onPointerDown={beginProgressDrag}>
                    <span>执行状态</span>
                    <div>
                      <strong>{completedCount}/{selectedReportOrbs.length}</strong>
                      <button
                        type="button"
                        className="progressCollapseButton"
                        onClick={() => setProgressCollapsed(true)}
                        aria-label="折叠执行状态"
                      >
                        <ChevronDown size={16} />
                      </button>
                      <button
                        type="button"
                        className={`progressPauseButton ${executionPaused ? "paused" : ""} ${executionComplete ? "complete" : ""}`}
                        disabled={executionComplete}
                        onClick={toggleExecutionPaused}
                      >
                        {executionComplete ? <Check size={14} /> : executionPaused ? <Play size={14} /> : <Pause size={14} />}
                        {executionComplete ? "已完成" : executionPaused ? "继续" : "暂停"}
                      </button>
                    </div>
                  </div>
                  <div className="reportProgressTrack">
                    <i style={{ height: `${selectedReportOrbs.length ? Math.max(8, (completedCount / selectedReportOrbs.length) * 100) : 0}%` }} />
                  </div>
                  <div className="reportProgressList" ref={progressPanelRef}>
                    {selectedReportOrbs.map((orb, index) => (
                      <div
                        key={orb.id}
                        className={`reportProgressItem ${orb.status} ${index === activeProgressIndex ? "active" : ""}`}
                      >
                        <span>{String(orb.order).padStart(2, "0")}</span>
                        <div>
                          <strong>{chartLabel(orb.chartType)}</strong>
                          <em>{statusText(orb.status)}</em>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ReportModuleSlot({ index, orb, settled, wide }: { index: number; orb: ReportOrb; settled: boolean; wide?: boolean }) {
  return (
    <article className={`reportModuleSlot ${wide ? "wideModule" : ""} ${settled ? "settled" : "launching"} ${orb.status}`}>
      <div>
        <span>{String(index).padStart(2, "0")}</span>
        <strong>{chartLabel(orb.chartType)}</strong>
      </div>
      <h3>{orb.question}</h3>
      <div className="moduleSlotStage">
        {orb.status === "running" ? <Loader2 size={18} className="spinIcon" /> : <Rocket size={18} />}
        <span>{settled ? statusText(orb.status) : "投放中"}</span>
      </div>
      <div className="moduleSlotSkeleton" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </article>
  );
}

function ReportPreviewModule({ index, orb, bundle, wide }: { index: number; orb: ReportOrb; bundle: ApiTaskBundle; wide?: boolean }) {
  const chart = bundle.charts.find((item) => item.type !== "table");
  const fullSummary = bundle.task.analysis_summary || "模块分析完成。";
  return (
    <article className={`reportPreviewModule pureReportModule ${wide ? "wideModule" : ""}`}>
      <div className="pureReportModuleHeader">
        <span>{String(index).padStart(2, "0")}</span>
        <div>
          <strong>{chartLabel(orb.chartType)}</strong>
          <h3>{orb.question}</h3>
        </div>
      </div>
      <div className="pureChartResult">
        {chart ? <ChartPanel chart={chart} /> : <div className="pureChartEmpty">暂无可视化图表，模块已完成分析。</div>}
      </div>
      <PureReportInsightText text={fullSummary} />
    </article>
  );
}

function PureReportInsightText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const normalized = text.replace(/\s+/g, " ").trim() || "模块分析完成。";
  const longSummary = normalized.length > 200;
  const displayText = longSummary && !expanded ? `${compactText(normalized, 200)}...` : text;

  return (
    <section className={`pureReportInsight ${expanded ? "expanded" : ""}`}>
      <strong>分析结果</strong>
      <p>{displayText}</p>
      {longSummary ? (
        <button type="button" className="pureReportMore" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起信息" : "详细信息"}
        </button>
      ) : null}
    </section>
  );
}

function withPreferredChart(strategy: Strategy | undefined, chartType: string): Strategy | undefined {
  if (!strategy) return undefined;
  const current = strategy.chart_suggestions?.[0] || {};
  return {
    ...strategy,
    chart_suggestions: [
      { ...current, type: chartType },
      ...(strategy.chart_suggestions || []).slice(1),
    ],
  };
}

function chartLabel(type: string) {
  return chartTypes.find((chart) => chart.type === type)?.label || type;
}

function statusText(status: OrbStatus) {
  return status === "draft" ? "待确认" : status === "queued" ? "排队中" : status === "running" ? "分析中" : status === "success" ? "已完成" : "失败";
}

function buildConclusion(count: number, summary: string) {
  return compactText(`本次纯图表报告共完成 ${count} 个分析模块，已形成对应图表和短结论。${summary ? ` 核心摘要：${summary.split("\n").slice(-2).join(" ")}` : ""}`, 200);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getStudioSessionIdFromUrl() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("session_id") || "";
}

function setStudioSessionUrl(sessionId: string) {
  if (typeof window === "undefined" || !sessionId) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("session_id") === sessionId) return;
  url.searchParams.set("session_id", sessionId);
  window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function studioSnapshotKey(sessionId: string) {
  return `dragent.reportStudio.${sessionId}`;
}

function saveStudioSnapshot(sessionId: string, snapshot: ReportStudioSnapshot) {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    window.localStorage.setItem(studioSnapshotKey(sessionId), JSON.stringify(snapshot));
  } catch {
    // 本地存储不可用时不影响报表生成。
  }
}

function readStudioSnapshot(sessionId: string): ReportStudioSnapshot | null {
  if (typeof window === "undefined" || !sessionId) return null;
  try {
    const raw = window.localStorage.getItem(studioSnapshotKey(sessionId));
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<ReportStudioSnapshot>;
    if (!snapshot || typeof snapshot !== "object" || !snapshot.step || !Array.isArray(snapshot.orbs)) return null;
    return {
      selectedDatasetId: snapshot.selectedDatasetId || "",
      reportTitle: snapshot.reportTitle || "纯图表报表",
      analysisGoal: snapshot.analysisGoal || "",
      divergenceGoal: snapshot.divergenceGoal || "围绕趋势、贡献、异常、质量和经营动作发散分析",
      recommendations: Array.isArray(snapshot.recommendations) ? snapshot.recommendations : [],
      orbs: snapshot.orbs as ReportOrb[],
      step: snapshot.step,
      notice: snapshot.notice || "已复原报表生成状态",
      report: snapshot.report || null,
      conclusion: snapshot.conclusion || "",
      launchSettled: Boolean(snapshot.launchSettled),
      progressCollapsed: Boolean(snapshot.progressCollapsed),
      executionPaused: Boolean(snapshot.executionPaused),
      progressPosition: snapshot.progressPosition || null,
      updatedAt: snapshot.updatedAt || "",
    };
  } catch {
    return null;
  }
}

async function waitWhilePaused(pauseRef: { current: boolean }, onPaused: () => void) {
  let notified = false;
  while (pauseRef.current) {
    if (!notified) {
      onPaused();
      notified = true;
    }
    await wait(300);
  }
}

function compactText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function orbMotion(index: number, total: number) {
  const columns = total <= 4 ? total : 4;
  const rows = Math.ceil(total / columns);
  const col = index % columns;
  const row = Math.floor(index / columns);
  const cellW = 82 / Math.max(columns, 1);
  const cellH = 70 / Math.max(rows, 1);
  const jitterX = pseudoRandom(index + 3) * Math.min(8, cellW * .36) - Math.min(4, cellW * .18);
  const jitterY = pseudoRandom(index + 11) * Math.min(10, cellH * .42) - Math.min(5, cellH * .21);
  return {
    x: 8 + col * cellW + cellW * .5 + jitterX,
    y: 12 + row * cellH + cellH * .5 + jitterY,
    dx: Math.round((pseudoRandom(index + 23) * 30) - 15),
    dy: Math.round((pseudoRandom(index + 37) * 28) - 14),
    duration: Number((4.6 + pseudoRandom(index + 51) * 2.8).toFixed(2)),
    delay: Number((-pseudoRandom(index + 71) * 3.2).toFixed(2)),
  };
}

function pseudoRandom(seed: number) {
  const value = Math.sin(seed * 9301 + 49297) * 233280;
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function orbStyle(orb: ReportOrb, index: number): CSSProperties {
  return {
    "--orb-index": index,
    "--orb-x": `${orb.x}%`,
    "--orb-y": `${orb.y}%`,
    "--orb-dx": `${orb.dx}px`,
    "--orb-dy": `${orb.dy}px`,
    "--orb-duration": `${orb.duration}s`,
    "--orb-delay": `${orb.delay}s`,
  } as CSSProperties;
}

function flyingOrbStyle(index: number): CSSProperties {
  const column = index % 2;
  const row = Math.floor(index / 2);
  const endX = 24 + column * 48;
  const endY = 250 + row * 292;
  return {
    "--fly-start-x": `${76 + index * 132}px`,
    "--fly-start-y": "66px",
    "--fly-mid-x": `${18 + column * 44}%`,
    "--fly-mid-y": `${Math.max(154, endY - 92)}px`,
    "--fly-end-x": `${endX}%`,
    "--fly-end-y": `${endY}px`,
    "--fly-delay": `${index * 90}ms`,
  } as CSSProperties;
}
