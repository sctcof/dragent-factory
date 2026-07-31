"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BarChart3, CheckSquare, Database, GitBranch, Link2, Plus, Server, Trash2, X } from "lucide-react";
import { api, type Asset, type CombinedKnowledgeGraph, type Datasource } from "../../lib/api";
import { GraphNetwork } from "../../components/GraphNetwork";

type AssetView = "assets" | "connections";

const DB_KIND_LABELS: Record<string, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  sqlite: "SQLite",
};

export default function DataAssetsPage() {
  const [activeView, setActiveView] = useState<AssetView>("assets");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [supported, setSupported] = useState<Record<string, string>>({});
  const [name, setName] = useState("经营数据库");
  const [dbKind, setDbKind] = useState("mysql");
  const [databaseUrl, setDatabaseUrl] = useState("mysql+pymysql://user:password@host:3306/database");
  const [sampleLimit, setSampleLimit] = useState(5000);
  const [notice, setNotice] = useState("准备就绪");
  const [busy, setBusy] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [combinedGraph, setCombinedGraph] = useState<CombinedKnowledgeGraph | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [assetCreatorOpen, setAssetCreatorOpen] = useState(false);
  const [creatorDatasourceId, setCreatorDatasourceId] = useState("");
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [library, ds, supportedData] = await Promise.all([
      api.assetLibrary(),
      api.datasources(),
      api.supportedDatasources()
    ]);
    setAssets(library.data_assets);
    setDatasources(ds);
    setSupported(supportedData.supported);
  }

  async function createDatasource() {
    setBusy(true);
    setNotice("正在验证数据库连接并读取元数据");
    try {
      await api.createDatasource({ name, database_url: databaseUrl });
      await refresh();
      setNotice("连接已加入连接池，可在新建资产时选择数据表");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "连接失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAsset(assetId: string) {
    await api.deleteAsset(assetId);
    setAssets((items) => items.filter((item) => item.id !== assetId));
    setSelectedAssetIds((items) => items.filter((id) => id !== assetId));
    if (combinedGraph?.asset_ids.includes(assetId)) setCombinedGraph(null);
  }

  async function deleteDatasource(datasourceId: string) {
    await api.deleteDatasource(datasourceId);
    await refresh();
    setNotice("连接配置已删除，已创建的数据资产仍然保留");
  }

  function toggleAsset(assetId: string) {
    setSelectedAssetIds((items) =>
      items.includes(assetId) ? items.filter((id) => id !== assetId) : [...items, assetId]
    );
  }

  async function generateCombinedGraph() {
    if (selectedAssetIds.length < 2 || busy) {
      setNotice("请至少选择两个数据资产后生成整体知识图");
      return;
    }
    setBusy(true);
    setNotice(`正在合并 ${selectedAssetIds.length} 个数据资产并推断跨表关系`);
    try {
      const graph = await api.combinedKnowledgeGraph(selectedAssetIds);
      setCombinedGraph(graph);
      setSelectedQuestion(graph.recommended_questions[0] || "");
      setNotice(`整体知识图已生成：${graph.graph.nodes.length} 个节点，${graph.inferred_joins.length} 条推断连接`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "整体知识图生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeSelectedAssets() {
    if (!combinedGraph?.asset_ids.length || busy) return;
    setBusy(true);
    setNotice("正在创建新的多数据集分析会话");
    try {
      const session = await api.createSession(`多数据集联合分析（${combinedGraph.assets.length} 个资产）`);
      const search = new URLSearchParams({
        session_id: session.id,
        asset_ids: combinedGraph.asset_ids.join(","),
        prompt: selectedQuestion || combinedGraph.recommended_questions[0] || ""
      });
      window.location.href = `/?${search.toString()}`;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "新建分析会话失败");
      setBusy(false);
    }
  }

  async function loadDatasourceTables(datasourceId: string) {
    setCreatorDatasourceId(datasourceId);
    setSelectedTables([]);
    if (!datasourceId) {
      setAvailableTables([]);
      return;
    }
    setBusy(true);
    try {
      const result = await api.datasourceTables(datasourceId);
      setAvailableTables(result.tables);
    } catch (error) {
      setAvailableTables([]);
      setNotice(error instanceof Error ? error.message : "读取数据表失败");
    } finally {
      setBusy(false);
    }
  }

  async function openAssetCreator() {
    if (!datasources.length) {
      setActiveView("connections");
      setNotice("请先在连接池中创建数据库连接");
      return;
    }
    setAssetCreatorOpen(true);
    await loadDatasourceTables(creatorDatasourceId || datasources[0].id);
  }

  function toggleTable(tableName: string) {
    setSelectedTables((items) =>
      items.includes(tableName) ? items.filter((name) => name !== tableName) : [...items, tableName]
    );
  }

  async function createAssetsFromTables() {
    if (!creatorDatasourceId || !selectedTables.length) return;
    setBusy(true);
    setNotice(`正在从 ${selectedTables.length} 张数据表创建数据资产`);
    try {
      const result = await api.createDatasourceAssets(creatorDatasourceId, selectedTables, sampleLimit);
      await refresh();
      const nextIds = result.assets.map((asset) => asset.id);
      setSelectedAssetIds((items) => Array.from(new Set([...items, ...nextIds])));
      setAssetCreatorOpen(false);
      setActiveView("assets");
      setNotice(
        result.failures.length
          ? `已创建 ${result.created} 个、复用 ${result.reused} 个资产，${result.failures.length} 个失败`
          : `已创建 ${result.created} 个、复用 ${result.reused} 个数据资产`
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建数据资产失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="dataAssetsPage">
      <header className="detailTopbar">
        <a className="linkButton" href="/"><ArrowLeft size={16} /> 返回对话</a>
        <span>{notice}</span>
        <button onClick={() => void refresh()}>刷新</button>
      </header>

      <div className="dataAssetsShell">
        <aside className="dataAssetsSidebar">
          <div className="dataAssetsBrand">
            <Database size={24} />
            <div><strong>数据管理</strong><small>资产与连接配置</small></div>
          </div>
          <nav>
            <button className={activeView === "assets" ? "active" : ""} onClick={() => setActiveView("assets")}>
              <Database size={17} /><span>数据资产</span><small>{assets.length}</small>
            </button>
            <button className={activeView === "connections" ? "active" : ""} onClick={() => setActiveView("connections")}>
              <Server size={17} /><span>连接池</span><small>{datasources.length}</small>
            </button>
          </nav>
        </aside>

        <div className="dataAssetsContent">
          {activeView === "assets" ? (
            <>
              <section className="detailHero compactHero">
                <div>
                  <Database size={28} />
                  <h1>数据资产</h1>
                  <p>默认展示已创建的数据表资产，可多选后进行联合分析或生成整体知识图。</p>
                </div>
                <button className="confirmButton" onClick={() => void openAssetCreator()}>
                  <Plus size={16} /> 新建数据资产
                </button>
              </section>

              <section className="detailPanel">
                <div className="sectionHeader assetSelectionHeader">
                  <div>
                    <h2>数据资产表</h2>
                    <p>已选择 {selectedAssetIds.length} 个资产。整体图谱会合并字段、指标并推断跨表关系。</p>
                  </div>
                  <div className="buttonRow">
                    <button onClick={() => setSelectedAssetIds(selectedAssetIds.length === assets.length ? [] : assets.map((asset) => asset.id))}>
                      <CheckSquare size={15} /> {selectedAssetIds.length === assets.length && assets.length ? "清空" : "全选"}
                    </button>
                    <button
                      className="confirmButton"
                      disabled={busy || selectedAssetIds.length < 2}
                      title={selectedAssetIds.length < 2 ? "请至少选择两个数据资产" : "生成所选资产的整体知识图"}
                      onClick={() => void generateCombinedGraph()}
                    >
                      <GitBranch size={15} /> {busy ? "生成中..." : "生成整体知识图"}
                    </button>
                  </div>
                </div>
                <div className="assetTable">
                  {assets.map((asset) => (
                    <div key={asset.id} className="assetTableRow">
                      <label className="assetSelectCell">
                        <input type="checkbox" checked={selectedAssetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)} />
                        <div>
                          <a href={`/assets/${asset.id}`}><strong>{asset.name}</strong></a>
                          <span>{asset.source_table || asset.data_dictionary?.table_name || asset.type} · {asset.data_dictionary?.row_count ?? 0} 行 · {asset.data_dictionary?.columns.length ?? 0} 字段</span>
                        </div>
                      </label>
                      <small>{asset.parse_status}</small>
                      <button onClick={() => void deleteAsset(asset.id)}><Trash2 size={15} /> 删除</button>
                    </div>
                  ))}
                  {!assets.length ? <div className="emptyState">暂无数据资产，请点击“新建数据资产”从连接池选择数据表。</div> : null}
                </div>
              </section>

            </>
          ) : (
            <>
              <section className="detailHero compactHero">
                <div>
                  <Server size={28} />
                  <h1>连接池</h1>
                  <p>集中管理数据库连接配置。数据表只在“新建资产”流程中按需选择。</p>
                </div>
              </section>

              <section className="detailPanel">
                <h2>新建连接</h2>
                <div className="connectorForm connectionKindForm">
                  <label>连接名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>
                  <label>
                    数据库类型
                    <select
                      value={dbKind}
                      onChange={(event) => {
                        const kind = event.target.value;
                        setDbKind(kind);
                        if (supported[kind]) setDatabaseUrl(supported[kind]);
                      }}
                    >
                      {Object.keys(supported).map((kind) => (
                        <option key={kind} value={kind}>{DB_KIND_LABELS[kind] || kind}</option>
                      ))}
                    </select>
                  </label>
                  <label>数据库连接 URL<input value={databaseUrl} onChange={(event) => setDatabaseUrl(event.target.value)} /></label>
                </div>
                <button className="confirmButton" disabled={busy || !name.trim() || !databaseUrl.trim()} onClick={() => void createDatasource()}>
                  <Link2 size={16} /> 验证并保存连接
                </button>
                <div className="supportedGrid">
                  {Object.entries(supported).map(([kind, example]) => <span key={kind}><strong>{kind}</strong>{example}</span>)}
                </div>
              </section>

              <section className="detailPanel">
                <h2>全部连接配置</h2>
                <div className="assetTable">
                  {datasources.map((datasource) => (
                    <div key={datasource.id} className="assetTableRow">
                      <div>
                        <strong>{datasource.name}</strong>
                        <span>{datasource.type} · {datasource.database_url_masked}</span>
                        {datasource.error ? <em>{datasource.error}</em> : null}
                      </div>
                      <small>{datasource.status}</small>
                      <button onClick={() => void deleteDatasource(datasource.id)}><Trash2 size={15} /> 删除</button>
                    </div>
                  ))}
                  {!datasources.length ? <div className="emptyState">暂无连接配置。</div> : null}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {combinedGraph ? (
        <div className="modalBackdrop knowledgeGraphBackdrop" role="presentation">
          <section className="knowledgeGraphModal" role="dialog" aria-modal="true" aria-labelledby="combined-graph-title">
            <header className="knowledgeGraphHeader">
              <div>
                <h2 id="combined-graph-title">{combinedGraph.title}</h2>
                <p>
                  {combinedGraph.assets.length} 个数据集 · {combinedGraph.graph.nodes.length} 个节点 ·
                  {combinedGraph.graph.edges.length} 条关系 · {combinedGraph.field_profiles.length} 个字段
                </p>
              </div>
              <button className="iconOnly" title="关闭知识图" onClick={() => setCombinedGraph(null)}><X size={18} /></button>
            </header>

            <div className="knowledgeGraphContent">
              {!combinedGraph.inferred_joins.length ? (
                <div className="graphNotice">未识别到同名主外键或公共维度，当前展示各数据集的整体结构。</div>
              ) : (
                <div className="graphNotice success">已识别 {combinedGraph.inferred_joins.length} 条跨表连接，可拖拽、缩放并悬停查看关系。</div>
              )}
              <div className="strategyChips combinedAssetChips">
                {combinedGraph.assets.map((asset) => <span key={asset.id}>{asset.table} · {asset.row_count} 行</span>)}
              </div>
              <GraphNetwork nodes={combinedGraph.graph.nodes} edges={combinedGraph.graph.edges} />

              {combinedGraph.inferred_joins.length ? (
                <div className="combinedJoinList">
                  <h3>推断的跨表连接</h3>
                  {combinedGraph.inferred_joins.slice(0, 40).map((join, index) => (
                    <span key={`${join.source_asset_id}-${join.target_asset_id}-${join.field}-${index}`}>
                      {join.source_asset} — <strong>{join.field}</strong> → {join.target_asset}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="recommendedQuestions">
                <div className="sectionHeader">
                  <div>
                    <h3>推荐分析问题</h3>
                    <p>根据所选数据表、字段类型、指标和跨表关系生成，选择后可带入新的分析会话。</p>
                  </div>
                </div>
                <div className="recommendedQuestionList">
                  {combinedGraph.recommended_questions.map((question, index) => (
                    <label key={question} className={selectedQuestion === question ? "selected" : ""}>
                      <input type="radio" name="recommended-question" checked={selectedQuestion === question} onChange={() => setSelectedQuestion(question)} />
                      <strong>{index + 1}</strong>
                      <span>{question}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="combinedMetadataSection">
                <div className="sectionHeader">
                  <div>
                    <h3>选中数据集元数据</h3>
                    <p>覆盖本次整体知识图中的全部 {combinedGraph.assets.length} 个数据集。</p>
                  </div>
                </div>
                <div className="combinedMetadataGrid">
                  {combinedGraph.assets.map((asset) => (
                    <article key={asset.id}>
                      <strong>{asset.name}</strong>
                      <span>数据表：{asset.table}</span>
                      <span>类型：{asset.type} · 来源：{asset.source}</span>
                      <span>{asset.row_count} 行 · {asset.column_count} 字段 · {asset.metric_count} 指标</span>
                      <small>创建时间：{asset.created_at}</small>
                    </article>
                  ))}
                </div>
              </div>

              <div className="combinedFieldProfiles">
                <div className="sectionHeader">
                  <div>
                    <h3>全部字段画像</h3>
                    <p>共 {combinedGraph.field_profiles.length} 个字段，包含类型、完整性、基数、取值范围和样例。</p>
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
                      {combinedGraph.field_profiles.map((field) => (
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
              </div>
            </div>

            <footer className="knowledgeGraphActions">
              <span>将创建一个新的对话，并自动带入 {combinedGraph.assets.length} 个数据资产及所选推荐问题。</span>
              <div>
                <button onClick={() => setCombinedGraph(null)}>关闭</button>
                <button className="confirmButton" disabled={busy} onClick={() => void analyzeSelectedAssets()}>
                  <BarChart3 size={16} /> {busy ? "正在创建..." : "新建对话并一起分析"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}

      {assetCreatorOpen ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAssetCreatorOpen(false);
        }}>
          <section className="assetCreatorModal" role="dialog" aria-modal="true" aria-labelledby="asset-creator-title">
            <div className="sectionHeader">
              <div>
                <h2 id="asset-creator-title">新建数据资产</h2>
                <p>选择连接和一个或多个数据表，每张表会生成一个独立数据资产。</p>
              </div>
              <button className="iconOnly" onClick={() => setAssetCreatorOpen(false)}><X size={17} /></button>
            </div>
            <label className="assetCreatorField">
              数据库连接
              <select value={creatorDatasourceId} onChange={(event) => void loadDatasourceTables(event.target.value)}>
                {datasources.map((datasource) => <option key={datasource.id} value={datasource.id}>{datasource.name} · {datasource.type}</option>)}
              </select>
            </label>
            <label className="assetCreatorField">
              单表抽样上限
              <input type="number" min={1} max={50000} value={sampleLimit} onChange={(event) => setSampleLimit(Number(event.target.value))} />
            </label>
            <div className="tablePickerHeader">
              <strong>选择数据表</strong>
              <button onClick={() => setSelectedTables(selectedTables.length === availableTables.length ? [] : [...availableTables])}>
                {selectedTables.length === availableTables.length && availableTables.length ? "取消全选" : "全选"}
              </button>
            </div>
            <div className="tablePicker">
              {availableTables.map((table) => (
                <label key={table}>
                  <input type="checkbox" checked={selectedTables.includes(table)} onChange={() => toggleTable(table)} />
                  <Database size={15} /><span>{table}</span>
                </label>
              ))}
              {!availableTables.length ? <div className="emptyState">{busy ? "正在读取数据表..." : "没有可用的数据表"}</div> : null}
            </div>
            <div className="modalActions">
              <button onClick={() => setAssetCreatorOpen(false)}>取消</button>
              <button className="confirmButton" disabled={busy || !selectedTables.length} onClick={() => void createAssetsFromTables()}>
                <Plus size={16} /> 创建 {selectedTables.length} 个资产
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
