"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BarChart3, FolderKanban, GitBranch } from "lucide-react";
import { api, type CombinedKnowledgeGraph, type DatasetDetail } from "../../../lib/api";
import { saveAnalysisPlan } from "../../../lib/analysisPlan";
import { GraphNetwork } from "../../../components/GraphNetwork";
import { RecommendedQuestionsPanel } from "../../../components/RecommendedQuestionsPanel";

export default function DatasetKnowledgeGraphPage({ params }: { params: { datasetId: string } }) {
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [graph, setGraph] = useState<CombinedKnowledgeGraph | null>(null);
  const [notice, setNotice] = useState("加载中");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNotice("加载中");
    setGraph(null);

    (async () => {
      try {
        const datasetDetail = await api.getDataset(params.datasetId);
        if (cancelled) return;
        setDetail(datasetDetail);

        const assetIds = datasetDetail.dataset.asset_ids.filter(
          (id) => !datasetDetail.missing_asset_ids.includes(id)
        );
        if (!assetIds.length) {
          setNotice("该数据集暂无有效成员资产");
          return;
        }

        const combined = await api.combinedKnowledgeGraph(
          assetIds,
          `${datasetDetail.dataset.name} · 整体知识图`
        );
        if (cancelled) return;
        setGraph(combined);
        setNotice("就绪");
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "加载失败");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.datasetId]);

  async function launchAnalysisPlan(
    mode: "new" | "existing",
    sessionId?: string,
    questions?: string[]
  ) {
    if (!detail?.dataset.asset_ids.length || busy) return;
    const planQuestions = questions?.length
      ? questions
      : graph?.recommended_questions.slice(0, 1) || [`请基于数据集「${detail.dataset.name}」开展分析`];
    setBusy(true);
    try {
      const session = mode === "existing" && sessionId
        ? { id: sessionId }
        : await api.createSession(`数据集分析 · ${detail.dataset.name}`);
      const planKey = saveAnalysisPlan(planQuestions);
      const search = new URLSearchParams({
        session_id: session.id,
        dataset_ids: detail.dataset.id,
        plan_key: planKey,
        use_new_strategy: "1",
        prompt: planQuestions[0] || "",
      });
      window.location.href = `/workspace?${search.toString()}`;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "带入分析会话失败");
      setBusy(false);
    }
  }

  const dataset = detail?.dataset;
  const assetIds = dataset
    ? dataset.asset_ids.filter((id) => !(detail?.missing_asset_ids || []).includes(id))
    : [];

  return (
    <main className="detailPage datasetKnowledgePage">
      <header className="detailTopbar">
        <a className="linkButton" href="/data-assets?view=datasets">
          <ArrowLeft size={16} /> 返回数据集管理
        </a>
        <span>{notice}</span>
      </header>

      <section className="detailHero">
        <div>
          <FolderKanban size={28} />
          <h1>{dataset?.name || "数据集知识图"}</h1>
          <p>
            {dataset?.description || "查看该数据集全部成员资产构成的整体知识图。"}
            {dataset ? ` · ${dataset.asset_ids.length} 个资产` : ""}
          </p>
        </div>
        {dataset?.asset_ids.length ? (
          <button
            className="confirmButton"
            disabled={busy || !graph}
            onClick={() => void launchAnalysisPlan("new")}
          >
            <BarChart3 size={16} /> {busy ? "正在创建..." : "去分析"}
          </button>
        ) : null}
      </section>

      {!dataset ? (
        <section className="detailPanel">
          <div className="emptyState">{notice === "加载中" ? "正在加载数据集…" : notice}</div>
        </section>
      ) : !dataset.asset_ids.length ? (
        <section className="detailPanel">
          <div className="emptyState">该数据集还没有成员资产，请先编辑数据集并新增数据资产。</div>
        </section>
      ) : !graph ? (
        <section className="detailPanel">
          <div className="emptyState">{notice === "就绪" || notice === "加载中" ? "正在生成整体知识图…" : notice}</div>
        </section>
      ) : (
        <>
          <section className="detailPanel">
            <div className="sectionHeader">
              <div>
                <h2><GitBranch size={18} /> 整体知识图</h2>
                <p>
                  {graph.assets.length} 个数据资产 · {graph.graph.nodes.length} 个节点 ·
                  {graph.graph.edges.length} 条关系 · {graph.field_profiles.length} 个字段
                </p>
              </div>
            </div>

            {!graph.inferred_joins.length ? (
              <div className="graphNotice">未识别到同名主外键或公共维度，当前展示各数据资产的整体结构。</div>
            ) : (
              <div className="graphNotice success">
                已识别 {graph.inferred_joins.length} 条跨表连接，可拖拽、缩放并悬停查看关系。
              </div>
            )}

            <div className="strategyChips combinedAssetChips">
              {graph.assets.map((asset) => (
                <a key={asset.id} href={`/assets/${asset.id}`}>{asset.table} · {asset.row_count} 行</a>
              ))}
            </div>

            <GraphNetwork nodes={graph.graph.nodes} edges={graph.graph.edges} />

            {graph.inferred_joins.length ? (
              <div className="combinedJoinList">
                <h3>推断的跨表连接</h3>
                {graph.inferred_joins.slice(0, 40).map((join, index) => (
                  <span key={`${join.source_asset_id}-${join.target_asset_id}-${join.field}-${index}`}>
                    {join.source_asset} — <strong>{join.field}</strong> → {join.target_asset}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="detailPanel">
            <RecommendedQuestionsPanel
              assetIds={assetIds}
              initialQuestions={graph.recommended_questions}
              busy={busy}
              onNotice={setNotice}
              onLaunch={(mode, sessionId, questions) => void launchAnalysisPlan(mode, sessionId, questions)}
            />
          </section>

          <section className="detailPanel">
            <div className="sectionHeader">
              <div>
                <h3>成员资产元数据</h3>
                <p>覆盖本数据集中的全部 {graph.assets.length} 个数据资产。</p>
              </div>
            </div>
            <div className="combinedMetadataGrid">
              {graph.assets.map((asset) => (
                <article key={asset.id}>
                  <strong><a href={`/assets/${asset.id}`}>{asset.name}</a></strong>
                  <span>数据表：{asset.table}</span>
                  <span>类型：{asset.type} · 来源：{asset.source}</span>
                  <span>{asset.row_count} 行 · {asset.column_count} 字段 · {asset.metric_count} 指标</span>
                  <small>创建时间：{asset.created_at}</small>
                </article>
              ))}
            </div>
            {detail.missing_asset_ids.length ? (
              <small className="fieldHint">另有 {detail.missing_asset_ids.length} 个资产已删除或不存在</small>
            ) : null}
          </section>

          <section className="detailPanel">
            <div className="sectionHeader">
              <div>
                <h3>全部字段画像</h3>
                <p>共 {graph.field_profiles.length} 个字段，包含类型、完整性、基数、取值范围和样例。</p>
              </div>
            </div>
            <div className="fieldProfileTableWrap">
              <table className="fieldProfileTable">
                <thead>
                  <tr>
                    <th>数据表</th><th>字段</th><th>逻辑类型</th><th>唯一值</th><th>缺失值</th>
                    <th>最小值</th><th>最大值</th><th>样例值</th><th>敏感字段</th>
                  </tr>
                </thead>
                <tbody>
                  {graph.field_profiles.map((field) => (
                    <tr key={`${field.asset_id}-${field.name}`}>
                      <td title={field.asset_name}>{field.table}</td>
                      <td><strong>{field.name}</strong></td>
                      <td>{field.logical_type}</td>
                      <td>{field.unique_count}</td>
                      <td>{field.null_count}</td>
                      <td>{String(field.min_value ?? "-")}</td>
                      <td>{String(field.max_value ?? "-")}</td>
                      <td className="sampleValues" title={field.sample_values.map(String).join(" / ")}>
                        {field.sample_values.slice(0, 5).map(String).join(" / ") || "-"}
                      </td>
                      <td>{field.sensitive ? "是" : "否"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
