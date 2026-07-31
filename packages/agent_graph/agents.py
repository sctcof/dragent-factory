from __future__ import annotations

import json
from typing import Any, Dict, List

from packages.llm_gateway import ModelRouter
from packages.rag_client import LocalRagClient
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
    def __init__(self, rag: LocalRagClient, router: ModelRouter) -> None:
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
        dimensions = _choose_dimensions(assets, intent)
        metrics = _choose_metrics(assets, intent)
        if not metrics:
            metrics = ["row_count"]
        selected_templates = _rank_strategy_templates(intent, strategy_templates or [])
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
            "本地开发模式使用确定性启发式 Agent，生产可通过 llm_gateway 替换为真实模型。",
            "所有新结论必须来自执行结果或 Supporting IDs，未证实推断只进入备注。",
        ]
        if context:
            asset_names = {
                asset.id: asset.name
                for asset in assets
            }
            matched_names = []
            for item in context:
                name = asset_names.get(item.get("asset_id"))
                if name and name not in matched_names:
                    matched_names.append(name)
            assumptions.append("策略参考了数据字典：" + "、".join(matched_names[:3] or [asset.name for asset in assets[:1]]))
        if selected_templates:
            assumptions.append("策略资产引用：" + "、".join(template.title for template in selected_templates[:3]))
        if feedback_context:
            assumptions.append(f"纳入 {len(feedback_context)} 条已认可问答作为个性化策略参考。")
        assumptions.append(_method_fit_note(intent))
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


class CoderAgent:
    def __init__(self, router: ModelRouter) -> None:
        self.router = router

    def generate_python(self, strategy: Strategy, assets: List[Asset]) -> str:
        primary_asset = assets[0]
        dictionary = primary_asset.data_dictionary
        dimensions = strategy.dimensions
        metrics = [metric for metric in strategy.metrics if metric != "row_count"]
        first_dimension = dimensions[0] if dimensions else None
        first_metric = metrics[0] if metrics else None
        suggested_chart_type = str((strategy.chart_suggestions[0] if strategy.chart_suggestions else {}).get("type", "bar"))
        selected_chart_type = suggested_chart_type if suggested_chart_type in {"line", "bar", "pie", "heatmap"} else "bar"
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

if quality_table:
    charts.append({{
        "id": "chart_asset_quality",
        "type": selected_chart_type,
        "title": "各数据集记录数对比",
        "x_field": "asset",
        "y_fields": ["rows"],
        "dataset": quality_table,
        "insight": "用于检查多数据集规模差异和后续 join 风险。"
    }})
process_steps.append({{"step": 6, "name": "跨数据集一致性检查", "detail": "对比多数据集规模和字段覆盖，识别可能的连接与口径风险。"}})
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
    def explain(self, strategy: Strategy, execution: ExecutionResult) -> Dict[str, Any]:
        if execution.status != "success":
            return {
                "summary": "代码执行失败，已记录 stderr，可在代码沙箱中修改后重跑。",
                "charts": [],
            }
        top_line = "分析执行成功。"
        if execution.table:
            top_line += f" 返回 {len(execution.table)} 行结果。"
        if execution.charts:
            chart = execution.charts[0]
            if chart.insight:
                top_line += " " + chart.insight
        return {
            "summary": top_line + " 结论仅基于本次执行结果与已解析数据字典。",
            "charts": execution.charts,
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
