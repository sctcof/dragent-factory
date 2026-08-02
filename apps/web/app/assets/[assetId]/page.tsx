"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Database, GitBranch, Trash2 } from "lucide-react";
import { api, type AssetDetail } from "../../../lib/api";
import { DataTable } from "../../../components/ChartPanel";
import { GraphNetwork } from "../../../components/GraphNetwork";

export default function AssetDetailPage({ params }: { params: { assetId: string } }) {
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [notice, setNotice] = useState("加载中");

  useEffect(() => {
    api.assetDetail(params.assetId)
      .then((value) => {
        setDetail(value);
        setNotice("就绪");
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "加载失败"));
  }, [params.assetId]);

  async function removeAsset() {
    await api.deleteAsset(params.assetId);
    window.location.href = "/workspace";
  }

  if (!detail) {
    return (
      <main className="detailPage">
        <div className="detailTopbar">
          <a className="linkButton" href="/workspace"><ArrowLeft size={16} /> 返回</a>
          <span>{notice}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="detailPage">
      <header className="detailTopbar">
        <a className="linkButton" href="/workspace"><ArrowLeft size={16} /> 返回对话</a>
        <button onClick={removeAsset}><Trash2 size={16} /> 删除资产</button>
      </header>

      <section className="detailHero">
        <div>
          <Database size={28} />
          <h1>{detail.asset.name}</h1>
          <p>{detail.metadata.row_count} 行 · {detail.metadata.column_count} 字段 · {detail.metadata.parse_status}</p>
        </div>
      </section>

      <section className="detailGrid">
        <div className="detailPanel">
          <h2>元数据</h2>
          <dl className="metadataGrid">
            {Object.entries(detail.metadata).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value ?? "-")}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="detailPanel">
          <h2>数据洞察</h2>
          <div className="insightList">
            {detail.insights.map((item) => <p key={item}>{item}</p>)}
          </div>
        </div>
      </section>

      <section className="detailPanel">
        <h2>字段画像</h2>
        <div className="profileGrid">
          {detail.field_profiles.map((field) => (
            <article className="profileCard" key={field.name}>
              <strong>{field.name}</strong>
              <span>{field.logical_type}</span>
              <small>唯一值 {field.unique_count} · 缺失 {field.null_count}</small>
              <small>样例：{field.sample_values.slice(0, 4).map(String).join(" / ") || "-"}</small>
              {field.sensitive ? <em>敏感字段</em> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="detailPanel">
        <h2>图谱关系</h2>
        <div className="graphSummary">
          <div><GitBranch size={18} /> 节点 {detail.graph.nodes.length}</div>
          <div>关系 {detail.graph.edges.length}</div>
        </div>
        <GraphNetwork nodes={detail.graph.nodes} edges={detail.graph.edges} />
      </section>

      <section className="detailPanel">
        <h2>数据预览</h2>
        <DataTable rows={detail.preview_rows} />
      </section>
    </main>
  );
}
