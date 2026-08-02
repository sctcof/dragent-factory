"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, GitBranch, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { api, type StrategyAsset } from "../../lib/api";
import { StrategyFlow } from "../../components/StrategyFlow";

type ModalMode = "create" | "edit" | "merge";

const DEFAULT_MARKDOWN = "# 自定义分析策略\n\n## 分析步骤\n- 1_data_scope_and_quality_check\n- 2_metric_definition_and_field_mapping\n- 3_time_trend_decomposition\n- 4_dimension_group_comparison\n- 5_contribution_and_outlier_drilldown\n- 6_cross_dataset_consistency_check\n- 7_business_summary_and_risk_notes\n\n## 维度\nmonth, region\n\n## 指标\nrevenue, gross_margin";

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<StrategyAsset[]>([]);
  const [notice, setNotice] = useState("加载中");
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [editingStrategy, setEditingStrategy] = useState<StrategyAsset | null>(null);
  const [title, setTitle] = useState("自定义分析策略");
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const library = await api.assetLibrary();
    setStrategies(library.strategy_assets);
    setNotice("就绪");
  }

  function openCreate() {
    setEditingStrategy(null);
    setTitle("自定义分析策略");
    setMarkdown(DEFAULT_MARKDOWN);
    setMergeIds([]);
    setModalMode("create");
  }

  function openMerge() {
    setEditingStrategy(null);
    setTitle("合并分析策略");
    setMarkdown("");
    setMergeIds(strategies.slice(0, 2).map((item) => item.id));
    setModalMode("merge");
  }

  function openEdit(strategy: StrategyAsset) {
    setEditingStrategy(strategy);
    setTitle(strategy.title);
    setMarkdown(strategy.markdown || strategyToMarkdown(strategy));
    setMergeIds([]);
    setModalMode("edit");
  }

  async function remove(strategyId: string) {
    await api.deleteStrategyAsset(strategyId);
    setStrategies((items) => items.filter((item) => item.id !== strategyId));
    setNotice("策略已删除");
  }

  async function saveStrategy() {
    if (!title.trim() || (modalMode !== "merge" && !markdown.trim())) return;
    setBusy(true);
    try {
      let saved: StrategyAsset;
      if (modalMode === "edit" && editingStrategy) {
        saved = await api.updateStrategyAsset(editingStrategy.id, { title: title.trim(), markdown });
      } else if (modalMode === "merge") {
        saved = await api.mergeStrategyAssets({ title: title.trim(), strategy_asset_ids: mergeIds });
      } else {
        saved = await api.createStrategyFromMarkdown({ title: title.trim(), markdown });
      }
      setStrategies((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setModalMode(null);
      setNotice(modalMode === "merge" ? "策略已合并创建" : modalMode === "edit" ? "策略已更新" : "策略已创建");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function polish() {
    if (!title.trim() || !markdown.trim()) return;
    setBusy(true);
    try {
      const result = await api.polishStrategyAsset({ title: title.trim(), markdown });
      setTitle(result.title);
      setMarkdown(result.markdown);
      setNotice("策略已润色，可确认保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "润色失败");
    } finally {
      setBusy(false);
    }
  }

  async function polishStrategy(strategy: StrategyAsset) {
    setBusy(true);
    try {
      const source = strategy.markdown || strategyToMarkdown(strategy);
      const result = await api.polishStrategyAsset({ title: strategy.title, markdown: source });
      setEditingStrategy(strategy);
      setTitle(result.title);
      setMarkdown(result.markdown);
      setMergeIds([]);
      setModalMode("edit");
      setNotice("策略已润色，可确认保存");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "润色失败");
    } finally {
      setBusy(false);
    }
  }

  const selectedMergeStrategies = useMemo(
    () => strategies.filter((strategy) => mergeIds.includes(strategy.id)),
    [strategies, mergeIds]
  );
  const liveMethods = useMemo(() => parseMethodsFromMarkdown(markdown), [markdown]);

  return (
    <main className="detailPage">
      <header className="detailTopbar">
        <a className="linkButton" href="/workspace"><ArrowLeft size={16} /> 返回对话</a>
        <div className="buttonRow">
          <button onClick={refresh}>刷新</button>
          <button onClick={openMerge}><GitBranch size={16} /> 合并已有</button>
          <button className="confirmButton" onClick={openCreate}><Check size={16} /> 新增策略</button>
        </div>
      </header>

      <section className="detailHero">
        <div>
          <GitBranch size={28} />
          <h1>策略资产</h1>
          <p>{strategies.length} 个策略 · {notice}</p>
        </div>
      </section>

      <section className="detailPanel">
        <h2>策略列表</h2>
        <div className="assetTable">
          {strategies.map((strategy) => (
            <article key={strategy.id} className="strategyAssetCard">
              <div>
                <h3>{strategy.title}</h3>
                <p>{strategy.objective}</p>
                <div className="strategyChips">
                  <span>{strategy.kind === "template" ? "模板策略" : "已确认策略"}</span>
                  <span>维度：{strategy.dimensions.join(", ") || "-"}</span>
                  <span>指标：{strategy.metrics.join(", ") || "-"}</span>
                  <span>方法：{strategy.methods.length} 步</span>
                </div>
                <StrategyFlow methods={strategy.methods} />
              </div>
              <div className="strategyActions">
                <button onClick={() => openEdit(strategy)}><Pencil size={15} /> 编辑</button>
                <button onClick={() => polishStrategy(strategy)}><Sparkles size={15} /> 润色</button>
                <button onClick={() => remove(strategy.id)}><Trash2 size={15} /> 删除</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {modalMode ? (
        <div className="modalBackdrop">
          <section className="strategyModal">
            <div className="sectionHeader">
              <div>
                <h2>{modalMode === "merge" ? "合并已有策略" : modalMode === "edit" ? "编辑策略" : "新增策略"}</h2>
                <p>{modalMode === "merge" ? `已选择 ${selectedMergeStrategies.length} 个策略` : "支持 Markdown 编辑和润色"}</p>
              </div>
              <button className="iconOnly" onClick={() => setModalMode(null)} title="关闭"><X size={16} /></button>
            </div>

            <label className="formLabel">策略名称<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>

            {modalMode === "merge" ? (
              <div className="pickerList">
                {strategies.map((strategy) => (
                  <label key={strategy.id} className="pickerCheck">
                    <input
                      type="checkbox"
                      checked={mergeIds.includes(strategy.id)}
                      onChange={(event) =>
                        setMergeIds((ids) => event.target.checked ? [...ids, strategy.id] : ids.filter((id) => id !== strategy.id))
                      }
                    />
                    <span>{strategy.title}</span>
                    <small>{strategy.methods.length} 步</small>
                  </label>
                ))}
              </div>
            ) : (
              <div className="strategyEditGrid">
                <label className="formLabel">策略 Markdown<textarea value={markdown} onChange={(event) => setMarkdown(event.target.value)} /></label>
                <section className="liveFlowPanel">
                  <h3>策略流程预览</h3>
                  <StrategyFlow methods={liveMethods} />
                </section>
              </div>
            )}

            <div className="buttonRow">
              {modalMode !== "merge" ? <button disabled={busy} onClick={polish}><Sparkles size={15} /> 润色</button> : null}
              <button className="confirmButton" disabled={busy || (modalMode === "merge" && !mergeIds.length)} onClick={saveStrategy}>
                <Check size={15} /> 确认
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function strategyToMarkdown(strategy: StrategyAsset) {
  return [
    `# ${strategy.title}`,
    "",
    "## 分析步骤",
    ...strategy.methods.map((method) => `- ${method}`),
    "",
    "## 维度",
    strategy.dimensions.join(", ") || "-",
    "",
    "## 指标",
    strategy.metrics.join(", ") || "-",
  ].join("\n");
}

function parseMethodsFromMarkdown(markdown: string) {
  const methods: string[] = [];
  markdown.split("\n").forEach((line) => {
    const value = line.trim();
    const match = value.match(/^(?:[-*]|\d+[.)、])\s*(.+)$/);
    if (match?.[1]) {
      const method = match[1].trim();
      if (method && !methods.includes(method)) methods.push(method);
    }
  });
  return methods.slice(0, 12);
}
