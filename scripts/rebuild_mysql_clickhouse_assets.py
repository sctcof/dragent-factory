#!/usr/bin/env python3
"""为 MySQL / ClickHouse 资产重建 data_dictionary 和 graph (parse_status 从 pending -> ready)."""
from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path("/Users/guanwenzheng/Desktop/workspace/dragent-factory")
CSV_DIR = ROOT / "examples" / "ecommerce_platform" / "csv"
META_PATH = ROOT / "local_data" / "metadata.json"

# table_name -> csv filename (与 seed_ecommerce_samples.py 一致)
TABLE_FILES = {
    "suppliers": "01_suppliers.csv",
    "customers": "02_customers.csv",
    "products": "03_products.csv",
    "stores": "04_stores.csv",
    "campaigns": "05_campaigns.csv",
    "promotions": "06_promotions.csv",
    "orders": "07_orders.csv",
    "order_items": "08_order_items.csv",
    "payments": "09_payments.csv",
    "shipments": "10_shipments.csv",
    "returns": "11_returns.csv",
    "inventory_weekly": "12_inventory_weekly.csv",
    "support_tickets": "13_support_tickets.csv",
    "reviews": "14_reviews.csv",
}

DATE_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$|^\d{4}/\d{2}/\d{2}$|^\d{4}年\d{1,2}月\d{1,2}日$")
NUM_RE = re.compile(r"^-?\d+(\.\d+)?$")


def infer_logical_type(values: List[str]) -> str:
    """根据样本值猜测 logical_type: date / number / category / text."""
    samples = [v for v in values if v not in (None, "", "NULL")]
    if not samples:
        return "text"
    n_date = sum(1 for v in samples if DATE_RE.match(str(v)))
    n_num = sum(1 for v in samples if NUM_RE.match(str(v)))
    n = len(samples)
    if n_date / n >= 0.7:
        return "date"
    if n_num / n >= 0.7:
        return "number"
    # 唯一值较少 (相对样本) 视作 category
    if len(set(samples)) <= max(20, n // 5):
        return "category"
    return "text"


def to_number(v: str) -> Optional[float]:
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def build_column_profile(table_name: str, col_name: str, rows: List[Dict[str, str]]) -> Dict[str, Any]:
    values = [r.get(col_name, "") for r in rows]
    non_null = [v for v in values if v not in (None, "", "NULL")]
    null_count = len(values) - len(non_null)
    unique_vals = list(dict.fromkeys(non_null))  # 保序去重
    unique_count = len(unique_vals)
    sample_values = unique_vals[:5]

    ltype = infer_logical_type(non_null)
    min_value: Any = None
    max_value: Any = None
    if ltype == "number":
        nums = [to_number(v) for v in non_null]
        nums = [n for n in nums if n is not None]
        if nums:
            min_value = min(nums)
            max_value = max(nums)
    elif ltype == "date":
        if non_null:
            min_value = min(non_null)
            max_value = max(non_null)

    return {
        "name": col_name,
        "logical_type": ltype,
        "null_count": null_count,
        "unique_count": unique_count,
        "sample_values": sample_values,
        "min_value": min_value,
        "max_value": max_value,
        "sensitive": False,
    }


def build_metrics(columns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """为所有 numeric 列生成 sum 度量."""
    metrics = []
    for col in columns:
        if col["logical_type"] == "number":
            metrics.append({
                "name": col["name"],
                "formula": f"sum({col['name']})",
                "derived_from": [col["name"]],
            })
    return metrics


def build_graph(asset_id: str, asset_name: str, table_name: str, columns: List[Dict[str, Any]]) -> Dict[str, Any]:
    nodes = [
        {"id": f"dataset:{asset_id}", "type": "Dataset", "label": asset_name},
        {"id": f"table:{asset_id}:{table_name}", "type": "Table", "label": table_name},
    ]
    for col in columns:
        nodes.append({
            "id": f"column:{asset_id}:{col['name']}",
            "type": "Column",
            "label": col["name"],
            "logical_type": col["logical_type"],
        })
    return {"nodes": nodes, "edges": []}


def load_csv(table: str) -> List[Dict[str, str]]:
    fp = CSV_DIR / TABLE_FILES[table]
    # 用 utf-8-sig 处理 BOM
    with open(fp, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main() -> None:
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    assets = meta.get("assets", {})
    updated = 0
    by_kind: Dict[str, int] = {}

    for a in assets.values():
        ds_id = a.get("datasource_id")
        if ds_id not in ("ds_9e90e08b2b98", "ds_b440aeabb67c"):
            continue
        if a.get("parse_status") != "pending":
            continue
        # 从 asset name 末尾提取 table 名: "电商样例 · MySQL / payments" -> "payments"
        name = a.get("name", "")
        if " / " not in name:
            continue
        table = name.rsplit(" / ", 1)[-1].strip()
        if table not in TABLE_FILES:
            print(f"[skip] unknown table: {table} ({a['id']})")
            continue

        rows = load_csv(table)
        if not rows:
            print(f"[skip] empty CSV: {table}")
            continue

        col_names = list(rows[0].keys())
        columns = [build_column_profile(table, c, rows) for c in col_names]
        row_count = len(rows)
        metrics = build_metrics(columns)

        # 兼容原命名规则: MySQL/ClickHouse 的 table_name 直接用表名
        a["parse_status"] = "ready"
        a["data_dictionary"] = {
            "asset_id": a["id"],
            "asset_name": name,
            "table_name": table,
            "row_count": row_count,
            "columns": columns,
            "metrics": metrics,
            "supporting_ids": [f"{a['id']}:schema", f"{a['id']}:profile"],
        }
        # 更新 metrics 加入 supporting_ids
        for m in metrics:
            m["supporting_ids"] = [f"{a['id']}:column:{m['derived_from'][0]}"]
        a["graph"] = build_graph(a["id"], name, table, columns)

        kind = "MySQL" if ds_id == "ds_9e90e08b2b98" else "ClickHouse"
        by_kind[kind] = by_kind.get(kind, 0) + 1
        updated += 1
        print(f"[ok] {kind} {a['id']} {table}: rows={row_count}, cols={len(columns)}")

    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nTotal updated: {updated}")
    for k, v in by_kind.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()