"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, CheckSquare, Database, FolderKanban, GitBranch, Pencil, Plus, Search, Server, Tags, Trash2, X } from "lucide-react";
import { api, type Asset, type AssetTag, type CombinedKnowledgeGraph, type Dataset, type Datasource } from "../../lib/api";
import { saveAnalysisPlan } from "../../lib/analysisPlan";
import { GraphNetwork } from "../../components/GraphNetwork";
import { RecommendedQuestionsPanel } from "../../components/RecommendedQuestionsPanel";
import { TagMultiSelect } from "../../components/TagMultiSelect";

type AssetView = "assets" | "connections" | "datasets" | "tags";
type AssetGroupMode = "tag" | "kind";
type DatasetDialogMode = "create" | "add" | "edit";

const FILE_CONNECTION_KIND = "upload";

const DEFAULT_KIND_LABELS: Record<string, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  sqlite: "SQLite",
  clickhouse: "ClickHouse",
  mssql: "SQL Server",
  duckdb: "DuckDB",
  [FILE_CONNECTION_KIND]: "文件上传",
};

type ConnectionDialogMode = "create" | "edit";

const DEFAULT_ASSET_TAG = "public";

function assetTags(asset: Asset): string[] {
  const tags = (asset.tags || []).map((tag) => tag.trim()).filter(Boolean);
  return tags.length ? tags : [DEFAULT_ASSET_TAG];
}

function tagPath(tag: AssetTag): string {
  return (tag.path || tag.name || "").trim();
}

function tagLabel(tag: AssetTag): string {
  return tagPath(tag).split("/").join(" / ");
}

function assetMatchesTagPath(asset: Asset, filterPath: string): boolean {
  return assetTags(asset).some(
    (value) => value === filterPath || value.startsWith(`${filterPath}/`)
  );
}

function displayTagChip(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts[parts.length - 1] || value;
}

/** 多级标签完整路径展示，如 retail / orders */
function displayTagPath(value: string): string {
  return value.split("/").filter(Boolean).join(" / ") || value;
}

/** Keep only deepest tags so parent/child paths don't both show the same asset. */
function leafTagsOfAsset(asset: Asset): string[] {
  const tags = assetTags(asset);
  return tags.filter((tag) => !tags.some((other) => other !== tag && other.startsWith(`${tag}/`)));
}

function isTagUnderOrEqual(tagPathValue: string, filterPath: string): boolean {
  return tagPathValue === filterPath || tagPathValue.startsWith(`${filterPath}/`);
}

function toLeafTagValues(tags: string[]): string[] {
  const cleaned = tags.map((tag) => tag.trim()).filter(Boolean);
  const leaves = cleaned.filter((tag) => !cleaned.some((other) => other !== tag && other.startsWith(`${tag}/`)));
  const hasNonPublic = leaves.some(
    (tag) => tag !== DEFAULT_ASSET_TAG && !tag.startsWith(`${DEFAULT_ASSET_TAG}/`)
  );
  const reconciled = hasNonPublic
    ? leaves.filter((tag) => tag !== DEFAULT_ASSET_TAG && !tag.startsWith(`${DEFAULT_ASSET_TAG}/`))
    : leaves;
  return reconciled.length ? reconciled : [DEFAULT_ASSET_TAG];
}

function connectionNeedsAuth(kind: string): boolean {
  return kind !== "sqlite" && kind !== "duckdb";
}

type ParsedDbUrl = { scheme: string; username: string; password: string; rest: string };

function parseDbUrl(url: string): ParsedDbUrl {
  const match = url.trim().match(/^([^:\s/]+):\/\/(?:([^:@/?#]*)(?::([^@/?#]*))?@)?(.*)$/);
  if (!match) return { scheme: "", username: "", password: "", rest: url.trim() };
  const decode = (value: string) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return {
    scheme: match[1] || "",
    username: decode(match[2] || ""),
    password: decode(match[3] || ""),
    rest: match[4] || "",
  };
}

function stripDbUrlAuth(url: string): string {
  const parsed = parseDbUrl(url);
  if (!parsed.scheme) return url.trim();
  return `${parsed.scheme}://${parsed.rest}`;
}

function composeDatabaseUrl(url: string, username: string, password: string, kind: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (!connectionNeedsAuth(kind)) return stripDbUrlAuth(trimmed);
  const parsed = parseDbUrl(trimmed);
  const scheme = parsed.scheme || `${kind}+driver`;
  const rest = parsed.rest || (parsed.scheme ? "" : trimmed.replace(/^[a-z0-9+.-]+:\/\//i, ""));
  const user = username.trim();
  const pass = password;
  if (!user && !pass) return `${scheme}://${rest}`;
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`;
  return `${scheme}://${auth}${rest}`;
}

function exampleUrlWithoutAuth(hint: string): string {
  return hint ? stripDbUrlAuth(hint) : "";
}

export default function DataAssetsPage() {
  const [activeView, setActiveView] = useState<AssetView>("assets");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [supported, setSupported] = useState<Record<string, string>>({});
  const [kindLabels, setKindLabels] = useState<Record<string, string>>(DEFAULT_KIND_LABELS);
  const [kindOrder, setKindOrder] = useState<string[]>(Object.keys(DEFAULT_KIND_LABELS));
  const [connDialogOpen, setConnDialogOpen] = useState(false);
  const [datasetDialogOpen, setDatasetDialogOpen] = useState(false);
  const [datasetDialogMode, setDatasetDialogMode] = useState<DatasetDialogMode>("create");
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [datasetDescription, setDatasetDescription] = useState("");
  const [datasetTargetId, setDatasetTargetId] = useState("");
  const [datasetPickerTag, setDatasetPickerTag] = useState("all");
  const [datasetDialogAssetIds, setDatasetDialogAssetIds] = useState<string[]>([]);
  const [datasetAddingAssets, setDatasetAddingAssets] = useState(false);
  const [expandedDatasetId, setExpandedDatasetId] = useState<string | null>(null);
  const [connDialogMode, setConnDialogMode] = useState<ConnectionDialogMode>("create");
  const [editingDatasource, setEditingDatasource] = useState<Datasource | null>(null);
  const [name, setName] = useState("");
  const [dbKind, setDbKind] = useState("mysql");
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [connUsername, setConnUsername] = useState("");
  const [connPassword, setConnPassword] = useState("");
  const [testPassed, setTestPassed] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testedTables, setTestedTables] = useState<string[]>([]);
  const [sampleLimit, setSampleLimit] = useState(5000);
  const [notice, setNotice] = useState("准备就绪");
  const [busy, setBusy] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [combinedGraph, setCombinedGraph] = useState<CombinedKnowledgeGraph | null>(null);
  const [assetCreatorOpen, setAssetCreatorOpen] = useState(false);
  const [creatorDatasourceId, setCreatorDatasourceId] = useState("");
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [managedTags, setManagedTags] = useState<AssetTag[]>([]);
  const [creatorSelectedTags, setCreatorSelectedTags] = useState<string[]>([DEFAULT_ASSET_TAG]);
  const [activeTagFilter, setActiveTagFilter] = useState<string>("all");
  const [activeKindFilter, setActiveKindFilter] = useState<string>("all");
  const [assetGroupMode, setAssetGroupMode] = useState<AssetGroupMode>("tag");
  const [tagEditorAssetId, setTagEditorAssetId] = useState<string | null>(null);
  const [tagEditorMode, setTagEditorMode] = useState<"single" | "batch">("single");
  const [tagEditorSelected, setTagEditorSelected] = useState<string[]>([DEFAULT_ASSET_TAG]);
  const [batchTagMode, setBatchTagMode] = useState<"add" | "replace">("add");
  const [newTagName, setNewTagName] = useState("");
  const [newTagDescription, setNewTagDescription] = useState("");
  const [newTagParentId, setNewTagParentId] = useState<string>("");
  const [assetSearch, setAssetSearch] = useState("");

  const orderedManagedTags = useMemo(() => {
    return [...managedTags].sort((a, b) => {
      const pathA = tagPath(a);
      const pathB = tagPath(b);
      if (pathA === DEFAULT_ASSET_TAG) return -1;
      if (pathB === DEFAULT_ASSET_TAG) return 1;
      return pathA.localeCompare(pathB, "zh-CN");
    });
  }, [managedTags]);

  const publicTag = useMemo(
    () => orderedManagedTags.find((tag) => tagPath(tag) === DEFAULT_ASSET_TAG || tag.name === DEFAULT_ASSET_TAG) || null,
    [orderedManagedTags]
  );

  const datasourceById = useMemo(() => {
    const map = new Map<string, Datasource>();
    for (const item of datasources) map.set(item.id, item);
    return map;
  }, [datasources]);

  function connectionKindOf(asset: Asset): string {
    if (asset.datasource_id) {
      const ds = datasourceById.get(asset.datasource_id);
      if (ds?.type) return ds.type;
    }
    if (asset.source === "database" || asset.type === "database") return "unknown";
    return FILE_CONNECTION_KIND;
  }

  function connectionKindLabel(kind: string): string {
    if (kind === "unknown") return "未知连接";
    return kindLabels[kind] || kind;
  }

  const filteredAssets = useMemo(() => {
    const query = assetSearch.trim().toLowerCase();
    if (!query) return assets;
    return assets.filter((asset) => {
      const kind = connectionKindOf(asset);
      const ds = asset.datasource_id ? datasourceById.get(asset.datasource_id) : null;
      const haystack = [
        asset.name,
        asset.source,
        asset.source_table,
        asset.data_dictionary?.table_name,
        asset.parse_status,
        kind,
        connectionKindLabel(kind),
        ds?.name,
        ...assetTags(asset),
        ...leafTagsOfAsset(asset).map(displayTagChip),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [assets, assetSearch, datasourceById, kindLabels]);

  const scopedAssets = useMemo(() => {
    return filteredAssets.filter((asset) => {
      if (activeKindFilter !== "all" && connectionKindOf(asset) !== activeKindFilter) return false;
      if (activeTagFilter !== "all") {
        const leaves = leafTagsOfAsset(asset);
        if (!leaves.some((tag) => isTagUnderOrEqual(tag, activeTagFilter))) return false;
      }
      return true;
    });
  }, [filteredAssets, activeKindFilter, activeTagFilter, datasourceById]);

  const visibleAssetGroups = useMemo(() => {
    if (assetGroupMode === "kind") {
      const groups: Record<string, Asset[]> = {};
      for (const asset of scopedAssets) {
        const kind = connectionKindOf(asset);
        if (!groups[kind]) groups[kind] = [];
        groups[kind].push(asset);
      }
      const orderedKinds = [
        ...kindOrder.filter((kind) => groups[kind]?.length),
        ...Object.keys(groups)
          .filter((kind) => !kindOrder.includes(kind))
          .sort((a, b) => connectionKindLabel(a).localeCompare(connectionKindLabel(b), "zh-CN")),
      ];
      return orderedKinds.map((kind) => ({
        key: `kind:${kind}`,
        title: connectionKindLabel(kind),
        subtitle: kind,
        items: groups[kind],
      }));
    }

    const groups: Record<string, Asset[]> = {};
    const seenInGroup = new Map<string, Set<string>>();
    for (const asset of scopedAssets) {
      const leaves = leafTagsOfAsset(asset);
      for (const tag of leaves) {
        if (activeTagFilter !== "all" && !isTagUnderOrEqual(tag, activeTagFilter)) continue;
        if (!groups[tag]) groups[tag] = [];
        if (!seenInGroup.has(tag)) seenInGroup.set(tag, new Set());
        const used = seenInGroup.get(tag)!;
        if (used.has(asset.id)) continue;
        used.add(asset.id);
        groups[tag].push(asset);
      }
    }
    const ordered = [
      ...(groups[DEFAULT_ASSET_TAG] ? [DEFAULT_ASSET_TAG] : []),
      ...Object.keys(groups).filter((tag) => tag !== DEFAULT_ASSET_TAG).sort((a, b) => a.localeCompare(b, "zh-CN")),
    ];
    return ordered.map((tag) => ({
      key: `tag:${tag}`,
      title: displayTagPath(tag),
      subtitle: tag,
      items: groups[tag],
    }));
  }, [assetGroupMode, scopedAssets, activeTagFilter, kindOrder, kindLabels, datasourceById]);

  const connectionKindStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const asset of filteredAssets) {
      const kind = connectionKindOf(asset);
      counts[kind] = (counts[kind] || 0) + 1;
    }
    const ordered = [
      ...kindOrder.filter((kind) => counts[kind]),
      ...Object.keys(counts)
        .filter((kind) => !kindOrder.includes(kind))
        .sort((a, b) => connectionKindLabel(a).localeCompare(connectionKindLabel(b), "zh-CN")),
    ];
    return ordered.map((kind) => ({ kind, count: counts[kind], label: connectionKindLabel(kind) }));
  }, [filteredAssets, kindOrder, kindLabels, datasourceById]);

  const datasourcesByKind = useMemo(() => {
    const groups: Record<string, Datasource[]> = {};
    for (const ds of datasources) {
      const kind = (ds.type || "other").toLowerCase();
      if (!groups[kind]) groups[kind] = [];
      groups[kind].push(ds);
    }
    const orderedKinds = [
      ...kindOrder.filter((kind) => groups[kind]?.length),
      ...Object.keys(groups).filter((kind) => !kindOrder.includes(kind)).sort(),
    ];
    return orderedKinds.map((kind) => ({
      kind,
      label: kindLabels[kind] || kind,
      items: groups[kind],
    }));
  }, [datasources, kindLabels, kindOrder]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const view = new URLSearchParams(window.location.search).get("view");
      if (view === "datasets" || view === "connections" || view === "tags" || view === "assets") {
        setActiveView(view);
      }
    }
    void refresh();
  }, []);

  async function refresh() {
    const [library, ds, supportedData, tags, datasetList] = await Promise.all([
      api.assetLibrary(),
      api.datasources(),
      api.supportedDatasources(),
      api.listTags(),
      api.listDatasets(),
    ]);
    setAssets(library.data_assets);
    setDatasources(ds);
    setManagedTags(tags);
    setDatasets(datasetList);
    if (!newTagParentId) setNewTagParentId("__root__");
    setSupported(supportedData.supported);
    if (supportedData.labels) setKindLabels({ ...DEFAULT_KIND_LABELS, ...supportedData.labels });
    if (supportedData.kinds?.length) {
      setKindOrder([
        ...supportedData.kinds.filter((kind) => kind !== FILE_CONNECTION_KIND),
        FILE_CONNECTION_KIND,
      ]);
    }
  }

  const assetsById = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const asset of assets) map.set(asset.id, asset);
    return map;
  }, [assets]);

  const datasetMemberAssets = useMemo(() => {
    return datasetDialogAssetIds
      .map((id) => assetsById.get(id))
      .filter((item): item is Asset => !!item);
  }, [assetsById, datasetDialogAssetIds]);

  const datasetPickerAssets = useMemo(() => {
    const memberIds = new Set(datasetDialogAssetIds);
    const scoped = datasetPickerTag === "all"
      ? assets
      : assets.filter((asset) =>
          leafTagsOfAsset(asset).some((tag) => isTagUnderOrEqual(tag, datasetPickerTag))
        );
    // 编辑模式下的「新增」只展示尚未纳入的资产
    if (datasetDialogMode === "edit") {
      return scoped.filter((asset) => !memberIds.has(asset.id));
    }
    return scoped;
  }, [assets, datasetDialogAssetIds, datasetDialogMode, datasetPickerTag]);

  const datasetPickerVisibleSelectedCount = useMemo(
    () => datasetPickerAssets.filter((asset) => datasetDialogAssetIds.includes(asset.id)).length,
    [datasetDialogAssetIds, datasetPickerAssets],
  );

  function openCreateDatasetDialog(initialAssetIds?: string[]) {
    const seedIds = initialAssetIds ?? selectedAssetIds;
    const pickerTag = activeTagFilter !== "all" ? activeTagFilter : "all";
    const defaultName =
      pickerTag !== "all"
        ? `${displayTagPath(pickerTag)} 数据集`
        : `数据集 ${new Date().toLocaleDateString("zh-CN")}`;
    setDatasetDialogMode("create");
    setEditingDataset(null);
    setDatasetName(defaultName);
    setDatasetDescription(
      pickerTag !== "all"
        ? `按标签「${displayTagPath(pickerTag)}」所选资产构建`
        : seedIds.length
          ? `由所选 ${seedIds.length} 个资产构建`
          : ""
    );
    setDatasetTargetId("");
    setDatasetPickerTag(pickerTag);
    setDatasetDialogAssetIds(seedIds);
    setDatasetAddingAssets(false);
    setDatasetDialogOpen(true);
  }

  function openAddToDatasetDialog(initialAssetIds?: string[]) {
    const seedIds = initialAssetIds ?? selectedAssetIds;
    if (!datasets.length) {
      setNotice("暂无数据集，请先构建新的数据集");
      openCreateDatasetDialog(seedIds);
      return;
    }
    setDatasetDialogMode("add");
    setEditingDataset(null);
    setDatasetName("");
    setDatasetDescription("");
    setDatasetTargetId(datasets[0].id);
    setDatasetPickerTag(activeTagFilter !== "all" ? activeTagFilter : "all");
    setDatasetDialogAssetIds(seedIds);
    setDatasetAddingAssets(false);
    setDatasetDialogOpen(true);
  }

  function openEditDataset(dataset: Dataset) {
    setDatasetDialogMode("edit");
    setEditingDataset(dataset);
    setDatasetName(dataset.name);
    setDatasetDescription(dataset.description || "");
    setDatasetTargetId(dataset.id);
    setDatasetPickerTag("all");
    setDatasetDialogAssetIds([...dataset.asset_ids]);
    setDatasetAddingAssets(false);
    setDatasetDialogOpen(true);
  }

  function closeDatasetDialog() {
    setDatasetDialogOpen(false);
    setEditingDataset(null);
    setDatasetName("");
    setDatasetDescription("");
    setDatasetTargetId("");
    setDatasetPickerTag("all");
    setDatasetDialogAssetIds([]);
    setDatasetAddingAssets(false);
  }

  function toggleDatasetDialogAsset(assetId: string) {
    setDatasetDialogAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  }

  function addDatasetDialogAssets(assetIds: string[]) {
    if (!assetIds.length) return;
    setDatasetDialogAssetIds((prev) => {
      const next = new Set(prev);
      for (const id of assetIds) next.add(id);
      return [...next];
    });
  }

  function removeDatasetDialogAsset(assetId: string) {
    setDatasetDialogAssetIds((prev) => prev.filter((id) => id !== assetId));
  }

  function selectAllDatasetPickerVisible() {
    if (datasetDialogMode === "edit") {
      addDatasetDialogAssets(datasetPickerAssets.map((asset) => asset.id));
      return;
    }
    setDatasetDialogAssetIds((prev) => {
      const next = new Set(prev);
      for (const asset of datasetPickerAssets) next.add(asset.id);
      return [...next];
    });
  }

  function clearDatasetPickerVisible() {
    const visible = new Set(datasetPickerAssets.map((asset) => asset.id));
    setDatasetDialogAssetIds((prev) => prev.filter((id) => !visible.has(id)));
  }

  async function saveDatasetDialog() {
    if (datasetDialogMode !== "add" && !datasetName.trim()) {
      setNotice("请填写数据集名称");
      return;
    }
    if (!datasetDialogAssetIds.length && datasetDialogMode !== "edit") {
      setNotice("请先通过标签筛选并勾选数据资产");
      return;
    }
    setBusy(true);
    try {
      const tagMeta =
        datasetPickerTag !== "all"
          ? [datasetPickerTag]
          : activeTagFilter !== "all"
            ? [activeTagFilter]
            : [];
      if (datasetDialogMode === "create") {
        const created = await api.createDataset({
          name: datasetName.trim(),
          description: datasetDescription.trim(),
          asset_ids: datasetDialogAssetIds,
          tags: tagMeta,
        });
        setDatasets((items) => [created, ...items.filter((item) => item.id !== created.id)]);
        closeDatasetDialog();
        setNotice(`已创建数据集「${created.name}」，包含 ${created.asset_ids.length} 个资产`);
        setActiveView("datasets");
      } else if (datasetDialogMode === "add") {
        if (!datasetTargetId) {
          setNotice("请选择要加入的数据集");
          return;
        }
        if (!datasetDialogAssetIds.length) {
          setNotice("请先勾选要追加的数据资产");
          return;
        }
        const updated = await api.mutateDatasetAssets(datasetTargetId, datasetDialogAssetIds, "add");
        setDatasets((items) => items.map((item) => (item.id === updated.id ? updated : item)));
        closeDatasetDialog();
        setNotice(`已向「${updated.name}」追加资产，当前共 ${updated.asset_ids.length} 个`);
        setActiveView("datasets");
      } else if (datasetDialogMode === "edit" && editingDataset) {
        const updated = await api.updateDataset(editingDataset.id, {
          name: datasetName.trim(),
          description: datasetDescription.trim(),
          asset_ids: datasetDialogAssetIds,
        });
        setDatasets((items) => items.map((item) => (item.id === updated.id ? updated : item)));
        closeDatasetDialog();
        setNotice(`数据集「${updated.name}」已更新（${updated.asset_ids.length} 个资产）`);
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "数据集保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDataset(datasetId: string) {
    if (!window.confirm("确认删除该数据集？不会删除其中的数据资产。")) return;
    setBusy(true);
    try {
      await api.deleteDataset(datasetId);
      setDatasets((items) => items.filter((item) => item.id !== datasetId));
      if (expandedDatasetId === datasetId) setExpandedDatasetId(null);
      setNotice("数据集已删除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeAssetFromDataset(datasetId: string, assetId: string) {
    setBusy(true);
    try {
      const updated = await api.mutateDatasetAssets(datasetId, [assetId], "remove");
      setDatasets((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice("已从数据集移除该资产");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "移除失败");
    } finally {
      setBusy(false);
    }
  }

  function openCreateConnection() {
    const kind = kindOrder[0] || "mysql";
    setConnDialogMode("create");
    setEditingDatasource(null);
    setName("");
    setDbKind(kind);
    setDatabaseUrl(exampleUrlWithoutAuth(supported[kind] || ""));
    setConnUsername("");
    setConnPassword("");
    setTestPassed(false);
    setTestMessage("");
    setTestedTables([]);
    setConnDialogOpen(true);
  }

  function openEditConnection(datasource: Datasource) {
    setConnDialogMode("edit");
    setEditingDatasource(datasource);
    setName(datasource.name);
    setDbKind(datasource.type || "mysql");
    setDatabaseUrl(stripDbUrlAuth(datasource.database_url_masked));
    setConnUsername("");
    setConnPassword("");
    setTestPassed(false);
    setTestMessage("修改连接信息后需重新测试；若仅改名称可直接保存（将复用原凭据）。");
    setTestedTables(datasource.tables || []);
    setConnDialogOpen(true);
  }

  function closeConnectionDialog() {
    setConnDialogOpen(false);
    setEditingDatasource(null);
    setConnUsername("");
    setConnPassword("");
    setTestPassed(false);
    setTestMessage("");
    setTestedTables([]);
  }

  function onDbKindChange(kind: string) {
    setDbKind(kind);
    setDatabaseUrl(exampleUrlWithoutAuth(supported[kind] || ""));
    setConnUsername("");
    setConnPassword("");
    setTestPassed(false);
    setTestMessage("");
    setTestedTables([]);
  }

  function invalidateConnectionTest(clearTables = true) {
    setTestPassed(false);
    if (clearTables) setTestedTables([]);
    if (testMessage && !testMessage.includes("仅改名称")) setTestMessage("");
  }

  function onDatabaseUrlChange(value: string) {
    const parsed = parseDbUrl(value);
    if (connectionNeedsAuth(dbKind) && (parsed.username || parsed.password) && !parsed.username.includes("*")) {
      setConnUsername(parsed.username);
      setConnPassword(parsed.password);
      setDatabaseUrl(stripDbUrlAuth(value));
    } else {
      setDatabaseUrl(value);
    }
    invalidateConnectionTest();
  }

  function resolvedDatabaseUrl(): string {
    return composeDatabaseUrl(databaseUrl, connUsername, connPassword, dbKind);
  }

  async function testConnection() {
    if (!databaseUrl.trim()) {
      setTestMessage("请填写数据库连接地址后再测试");
      setTestPassed(false);
      return;
    }
    if (connectionNeedsAuth(dbKind) && !connUsername.trim()) {
      setTestMessage("请填写用户名后再测试连接");
      setTestPassed(false);
      return;
    }
    const url = resolvedDatabaseUrl();
    if (!url || url.includes("***")) {
      setTestMessage("请填写完整的连接信息（含用户名与密码）后再测试");
      setTestPassed(false);
      return;
    }
    setBusy(true);
    setTestMessage("正在测试连接...");
    setTestedTables([]);
    try {
      const result = await api.testDatasource(url);
      setTestPassed(true);
      setDbKind(result.kind || dbKind);
      setTestedTables(result.tables || []);
      setTestMessage(`连接成功：${kindLabels[result.kind] || result.kind}，发现 ${result.table_count} 张表`);
      setNotice("数据库连接测试通过，可以保存");
    } catch (error) {
      setTestPassed(false);
      setTestedTables([]);
      setTestMessage(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveConnection() {
    if (!name.trim()) {
      setTestMessage("请填写连接名称");
      return;
    }
    const isEdit = connDialogMode === "edit" && editingDatasource;
    // 编辑时：未填写新账号密码（或文件库未重新测试）则复用原凭据
    const reuseCredential = Boolean(
      isEdit
      && (
        connectionNeedsAuth(dbKind)
          ? !connUsername.trim()
          : !testPassed
      )
    );
    if (!reuseCredential && !testPassed) {
      setTestMessage("请先测试连接通过后再保存");
      return;
    }
    setBusy(true);
    setNotice(isEdit ? "正在更新连接配置" : "正在保存连接配置");
    try {
      if (isEdit && editingDatasource) {
        await api.updateDatasource(editingDatasource.id, {
          name: name.trim(),
          database_url: reuseCredential ? undefined : resolvedDatabaseUrl(),
        });
        setNotice("连接配置已更新");
      } else {
        await api.createDatasource({ name: name.trim(), database_url: resolvedDatabaseUrl() });
        setNotice("连接已加入连接池，可在新建资产时选择数据表");
      }
      await refresh();
      closeConnectionDialog();
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : "保存失败");
      setNotice(error instanceof Error ? error.message : "保存失败");
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

  async function deleteDatasource(datasourceId: string, event?: { stopPropagation: () => void }) {
    event?.stopPropagation();
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
      setNotice(`整体知识图已生成：${graph.graph.nodes.length} 个节点，${graph.inferred_joins.length} 条推断连接`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "整体知识图生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeSelectedAssets(
    mode: "new" | "existing" = "new",
    sessionId?: string,
    selectedQuestions: string[] = []
  ) {
    if (!combinedGraph?.asset_ids.length || busy) return;
    const questions = selectedQuestions.length
      ? selectedQuestions
      : combinedGraph.recommended_questions.slice(0, 1);
    if (!questions.length) {
      setNotice("请先勾选至少一个推荐分析问题");
      return;
    }
    setBusy(true);
    setNotice(mode === "existing" ? "正在带入指定对话" : "正在创建数据集并进入分析会话");
    try {
      const dataset = await api.createDataset({
        name: combinedGraph.title || `联合分析集（${combinedGraph.assets.length} 个资产）`,
        description: "由整体知识图选中资产自动创建",
        asset_ids: combinedGraph.asset_ids,
      });
      const session = mode === "existing" && sessionId
        ? { id: sessionId }
        : await api.createSession(`数据集分析 · ${dataset.name}`);
      const planKey = saveAnalysisPlan(questions);
      const search = new URLSearchParams({
        session_id: session.id,
        dataset_ids: dataset.id,
        plan_key: planKey,
        use_new_strategy: "1",
        prompt: questions[0] || "",
      });
      window.location.href = `/?${search.toString()}`;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "带入分析会话失败");
      setBusy(false);
    }
  }

  function analyzeWithDataset(dataset: Dataset) {
    if (!dataset.asset_ids.length) {
      setNotice("该数据集没有成员资产，请先添加数据资产");
      return;
    }
    const search = new URLSearchParams({
      dataset_ids: dataset.id,
      prompt: `请基于数据集「${dataset.name}」开展分析`,
    });
    window.location.href = `/?${search.toString()}`;
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
    setCreatorSelectedTags([DEFAULT_ASSET_TAG]);
    setAssetCreatorOpen(true);
    await loadDatasourceTables(creatorDatasourceId || datasources[0].id);
  }

  function toggleTable(tableName: string) {
    setSelectedTables((items) =>
      items.includes(tableName) ? items.filter((name) => name !== tableName) : [...items, tableName]
    );
  }

  async function createManagedTag() {
    const name = newTagName.trim();
    if (!name) {
      setNotice("请填写标签名称");
      return;
    }
    setBusy(true);
    try {
      const parentId = !newTagParentId || newTagParentId === "__root__" ? null : newTagParentId;
      const created = await api.createTag({
        name,
        description: newTagDescription.trim(),
        parent_id: parentId,
      });
      setNewTagName("");
      setNewTagDescription("");
      setNewTagParentId(parentId ? created.id : "__root__");
      await refresh();
      setNotice(parentId ? `已创建子标签「${tagLabel(created)}」` : `已创建一级标签「${created.name}」`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建标签失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeManagedTag(tag: AssetTag) {
    if (tag.is_system || tag.name === DEFAULT_ASSET_TAG || tagPath(tag) === DEFAULT_ASSET_TAG) {
      setNotice("系统默认标签 public 不可删除");
      return;
    }
    setBusy(true);
    try {
      await api.deleteTag(tag.id);
      if (newTagParentId === tag.id) setNewTagParentId("__root__");
      await refresh();
      setNotice(`标签「${tagLabel(tag)}」已删除`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除标签失败");
    } finally {
      setBusy(false);
    }
  }

  function canMoveUnder(tag: AssetTag, candidateParent: AssetTag): boolean {
    const childPath = tagPath(tag);
    const parentPath = tagPath(candidateParent);
    if (candidateParent.id === tag.id) return false;
    if (parentPath === childPath || parentPath.startsWith(`${childPath}/`)) return false;
    return true;
  }

  async function changeTagLevel(tag: AssetTag, parentValue: string) {
    if (tagPath(tag) === DEFAULT_ASSET_TAG) {
      setNotice("系统默认标签 public 不可调整级别");
      return;
    }
    setBusy(true);
    try {
      await api.updateTag(tag.id, {
        move_parent: true,
        parent_id: parentValue === "__root__" ? null : parentValue,
      });
      await refresh();
      setNotice(
        parentValue === "__root__"
          ? `「${tag.name}」已调整为一级标签`
          : `「${tag.name}」级别已更新`
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "调整标签级别失败");
    } finally {
      setBusy(false);
    }
  }

  async function createAssetsFromTables() {
    if (!creatorDatasourceId || !selectedTables.length) return;
    setBusy(true);
    setNotice(`正在从 ${selectedTables.length} 张数据表创建数据资产`);
    try {
      const tags = toLeafTagValues(creatorSelectedTags);
      const result = await api.createDatasourceAssets(
        creatorDatasourceId,
        selectedTables,
        sampleLimit,
        tags
      );
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

  function openTagEditor(asset: Asset) {
    const selected = assetTags(asset).map((value) => {
      const byPath = managedTags.find((tag) => tagPath(tag) === value);
      if (byPath) return tagPath(byPath);
      const byName = managedTags.find((tag) => tag.name === value);
      return byName ? tagPath(byName) : value;
    });
    setTagEditorMode("single");
    setTagEditorAssetId(asset.id);
    setTagEditorSelected(selected.length ? selected : [DEFAULT_ASSET_TAG]);
  }

  function openBatchTagEditor() {
    if (!selectedAssetIds.length) {
      setNotice("请先勾选要打标的数据资产");
      return;
    }
    setTagEditorMode("batch");
    setTagEditorAssetId("__batch__");
    setBatchTagMode("add");
    setTagEditorSelected([]);
  }

  function closeTagEditor() {
    setTagEditorAssetId(null);
    setTagEditorMode("single");
  }

  async function saveAssetTags() {
    const tags = toLeafTagValues(tagEditorSelected);
    setBusy(true);
    try {
      if (tagEditorMode === "batch") {
        const result = await api.batchUpdateAssetTags(selectedAssetIds, tags, batchTagMode);
        setAssets((items) => {
          const map = new Map(result.updated.map((asset) => [asset.id, asset]));
          return items.map((item) => {
            const next = map.get(item.id);
            return next ? { ...item, tags: next.tags || [DEFAULT_ASSET_TAG] } : item;
          });
        });
        closeTagEditor();
        setNotice(
          batchTagMode === "replace"
            ? `已为 ${result.updated_count} 个资产替换标签`
            : `已为 ${result.updated_count} 个资产追加标签`
        );
      } else if (tagEditorAssetId) {
        const updated = await api.updateAssetTags(tagEditorAssetId, tags);
        setAssets((items) => items.map((item) => (item.id === tagEditorAssetId ? { ...item, tags: updated.tags || [DEFAULT_ASSET_TAG] } : item)));
        closeTagEditor();
        setNotice(`标签已更新为 ${(updated.tags || [DEFAULT_ASSET_TAG]).join(", ")}`);
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "标签更新失败");
    } finally {
      setBusy(false);
    }
  }

  const visibleAssetIds = useMemo(
    () => visibleAssetGroups.flatMap((group) => group.items.map((asset) => asset.id)),
    [visibleAssetGroups]
  );
  const uniqueVisibleAssetIds = useMemo(() => Array.from(new Set(visibleAssetIds)), [visibleAssetIds]);

  function assetCountForTag(tag: AssetTag | string): number {
    const path = typeof tag === "string" ? tag : tagPath(tag);
    return filteredAssets.filter((asset) => {
      if (activeKindFilter !== "all" && connectionKindOf(asset) !== activeKindFilter) return false;
      return leafTagsOfAsset(asset).some((leaf) => isTagUnderOrEqual(leaf, path));
    }).length;
  }

  function assetCountForKind(kind: string): number {
    return filteredAssets.filter((asset) => {
      if (activeTagFilter !== "all") {
        const leaves = leafTagsOfAsset(asset);
        if (!leaves.some((leaf) => isTagUnderOrEqual(leaf, activeTagFilter))) return false;
      }
      return connectionKindOf(asset) === kind;
    }).length;
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
            <div><strong>数据管理</strong><small>资产、连接与标签</small></div>
          </div>
          <nav>
            <button className={activeView === "assets" ? "active" : ""} onClick={() => setActiveView("assets")}>
              <Database size={17} /><span>数据资产</span><small>{assets.length}</small>
            </button>
            <button className={activeView === "datasets" ? "active" : ""} onClick={() => setActiveView("datasets")}>
              <FolderKanban size={17} /><span>数据集管理</span><small>{datasets.length}</small>
            </button>
            <button className={activeView === "connections" ? "active" : ""} onClick={() => setActiveView("connections")}>
              <Server size={17} /><span>连接池</span><small>{datasources.length}</small>
            </button>
            <button className={activeView === "tags" ? "active" : ""} onClick={() => setActiveView("tags")}>
              <Tags size={17} /><span>标签管理</span><small>{managedTags.length}</small>
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
                  <p>可按标签或连接类型筛选；筛选后全选资产，可构建数据集或加入已有数据集。</p>
                </div>
                <button className="confirmButton" onClick={() => void openAssetCreator()}>
                  <Plus size={16} /> 新建数据资产
                </button>
              </section>

              <section className="detailPanel">
                <div className="sectionHeader assetSelectionHeader">
                  <div>
                    <h2>数据资产表</h2>
                    <p>
                      已选择 {selectedAssetIds.length} 个资产。
                      可先筛标签再「全选」，然后「构建数据集」或「加入数据集」。
                    </p>
                  </div>
                  <div className="buttonRow">
                    <button
                      onClick={() =>
                        setSelectedAssetIds(
                          selectedAssetIds.length === uniqueVisibleAssetIds.length && uniqueVisibleAssetIds.length
                            ? []
                            : uniqueVisibleAssetIds
                        )
                      }
                    >
                      <CheckSquare size={15} />{" "}
                      {selectedAssetIds.length === uniqueVisibleAssetIds.length && uniqueVisibleAssetIds.length ? "清空" : "全选"}
                    </button>
                    <button
                      disabled={busy || !selectedAssetIds.length}
                      title={!selectedAssetIds.length ? "请先勾选数据资产" : "为所选资产批量打标"}
                      onClick={openBatchTagEditor}
                    >
                      <Tags size={15} /> 批量打标{selectedAssetIds.length ? ` (${selectedAssetIds.length})` : ""}
                    </button>
                    <button
                      disabled={busy}
                      title="按标签勾选数据资产并构建数据集"
                      onClick={() => openCreateDatasetDialog()}
                    >
                      <FolderKanban size={15} /> 构建数据集{selectedAssetIds.length ? ` (${selectedAssetIds.length})` : ""}
                    </button>
                    <button
                      disabled={busy || !datasets.length}
                      title={!datasets.length ? "暂无数据集，请先构建" : "按标签勾选资产并加入已有数据集"}
                      onClick={() => openAddToDatasetDialog()}
                    >
                      <Plus size={15} /> 加入数据集
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

                <label className="assetSearchBar">
                  <Search size={16} />
                  <input
                    value={assetSearch}
                    placeholder="搜索资产名称、数据表、标签、连接类型…"
                    onChange={(event) => setAssetSearch(event.target.value)}
                  />
                  {assetSearch ? (
                    <button type="button" className="iconOnly" onClick={() => setAssetSearch("")} title="清空搜索">
                      <X size={15} />
                    </button>
                  ) : null}
                </label>

                <div className="assetGroupModeRow">
                  <span>分组方式</span>
                  <div className="assetGroupModeTabs">
                    <button type="button" className={assetGroupMode === "tag" ? "active" : ""} onClick={() => setAssetGroupMode("tag")}>
                      按标签
                    </button>
                    <button type="button" className={assetGroupMode === "kind" ? "active" : ""} onClick={() => setAssetGroupMode("kind")}>
                      按连接类型
                    </button>
                  </div>
                </div>

                <div className="filterSection">
                  <small className="filterSectionLabel">连接类型</small>
                  <div className="tagFilterBar kindFilterBar">
                    <button className={activeKindFilter === "all" ? "active" : ""} onClick={() => setActiveKindFilter("all")}>
                      全部 <small>{filteredAssets.filter((asset) => {
                        if (activeTagFilter === "all") return true;
                        return leafTagsOfAsset(asset).some((leaf) => isTagUnderOrEqual(leaf, activeTagFilter));
                      }).length}</small>
                    </button>
                    {connectionKindStats.map((item) => (
                      <button
                        key={item.kind}
                        className={activeKindFilter === item.kind ? "active" : ""}
                        onClick={() => setActiveKindFilter(item.kind)}
                        title={item.kind}
                      >
                        {item.label} <small>{assetCountForKind(item.kind)}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="filterSection">
                  <small className="filterSectionLabel">业务标签</small>
                  <div className="tagFilterBar">
                    <button className={activeTagFilter === "all" ? "active" : ""} onClick={() => setActiveTagFilter("all")}>
                      全部 <small>{filteredAssets.filter((asset) => activeKindFilter === "all" || connectionKindOf(asset) === activeKindFilter).length}</small>
                    </button>
                    {orderedManagedTags.map((tag) => {
                      const path = tagPath(tag);
                      return (
                        <button
                          key={tag.id}
                          className={activeTagFilter === path ? "active" : ""}
                          style={{ marginLeft: Math.min(tag.depth || 0, 4) * 8 }}
                          onClick={() => setActiveTagFilter(path)}
                          title={tagLabel(tag)}
                        >
                          {displayTagChip(path)} <small>{assetCountForTag(tag)}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {visibleAssetGroups.length ? visibleAssetGroups.map((group) => (
                  <div key={group.key} className="connectionTypeGroup">
                    <div className="connectionTypeHeader">
                      <strong>{assetGroupMode === "kind" ? group.title : `#${group.title}`}</strong>
                      <small>{group.items.length} 个资产</small>
                    </div>
                    <div className="assetTable">
                      {group.items.map((asset) => {
                        const kind = connectionKindOf(asset);
                        const ds = asset.datasource_id ? datasourceById.get(asset.datasource_id) : null;
                        return (
                          <div key={`${group.key}-${asset.id}`} className="assetTableRow">
                            <label className="assetSelectCell">
                              <input type="checkbox" checked={selectedAssetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)} />
                              <div>
                                <a href={`/assets/${asset.id}`}><strong>{asset.name}</strong></a>
                                <span>{asset.source_table || asset.data_dictionary?.table_name || asset.type} · {asset.data_dictionary?.row_count ?? 0} 行 · {asset.data_dictionary?.columns.length ?? 0} 字段</span>
                                <div className="assetTagList">
                                  <span className="assetTagChip kindChip" title={ds?.name || kind}>{connectionKindLabel(kind)}</span>
                                  {leafTagsOfAsset(asset).map((tag) => (
                                    <span key={tag} className="assetTagChip" title={tag}>{displayTagPath(tag)}</span>
                                  ))}
                                </div>
                              </div>
                            </label>
                            <small>{asset.parse_status}</small>
                            <div className="connectionRowActions">
                              <button type="button" onClick={() => openTagEditor(asset)}><Pencil size={15} /> 标签</button>
                              <button type="button" onClick={() => void deleteAsset(asset.id)}><Trash2 size={15} /> 删除</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )) : (
                  <div className="emptyState">
                    {assetSearch.trim() || activeKindFilter !== "all" || activeTagFilter !== "all"
                      ? "没有匹配的数据资产，请调整搜索或筛选条件。"
                      : "暂无数据资产，请点击“新建数据资产”从连接池选择数据表。"}
                  </div>
                )}
              </section>

            </>
          ) : activeView === "datasets" ? (
            <>
              <section className="detailHero compactHero">
                <div>
                  <FolderKanban size={28} />
                  <h1>数据集管理</h1>
                  <p>管理由多张数据资产组成的分析数据集；点击数据集可查看整体知识图。</p>
                </div>
                <button className="confirmButton" onClick={() => openCreateDatasetDialog([])}>
                  <Plus size={16} /> 新建数据集
                </button>
              </section>

              <section className="detailPanel">
                <div className="sectionHeader">
                  <div>
                    <h2>数据集列表</h2>
                    <p>共 {datasets.length} 个数据集。删除数据集不会删除其中的数据资产。</p>
                  </div>
                </div>
                {datasets.length ? (
                  <div className="datasetList">
                    {datasets.map((dataset) => {
                      const members = dataset.asset_ids
                        .map((id) => assetsById.get(id))
                        .filter((item): item is Asset => !!item);
                      const missing = dataset.asset_ids.length - members.length;
                      const expanded = expandedDatasetId === dataset.id;
                      return (
                        <article key={dataset.id} className={`datasetCard ${expanded ? "expanded" : ""}`}>
                          <div className="datasetCardHeader">
                            <a className="datasetCardMain" href={`/datasets/${dataset.id}`} title="查看整体知识图">
                              <strong>{dataset.name}</strong>
                              <p>{dataset.description || "暂无描述"}</p>
                              <div className="assetTagList">
                                <span className="assetTagChip kindChip">{dataset.asset_ids.length} 个资产</span>
                                {(dataset.tags || []).map((tag) => (
                                  <span key={tag} className="assetTagChip" title={tag}>{displayTagPath(tag)}</span>
                                ))}
                              </div>
                            </a>
                            <div className="connectionRowActions">
                              <button type="button" className="confirmButton" onClick={() => analyzeWithDataset(dataset)}>
                                <BarChart3 size={15} /> 去分析
                              </button>
                              <button type="button" onClick={() => setExpandedDatasetId(expanded ? null : dataset.id)}>
                                {expanded ? "收起" : "查看成员"}
                              </button>
                              <button type="button" onClick={() => openEditDataset(dataset)}>
                                <Pencil size={15} /> 编辑
                              </button>
                              <button type="button" onClick={() => void deleteDataset(dataset.id)}>
                                <Trash2 size={15} /> 删除
                              </button>
                            </div>
                          </div>
                          {expanded ? (
                            <div className="datasetMembers">
                              {members.length ? members.map((asset) => (
                                <div key={asset.id} className="datasetMemberRow">
                                  <div>
                                    <a href={`/assets/${asset.id}`}><strong>{asset.name}</strong></a>
                                    <span>
                                      {asset.source_table || asset.data_dictionary?.table_name || asset.type}
                                      {" · "}
                                      {leafTagsOfAsset(asset).map(displayTagPath).join("、") || "-"}
                                    </span>
                                  </div>
                                  <button type="button" onClick={() => void removeAssetFromDataset(dataset.id, asset.id)}>
                                    移除
                                  </button>
                                </div>
                              )) : <div className="emptyState">数据集暂无有效成员</div>}
                              {missing > 0 ? <small className="fieldHint">另有 {missing} 个资产已删除或不存在</small> : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="emptyState">
                    暂无数据集。请到「数据资产」按标签筛选并全选，再点击「构建数据集」。
                  </div>
                )}
              </section>
            </>
          ) : activeView === "connections" ? (
            <>
              <section className="detailHero compactHero">
                <div>
                  <Server size={28} />
                  <h1>连接池</h1>
                  <p>按数据库类型管理全部数据资产连接。先测试通过后再保存；点击连接可进入配置界面更新。</p>
                </div>
                <button className="confirmButton" onClick={openCreateConnection}>
                  <Plus size={16} /> 新建连接
                </button>
              </section>

              <section className="detailPanel">
                <div className="sectionHeader">
                  <div>
                    <h2>连接配置</h2>
                    <p>共 {datasources.length} 个连接，按类型分组展示。</p>
                  </div>
                </div>
                {datasourcesByKind.length ? datasourcesByKind.map((group) => (
                  <div key={group.kind} className="connectionTypeGroup">
                    <div className="connectionTypeHeader">
                      <strong>{group.label}</strong>
                      <small>{group.items.length} 个连接</small>
                    </div>
                    <div className="assetTable">
                      {group.items.map((datasource) => (
                        <div
                          key={datasource.id}
                          className="assetTableRow connectionRow"
                          role="button"
                          tabIndex={0}
                          onClick={() => openEditConnection(datasource)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openEditConnection(datasource);
                            }
                          }}
                        >
                          <div>
                            <strong>{datasource.name}</strong>
                            <span>{datasource.database_url_masked}</span>
                            <em>{datasource.tables?.length ?? 0} 张表 · {datasource.status}</em>
                            {datasource.error ? <em className="errorText">{datasource.error}</em> : null}
                          </div>
                          <small>{kindLabels[datasource.type] || datasource.type}</small>
                          <div className="connectionRowActions" onClick={(event) => event.stopPropagation()}>
                            <button type="button" onClick={() => openEditConnection(datasource)}>
                              <Pencil size={15} /> 配置
                            </button>
                            <button type="button" onClick={(event) => void deleteDatasource(datasource.id, event)}>
                              <Trash2 size={15} /> 删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )) : <div className="emptyState">暂无连接配置，请点击右上角“新建连接”。</div>}
              </section>
            </>
          ) : (
            <>
              <section className="detailHero compactHero">
                <div>
                  <Tags size={28} />
                  <h1>标签管理</h1>
                  <p>多级标签树，支持调整级别；根节点 public 固定不可移动。</p>
                </div>
              </section>

              <section className="detailPanel">
                <div className="sectionHeader">
                  <div>
                    <h2>标签树</h2>
                    <p>共 {orderedManagedTags.length} 个标签。可通过「级别」下拉调整挂载位置。</p>
                  </div>
                </div>
                <div className="tagTree">
                  {publicTag ? null : (
                    <div className="tagTreeRow rootTagRow">
                      <div>
                        <strong>#public</strong>
                        <span>系统默认根标签（初始化中…）</span>
                      </div>
                    </div>
                  )}
                  {orderedManagedTags.map((tag) => {
                    const path = tagPath(tag);
                    const isPublic = path === DEFAULT_ASSET_TAG;
                    const isTopLevel = (tag.depth || 0) === 0;
                    return (
                      <div
                        key={tag.id}
                        className={`tagTreeRow ${isPublic ? "rootTagRow" : ""} ${isTopLevel && !isPublic ? "topLevelTagRow" : ""} ${newTagParentId === tag.id ? "selectedParent" : ""}`}
                        style={{ paddingLeft: 16 + Math.min(tag.depth || 0, 6) * 18 }}
                      >
                        <div>
                          <strong>#{tag.name}</strong>
                          <span>{tagLabel(tag)}</span>
                          <em>
                            {tag.description
                              || (isPublic ? "系统默认根标签" : isTopLevel ? "一级标签" : "子标签")}
                            {" · "}
                            {assetCountForTag(tag)} 个关联资产
                          </em>
                        </div>
                        <label className="tagLevelSelect">
                          <span>级别</span>
                          <select
                            value={tag.parent_id || "__root__"}
                            disabled={isPublic || busy}
                            onChange={(event) => void changeTagLevel(tag, event.target.value)}
                          >
                            <option value="__root__">一级标签（与 public 同级）</option>
                            {orderedManagedTags
                              .filter((candidate) => canMoveUnder(tag, candidate))
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {"— ".repeat(candidate.depth || 0)}{candidate.name} ({tagPath(candidate)})
                                </option>
                              ))}
                          </select>
                        </label>
                        <div className="connectionRowActions">
                          <button
                            type="button"
                            onClick={() => setNewTagParentId(tag.id)}
                            title="在此标签下新增子标签"
                          >
                            <Plus size={15} /> 子标签
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTagFilter(path);
                              setActiveView("assets");
                            }}
                          >
                            查看资产
                          </button>
                          <button
                            type="button"
                            disabled={!!tag.is_system || isPublic || busy}
                            onClick={() => void removeManagedTag(tag)}
                          >
                            <Trash2 size={15} /> 删除
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!orderedManagedTags.length ? <div className="emptyState">暂无标签。</div> : null}
                </div>
              </section>

              <section className="detailPanel">
                <div className="sectionHeader">
                  <div>
                    <h2>新建标签</h2>
                    <p>
                      当前位置：
                      {!newTagParentId || newTagParentId === "__root__"
                        ? "一级标签（与 public 同级）"
                        : tagLabel(orderedManagedTags.find((tag) => tag.id === newTagParentId) as AssetTag)}
                    </p>
                  </div>
                  <button type="button" onClick={() => setNewTagParentId("__root__")}>
                    新建一级标签
                  </button>
                </div>
                <div className="tagCreateForm multilevel">
                  <label>
                    父级标签
                    <select value={newTagParentId || "__root__"} onChange={(event) => setNewTagParentId(event.target.value)}>
                      <option value="__root__">一级标签（与 public 同级）</option>
                      {orderedManagedTags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {"— ".repeat(tag.depth || 0)}{tag.name} ({tagPath(tag)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    标签名称
                    <input value={newTagName} placeholder="例如：finance" onChange={(event) => setNewTagName(event.target.value)} />
                  </label>
                  <label>
                    说明（可选）
                    <input value={newTagDescription} placeholder="用途说明" onChange={(event) => setNewTagDescription(event.target.value)} />
                  </label>
                  <button className="confirmButton" disabled={busy || !newTagName.trim()} onClick={() => void createManagedTag()}>
                    <Plus size={16} /> 新增标签
                  </button>
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
                <RecommendedQuestionsPanel
                  assetIds={combinedGraph.asset_ids}
                  initialQuestions={combinedGraph.recommended_questions}
                  busy={busy}
                  onNotice={setNotice}
                  onLaunch={(mode, sessionId, questions) => void analyzeSelectedAssets(mode, sessionId, questions)}
                />
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
              <span>
                可带入已有对话或新建对话，覆盖 {combinedGraph.assets.length} 个资产，并按所选问题依次分析。
              </span>
              <div className="buttonRow">
                <button onClick={() => setCombinedGraph(null)}>关闭</button>
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
            <div className="assetCreatorField">
              <span>选择标签</span>
              <TagMultiSelect
                tags={orderedManagedTags}
                value={creatorSelectedTags}
                onChange={setCreatorSelectedTags}
                defaultTag={DEFAULT_ASSET_TAG}
                placeholder="点击选择标签"
              />
              <small className="fieldHint">树形多选；选择非 public 一级目录后将自动去掉 public，并按末级标签归类展示。</small>
            </div>
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

      {tagEditorAssetId ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeTagEditor();
          }}
        >
          <section className="assetCreatorModal connectionDialogModal" role="dialog" aria-modal="true" aria-labelledby="tag-editor-title">
            <div className="sectionHeader">
              <div>
                <h2 id="tag-editor-title">{tagEditorMode === "batch" ? "批量打标" : "选择标签"}</h2>
                <p>
                  {tagEditorMode === "batch"
                    ? `已选 ${selectedAssetIds.length} 个资产，勾选标签后可追加或覆盖。`
                    : "树形勾选；选择非 public 一级目录后自动去掉 public。"}
                </p>
              </div>
              <button className="iconOnly" onClick={closeTagEditor}><X size={17} /></button>
            </div>
            {tagEditorMode === "batch" ? (
              <div className="batchTagModeRow">
                <label className={batchTagMode === "add" ? "selected" : ""}>
                  <input type="radio" name="batch-tag-mode" checked={batchTagMode === "add"} onChange={() => setBatchTagMode("add")} />
                  <span>追加标签</span>
                  <small>保留原标签并合并所选</small>
                </label>
                <label className={batchTagMode === "replace" ? "selected" : ""}>
                  <input type="radio" name="batch-tag-mode" checked={batchTagMode === "replace"} onChange={() => setBatchTagMode("replace")} />
                  <span>覆盖标签</span>
                  <small>用所选标签替换原标签</small>
                </label>
              </div>
            ) : null}
            <TagMultiSelect
              tags={orderedManagedTags}
              value={tagEditorSelected}
              onChange={setTagEditorSelected}
              defaultTag={DEFAULT_ASSET_TAG}
              allowEmpty={tagEditorMode === "batch"}
              placeholder="点击选择标签"
            />
            {!orderedManagedTags.length ? <div className="emptyState">暂无可用标签，请先到「标签管理」新增。</div> : null}
            <div className="modalActions">
              <button type="button" onClick={() => { closeTagEditor(); setActiveView("tags"); }}>去标签管理</button>
              <button type="button" onClick={closeTagEditor}>取消</button>
              <button type="button" className="confirmButton" disabled={busy || !tagEditorSelected.length} onClick={() => void saveAssetTags()}>
                {tagEditorMode === "batch"
                  ? (busy ? "处理中..." : `应用到 ${selectedAssetIds.length} 个资产`)
                  : "保存标签"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {datasetDialogOpen ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDatasetDialog();
          }}
        >
          <section className="assetCreatorModal connectionDialogModal datasetDialogModal" role="dialog" aria-modal="true" aria-labelledby="dataset-dialog-title">
            <div className="sectionHeader">
              <div>
                <h2 id="dataset-dialog-title">
                  {datasetDialogMode === "create" ? "构建数据集" : datasetDialogMode === "add" ? "加入已有数据集" : "编辑数据集"}
                </h2>
                <p>
                  {datasetDialogMode === "edit"
                    ? "修改名称与描述；默认仅展示本数据集成员，点击「新增数据资产」可按标签添加。"
                    : "先选择标签，再在下方用复选框勾选要纳入的数据资产。"}
                </p>
              </div>
              <button className="iconOnly" onClick={closeDatasetDialog}><X size={17} /></button>
            </div>

            {datasetDialogMode === "add" ? (
              <label className="assetCreatorField">
                选择数据集
                <select value={datasetTargetId} onChange={(event) => setDatasetTargetId(event.target.value)}>
                  {datasets.map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name}（{dataset.asset_ids.length} 个资产）
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="assetCreatorField">
                  数据集名称
                  <input value={datasetName} placeholder="例如：零售交易分析集" onChange={(event) => setDatasetName(event.target.value)} />
                </label>
                <label className="assetCreatorField">
                  描述
                  <textarea
                    value={datasetDescription}
                    placeholder="可选，说明该数据集的分析用途"
                    rows={2}
                    onChange={(event) => setDatasetDescription(event.target.value)}
                  />
                </label>
              </>
            )}

            {datasetDialogMode === "edit" ? (
              <div className="datasetAssetPicker">
                <div className="tablePickerHeader">
                  <div>
                    <strong>数据集成员</strong>
                    <small className="fieldHint">共 {datasetDialogAssetIds.length} 个资产</small>
                  </div>
                  <button
                    type="button"
                    className={datasetAddingAssets ? undefined : "confirmButton"}
                    onClick={() => {
                      setDatasetAddingAssets((open) => !open);
                      if (!datasetAddingAssets) setDatasetPickerTag("all");
                    }}
                  >
                    <Plus size={14} /> {datasetAddingAssets ? "收起新增" : "新增数据资产"}
                  </button>
                </div>
                {datasetMemberAssets.length ? (
                  <div className="datasetDialogMemberList">
                    {datasetMemberAssets.map((asset) => {
                      const kind = connectionKindOf(asset);
                      return (
                        <div key={asset.id} className="datasetDialogMemberRow">
                          <div>
                            <strong>{asset.name}</strong>
                            <span>
                              {connectionKindLabel(kind)}
                              {" · "}
                              {leafTagsOfAsset(asset).map(displayTagPath).join("、") || "-"}
                            </span>
                          </div>
                          <button type="button" onClick={() => removeDatasetDialogAsset(asset.id)}>移除</button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="emptyState">暂无成员资产，请点击「新增数据资产」</div>
                )}
                {datasetDialogAssetIds.length > datasetMemberAssets.length ? (
                  <small className="fieldHint">
                    另有 {datasetDialogAssetIds.length - datasetMemberAssets.length} 个资产已删除或不存在
                  </small>
                ) : null}

                {datasetAddingAssets ? (
                  <div className="datasetAddAssetsPanel">
                    <label className="assetCreatorField">
                      按标签筛选可添加资产
                      <select value={datasetPickerTag} onChange={(event) => setDatasetPickerTag(event.target.value)}>
                        <option value="all">全部标签</option>
                        {orderedManagedTags.map((tag) => {
                          const path = tagPath(tag);
                          return (
                            <option key={tag.id} value={path}>
                              {"　".repeat(Math.max(0, path.split("/").length - 1))}
                              {displayTagPath(path)}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <div className="tablePickerHeader">
                      <small className="fieldHint">可选 {datasetPickerAssets.length} 个（不含已有成员）</small>
                      <button type="button" onClick={selectAllDatasetPickerVisible} disabled={!datasetPickerAssets.length}>
                        <CheckSquare size={14} /> 全部加入当前标签
                      </button>
                    </div>
                    {datasetPickerAssets.length ? (
                      <div className="datasetDialogMemberList">
                        {datasetPickerAssets.map((asset) => {
                          const kind = connectionKindOf(asset);
                          return (
                            <div key={asset.id} className="datasetDialogMemberRow">
                              <div>
                                <strong>{asset.name}</strong>
                                <span>
                                  {connectionKindLabel(kind)}
                                  {" · "}
                                  {leafTagsOfAsset(asset).map(displayTagPath).join("、") || "-"}
                                </span>
                              </div>
                              <button type="button" onClick={() => addDatasetDialogAssets([asset.id])}>加入</button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="emptyState">该标签下没有可新增的数据资产</div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <label className="assetCreatorField">
                  按标签筛选资产
                  <select value={datasetPickerTag} onChange={(event) => setDatasetPickerTag(event.target.value)}>
                    <option value="all">全部标签</option>
                    {orderedManagedTags.map((tag) => {
                      const path = tagPath(tag);
                      return (
                        <option key={tag.id} value={path}>
                          {"　".repeat(Math.max(0, path.split("/").length - 1))}
                          {displayTagPath(path)}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <div className="datasetAssetPicker">
                  <div className="tablePickerHeader">
                    <div>
                      <strong>数据资产</strong>
                      <small className="fieldHint">
                        当前标签下 {datasetPickerAssets.length} 个，已勾选可见 {datasetPickerVisibleSelectedCount} 个；合计已选 {datasetDialogAssetIds.length} 个（跨标签保留）。
                      </small>
                    </div>
                    <div className="buttonRow">
                      <button type="button" onClick={selectAllDatasetPickerVisible} disabled={!datasetPickerAssets.length}>
                        <CheckSquare size={14} /> 全选当前标签
                      </button>
                      <button type="button" onClick={clearDatasetPickerVisible} disabled={!datasetPickerVisibleSelectedCount}>
                        清空当前标签
                      </button>
                    </div>
                  </div>
                  {datasetPickerAssets.length ? (
                    <div className="tablePicker datasetAssetPickerList">
                      {datasetPickerAssets.map((asset) => {
                        const checked = datasetDialogAssetIds.includes(asset.id);
                        const kind = connectionKindOf(asset);
                        return (
                          <label key={asset.id} className={checked ? "selected" : undefined}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleDatasetDialogAsset(asset.id)}
                            />
                            <Database size={15} />
                            <span title={`${asset.name} · ${asset.source_table || asset.data_dictionary?.table_name || ""}`}>
                              {asset.name}
                              <small>
                                {connectionKindLabel(kind)}
                                {" · "}
                                {leafTagsOfAsset(asset).map(displayTagPath).join("、") || "-"}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="emptyState">该标签下暂无数据资产</div>
                  )}
                </div>
              </>
            )}

            <div className="modalActions">
              <button type="button" onClick={closeDatasetDialog}>取消</button>
              <button
                type="button"
                className="confirmButton"
                disabled={
                  busy
                  || (datasetDialogMode === "add"
                    ? !datasetTargetId || !datasetDialogAssetIds.length
                    : !datasetName.trim())
                }
                onClick={() => void saveDatasetDialog()}
              >
                {busy
                  ? "处理中..."
                  : datasetDialogMode === "create"
                    ? `创建并加入 ${datasetDialogAssetIds.length} 个资产`
                    : datasetDialogMode === "add"
                      ? `追加 ${datasetDialogAssetIds.length} 个资产`
                      : `保存（${datasetDialogAssetIds.length} 个资产）`}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {connDialogOpen ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConnectionDialog();
          }}
        >
          <section className="assetCreatorModal connectionDialogModal" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title">
            <div className="sectionHeader">
              <div>
                <h2 id="connection-dialog-title">{connDialogMode === "edit" ? "配置连接" : "新建连接"}</h2>
                <p>选择连接方式并填写连接信息，测试通过后可保存到连接池。</p>
              </div>
              <button className="iconOnly" onClick={closeConnectionDialog}><X size={17} /></button>
            </div>

            <div className="connectionDialogForm">
              <label className="assetCreatorField">
                连接名称
                <input value={name} placeholder="例如：零售经营库" onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="assetCreatorField">
                连接方式
                <select value={dbKind} onChange={(event) => onDbKindChange(event.target.value)}>
                  {(kindOrder.length ? kindOrder : Object.keys(supported)).map((kind) => (
                    <option key={kind} value={kind}>{kindLabels[kind] || kind}</option>
                  ))}
                </select>
              </label>
              <label className="assetCreatorField">
                数据库连接地址
                <input
                  value={databaseUrl}
                  placeholder={exampleUrlWithoutAuth(supported[dbKind] || "") || "请输入数据库连接地址"}
                  onChange={(event) => onDatabaseUrlChange(event.target.value)}
                />
              </label>
              {connectionNeedsAuth(dbKind) ? (
                <div className="connectionCredentialRow">
                  <label className="assetCreatorField">
                    用户名
                    <input
                      value={connUsername}
                      autoComplete="off"
                      placeholder={connDialogMode === "edit" ? "留空则复用已保存凭据" : "例如：root"}
                      onChange={(event) => {
                        setConnUsername(event.target.value);
                        invalidateConnectionTest();
                      }}
                    />
                  </label>
                  <label className="assetCreatorField">
                    密码
                    <input
                      type="password"
                      value={connPassword}
                      autoComplete="new-password"
                      placeholder={connDialogMode === "edit" ? "留空则复用已保存凭据" : "请输入密码"}
                      onChange={(event) => {
                        setConnPassword(event.target.value);
                        invalidateConnectionTest();
                      }}
                    />
                  </label>
                </div>
              ) : (
                <p className="connectionHint">文件型数据库无需填写用户名和密码。</p>
              )}
              <p className="connectionHint">
                示例：{exampleUrlWithoutAuth(supported[dbKind] || "") || "选择连接方式后显示示例"}
                {connectionNeedsAuth(dbKind) ? "（用户名与密码请在上方单独填写）" : ""}
              </p>
              {testMessage ? (
                <div className={`connectionTestResult ${testPassed ? "success" : ""}`}>{testMessage}</div>
              ) : null}
              {testedTables.length ? (
                <div className="connectionTablesPanel">
                  <div className="tablePickerHeader">
                    <strong>数据表（{testedTables.length}）</strong>
                    <small className="fieldHint">{testPassed ? "测试通过后读取" : "来自已保存连接缓存"}</small>
                  </div>
                  <div className="connectionTableList">
                    {testedTables.map((table) => (
                      <span key={table} className="connectionTableChip" title={table}>{table}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="modalActions">
              <button type="button" onClick={closeConnectionDialog}>取消</button>
              <button
                type="button"
                disabled={
                  busy
                  || !databaseUrl.trim()
                  || (connectionNeedsAuth(dbKind) && !connUsername.trim())
                }
                onClick={() => void testConnection()}
              >
                {busy ? "处理中..." : "测试连接"}
              </button>
              <button
                type="button"
                className="confirmButton"
                disabled={
                  busy
                  || !name.trim()
                  || (
                    connDialogMode === "create"
                      ? !testPassed
                      : !(testPassed || editingDatasource)
                  )
                }
                onClick={() => void saveConnection()}
              >
                {connDialogMode === "edit" ? "保存更新" : "保存连接"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
