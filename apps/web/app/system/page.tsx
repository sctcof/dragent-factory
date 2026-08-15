"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Boxes,
  Braces,
  Database,
  HardDrive,
  KeyRound,
  Network,
  RefreshCw,
  Server,
  Sparkles
} from "lucide-react";
import { api, type SystemConfigResponse } from "../../lib/api";

const AGENT_LABELS: Record<string, string> = {
  data: "数据画像",
  planner: "策略规划",
  coder: "代码生成",
  analyzer: "结论分析",
  report: "报告编排",
};

function StatusDot({ state }: { state: "ok" | "bad" | "none" }) {
  return <i className={`sysStatusDot ${state}`} aria-hidden="true" />;
}

function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="sysKv">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : ""}>{value || "—"}</dd>
    </div>
  );
}

export default function SystemPage() {
  const [config, setConfig] = useState<SystemConfigResponse | null>(null);
  const [notice, setNotice] = useState("加载中");

  async function refresh() {
    setNotice("加载中");
    try {
      setConfig(await api.systemConfig());
      setNotice("已连接 API 服务");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "配置加载失败");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const ragflow = config?.vector.ragflow;
  const ragflowState: "ok" | "bad" | "none" = !config
    ? "none"
    : config.vector.backend !== "ragflow"
      ? "none"
      : ragflow?.reachable
        ? "ok"
        : "bad";

  return (
    <main className="detailPage systemPage">
      <header className="detailTopbar">
        <a className="linkButton" href="/workspace"><ArrowLeft size={16} /> 返回工作台</a>
        <div className="helpTopbarActions">
          <a className="linkButton" href="/help"><BookOpen size={15} /> 接口文档</a>
          <button onClick={() => void refresh()}><RefreshCw size={15} /> 刷新</button>
        </div>
      </header>

      <section className="detailHero systemHero">
        <div>
          <Server size={26} />
          <h1>系统基础服务配置</h1>
          <p>
            {config
              ? `${config.app.title} · v${config.app.version} · 项目 ${config.project_id} · ${config.time}`
              : "正在加载…"}
            {" · "}{notice}
          </p>
          {config ? (
            <div className="sysSummaryRow">
              <span className="sysSummaryChip">
                <StatusDot state={config.storage.ok ? "ok" : "bad"} />
                存储 {config.storage.mode === "postgres" ? "PostgreSQL" : "本地 JSON"}
              </span>
              <span className="sysSummaryChip">
                <StatusDot state={config.vector.backend === "ragflow" ? (ragflowState === "ok" ? "ok" : "bad") : "ok"} />
                向量 {config.vector.backend === "ragflow" ? "RAGFlow" : "本地关键词"}
              </span>
              <span className="sysSummaryChip">
                <StatusDot state={config.cache.reachable ? "ok" : "bad"} />
                Redis
              </span>
              <span className="sysSummaryChip">
                <StatusDot state={config.graph.reachable ? "ok" : "bad"} />
                Neo4j
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {config ? (
        <div className="sysGrid">
          <section className="detailPanel sysCard">
            <h2><Server size={16} /> API 服务</h2>
            <dl className="sysKvList">
              <KeyValue label="应用名称" value={config.app.title} />
              <KeyValue label="版本" value={config.app.version} />
              <KeyValue label="项目 ID" value={config.project_id} mono />
              <KeyValue label="服务时间" value={config.time} mono />
              <KeyValue label="服务地址" value={api.base} mono />
            </dl>
          </section>

          <section className="detailPanel sysCard">
            <h2><Database size={16} /> 元数据存储</h2>
            <div className="sysModeRow">
              <StatusDot state={config.storage.ok ? "ok" : "bad"} />
              <strong>{config.storage.mode === "postgres" ? "PostgreSQL（生产模式）" : "本地 JSON 文件（MVP 模式）"}</strong>
            </div>
            <dl className="sysKvList">
              <KeyValue label="元数据文件" value={config.storage.metadata_path} mono />
              {config.storage.mode === "postgres" ? (
                <KeyValue label="数据库连接" value={config.storage.database_url} mono />
              ) : null}
            </dl>
          </section>

          <section className="detailPanel sysCard">
            <h2><Braces size={16} /> 向量检索（RAG）</h2>
            <div className="sysModeRow">
              <StatusDot state={config.vector.backend === "ragflow" ? (ragflowState === "ok" ? "ok" : "bad") : "ok"} />
              <strong>
                {config.vector.backend === "ragflow" ? "RAGFlow 语义检索" : "本地关键词打分（未接入 RAGFlow）"}
              </strong>
            </div>
            <dl className="sysKvList">
              <KeyValue label="后端模式" value={config.vector.backend} mono />
              <KeyValue label="RAGFlow 地址" value={ragflow?.base_url || "未配置"} mono />
              <KeyValue label="API Key" value={ragflow?.api_key_set ? "已配置" : "未配置"} />
              <KeyValue
                label="服务状态"
                value={ragflow?.reachable === undefined || ragflow?.reachable === null ? "—" : ragflow?.reachable ? "已连接" : `不可达${ragflow?.error ? `（${ragflow.error}）` : ""}`}
              />
              {ragflow?.kb ? (
                <>
                  <KeyValue label="项目知识库" value={`${ragflow.kb.name}（${ragflow.kb.docs} 文档 / ${ragflow.kb.chunks} 分块）`} />
                  <KeyValue label="嵌入模型" value={ragflow.kb.embedding_model} mono />
                </>
              ) : null}
              {typeof ragflow?.kb_count === "number" ? (
                <KeyValue label="账户知识库数" value={String(ragflow.kb_count)} />
              ) : null}
            </dl>
          </section>

          <section className="detailPanel sysCard">
            <h2><Network size={16} /> 缓存 Redis</h2>
            <div className="sysModeRow">
              <StatusDot state={config.cache.reachable ? "ok" : "bad"} />
              <strong>{config.cache.reachable ? "已连接" : "不可达（进度缓存将降级）"}</strong>
            </div>
            <dl className="sysKvList">
              <KeyValue label="连接地址" value={config.cache.redis_url} mono />
            </dl>
          </section>

          <section className="detailPanel sysCard">
            <h2><Network size={16} /> 图数据库 Neo4j</h2>
            <div className="sysModeRow">
              <StatusDot state={config.graph.reachable ? "ok" : "bad"} />
              <strong>{config.graph.reachable ? "已连接" : "不可达（知识图谱将降级）"}</strong>
            </div>
            <dl className="sysKvList">
              <KeyValue label="连接地址" value={config.graph.neo4j_uri} mono />
              <KeyValue label="用户名" value={config.graph.neo4j_user} mono />
              <KeyValue label="密码" value={config.graph.password_set ? "已配置" : "未配置"} />
            </dl>
          </section>

          <section className="detailPanel sysCard">
            <h2><HardDrive size={16} /> 对象存储</h2>
            <div className="sysModeRow">
              <StatusDot state="ok" />
              <strong>本地文件存储</strong>
            </div>
            <dl className="sysKvList">
              <KeyValue label="对象根目录" value={config.objects.root} mono />
            </dl>
          </section>

          <section className="detailPanel sysCard sysCardWide">
            <h2><Sparkles size={16} /> LLM 模型配置</h2>
            <dl className="sysKvList sysInlineKv">
              <KeyValue label="全局默认模型" value={config.models.global_default} mono />
              <KeyValue
                label="网关状态"
                value={config.models.llm_gateway_configured ? "已配置可用网关" : "未配置（外部模型不可调用）"}
              />
            </dl>
            <div className="sysAgentRow">
              <span className="sysKvLabel">Agent 指派</span>
              <div className="sysAgentChips">
                {Object.entries(config.models.agents || {}).map(([key, modelId]) => (
                  <span key={key} className="sysAgentChip">
                    <em>{AGENT_LABELS[key] || key}</em>
                    <code>{modelId}</code>
                  </span>
                ))}
              </div>
            </div>
            <div className="assetTable sysModelTable">
              {(config.models.catalog || []).map((model) => (
                <article key={model.id} className="assetTableRow sysModelRow">
                  <div>
                    <strong><Bot size={14} /> {model.name}</strong>
                    <span>{model.id} · {model.provider}</span>
                  </div>
                  <small>{model.enabled ? "已启用" : "已停用"}</small>
                  <small>
                    {model.provider === "local"
                      ? "本地启发式"
                      : model.llm_gateway_configured
                        ? `API Key ${model.llm_api_key_set ? "已配置" : "使用全局"}` + (model.llm_base_url ? " · 独立地址" : " · 全局地址")
                        : "缺少 API Key"}
                  </small>
                </article>
              ))}
            </div>
          </section>

          <section className="detailPanel sysCard sysCardWide">
            <h2><Boxes size={16} /> 数据连接（{config.datasources.count}）</h2>
            <div className="assetTable sysModelTable">
              {config.datasources.items.map((source) => (
                <article key={source.id} className="assetTableRow sysModelRow">
                  <div>
                    <strong>{source.name}</strong>
                    <span>{source.type} · {source.tables} 张表 · {source.url_masked}</span>
                  </div>
                  <small>{source.status === "ready" ? "就绪" : source.status}</small>
                  <small>{source.id}</small>
                </article>
              ))}
              {!config.datasources.items.length ? <div className="emptyChoice">暂无数据连接</div> : null}
            </div>
          </section>
        </div>
      ) : (
        <section className="detailPanel sysEmpty">
          <p>配置信息加载失败：{notice}</p>
          <button className="confirmButton" onClick={() => void refresh()}><RefreshCw size={15} /> 重试</button>
        </section>
      )}

      <footer className="helpFooter">
        配置信息来自 API 服务实时探测；密码与密钥均已脱敏处理。
      </footer>
    </main>
  );
}
