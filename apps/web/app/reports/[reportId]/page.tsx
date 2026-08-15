"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Download, FileText, MoreHorizontal, Pencil, Play, Sparkles, Trash2, X } from "lucide-react";
import { api, type ChartConfig, type ReportDetail, type Strategy, type StrategyAsset } from "../../../lib/api";
import { ChartPanel, DataTable } from "../../../components/ChartPanel";
import { StrategyFlow } from "../../../components/StrategyFlow";

export default function ReportPage({ params }: { params: { reportId: string } }) {
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [notice, setNotice] = useState("加载中");
  const [generatedStrategy, setGeneratedStrategy] = useState<StrategyAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);

  useEffect(() => {
    api.reportDetail(params.reportId)
      .then((value) => {
        setDetail(value);
        setTitleDraft(value.report.title);
        setNotice("就绪");
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "加载失败"));
  }, [params.reportId]);

  const versions = detail?.report.versions || [];
  const latestVersion = detail?.version?.version || versions[versions.length - 1]?.version || 1;
  const isPureChartReport = Boolean(detail?.items.length) && detail!.items.every((item) => item.type === "visual_report_module");
  const pureReportConclusion = isPureChartReport ? buildPureReportConclusion(detail!.items) : "";
  const backHref = isPureChartReport ? `/report-studio?session_id=${encodeURIComponent(detail!.report.session_id)}` : "/workspace";
  const backLabel = isPureChartReport ? "返回报表生成舱" : "返回对话";

  const exportPdf = () => {
    window.print();
  };

  async function deleteSourceSession() {
    if (!detail) return;
    await api.deleteSession(detail.session.id);
    setNotice("来源会话已删除");
  }

  async function saveReportTitle() {
    if (!detail || busy) return;
    const title = titleDraft.trim();
    if (!title) {
      setNotice("报告标题不能为空");
      return;
    }
    setBusy(true);
    setNotice("正在保存报告标题");
    try {
      const report = await api.updateReport(detail.report.id, { title });
      setDetail({ ...detail, report });
      setTitleDraft(report.title);
      setEditingTitle(false);
      setNotice("报告标题已更新");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "标题保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function runModule(moduleId: string) {
    setNotice("正在运行报告模块");
    try {
      const next = await api.runReportModule(detail!.report.id, moduleId);
      setDetail(next);
      setNotice("模块运行完成，图表已刷新");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "运行失败");
    }
  }

  async function generateStrategy() {
    if (!detail || busy) return;
    setBusy(true);
    setNotice("正在基于报告内容生成分析策略");
    try {
      const result = await api.generateReportStrategy(detail.report.id);
      setGeneratedStrategy(result.strategy);
      setNotice(
        result.generation.status === "success"
          ? `分析策略已由 ${result.generation.model} 生成`
          : `分析策略已生成；${result.generation.reason || "当前使用本地降级模式"}`
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "分析策略生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteModule(moduleId: string) {
    if (!detail || busy || !window.confirm("确定从报告中删除这个模块吗？")) return;
    setBusy(true);
    setNotice("正在删除报告模块");
    try {
      const next = await api.deleteReportModule(detail.report.id, moduleId);
      setDetail(next);
      setNotice("模块已删除，报告序号已重新排列");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "模块删除失败");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) {
    return (
      <main className="reportPage">
        <div className="detailTopbar">
          <a className="linkButton" href="/workspace"><ArrowLeft size={16} /> 返回</a>
          <span>{notice}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="reportPage">
      <header className="reportToolbar">
        <a className="linkButton" href={backHref}><ArrowLeft size={16} /> {backLabel}</a>
        <div className="buttonRow">
          <button disabled={busy || !detail.items.length} onClick={generateStrategy}>
            <Sparkles size={16} /> 生成分析策略
          </button>
          <button onClick={deleteSourceSession}><Trash2 size={16} /> 删除来源会话</button>
          <a className="linkButton" href={`${api.base}/api/reports/${detail.report.id}/versions/${latestVersion}/download?format=markdown`}>
            Markdown
          </a>
          <button className="confirmButton" onClick={exportPdf}><Download size={16} /> 导出 PDF</button>
        </div>
      </header>

      <article className={`reportDocument ${isPureChartReport ? "pureReportDocument" : ""}`}>
        <section className="reportCover">
          <FileText size={34} />
          {editingTitle ? (
            <div className="reportTitleEditor">
              <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} />
              <button className="confirmButton" disabled={busy} onClick={saveReportTitle}><Check size={16} /> 保存</button>
              <button disabled={busy} onClick={() => { setTitleDraft(detail.report.title); setEditingTitle(false); }}><X size={16} /> 取消</button>
            </div>
          ) : (
            <div className="reportCoverTitleRow">
              <h1>{detail.report.title}</h1>
              <button className="iconOnly" disabled={busy} onClick={() => setEditingTitle(true)} title="编辑报告标题"><Pencil size={17} /></button>
            </div>
          )}
          <p>来源会话：{detail.session.title}</p>
          <p>报告版本：v{latestVersion}</p>
        </section>

        {isPureChartReport ? (
          <section className="reportCanvas active reportPageCanvas">
            <section className="pureReportHeader">
              <span>BI Chart Report</span>
              <h2>{detail.report.title}</h2>
              <p>只展示报告主题、分析问题、图表结果和短结论，隐藏策略流程、执行步骤和数据表格。</p>
            </section>
            {detail.items.map((item, index) => {
              const isLastWide = detail.items.length % 2 === 1 && index === detail.items.length - 1;
              return (
                <PureReportModule
                  key={item.id || `${item.ref_id}-${index}`}
                  index={index + 1}
                  item={item}
                  wide={isLastWide}
                />
              );
            })}
            <section className="pureReportFinalConclusion">
              <span>Final Insight</span>
              <h2>最终分析结论</h2>
              <p>{pureReportConclusion}</p>
            </section>
          </section>
        ) : (
          detail.items.map((item, index) => (
            <ReportModule
              key={item.id || `${item.ref_id}-${index}`}
              index={index + 1}
              item={item}
              busy={busy}
              onRun={() => runModule(item.id)}
              onDelete={() => deleteModule(item.id)}
            />
          ))
        )}
      </article>

      <button className="floatingExport" onClick={exportPdf}>
        <Download size={18} /> 导出 PDF
      </button>
      {generatedStrategy ? (
        <div className="modalBackdrop">
          <section className="strategyModal">
            <div className="sectionHeader">
              <div>
                <h2>{generatedStrategy.title}</h2>
                <p>已保存为策略资产，可在后续对话中选择使用。</p>
              </div>
              <button className="iconOnly" onClick={() => setGeneratedStrategy(null)} title="关闭"><X size={16} /></button>
            </div>
            <p className="sessionStrategyObjective">{generatedStrategy.objective}</p>
            <div className="strategyChips">
              <span>维度：{generatedStrategy.dimensions.join(", ") || "-"}</span>
              <span>指标：{generatedStrategy.metrics.join(", ") || "-"}</span>
            </div>
            <div className="strategyFlowPanel">
              <strong>分析流程</strong>
              <StrategyFlow methods={generatedStrategy.methods} />
            </div>
            <div className="buttonRow">
              <a className="linkButton" href="/strategies">查看策略资产</a>
              <button className="confirmButton" onClick={() => setGeneratedStrategy(null)}>完成</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function PureReportModule({
  index,
  item,
  wide,
}: {
  index: number;
  item: { id: string; title: string; type: string; ref_id: string; snapshot: Record<string, unknown> };
  wide?: boolean;
}) {
  const charts = normalizeCharts(item.snapshot.charts).filter((chart) => chart.type !== "table");
  const chart = charts[0];
  const question = typeof item.snapshot.intent === "string" ? item.snapshot.intent : item.title;
  const fullSummary = typeof item.snapshot.summary === "string" ? item.snapshot.summary : "模块分析完成。";
  const chartType = typeof item.snapshot.requested_chart_type === "string" ? item.snapshot.requested_chart_type : chart?.type || "chart";

  return (
    <article className={`reportPreviewModule pureReportModule ${wide ? "wideModule" : ""}`}>
      <div className="pureReportModuleHeader">
        <span>{String(index).padStart(2, "0")}</span>
        <div>
          <strong>{chartLabel(chartType)}</strong>
          <h3>{question}</h3>
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

function ReportModule({
  index,
  item,
  busy,
  onRun,
  onDelete,
}: {
  index: number;
  item: { id: string; title: string; type: string; ref_id: string; snapshot: Record<string, unknown> };
  busy: boolean;
  onRun: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const charts = useMemo(() => normalizeCharts(item.snapshot.charts), [item.snapshot]);
  const table = normalizeTable(item.snapshot.table);
  const strategy = normalizeStrategy(item.snapshot.strategy);
  const processSteps = normalizeSnapshotProcessSteps(item.snapshot);
  const runnable = Boolean(item.snapshot.task_id || strategy?.task_id || item.snapshot.task);
  return (
    <section className="reportModule">
      <div className="moduleHeader">
        <span>{index}</span>
        <div>
          <h2>{item.title}</h2>
          <p>{item.type} · {item.ref_id}</p>
        </div>
        <div className="moduleActions">
          <div className="moduleMore">
            <button className="iconOnly" disabled={busy} onClick={() => setMenuOpen((open) => !open)} title="更多操作">
              <MoreHorizontal size={17} />
            </button>
            {menuOpen ? (
              <div className="moduleMenu">
                <button className="dangerButton" onClick={() => { setMenuOpen(false); onDelete(); }}>
                  <Trash2 size={15} /> 删除模块
                </button>
              </div>
            ) : null}
          </div>
          <button disabled={busy || !runnable} onClick={onRun}><Play size={15} /> 运行</button>
        </div>
      </div>
      {typeof item.snapshot.intent === "string" ? <p className="reportIntent">分析问题：{item.snapshot.intent}</p> : null}
      {strategy ? <StrategySummary strategy={strategy} /> : null}
      {typeof item.snapshot.summary === "string" ? <p className="summary">{item.snapshot.summary}</p> : null}
      {processSteps.length ? (
        <div className="processList">
          {processSteps.map((step, stepIndex) => (
            <div className="processLine" key={`${step.step || stepIndex}-${step.name || stepIndex}`}>
              <span className="stepBadge">{step.step || stepIndex + 1}</span>
              <div>
                <strong>{step.name || "分析步骤"}</strong>
                <p>{step.detail || "-"}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {charts.length ? (
        <div className="chartGrid">
          {charts.map((chart) => <ChartPanel key={chart.id} chart={chart} />)}
        </div>
      ) : null}
      {table.length ? <DataTable rows={table} /> : null}
      {!charts.length && !table.length && !strategy && !processSteps.length ? (
        <pre className="jsonBlock">{JSON.stringify(item.snapshot, null, 2)}</pre>
      ) : null}
    </section>
  );
}

function StrategySummary({ strategy }: { strategy: Strategy }) {
  return (
    <div className="reportStrategy">
      <strong>{strategy.objective}</strong>
      <div className="reportStrategyMeta">
        <span>维度：{strategy.dimensions.join(", ") || "-"}</span>
        <span>指标：{strategy.metrics.join(", ") || "-"}</span>
      </div>
      <div className="reportStrategyFlow">
        <small>分析流程</small>
        <StrategyFlow methods={strategy.methods} />
      </div>
    </div>
  );
}

function normalizeStrategy(value: unknown): Strategy | null {
  return value && typeof value === "object" ? value as Strategy : null;
}

function normalizeCharts(value: unknown): ChartConfig[] {
  return Array.isArray(value) ? value as ChartConfig[] : [];
}

function chartLabel(type: string) {
  const labels: Record<string, string> = {
    line: "曲线图",
    bar: "柱状图",
    pie: "饼图",
    heatmap: "热力图",
    scatter: "散点图",
    area: "面积图",
    funnel: "漏斗图",
    treemap: "矩形树图",
  };
  return labels[type] || type;
}

function compactText(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function buildPureReportConclusion(items: ReportDetail["items"]) {
  const summaries = items
    .map((item) => typeof item.snapshot.summary === "string" ? item.snapshot.summary : "")
    .map((text) => text.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const core = summaries
    .map((summary) => compactText(summary, 90))
    .slice(0, 4)
    .join("；");
  return compactText(
    `本次纯图表报告共完成 ${items.length} 个分析模块，已形成对应图表和短结论。${core ? `综合来看：${core}。` : ""}建议优先关注数据质量、关键维度贡献、异常波动和可执行经营动作，并在后续复盘中持续验证口径与效果。`,
    520
  );
}

function normalizeTable(value: unknown): Array<Record<string, string | number>> {
  return Array.isArray(value) ? value as Array<Record<string, string | number>> : [];
}

type ProcessStep = { step?: string | number; name?: string; detail?: string };

function normalizeSnapshotProcessSteps(snapshot: Record<string, unknown>): ProcessStep[] {
  const direct = normalizeProcessSteps(snapshot.process_steps);
  if (direct.length) return direct;
  const execution = snapshot.execution;
  if (execution && typeof execution === "object" && "process_steps" in execution) {
    return normalizeProcessSteps((execution as { process_steps?: unknown }).process_steps);
  }
  return [];
}

function normalizeProcessSteps(value: unknown): ProcessStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      step: typeof item.step === "number" || typeof item.step === "string" ? item.step : undefined,
      name: typeof item.name === "string" ? item.name : undefined,
      detail: typeof item.detail === "string" ? item.detail : undefined,
    }));
}
