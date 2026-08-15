"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, Check, KeyRound, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { api, type ModelCatalogEntry, type ModelConfig } from "../../lib/api";

type ModelDraft = ModelCatalogEntry & {
  clearApiKey?: boolean;
};

type GatewayPreset = {
  key: string;
  label: string;
  id: string;
  name: string;
  provider: "openai_compatible";
  llm_base_url: string;
  description: string;
  hint: string;
};

const GATEWAY_PRESETS: GatewayPreset[] = [
  {
    key: "deepseek-chat",
    label: "DeepSeek Chat",
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    provider: "openai_compatible",
    llm_base_url: "https://api.deepseek.com/v1",
    description: "DeepSeek 官方 API；填写本模型 API Key 即可使用",
    hint: "推荐 · 官方 DeepSeek",
  },
  {
    key: "deepseek-reasoner",
    label: "DeepSeek Reasoner",
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    provider: "openai_compatible",
    llm_base_url: "https://api.deepseek.com/v1",
    description: "DeepSeek 推理模型（R1）",
    hint: "官方 DeepSeek R1",
  },
  {
    key: "openrouter-deepseek",
    label: "OpenRouter · DeepSeek",
    id: "deepseek/deepseek-chat",
    name: "OpenRouter · DeepSeek Chat",
    provider: "openai_compatible",
    llm_base_url: "https://openrouter.ai/api/v1",
    description: "经 OpenRouter 调用 DeepSeek；填写 OpenRouter API Key",
    hint: "OpenRouter 聚合",
  },
  {
    key: "openrouter-gpt4o",
    label: "OpenRouter · GPT-4o",
    id: "openai/gpt-4o",
    name: "OpenRouter · GPT-4o",
    provider: "openai_compatible",
    llm_base_url: "https://openrouter.ai/api/v1",
    description: "经 OpenRouter 调用 GPT-4o",
    hint: "OpenRouter 聚合",
  },
  {
    key: "openai-gpt4o",
    label: "OpenAI GPT-4o",
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai_compatible",
    llm_base_url: "https://api.openai.com/v1",
    description: "OpenAI 官方兼容接口",
    hint: "OpenAI 官方",
  },
  {
    key: "custom",
    label: "自定义兼容网关",
    id: "",
    name: "",
    provider: "openai_compatible",
    llm_base_url: "",
    description: "",
    hint: "任意 OpenAI 兼容 API",
  },
];

const EMPTY_DRAFT: ModelDraft = {
  id: "",
  name: "",
  provider: "openai_compatible",
  enabled: true,
  description: "",
  llm_base_url: "",
  llm_api_key: "",
  clearApiKey: false,
};

export default function ModelsPage() {
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [gatewayReady, setGatewayReady] = useState(false);
  const [notice, setNotice] = useState("加载中");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ModelDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [presetKey, setPresetKey] = useState("deepseek-chat");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiKeyHint, setApiKeyHint] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  const enabledCount = useMemo(
    () => (config?.catalog || []).filter((item) => item.enabled).length,
    [config]
  );
  const isEditing = Boolean(editingId);
  const showModelGatewayFields = draft.provider === "openai_compatible";
  const catalogIds = useMemo(() => new Set((config?.catalog || []).map((item) => item.id)), [config]);

  function applyConfig(modelConfig: ModelConfig, gatewayConfigured?: boolean) {
    setConfig(modelConfig);
    setLlmBaseUrl(modelConfig.llm_base_url || "");
    setApiKeySet(Boolean(modelConfig.llm_api_key_set));
    setApiKeyHint(modelConfig.llm_api_key_hint || "");
    setLlmApiKey("");
    setClearApiKey(false);
    setGatewayReady(
      typeof gatewayConfigured === "boolean"
        ? gatewayConfigured
        : Boolean(modelConfig.llm_gateway_configured)
    );
  }

  async function refresh() {
    setNotice("加载中");
    try {
      const [modelConfig, list] = await Promise.all([api.getModelConfig(), api.listModels(false)]);
      applyConfig(modelConfig, list.llm_gateway_configured);
      setNotice("就绪");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "模型配置加载失败");
    }
  }

  async function persist(next: ModelConfig, successNotice: string): Promise<boolean> {
    setBusy(true);
    try {
      const saved = await api.putModelConfig(next);
      applyConfig(saved);
      setNotice(successNotice);
      setFormError("");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      setNotice(message);
      setFormError(message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setPresetKey("custom");
    setFormError("");
  }

  function normalizeGatewayBaseUrl(url: string) {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    // DeepSeek 官方根地址补全 /v1，避免拼成 /chat/completions 而非 /v1/chat/completions
    if (/^https?:\/\/api\.deepseek\.com$/i.test(trimmed)) {
      return `${trimmed}/v1`;
    }
    return trimmed;
  }

  useEffect(() => {
    if (!showForm) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) closeForm();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showForm, busy]);

  function openCreate(preset: GatewayPreset = GATEWAY_PRESETS.find((item) => item.key === "custom")!) {
    setEditingId(null);
    setPresetKey(preset.key);
    setFormError("");
    setDraft({
      id: preset.id,
      name: preset.name,
      provider: preset.provider,
      enabled: true,
      description: preset.description,
      llm_base_url: preset.llm_base_url,
      llm_api_key: "",
      clearApiKey: false,
    });
    setShowForm(true);
  }

  function applyPreset(key: string) {
    setPresetKey(key);
    const preset = GATEWAY_PRESETS.find((item) => item.key === key);
    if (!preset) return;
    setDraft((item) => ({
      ...item,
      id: preset.id || item.id,
      name: preset.name || item.name,
      provider: preset.provider,
      description: preset.description || item.description,
      llm_base_url: preset.llm_base_url || item.llm_base_url,
    }));
  }

  function openEdit(model: ModelCatalogEntry) {
    setEditingId(model.id);
    const matched =
      GATEWAY_PRESETS.find((preset) => preset.id === model.id && preset.key !== "custom") ||
      GATEWAY_PRESETS.find(
        (preset) =>
          preset.key !== "custom" &&
          Boolean(model.llm_base_url) &&
          preset.llm_base_url === model.llm_base_url
      );
    setPresetKey(matched?.key || "custom");
    setFormError("");
    setDraft({
      id: model.id,
      name: model.name,
      provider: model.provider || "openai_compatible",
      enabled: model.enabled,
      description: model.description || "",
      llm_base_url: model.llm_base_url || "",
      llm_api_key: "",
      llm_api_key_set: model.llm_api_key_set,
      llm_api_key_hint: model.llm_api_key_hint,
      clearApiKey: false,
    });
    setShowForm(true);
  }

  async function quickAddPreset(preset: GatewayPreset) {
    if (!config) return;
    if (catalogIds.has(preset.id)) {
      const existing = config.catalog.find((item) => item.id === preset.id);
      if (existing) openEdit(existing);
      else setNotice(`模型 ${preset.id} 已存在`);
      return;
    }
    await persist(
      {
        ...config,
        catalog: [
          ...config.catalog.map((item) => ({ ...item, llm_api_key: "" })),
          {
            id: preset.id,
            name: preset.name,
            provider: preset.provider,
            enabled: true,
            description: preset.description,
            llm_base_url: preset.llm_base_url,
            llm_api_key: "",
          },
        ],
        llm_api_key: "",
      },
      `已添加 ${preset.name}，请填写 API Key`
    );
    const next = {
      id: preset.id,
      name: preset.name,
      provider: preset.provider,
      enabled: true,
      description: preset.description,
      llm_base_url: preset.llm_base_url,
    };
    openEdit(next);
  }

  async function saveGateway() {
    if (!config) return;
    const nextKey = clearApiKey ? "__CLEAR__" : llmApiKey.trim();
    await persist(
      {
        ...config,
        llm_base_url: normalizeGatewayBaseUrl(llmBaseUrl),
        llm_api_key: nextKey,
        catalog: (config.catalog || []).map((item) => ({
          ...item,
          llm_api_key: "",
        })),
      },
      clearApiKey ? "已更新全局网关地址并清除 API Key" : "全局 LLM 网关配置已保存"
    );
  }

  function modelCallable(model: ModelCatalogEntry) {
    if (model.provider === "local") return true;
    return Boolean(model.llm_gateway_configured);
  }

  async function setDefault(modelId: string) {
    if (!config) return;
    const model = config.catalog.find((item) => item.id === modelId);
    if (model && model.provider === "openai_compatible" && !modelCallable(model)) {
      setNotice(`「${model.name}」尚未配置可用 API Key，请先编辑填写密钥再设为默认`);
      openEdit(model);
      return;
    }
    const nextAgents = { ...(config.agents || {}) };
    if (model?.provider === "openai_compatible") {
      nextAgents.planner = modelId;
      nextAgents.analyzer = modelId;
    }
    await persist(
      {
        ...config,
        global_default: modelId,
        agents: nextAgents,
        llm_api_key: "",
        catalog: (config.catalog || []).map((item) => ({ ...item, llm_api_key: "" })),
      },
      `已将默认模型设为 ${modelId}`
    );
  }

  async function toggleEnabled(modelId: string) {
    if (!config) return;
    const catalog = config.catalog.map((item) =>
      item.id === modelId ? { ...item, enabled: !item.enabled, llm_api_key: "" } : { ...item, llm_api_key: "" }
    );
    const stillEnabled = catalog.some((item) => item.enabled && item.id === config.global_default);
    await persist(
      {
        ...config,
        catalog,
        global_default: stillEnabled ? config.global_default : (catalog.find((item) => item.enabled)?.id || config.global_default),
        llm_api_key: "",
      },
      "模型启用状态已更新"
    );
  }

  async function removeModel(modelId: string) {
    if (!config) return;
    if (!window.confirm(`确认从列表移除模型「${modelId}」？`)) return;
    const catalog = config.catalog
      .filter((item) => item.id !== modelId)
      .map((item) => ({ ...item, llm_api_key: "" }));
    if (!catalog.length) {
      setNotice("至少保留一个模型");
      return;
    }
    await persist(
      {
        ...config,
        catalog,
        global_default: catalog.some((item) => item.id === config.global_default)
          ? config.global_default
          : catalog[0].id,
        llm_api_key: "",
      },
      "模型已移除"
    );
    if (editingId === modelId) closeForm();
  }

  async function saveModel() {
    if (!config) return;
    const id = draft.id.trim();
    const name = draft.name.trim() || id;
    if (!id) {
      setFormError("请填写模型 ID（需与提供方 model 字段一致，如 deepseek-chat）");
      return;
    }
    const provider = draft.provider || "openai_compatible";
    const description = draft.description?.trim() || "";
    const enabled = draft.enabled;
    const entryBaseUrl =
      provider === "openai_compatible" ? normalizeGatewayBaseUrl(draft.llm_base_url || "") : "";
    let entryApiKey = "";
    if (provider === "openai_compatible") {
      if (draft.clearApiKey) entryApiKey = "__CLEAR__";
      else entryApiKey = (draft.llm_api_key || "").trim();
      const hasModelKey =
        (Boolean(entryApiKey) && entryApiKey !== "__CLEAR__") ||
        (Boolean(draft.llm_api_key_set) && !draft.clearApiKey);
      const hasGlobalKey = (Boolean(apiKeySet) && !clearApiKey) || Boolean(llmApiKey.trim());
      const hasBase = Boolean(entryBaseUrl || normalizeGatewayBaseUrl(llmBaseUrl) || config.llm_base_url);
      if (!hasModelKey && !hasGlobalKey) {
        setFormError("请填写本模型 LLM_API_KEY（或先保存全局 API Key），否则无法调用该模型");
        return;
      }
      if (!hasBase) {
        setFormError("请填写 LLM_BASE_URL（本模型或全局），例如 https://api.deepseek.com/v1");
        return;
      }
    } else if (isEditing) {
      entryApiKey = "__CLEAR__";
    }

    const nextEntry: ModelCatalogEntry = {
      id,
      name,
      provider,
      enabled,
      description,
      llm_base_url: entryBaseUrl,
      llm_api_key: entryApiKey,
    };

    if (isEditing && editingId) {
      const conflict = config.catalog.some((item) => item.id === id && item.id !== editingId);
      if (conflict) {
        setFormError("模型 ID 已存在，请换一个 ID 或直接编辑已有项");
        return;
      }
      const catalog = config.catalog.map((item) => {
        if (item.id === editingId) return nextEntry;
        return { ...item, llm_api_key: "" };
      });
      const agents = Object.fromEntries(
        Object.entries(config.agents || {}).map(([key, value]) => [
          key,
          value === editingId ? id : value,
        ])
      );
      const globalDefault = config.global_default === editingId ? id : config.global_default;
      const stillEnabled = catalog.some((item) => item.enabled && item.id === globalDefault);
      const ok = await persist(
        {
          ...config,
          catalog,
          agents,
          global_default: stillEnabled
            ? globalDefault
            : (catalog.find((item) => item.enabled)?.id || catalog[0]?.id || globalDefault),
          llm_api_key: "",
        },
        `模型「${name}」配置已更新`
      );
      if (ok) closeForm();
      return;
    }

    if (config.catalog.some((item) => item.id === id)) {
      setFormError("模型 ID 已存在，可直接点列表中的「编辑」填写 API Key");
      return;
    }
    const ok = await persist(
      {
        ...config,
        catalog: [
          ...config.catalog.map((item) => ({ ...item, llm_api_key: "" })),
          nextEntry,
        ],
        llm_api_key: "",
      },
      "模型已添加"
    );
    if (ok) closeForm();
  }

  return (
    <main className="detailPage">
      <header className="detailTopbar">
        <a className="linkButton" href="/workspace"><ArrowLeft size={16} /> 返回工作台</a>
        <button onClick={() => void refresh()}><RefreshCw size={16} /> 刷新</button>
      </header>

      <section className="detailHero">
        <div>
          <Bot size={28} />
          <h1>模型管理</h1>
          <p>
            {config ? `${config.catalog.length} 个模型 · 已启用 ${enabledCount} 个` : "加载中"}
            {" · "}
            {notice}
          </p>
          <small className={gatewayReady ? "modelGatewayOk" : "modelGatewayWarn"}>
            {gatewayReady
              ? "已配置可用网关（模型级或全局），可调用 openai_compatible 模型"
              : "DeepSeek / OpenRouter 等需填写对应 API Key 后才可调用"}
          </small>
          {config?.global_default &&
          config.catalog.some(
            (item) =>
              item.id === config.global_default &&
              item.provider === "openai_compatible" &&
              !item.llm_gateway_configured
          ) ? (
            <small className="modelGatewayWarn">
              当前默认模型「{config.global_default}」缺少 API Key，外部接口无法取数；请点编辑粘贴密钥并保存
            </small>
          ) : null}
        </div>
        <button className="primaryButton" disabled={busy} onClick={() => openCreate()}>
          <Plus size={16} /> 添加模型
        </button>
      </section>

      <section className="detailPanel modelFormPanel">
        <h2>快捷接入</h2>
        <p className="modelGatewayHint">
          一键加入 DeepSeek、OpenRouter 或其它 OpenAI 兼容模型。模型 ID 会作为请求体里的 <code>model</code> 字段发送。
        </p>
        <div className="modelPresetRow">
          {GATEWAY_PRESETS.filter((item) => item.key !== "custom").map((preset) => {
            const exists = catalogIds.has(preset.id);
            return (
              <button
                key={preset.key}
                type="button"
                className="modelPresetCard"
                disabled={busy || !config}
                onClick={() => void quickAddPreset(preset)}
              >
                <strong>{preset.label}</strong>
                <span>{preset.hint}</span>
                <small>{exists ? "已在列表 · 点此编辑密钥" : preset.llm_base_url}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="detailPanel modelFormPanel">
        <h2><KeyRound size={16} /> 全局 LLM 网关（默认回退）</h2>
        <p className="modelGatewayHint">
          未单独配置的模型会使用此处。DeepSeek / OpenRouter 建议在模型级填写各自 Key，避免混用。
        </p>
        <div className="modelFormGrid">
          <label className="modelFormFull">
            <span>LLM_BASE_URL</span>
            <input
              value={llmBaseUrl}
              placeholder="例如 https://api.deepseek.com/v1 或 https://openrouter.ai/api/v1"
              onChange={(event) => setLlmBaseUrl(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="modelFormFull">
            <span>LLM_API_KEY</span>
            <input
              type="password"
              value={llmApiKey}
              placeholder={
                clearApiKey
                  ? "将清除已保存的 API Key"
                  : apiKeySet
                    ? `已保存 ${apiKeyHint || "********"}，输入新值可覆盖`
                    : "输入 API Key"
              }
              disabled={clearApiKey}
              onChange={(event) => {
                setLlmApiKey(event.target.value);
                if (event.target.value) setClearApiKey(false);
              }}
              autoComplete="new-password"
            />
          </label>
        </div>
        <div className="buttonRow">
          <button className="confirmButton" disabled={busy || !config} onClick={() => void saveGateway()}>
            <Check size={15} /> 保存全局网关
          </button>
          <button
            type="button"
            disabled={busy || (!apiKeySet && !llmApiKey)}
            onClick={() => {
              setClearApiKey((value) => !value);
              setLlmApiKey("");
            }}
          >
            {clearApiKey ? "取消清除密钥" : "清除 API Key"}
          </button>
        </div>
      </section>

      <section className="detailPanel">
        <h2>使用中的模型列表</h2>
        <div className="assetTable">
          {(config?.catalog || []).map((model) => {
            const isDefault = config?.global_default === model.id;
            return (
              <article
                key={model.id}
                className={`assetTableRow modelTableRow ${model.enabled ? "" : "disabledRow"}`}
              >
                <div>
                  <strong>
                    <Sparkles size={14} /> {model.name}
                    {isDefault ? <em className="modelDefaultBadge">默认</em> : null}
                  </strong>
                  <span>{model.id} · {model.provider}</span>
                  {model.description ? <small>{model.description}</small> : null}
                  {model.provider === "openai_compatible" ? (
                    <small>
                      {model.llm_base_url ? `BASE_URL: ${model.llm_base_url}` : "BASE_URL: 使用全局"}
                      {" · "}
                      {model.llm_api_key_set ? `API_KEY: ${model.llm_api_key_hint || "已配置"}` : "API_KEY: 使用全局 / 未配置"}
                      {model.llm_gateway_configured ? " · 可调用" : " · 未就绪"}
                    </small>
                  ) : null}
                </div>
                <small>{model.enabled ? "已启用" : "已停用"}</small>
                <div className="rowActions">
                  <button disabled={busy} title="编辑模型配置" onClick={() => openEdit(model)}>
                    <Pencil size={15} /> 编辑
                  </button>
                  <button
                    disabled={busy || isDefault || !model.enabled || (model.provider === "openai_compatible" && !modelCallable(model))}
                    title={
                      model.provider === "openai_compatible" && !modelCallable(model)
                        ? "请先配置 API Key"
                        : "设为默认模型"
                    }
                    onClick={() => void setDefault(model.id)}
                  >
                    设为默认
                  </button>
                  <button disabled={busy} onClick={() => void toggleEnabled(model.id)}>
                    {model.enabled ? "停用" : "启用"}
                  </button>
                  <button className="dangerButton" disabled={busy || isDefault} onClick={() => void removeModel(model.id)}>
                    <Trash2 size={15} /> 移除
                  </button>
                </div>
              </article>
            );
          })}
          {!config?.catalog?.length ? <div className="emptyChoice">暂无模型，请先添加</div> : null}
        </div>
      </section>

      {showForm ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) closeForm();
          }}
        >
          <section
            className="assetCreatorModal modelEditorModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-editor-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sectionHeader">
              <div>
                <h2 id="model-editor-title">{isEditing ? `编辑模型 · ${editingId}` : "新增可用模型"}</h2>
                <p>选择预设可自动填充 Base URL 与模型 ID；也可改成任意 OpenAI 兼容网关。</p>
              </div>
              <button className="iconOnly" type="button" disabled={busy} onClick={closeForm} title="关闭">
                <X size={16} />
              </button>
            </div>

            <div className="modelFormGrid">
              <label className="modelFormFull">
                <span>网关预设</span>
                <select
                  value={presetKey}
                  onChange={(event) => applyPreset(event.target.value)}
                  disabled={busy}
                >
                  {GATEWAY_PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.label}{preset.hint ? `（${preset.hint}）` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>模型 ID（请求 model）</span>
                <input
                  value={draft.id}
                  placeholder="deepseek-chat / deepseek/deepseek-chat / gpt-4o"
                  onChange={(event) => setDraft((item) => ({ ...item, id: event.target.value }))}
                />
              </label>
              <label>
                <span>显示名称</span>
                <input
                  value={draft.name}
                  placeholder="例如 DeepSeek Chat"
                  onChange={(event) => setDraft((item) => ({ ...item, name: event.target.value }))}
                />
              </label>
              <label>
                <span>提供方</span>
                <select
                  value={draft.provider}
                  onChange={(event) => setDraft((item) => ({ ...item, provider: event.target.value }))}
                >
                  <option value="local">local（本地启发式，不走网关）</option>
                  <option value="openai_compatible">openai_compatible（OpenAI 兼容网关）</option>
                </select>
              </label>
              <label className="modelFormCheck">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setDraft((item) => ({ ...item, enabled: event.target.checked }))}
                />
                <span>启用</span>
              </label>
              <label className="modelFormFull">
                <span>说明 / 备注</span>
                <input
                  value={draft.description || ""}
                  placeholder="用途说明（可选）"
                  onChange={(event) => setDraft((item) => ({ ...item, description: event.target.value }))}
                />
              </label>
              {showModelGatewayFields ? (
                <>
                  <label className="modelFormFull">
                    <span>LLM_BASE_URL（本模型）</span>
                    <input
                      value={draft.llm_base_url || ""}
                      placeholder="https://api.deepseek.com/v1"
                      onChange={(event) => setDraft((item) => ({ ...item, llm_base_url: event.target.value }))}
                      autoComplete="off"
                    />
                  </label>
                  <label className="modelFormFull">
                    <span>LLM_API_KEY（本模型）</span>
                    <input
                      type="password"
                      value={draft.llm_api_key || ""}
                      placeholder={
                        draft.clearApiKey
                          ? "将清除本模型 API Key"
                          : draft.llm_api_key_set
                            ? `已保存 ${draft.llm_api_key_hint || "********"}，输入新值可覆盖；留空保留`
                            : "粘贴 DeepSeek / OpenRouter / 其它 Key"
                      }
                      disabled={Boolean(draft.clearApiKey)}
                      onChange={(event) =>
                        setDraft((item) => ({
                          ...item,
                          llm_api_key: event.target.value,
                          clearApiKey: event.target.value ? false : item.clearApiKey,
                        }))
                      }
                      autoComplete="new-password"
                    />
                  </label>
                  <div className="modelFormFull buttonRow" style={{ margin: 0 }}>
                    <button
                      type="button"
                      disabled={busy || (!draft.llm_api_key_set && !draft.llm_api_key)}
                      onClick={() =>
                        setDraft((item) => ({
                          ...item,
                          clearApiKey: !item.clearApiKey,
                          llm_api_key: "",
                        }))
                      }
                    >
                      {draft.clearApiKey ? "取消清除本模型密钥" : "清除本模型 API Key"}
                    </button>
                  </div>
                </>
              ) : null}
            </div>

            {formError ? <p className="modelFormError" role="alert">{formError}</p> : null}
            {busy ? <p className="modelFormBusy">正在保存…</p> : null}

            <div className="modalActions">
              <button type="button" disabled={busy} onClick={closeForm}>
                取消
              </button>
              <button className="confirmButton" disabled={busy} onClick={() => void saveModel()}>
                <Check size={15} /> {busy ? "保存中…" : isEditing ? "保存修改" : "保存模型"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
