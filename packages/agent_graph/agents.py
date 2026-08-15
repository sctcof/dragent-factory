from __future__ import annotations

import json
from typing import Any, Dict, List

from packages.llm_gateway import ModelRouter
from packages.shared_types.models import Asset, ChartConfig, ChartType, ExecutionResult, Strategy, StrategyTemplate


class DataAgent:
    def describe_assets(self, assets: List[Asset]) -> str:
        parts = []
        for asset in assets:
            if not asset.data_dictionary:
                continue
            columns = ", ".join(f"{col.name}({col.logical_type})" for col in asset.data_dictionary.columns)
            parts.append(f"{asset.name}: {asset.data_dictionary.row_count} rows; {columns}")
        return "\n".join(parts)


class PlannerAgent:
    def __init__(self, rag: Any, router: ModelRouter) -> None:
        self.rag = rag
        self.router = router

    def plan(
        self,
        strategy_id: str,
        task_id: str,
        intent: str,
        assets: List[Asset],
        strategy_templates: List[StrategyTemplate] | None = None,
        feedback_context: List[Dict[str, Any]] | None = None,
    ) -> Strategy:
        context = self.rag.retrieve(intent, assets)
        selected_templates = _rank_strategy_templates(intent, strategy_templates or [])
        heuristic = self._heuristic_strategy(
            strategy_id=strategy_id,
            task_id=task_id,
            intent=intent,
            assets=assets,
            context=context,
            selected_templates=selected_templates,
            feedback_context=feedback_context,
        )
        llm_strategy = self._llm_strategy(
            strategy_id=strategy_id,
            task_id=task_id,
            intent=intent,
            assets=assets,
            context=context,
            selected_templates=selected_templates,
            feedback_context=feedback_context,
            fallback=heuristic,
        )
        return llm_strategy or heuristic

    def _heuristic_strategy(
        self,
        strategy_id: str,
        task_id: str,
        intent: str,
        assets: List[Asset],
        context: List[Dict[str, Any]],
        selected_templates: List[StrategyTemplate],
        feedback_context: List[Dict[str, Any]] | None,
    ) -> Strategy:
        dimensions = _choose_dimensions(assets, intent)
        metrics = _choose_metrics(assets, intent)
        if not metrics:
            metrics = ["row_count"]
        methods = _choose_methods(intent, dimensions, metrics, selected_templates)
        chart_suggestions = [
            {
                "type": "line" if any(_field_type(assets, dim) == "date" for dim in dimensions) else "bar",
                "title": f"{'/'.join(metrics[:2])} 按 {'/'.join(dimensions[:2]) if dimensions else '总体'} 分析",
                "dimensions": dimensions[:2],
                "metrics": metrics[:2],
            }
        ]
        if metrics:
            chart_suggestions.append({"type": "metric", "title": f"核心指标 {metrics[0]}", "metrics": [metrics[0]]})
        assumptions = [
            "策略来源：本地启发式 Planner（未调用外部模型或调用失败时回退）。",
            "所有新结论必须来自执行结果或 Supporting IDs，未证实推断只进入备注。",
        ]
        assumptions.extend(_shared_strategy_assumptions(assets, context, selected_templates, feedback_context, intent))
        return Strategy(
            id=strategy_id,
            task_id=task_id,
            objective=intent,
            dimensions=dimensions,
            metrics=metrics,
            methods=methods,
            chart_suggestions=chart_suggestions,
            evidence_policy="chart/table/conclusion outputs must reference asset supporting_ids or execution artifacts",
            assumptions=assumptions,
            source_strategy_ids=[template.id for template in selected_templates],
            rag_context=context[:6],
        )

    def _llm_strategy(
        self,
        strategy_id: str,
        task_id: str,
        intent: str,
        assets: List[Asset],
        context: List[Dict[str, Any]],
        selected_templates: List[StrategyTemplate],
        feedback_context: List[Dict[str, Any]] | None,
        fallback: Strategy,
    ) -> Strategy | None:
        schema = _asset_field_schema(assets)
        if not schema:
            return None
        system_prompt = (
            "你是数据分析策略规划助手。根据用户分析意图与可用字段，输出可执行的分析策略 JSON。"
            "规则：dimensions/metrics 只能从可用字段中选择；methods 用中文步骤，3-6 条；"
            "chart_suggestions 为数组，每项含 type/title/dimensions/metrics；"
            "禁止编造不存在的字段。输出 JSON："
            '{"objective":"...","dimensions":[],"metrics":[],"methods":[],'
            '"chart_suggestions":[{"type":"bar","title":"...","dimensions":[],"metrics":[]}],'
            '"assumptions":["..."]}'
        )
        user_prompt = (
            f"分析意图：{intent}\n"
            f"可用字段：{json.dumps(schema, ensure_ascii=False)}\n"
            f"启发式参考维度：{fallback.dimensions}\n"
            f"启发式参考指标：{fallback.metrics}\n"
            f"策略模板：{[template.title for template in selected_templates[:3]]}\n"
            f"RAG 上下文摘要：{json.dumps(context[:4], ensure_ascii=False, default=str)[:2500]}"
        )
        result, envelope = self.router.generate_json("planner", system_prompt, user_prompt)
        model_name = str(envelope.get("model") or "unknown")
        if not isinstance(result, dict):
            fallback.assumptions = [
                f"策略来源：本地启发式（模型 {model_name} 未调用成功"
                + (f"：{envelope.get('reason')}" if envelope.get("reason") else "")
                + "）。",
                *fallback.assumptions[1:],
            ]
            return None

        allowed_fields = {item["name"] for item in schema}
        dimensions = [
            name for name in _as_str_list(result.get("dimensions")) if name in allowed_fields
        ] or list(fallback.dimensions)
        metrics = [
            name for name in _as_str_list(result.get("metrics")) if name in allowed_fields or name == "row_count"
        ] or list(fallback.metrics)
        if not metrics:
            metrics = ["row_count"]
        methods = _as_str_list(result.get("methods")) or list(fallback.methods)
        chart_suggestions = _normalize_chart_suggestions(
            result.get("chart_suggestions"),
            dimensions=dimensions,
            metrics=metrics,
            fallback=fallback.chart_suggestions,
        )
        assumptions = [
            f"策略来源：外部模型 {model_name}（planner · {envelope.get('status')} · {envelope.get('latency_ms', 0)}ms）。",
            "所有新结论必须来自执行结果或 Supporting IDs，未证实推断只进入备注。",
        ]
        assumptions.extend(_as_str_list(result.get("assumptions"))[:4])
        assumptions.extend(_shared_strategy_assumptions(assets, context, selected_templates, feedback_context, intent))
        objective = str(result.get("objective") or intent).strip() or intent
        return Strategy(
            id=strategy_id,
            task_id=task_id,
            objective=objective,
            dimensions=dimensions[:4],
            metrics=metrics[:5],
            methods=methods[:6],
            chart_suggestions=chart_suggestions,
            evidence_policy=fallback.evidence_policy,
            assumptions=assumptions,
            source_strategy_ids=[template.id for template in selected_templates],
            rag_context=context[:6],
        )


class CoderAgent:
    def __init__(self, router: ModelRouter) -> None:
        self.router = router

    def generate_python(self, strategy: Strategy, assets: List[Asset]) -> str:
        dimensions = strategy.dimensions
        metrics = [metric for metric in strategy.metrics if metric != "row_count"]
        first_dimension = dimensions[0] if dimensions else None
        first_metric = metrics[0] if metrics else None

        def _asset_has_column(asset: Asset, column_name: str | None) -> bool:
            if not column_name or not asset.data_dictionary:
                return False
            return any(column.name == column_name for column in asset.data_dictionary.columns)

        # 主数据集应优先包含首个维度 + 首个指标；否则依次放宽：含指标、含维度、默认第一个
        candidates = [
            asset
            for asset in assets
            if _asset_has_column(asset, first_metric) and _asset_has_column(asset, first_dimension)
        ]
        if not candidates:
            candidates = [asset for asset in assets if _asset_has_column(asset, first_metric)]
        if not candidates:
            candidates = [asset for asset in assets if _asset_has_column(asset, first_dimension)]
        if not candidates:
            candidates = assets
        primary_asset = candidates[0]

        dictionary = primary_asset.data_dictionary
        suggested_chart_type = str((strategy.chart_suggestions[0] if strategy.chart_suggestions else {}).get("type", "bar"))
        supported_chart_types = {
            "line",
            "bar",
            "area",
            "pie",
            "doughnut",
            "rose",
            "heatmap",
            "scatter",
            "stacked_bar",
            "horizontal_bar",
            "radar",
            "gauge",
            "funnel",
            "treemap",
            "table",
        }
        selected_chart_type = suggested_chart_type if suggested_chart_type in supported_chart_types else "bar"
        rows_hint = dictionary.row_count if dictionary else 0
        asset_meta = [
            {
                "id": asset.id,
                "name": asset.name,
                "columns": [column.name for column in asset.data_dictionary.columns] if asset.data_dictionary else [],
            }
            for asset in assets
        ]
        return f'''import csv
import json
import os
from collections import defaultdict

assets = json.loads(os.environ["DRAGENT_ASSETS"])
result_path = os.environ["DRAGENT_RESULT_PATH"]
asset_meta = {json.dumps(asset_meta, ensure_ascii=False)}
primary_asset_id = {primary_asset.id!r}
dimension = {first_dimension!r}
metric = {first_metric!r}
selected_chart_type = {selected_chart_type!r}
rows_by_asset = {{}}
process_steps = []

def load_csv(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [dict(row) for row in reader]

for asset_id, path in assets.items():
    rows_by_asset[asset_id] = load_csv(path)

rows = rows_by_asset.get(primary_asset_id, [])
process_steps.append({{"step": 1, "name": "数据范围确认", "detail": f"载入 {{len(rows_by_asset)}} 个数据集，主数据集 {{primary_asset_id}} 共 {{len(rows)}} 行。"}})

def to_number(value):
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return 0.0

table = []
charts = []
quality_table = []
for meta in asset_meta:
    data = rows_by_asset.get(meta["id"], [])
    null_cells = 0
    total_cells = 0
    for row in data:
        for value in row.values():
            total_cells += 1
            if value in ["", None]:
                null_cells += 1
    quality_table.append({{
        "asset": meta["name"],
        "rows": len(data),
        "columns": len(meta["columns"]),
        "null_cells": null_cells,
        "null_rate": round(null_cells / total_cells, 4) if total_cells else 0
    }})
process_steps.append({{"step": 2, "name": "质量画像", "detail": "完成每个数据集的行数、列数、缺失率检查。"}})

if dimension and metric:
    grouped = defaultdict(lambda: {{"value": 0.0, "count": 0}})
    for row in rows:
        key = row.get(dimension, "未分组") or "未分组"
        grouped[key]["value"] += to_number(row.get(metric))
        grouped[key]["count"] += 1
    table = [
        {{dimension: key, metric: round(value["value"], 4), "records": value["count"]}}
        for key, value in grouped.items()
    ]
    table = sorted(table, key=lambda item: item[metric], reverse=True)[:50]
    process_steps.append({{"step": 3, "name": "指标聚合", "detail": f"按 {{dimension}} 聚合 {{metric}}，得到 {{len(table)}} 个分组。"}})
    chart_type = selected_chart_type
    charts.append({{
        "id": "chart_primary",
        "type": chart_type,
        "title": f"{{metric}} 按 {{dimension}} 汇总",
        "x_field": dimension,
        "y_fields": [metric],
        "dataset": table[:30],
        "insight": f"共处理 {{len(rows)}} 行，输出 {{len(table)}} 个分组。"
    }})
    process_steps.append({{"step": 4, "name": "趋势/对比图生成", "detail": f"生成 {{chart_type}} 图用于展示 {{metric}} 与 {{dimension}} 的关系。"}})
    if len(table) >= 2:
        top = table[0]
        total = sum(to_number(item.get(metric)) for item in table)
        contribution = round(to_number(top.get(metric)) / total, 4) if total else 0
        process_steps.append({{"step": 5, "name": "贡献拆解", "detail": f"最高分组 {{top.get(dimension)}} 贡献率约 {{contribution}}。"}})
else:
    table = [{{"metric": "row_count", "value": len(rows)}}]
    charts.append({{
        "id": "chart_row_count",
        "type": "metric",
        "title": "数据行数",
        "dataset": table,
        "y_fields": ["value"],
        "insight": "当前资产共有 {{}} 行记录。".format(len(rows))
    }})
    process_steps.append({{"step": 3, "name": "总体规模统计", "detail": "未识别到可聚合维度和指标，输出行数指标卡。"}})

# 「对比」类图至少需要 2 个数据集，单资产时改为指标卡，避免出现单柱难看图
if len(quality_table) >= 2:
    charts.append({{
        "id": "chart_asset_quality",
        "type": selected_chart_type if selected_chart_type in {{"bar", "horizontal_bar", "pie", "doughnut"}} else "bar",
        "title": "各数据集记录数对比",
        "x_field": "asset",
        "y_fields": ["rows"],
        "dataset": quality_table,
        "insight": "对比多数据集规模差异，评估后续 join 匹配与口径风险。"
    }})
    process_steps.append({{"step": 6, "name": "跨数据集一致性检查", "detail": f"对比 {{len(quality_table)}} 个数据集的行数/列数/缺失率。"}})
elif len(quality_table) == 1:
    item = quality_table[0]
    charts.append({{
        "id": "chart_asset_quality",
        "type": "metric",
        "title": f"{{item.get('asset', '当前数据集')}} 记录数",
        "dataset": [{{"rows": item.get("rows", 0)}}],
        "y_fields": ["rows"],
        "insight": (
            f"当前仅 1 个数据集（{{item.get('rows', 0)}} 行 / {{item.get('columns', 0)}} 列）。"
            "多数据集规模对比需选择至少 2 个分析资产。"
        )
    }})
    process_steps.append({{"step": 6, "name": "数据规模核对", "detail": "仅 1 个数据集，输出规模指标卡（对比图需 ≥2 个资产）。"}})
else:
    process_steps.append({{"step": 6, "name": "跨数据集一致性检查", "detail": "未生成质量画像，跳过数据集对比。"}})
process_steps.append({{"step": 7, "name": "业务结论生成", "detail": "将聚合结果、贡献拆解和质量风险汇总为可追溯结论。"}})

payload = {{
    "table": table,
    "charts": charts,
    "process_steps": process_steps,
    "quality_table": quality_table,
    "summary": "基于已确认策略执行完成，输入资产行数约为 {rows_hint}。"
}}
with open(result_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, ensure_ascii=False, indent=2)
print(payload["summary"])
'''


class AnalyzerAgent:
    def __init__(self, router: ModelRouter | None = None) -> None:
        self.router = router

    def explain(self, strategy: Strategy, execution: ExecutionResult) -> Dict[str, Any]:
        if execution.status != "success":
            return {
                "summary": (
                    f"针对分析目标「{strategy.objective}」的执行失败，已记录 stderr，"
                    "可在代码沙箱中修改后重跑。"
                ),
                "findings": [],
                "charts": [],
            }

        facts = _execution_facts(strategy, execution)
        findings = _data_findings(strategy, execution, facts)
        narrative = _goal_narrative(strategy, execution, facts, findings)
        model_note = "结论来源：本地启发式 Analyzer。"
        if self.router is not None:
            llm_summary, envelope = _llm_analysis_summary(self.router, strategy, execution, facts, findings)
            model_name = str((envelope or {}).get("model") or "unknown")
            status = str((envelope or {}).get("status") or "fallback")
            latency = int((envelope or {}).get("latency_ms") or 0)
            if llm_summary:
                narrative = llm_summary.get("summary") or narrative
                llm_findings = [
                    str(item).strip()
                    for item in (llm_summary.get("findings") or [])
                    if str(item).strip()
                ]
                if llm_findings:
                    findings = llm_findings[:6]
                model_note = f"结论来源：外部模型 {model_name}（analyzer · {status} · {latency}ms）。"
            else:
                reason = (envelope or {}).get("reason")
                model_note = (
                    f"结论来源：本地启发式（模型 {model_name} 未调用成功"
                    + (f"：{reason}" if reason else "")
                    + "）。"
                )

        charts = _enrich_chart_insights(execution.charts, strategy, findings)
        summary_lines = [narrative]
        if findings:
            summary_lines.append("")
            summary_lines.append("关键发现：")
            summary_lines.extend(f"- {item}" for item in findings)
        summary_lines.append("")
        summary_lines.append(model_note)
        summary_lines.append("结论仅基于本次执行结果与已解析数据字典，未覆盖未进入本次计算的字段与样本。")
        return {
            "summary": "\n".join(summary_lines).strip(),
            "findings": findings,
            "charts": charts,
        }


class ReportAgent:
    def compose_markdown(self, title: str, cart_items: List[Dict[str, Any]]) -> str:
        lines = [
            f"# {title}",
            "",
            "## 摘要结论",
            "本报告由报告购物车中的策略、代码、图表与结论聚合生成，所有条目保留来源引用。",
            "",
            "## 分析片段",
        ]
        for index, item in enumerate(cart_items, start=1):
            lines.extend(
                [
                    f"### {index}. {item.get('title', item.get('type', '片段'))}",
                    "",
                    f"- 类型：{item.get('type')}",
                    f"- 来源：{item.get('ref_id')}",
                    "",
                    "```json",
                    json.dumps(item.get("snapshot", {}), ensure_ascii=False, indent=2)[:6000],
                    "```",
                    "",
                ]
            )
        lines.extend(
            [
                "## 风险、限制与假设",
                "- 本地运行模式使用确定性 Agent，真实生产环境应接入模型网关与 RAGFlow。",
                "- 报告结论以购物车快照为准，不随后续数据刷新自动变化。",
                "",
                "## 附录",
                "- 证据链包括策略版本、执行记录、图表快照与资产 Supporting IDs。",
            ]
        )
        return "\n".join(lines)


def _to_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _format_number(value: float) -> str:
    if abs(value - round(value)) < 1e-9:
        return f"{int(round(value)):,}"
    if abs(value) >= 100:
        return f"{value:,.1f}"
    return f"{value:,.4g}"


def _numeric_columns(rows: List[Dict[str, Any]], preferred: List[str] | None = None) -> List[str]:
    if not rows:
        return []
    keys = list(rows[0].keys())
    scored: List[tuple[int, str]] = []
    for key in keys:
        values = [_to_number(row.get(key)) for row in rows[:80]]
        numeric_count = sum(1 for item in values if item is not None)
        if numeric_count < max(1, len(rows[:80]) // 2):
            continue
        boost = 10 if preferred and key in preferred else 0
        scored.append((numeric_count + boost, key))
    scored.sort(reverse=True)
    return [key for _, key in scored]


def _category_columns(rows: List[Dict[str, Any]], preferred: List[str] | None = None) -> List[str]:
    if not rows:
        return []
    numeric = set(_numeric_columns(rows))
    keys = [key for key in rows[0].keys() if key not in numeric]
    if preferred:
        ordered = [key for key in preferred if key in keys]
        ordered.extend(key for key in keys if key not in ordered)
        return ordered
    return keys


def _execution_facts(strategy: Strategy, execution: ExecutionResult) -> Dict[str, Any]:
    table = execution.table or []
    metrics = [item for item in strategy.metrics if item and item != "row_count"]
    dimensions = [item for item in strategy.dimensions if item]
    numeric_cols = _numeric_columns(table, metrics)
    category_cols = _category_columns(table, dimensions)
    metric = next((item for item in metrics if item in numeric_cols), numeric_cols[0] if numeric_cols else None)
    dimension = next((item for item in dimensions if item in category_cols), category_cols[0] if category_cols else None)

    values = [_to_number(row.get(metric)) for row in table] if metric else []
    values = [item for item in values if item is not None]
    total = sum(values) if values else None
    average = (total / len(values)) if values and total is not None else None
    ranked: List[Dict[str, Any]] = []
    if metric and dimension and table:
        ranked = sorted(
            (
                {
                    "label": str(row.get(dimension) if row.get(dimension) is not None else "未知"),
                    "value": _to_number(row.get(metric)) or 0.0,
                }
                for row in table
            ),
            key=lambda item: item["value"],
            reverse=True,
        )
    top = ranked[0] if ranked else None
    bottom = ranked[-1] if len(ranked) >= 2 else None
    contribution = None
    if top and total:
        contribution = top["value"] / total

    quality = execution.quality_table or []
    quality_note = None
    if len(quality) >= 2:
        quality_sorted = sorted(
            quality,
            key=lambda item: _to_number(item.get("rows")) or 0.0,
            reverse=True,
        )
        largest = quality_sorted[0]
        smallest = quality_sorted[-1]
        quality_note = (
            f"多数据集规模差异明显：最大 {largest.get('asset')} "
            f"{_format_number(_to_number(largest.get('rows')) or 0)} 行，"
            f"最小 {smallest.get('asset')} {_format_number(_to_number(smallest.get('rows')) or 0)} 行，"
            "后续 join 需关注口径与匹配损失。"
        )

    process_highlights = [
        str(step.get("detail") or step.get("name") or "").strip()
        for step in (execution.process_steps or [])
        if str(step.get("detail") or step.get("name") or "").strip()
    ][:3]

    return {
        "row_count": len(table),
        "metric": metric,
        "dimension": dimension,
        "total": total,
        "average": average,
        "top": top,
        "bottom": bottom,
        "contribution": contribution,
        "group_count": len(ranked) if ranked else len(table),
        "quality_note": quality_note,
        "process_highlights": process_highlights,
        "chart_count": len(execution.charts or []),
    }


def _data_findings(strategy: Strategy, execution: ExecutionResult, facts: Dict[str, Any]) -> List[str]:
    findings: List[str] = []
    metric = facts.get("metric")
    dimension = facts.get("dimension")
    top = facts.get("top")
    bottom = facts.get("bottom")
    total = facts.get("total")
    average = facts.get("average")
    contribution = facts.get("contribution")
    row_count = int(facts.get("row_count") or 0)

    if metric and total is not None:
        findings.append(
            f"指标 {metric} 合计 {_format_number(total)}"
            + (f"，均值 {_format_number(average)}" if average is not None else "")
            + f"，覆盖 {row_count} 个结果分组。"
        )
    elif row_count:
        findings.append(f"本次返回 {row_count} 行可核对结果，可用于回答「{strategy.objective}」。")

    if top and metric and dimension:
        line = (
            f"按 {dimension} 观察，{top['label']} 的 {metric} 最高"
            f"（{_format_number(top['value'])}）"
        )
        if contribution is not None:
            line += f"，约占合计 {contribution:.1%}"
        findings.append(line + "。")

    if bottom and top and metric and dimension and bottom["label"] != top["label"]:
        gap = top["value"] - bottom["value"]
        findings.append(
            f"{bottom['label']} 的 {metric} 最低（{_format_number(bottom['value'])}），"
            f"与最高项差距 {_format_number(gap)}，是优先下钻对象。"
        )

    quality_note = facts.get("quality_note")
    if quality_note:
        findings.append(str(quality_note))

    methods = [str(item).strip() for item in (strategy.methods or []) if str(item).strip()]
    if methods:
        findings.append(f"本轮采用方法：{'；'.join(methods[:3])}。")

    # 去重并限制数量
    deduped: List[str] = []
    for item in findings:
        if item and item not in deduped:
            deduped.append(item)
    return deduped[:6]


def _goal_narrative(
    strategy: Strategy,
    execution: ExecutionResult,
    facts: Dict[str, Any],
    findings: List[str],
) -> str:
    metric = facts.get("metric")
    dimension = facts.get("dimension")
    top = facts.get("top")
    row_count = int(facts.get("row_count") or 0)
    parts = [
        f"针对分析目标「{strategy.objective}」，"
        f"已按策略完成真实数据计算（返回 {row_count} 行结果"
        + (f"，产出 {facts.get('chart_count')} 张图表" if facts.get("chart_count") else "")
        + "）。"
    ]
    if metric and dimension and top:
        parts.append(
            f"围绕指标 {metric} 与维度 {dimension}，"
            f"当前最突出的信号来自 {top['label']}（{_format_number(top['value'])}），"
            "可作为下一轮归因与行动建议的切入点。"
        )
    elif findings:
        parts.append(findings[0])
    else:
        parts.append("本次结果已可用于核对数据范围与字段口径，建议补充更明确的指标或维度后继续下钻。")
    if strategy.dimensions or strategy.metrics:
        parts.append(
            "策略口径："
            + (
                f"维度 {('/'.join(strategy.dimensions[:3]) or '未指定')}"
                f"，指标 {('/'.join(strategy.metrics[:3]) or '未指定')}。"
            )
        )
    return "".join(parts)


def _llm_analysis_summary(
    router: ModelRouter,
    strategy: Strategy,
    execution: ExecutionResult,
    facts: Dict[str, Any],
    findings: List[str],
) -> tuple[Dict[str, Any] | None, Dict[str, Any]]:
    sample_rows = (execution.table or [])[:12]
    system_prompt = (
        "你是数据分析结论助手。请根据用户分析目标与真实执行结果，生成简洁、可核对的中文结论。"
        "要求：必须回应用户问题/目标；结论必须引用结果中的具体数值、分组或对比；"
        "禁止编造未出现在结果中的数据；输出 JSON："
        "{\"summary\":\"一段话\",\"findings\":[\"要点1\",\"要点2\"]}。"
    )
    user_prompt = (
        f"分析目标：{strategy.objective}\n"
        f"策略维度：{', '.join(strategy.dimensions) or '无'}\n"
        f"策略指标：{', '.join(strategy.metrics) or '无'}\n"
        f"策略方法：{', '.join(strategy.methods) or '无'}\n"
        f"执行摘要事实：{json.dumps(facts, ensure_ascii=False, default=str)}\n"
        f"启发式发现：{json.dumps(findings, ensure_ascii=False)}\n"
        f"结果样例（最多12行）：{json.dumps(sample_rows, ensure_ascii=False, default=str)}"
    )
    result, envelope = router.generate_json("analyzer", system_prompt, user_prompt)
    if not isinstance(result, dict):
        return None, envelope
    summary = str(result.get("summary") or "").strip()
    if not summary:
        return None, envelope
    return result, envelope


def _shared_strategy_assumptions(
    assets: List[Asset],
    context: List[Dict[str, Any]],
    selected_templates: List[StrategyTemplate],
    feedback_context: List[Dict[str, Any]] | None,
    intent: str,
) -> List[str]:
    assumptions: List[str] = []
    if context:
        asset_names = {asset.id: asset.name for asset in assets}
        matched_names: List[str] = []
        for item in context:
            name = asset_names.get(item.get("asset_id"))
            if name and name not in matched_names:
                matched_names.append(name)
        assumptions.append(
            "策略参考了数据字典：" + "、".join(matched_names[:3] or [asset.name for asset in assets[:1]])
        )
    if selected_templates:
        assumptions.append("策略资产引用：" + "、".join(template.title for template in selected_templates[:3]))
    if feedback_context:
        assumptions.append(f"纳入 {len(feedback_context)} 条已认可问答作为个性化策略参考。")
    assumptions.append(_method_fit_note(intent))
    return assumptions


def _asset_field_schema(assets: List[Asset]) -> List[Dict[str, str]]:
    schema: List[Dict[str, str]] = []
    seen: set[str] = set()
    for asset in assets:
        if not asset.data_dictionary:
            continue
        for column in asset.data_dictionary.columns:
            if column.name in seen:
                continue
            seen.add(column.name)
            schema.append(
                {
                    "name": column.name,
                    "logical_type": column.logical_type,
                    "asset": asset.name,
                }
            )
    return schema


def _as_str_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _normalize_chart_suggestions(
    value: Any,
    dimensions: List[str],
    metrics: List[str],
    fallback: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if not isinstance(value, list) or not value:
        return list(fallback)
    supported = {
        "line",
        "bar",
        "area",
        "pie",
        "doughnut",
        "rose",
        "heatmap",
        "scatter",
        "stacked_bar",
        "horizontal_bar",
        "radar",
        "gauge",
        "funnel",
        "treemap",
        "table",
        "metric",
    }
    suggestions: List[Dict[str, Any]] = []
    for item in value[:4]:
        if not isinstance(item, dict):
            continue
        chart_type = str(item.get("type") or "bar").strip()
        if chart_type not in supported:
            chart_type = "bar"
        dims = [name for name in _as_str_list(item.get("dimensions")) if name in dimensions] or dimensions[:2]
        mets = [name for name in _as_str_list(item.get("metrics")) if name in metrics] or metrics[:2]
        title = str(item.get("title") or "").strip() or f"{'/'.join(mets[:2] or ['指标'])} 分析"
        suggestions.append(
            {
                "type": chart_type,
                "title": title,
                "dimensions": dims,
                "metrics": mets,
            }
        )
    return suggestions or list(fallback)


def _enrich_chart_insights(
    charts: List[ChartConfig],
    strategy: Strategy,
    findings: List[str],
) -> List[ChartConfig]:
    if not charts:
        return []
    weak_tokens = ("用于检查", "共处理", "输出", "个分组", "行记录")
    enriched: List[ChartConfig] = []
    finding_idx = 0
    for chart in charts:
        insight = (chart.insight or "").strip()
        dataset = chart.dataset or []
        y_fields = chart.y_fields or []
        metric = y_fields[0] if y_fields else None
        x_field = chart.x_field
        data_insight = None
        if metric and dataset:
            ranked = sorted(
                dataset,
                key=lambda row: _to_number(row.get(metric)) or 0.0,
                reverse=True,
            )
            if ranked:
                top = ranked[0]
                label = str(top.get(x_field) if x_field and top.get(x_field) is not None else chart.title)
                value = _to_number(top.get(metric))
                if value is not None:
                    data_insight = (
                        f"「{label}」在 {metric} 上最高（{_format_number(value)}），"
                        f"与目标「{strategy.objective}」直接相关。"
                    )
        if (not insight or any(token in insight for token in weak_tokens)) and data_insight:
            insight = data_insight
        elif (not insight or any(token in insight for token in weak_tokens)) and finding_idx < len(findings):
            insight = findings[finding_idx]
            finding_idx += 1
        enriched.append(chart.model_copy(update={"insight": insight or chart.insight}))
    return enriched


def _choose_dimensions(assets: List[Asset], intent: str) -> List[str]:
    intent_lower = intent.lower()
    fields: List[tuple[str, str]] = []
    for asset in assets:
        if not asset.data_dictionary:
            continue
        fields.extend(
            (column.name, column.logical_type)
            for column in asset.data_dictionary.columns
            if column.logical_type in ["date", "category"]
        )

    available = {name.lower(): name for name, _ in fields}
    result: List[str] = []

    def add_named(candidates: List[str]) -> None:
        for candidate in candidates:
            name = available.get(candidate.lower())
            if name and name not in result:
                result.append(name)

    def add_first_named(candidates: List[str]) -> None:
        for candidate in candidates:
            name = available.get(candidate.lower())
            if name and name not in result:
                result.append(name)
                return

    aliases = [
        (["月份", "月度", "按月"], ["month", "order_month", "signup_month"]),
        (["区域", "地区"], ["region", "area"]),
        (["渠道"], ["channel"]),
        (["商品", "产品"], ["category", "brand", "product_id", "product_name"]),
        (["客户", "客群", "人群"], ["segment", "customer_id"]),
        (["仓库", "库存"], ["warehouse", "product_id"]),
        (["日期", "时间", "趋势", "变化"], ["month", "order_date", "date"]),
    ]
    for keywords, candidates in aliases:
        if any(keyword in intent_lower for keyword in keywords):
            add_first_named(candidates)

    for name, _ in fields:
        if name.lower() in intent_lower and name not in result:
            result.append(name)

    if _is_driver_intent(intent):
        add_named(["region", "channel", "category", "brand", "segment", "product_id", "customer_id", "warehouse"])
    elif _is_trend_intent(intent):
        add_named(["month", "order_date", "date"])

    add_named([name for name, field_type in fields if field_type == "category"])
    add_named([name for name, field_type in fields if field_type == "date"])
    return result[:4]


def _choose_metrics(assets: List[Asset], intent: str) -> List[str]:
    intent_lower = intent.lower()
    numeric: List[str] = []
    for asset in assets:
        if not asset.data_dictionary:
            continue
        numeric.extend(
            column.name
            for column in asset.data_dictionary.columns
            if column.logical_type == "number" and column.name not in numeric
        )

    available = {name.lower(): name for name in numeric}
    result: List[str] = []

    def add_named(candidates: List[str]) -> None:
        for candidate in candidates:
            name = available.get(candidate.lower())
            if name and name not in result:
                result.append(name)

    metric_aliases = [
        (["销量", "销售量", "售出", "件数"], ["quantity", "sales_volume", "units_sold", "order_count"]),
        (["销售金额", "销售额", "收入", "营收", "gmv"], ["revenue", "gmv", "sales_amount", "amount"]),
        (["订单", "单量"], ["order_count", "quantity"]),
        (["毛利", "利润"], ["gross_margin", "profit"]),
        (["成本"], ["cost"]),
        (["客单价"], ["avg_order_value"]),
    ]
    for keywords, candidates in metric_aliases:
        if any(keyword in intent_lower for keyword in keywords):
            add_named(candidates)

    for name in numeric:
        if name.lower() in intent_lower and name not in result:
            result.append(name)

    if _is_driver_intent(intent):
        add_named([
            "discount_rate",
            "list_price",
            "campaign_spend",
            "leads",
            "new_customers",
            "stockout_days",
            "stock_begin",
            "stock_end",
        ])

    add_named(numeric)
    return result[:5]


def _choose_methods(intent: str, dimensions: List[str], metrics: List[str], templates: List[StrategyTemplate]) -> List[str]:
    methods = [
        "确认分析范围并检查数据完整性与质量",
        "明确指标口径并映射到可用数据字段",
    ]

    if _is_driver_intent(intent):
        methods.extend([
            "筛选可能影响目标指标的候选因素",
            "按区域、渠道、商品和客群等维度逐层下钻",
            "比较候选因素的相关强度与影响幅度",
            "校验混杂因素及结论在不同分组下的稳定性",
            "按证据强弱排列最直接的影响因素",
        ])
    else:
        if _is_trend_intent(intent):
            methods.append("按时间拆解目标指标的变化趋势")
        if dimensions and _is_comparison_intent(intent):
            methods.append("对关键业务维度进行分组比较")
        if _is_contribution_intent(intent):
            methods.append("计算各分组贡献，并定位主要贡献项与异常项")
        if len(metrics) > 1 and any(keyword in intent.lower() for keyword in ["相关", "关系", "联动"]):
            methods.append("分析多个指标之间的联动关系")

    for template in templates:
        for method in template.methods:
            readable_method = _readable_method(method)
            if _is_driver_intent(intent) and readable_method != "检查跨数据集连接关系与口径一致性":
                continue
            if readable_method and _template_method_matches_intent(method, intent) and readable_method not in methods:
                methods.append(readable_method)

    if len(methods) == 2:
        methods.extend(["描述目标指标的整体分布", "对关键业务维度进行分组比较"])
    methods.append("汇总业务结论、支持证据与风险限制")
    return list(dict.fromkeys(methods))[:12]


def _rank_strategy_templates(intent: str, templates: List[StrategyTemplate]) -> List[StrategyTemplate]:
    if not templates:
        return [_default_strategy_template()]
    terms = _intent_terms(intent)
    scored = []
    for template in templates:
        haystack = " ".join([template.title, template.markdown, " ".join(template.methods), " ".join(template.metrics), " ".join(template.dimensions)]).lower()
        score = sum(1 for term in terms if term in haystack)
        scored.append((score, template))
    ranked = [template for score, template in sorted(scored, key=lambda item: item[0], reverse=True) if score > 0]
    return ranked[:3] or [_default_strategy_template()]


def _intent_terms(intent: str) -> set[str]:
    normalized = intent.lower().replace("_", " ").replace("/", " ")
    terms = {term for term in normalized.split() if len(term) > 1}
    vocabulary = [
        "趋势", "变化", "增长", "下降", "对比", "贡献", "下钻", "原因",
        "因素", "影响", "相关", "销量", "销售额", "收入", "毛利", "库存",
        "渠道", "区域", "商品", "客户", "异常", "预测",
    ]
    terms.update(term for term in vocabulary if term in normalized)
    return terms


def _is_driver_intent(intent: str) -> bool:
    lowered = intent.lower()
    return any(keyword in lowered for keyword in ["影响", "因素", "原因", "驱动", "归因", "根因", "最直接", "为什么"])


def _is_trend_intent(intent: str) -> bool:
    lowered = intent.lower()
    return any(keyword in lowered for keyword in ["趋势", "变化", "增长", "下降", "波动", "同比", "环比", "月份", "月度"])


def _is_contribution_intent(intent: str) -> bool:
    lowered = intent.lower()
    return any(keyword in lowered for keyword in ["贡献", "占比", "主要来源", "拆解"])


def _is_comparison_intent(intent: str) -> bool:
    lowered = intent.lower()
    return _is_trend_intent(intent) or _is_contribution_intent(intent) or any(
        keyword in lowered for keyword in ["对比", "比较", "按", "区域", "渠道", "商品", "客户"]
    )


def _template_method_matches_intent(method: str, intent: str) -> bool:
    lowered = method.lower()
    if any(token in lowered for token in ["scope", "quality", "metric", "field_mapping", "summary", "risk", "范围", "质量", "指标", "字段", "结论", "风险"]):
        return True
    if _is_driver_intent(intent) and any(token in lowered for token in ["driver", "factor", "cause", "correlation", "regression", "drilldown", "outlier", "segment", "cross_dataset", "因素", "原因", "相关", "回归", "下钻", "异常", "分组", "跨数据"]):
        return True
    if _is_trend_intent(intent) and any(token in lowered for token in ["trend", "time", "同比", "环比", "趋势", "时间"]):
        return True
    if _is_contribution_intent(intent) and any(token in lowered for token in ["contribution", "drilldown", "outlier", "rank", "贡献", "下钻", "异常", "排序"]):
        return True
    if _is_comparison_intent(intent) and any(token in lowered for token in ["dimension", "group", "comparison", "segment", "维度", "分组", "比较", "对比"]):
        return True
    return False


def _readable_method(method: str) -> str | None:
    legacy_names = {
        "1_data_scope_and_quality_check": "确认分析范围并检查数据完整性与质量",
        "2_metric_definition_and_field_mapping": "明确指标口径并映射到可用数据字段",
        "2_target_metric_definition_and_field_mapping": "明确目标指标口径，并映射到可用数据字段",
        "3_time_trend_decomposition": "按时间拆解目标指标的变化趋势",
        "4_dimension_group_comparison": "对关键业务维度进行分组比较",
        "5_contribution_and_outlier_drilldown": "计算各分组贡献，并定位主要贡献项与异常项",
        "6_cross_dataset_consistency_check": "检查跨数据集连接关系与口径一致性",
        "7_business_summary_and_risk_notes": "汇总业务结论、支持证据与风险限制",
        "8_segment_ranking": "按照关键业务分组进行影响排序",
        "9_multi_metric_correlation_hint": "分析多个指标之间的联动关系",
        "3_candidate_driver_field_screening": "筛选可能影响目标指标的候选因素",
        "4_multidimensional_drilldown": "按关键业务维度逐层下钻",
        "5_correlation_and_effect_size_ranking": "比较候选因素的相关强度与影响幅度",
        "6_confounder_and_stability_validation": "校验混杂因素及结论稳定性",
        "7_direct_driver_ranking_and_evidence": "按证据强弱排列最直接的影响因素",
    }
    normalized = method.strip()
    if normalized in legacy_names:
        return legacy_names[normalized]
    if normalized and any("\u4e00" <= char <= "\u9fff" for char in normalized):
        return normalized
    return None


def _method_fit_note(intent: str) -> str:
    if _is_driver_intent(intent):
        return "方法匹配说明：当前问题属于驱动因素下钻，策略已从趋势描述切换为候选因素筛选、多维下钻、相关性与效应量排序、混杂与稳定性校验，不直接沿用上一轮趋势分析方法。"
    if _is_trend_intent(intent) and _is_contribution_intent(intent):
        return "方法匹配说明：当前问题同时要求趋势与贡献识别，采用时间趋势拆解、维度对比和贡献下钻。"
    if _is_trend_intent(intent):
        return "方法匹配说明：当前问题属于趋势分析，优先采用时间序列拆解与分组对比。"
    return "方法匹配说明：当前策略依据问题目标、可用字段和匹配的策略资产动态生成。"


def _default_strategy_template() -> StrategyTemplate:
    return StrategyTemplate(
        id="builtin_complex_analysis",
        project_id="builtin",
        title="复杂业务数据诊断策略",
        source="builtin",
        markdown=(
            "# 复杂业务数据诊断策略\n"
            "- 先确认数据范围、口径和质量。\n"
            "- 再完成指标映射、趋势拆解、维度对比、贡献钻取、跨数据集一致性检查和业务结论。\n"
        ),
        methods=[
            "确认分析范围并检查数据完整性与质量",
            "明确指标口径并映射到可用数据字段",
            "按时间拆解目标指标的变化趋势",
            "对关键业务维度进行分组比较",
            "计算各分组贡献并定位异常项",
            "检查跨数据集连接关系与口径一致性",
            "汇总业务结论、支持证据与风险限制",
        ],
    )


def _field_type(assets: List[Asset], field_name: str) -> str | None:
    for asset in assets:
        if not asset.data_dictionary:
            continue
        for column in asset.data_dictionary.columns:
            if column.name == field_name:
                return column.logical_type
    return None
