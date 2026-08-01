#!/usr/bin/env python3
"""Generate ecommerce transaction sample CSVs (14 tables) for multi-DB seeding."""

from __future__ import annotations

import csv
import random
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

SEED = 20260801
random.seed(SEED)
ROOT = Path(__file__).resolve().parent

REGIONS = ["华东", "华北", "华南", "华中", "西南", "东北"]
CHANNELS = ["直播", "电商", "门店", "经销商", "企业采购"]
CATEGORIES = [
    "智能小家电", "厨房电器", "生活电器", "个护健康",
    "影音娱乐", "智能家居", "数码配件", "办公设备",
]
SEGMENTS = ["高价值", "成长型", "价格敏感", "沉睡", "新客"]
BRANDS = [f"品牌{index:02d}" for index in range(1, 21)]
WAREHOUSES = {region: f"W{index:02d}" for index, region in enumerate(REGIONS, start=1)}

# Demo-friendly scale; still enough for multi-round analytics.
N_CUSTOMERS = 2000
N_PRODUCTS = 200
N_STORES = 60
N_SUPPLIERS = 40
N_ORDERS = 12000


def write_csv(name: str, rows: list[dict]) -> None:
    if not rows:
        raise ValueError(f"{name} has no rows")
    path = ROOT / "csv" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def month_range() -> list[str]:
    months = []
    year, month = 2025, 8
    for _ in range(12):
        months.append(f"{year:04d}-{month:02d}")
        month += 1
        if month == 13:
            year += 1
            month = 1
    return months


MONTHS = month_range()
START_DATE = date(2025, 8, 1)
END_DATE = date(2026, 7, 31)
DATES = [START_DATE + timedelta(days=offset) for offset in range((END_DATE - START_DATE).days + 1)]


def build_suppliers() -> list[dict]:
    rows = []
    for index in range(1, N_SUPPLIERS + 1):
        rows.append({
            "supplier_id": f"S{index:03d}",
            "supplier_name": f"供应商{index:02d}",
            "region": REGIONS[(index - 1) % len(REGIONS)],
            "contact_name": f"联系人{index:02d}",
            "lead_days": random.randint(3, 21),
            "rating": round(random.uniform(3.2, 4.9), 1),
            "active": random.choice(["是", "是", "是", "否"]),
        })
    return rows


def build_customers() -> tuple[list[dict], dict[str, list[str]]]:
    rows = []
    by_region: dict[str, list[str]] = defaultdict(list)
    for index in range(1, N_CUSTOMERS + 1):
        customer_id = f"C{index:06d}"
        region = random.choices(REGIONS, weights=[24, 19, 18, 15, 13, 11])[0]
        rows.append({
            "customer_id": customer_id,
            "region": region,
            "city_tier": random.choices(["一线", "新一线", "二线", "三线及以下"], weights=[16, 24, 34, 26])[0],
            "segment": random.choices(SEGMENTS, weights=[12, 27, 25, 16, 20])[0],
            "signup_month": random.choice(MONTHS),
            "age_group": random.choice(["18-24", "25-34", "35-44", "45-54", "55+"]),
            "member_level": random.choices(["普通", "银卡", "金卡", "黑金"], weights=[45, 28, 20, 7])[0],
            "acquisition_source": random.choice(["自然搜索", "内容种草", "直播引流", "线下活动", "老客推荐"]),
        })
        by_region[region].append(customer_id)
    return rows, by_region


def build_products(suppliers: list[dict]) -> tuple[list[dict], dict[str, dict], dict[str, list[str]]]:
    rows = []
    by_id: dict[str, dict] = {}
    by_category: dict[str, list[str]] = defaultdict(list)
    supplier_ids = [item["supplier_id"] for item in suppliers]
    for index in range(1, N_PRODUCTS + 1):
        product_id = f"P{index:05d}"
        category = CATEGORIES[(index - 1) % len(CATEGORIES)]
        base_price = {
            "智能小家电": 899, "厨房电器": 1299, "生活电器": 699, "个护健康": 499,
            "影音娱乐": 1899, "智能家居": 1099, "数码配件": 199, "办公设备": 1599,
        }[category]
        list_price = round(base_price * random.uniform(0.55, 1.65), 2)
        row = {
            "product_id": product_id,
            "product_name": f"{category}-{index:03d}",
            "category": category,
            "brand": BRANDS[(index * 7) % len(BRANDS)],
            "list_price": list_price,
            "unit_cost": round(list_price * random.uniform(0.48, 0.72), 2),
            "launch_month": random.choice(MONTHS[:8]),
            "lifecycle_stage": random.choices(["新品", "成长", "成熟", "尾货"], weights=[16, 30, 45, 9])[0],
            "supplier_id": supplier_ids[(index - 1) % len(supplier_ids)],
        }
        rows.append(row)
        by_id[product_id] = row
        by_category[category].append(product_id)
    return rows, by_id, by_category


def build_stores() -> tuple[list[dict], dict[str, list[str]]]:
    rows = []
    by_region: dict[str, list[str]] = defaultdict(list)
    for index in range(1, N_STORES + 1):
        store_id = f"ST{index:04d}"
        region = REGIONS[(index - 1) % len(REGIONS)]
        rows.append({
            "store_id": store_id,
            "store_name": f"{region}经营单元{index:03d}",
            "region": region,
            "city": f"{region}城市{(index % 12) + 1:02d}",
            "store_type": random.choice(["旗舰店", "标准店", "社区店", "仓店一体"]),
            "primary_channel": random.choice(CHANNELS),
            "open_date": (date(2021, 1, 1) + timedelta(days=random.randint(0, 1500))).isoformat(),
            "floor_area_sqm": random.randint(80, 1200),
            "staff_count": random.randint(5, 48),
        })
        by_region[region].append(store_id)
    return rows, by_region


def build_campaigns() -> tuple[list[dict], dict[tuple[str, str, str], str]]:
    rows = []
    lookup = {}
    sequence = 1
    for month in MONTHS:
        for region in REGIONS:
            for channel in CHANNELS:
                campaign_id = f"MKT{sequence:05d}"
                sequence += 1
                spend = round(random.uniform(65000, 220000), 2)
                impressions = int(spend * random.uniform(8.5, 13.5))
                clicks = int(impressions * random.uniform(0.025, 0.065))
                leads = int(clicks * random.uniform(0.12, 0.28))
                rows.append({
                    "campaign_id": campaign_id,
                    "month": month,
                    "region": region,
                    "channel": channel,
                    "campaign_theme": random.choice(["新品首发", "会员增长", "节日大促", "内容种草", "清仓转化"]),
                    "spend": spend,
                    "impressions": impressions,
                    "clicks": clicks,
                    "leads": leads,
                    "attributed_orders": int(leads * random.uniform(0.18, 0.42)),
                    "target_roi": random.choice([2.5, 3.0, 3.5, 4.0]),
                })
                lookup[(month, region, channel)] = campaign_id
    return rows, lookup


def build_promotions() -> tuple[list[dict], dict[tuple[str, str], list[dict]]]:
    rows = []
    lookup: dict[tuple[str, str], list[dict]] = defaultdict(list)
    sequence = 1
    for month in MONTHS:
        for category in CATEGORIES:
            for promo_type in ["满减", "直降", "会员券"]:
                promotion_id = f"PR{sequence:05d}"
                sequence += 1
                discount_rate = random.choice([0.05, 0.08, 0.10, 0.15, 0.20, 0.25])
                row = {
                    "promotion_id": promotion_id,
                    "month": month,
                    "category": category,
                    "promotion_type": promo_type,
                    "discount_rate": discount_rate,
                    "coupon_cost_share": random.choice([0.3, 0.5, 0.7, 1.0]),
                    "min_purchase_amount": random.choice([0, 199, 399, 699, 999]),
                    "promotion_goal": random.choice(["拉新", "促活", "提升客单", "清库存"]),
                }
                rows.append(row)
                lookup[(month, category)].append(row)
    return rows, lookup


def build_transactions(
    customers_by_region: dict[str, list[str]],
    products: dict[str, dict],
    products_by_category: dict[str, list[str]],
    stores_by_region: dict[str, list[str]],
    campaign_lookup: dict[tuple[str, str, str], str],
    promotion_lookup: dict[tuple[str, str], list[dict]],
) -> tuple[list[dict], list[dict], list[dict], list[dict], list[dict], list[dict], list[dict]]:
    month_factor = {
        "2025-08": 0.78, "2025-09": 0.84, "2025-10": 0.91, "2025-11": 1.08,
        "2025-12": 1.32, "2026-01": 0.92, "2026-02": 0.82, "2026-03": 1.04,
        "2026-04": 1.12, "2026-05": 1.08, "2026-06": 0.95, "2026-07": 0.86,
    }
    region_weight = {"华东": 1.35, "华北": 1.12, "华南": 1.08, "华中": 0.92, "西南": 0.82, "东北": 0.70}
    channel_weight = {"直播": 1.22, "电商": 1.35, "门店": 1.0, "经销商": 0.78, "企业采购": 0.55}
    slots = []
    weights = []
    for day in DATES:
        month = day.strftime("%Y-%m")
        for region in REGIONS:
            for channel in CHANNELS:
                slots.append((day, month, region, channel))
                weights.append(month_factor[month] * region_weight[region] * channel_weight[channel])

    orders = []
    order_items = []
    payments = []
    shipments = []
    returns = []
    tickets = []
    reviews = []
    carriers = ["顺达", "迅联", "京速", "云仓配", "城际专线"]
    return_reasons = ["物流延迟", "商品破损", "质量问题", "描述不符", "无理由退货", "尺寸/适配问题"]
    ticket_categories = ["物流咨询", "退换货", "商品质量", "促销规则", "安装使用", "发票支付"]
    sampled_slots = random.choices(slots, weights=weights, k=N_ORDERS)

    for index, (order_day, month, region, channel) in enumerate(sampled_slots, start=1):
        order_id = f"O{index:08d}"
        category = random.choice(CATEGORIES)
        product_id = random.choice(products_by_category[category])
        product = products[product_id]
        promotion = random.choice(promotion_lookup[(month, category)]) if random.random() < 0.68 else None
        discount_rate = float(promotion["discount_rate"]) if promotion else 0.0
        line_count = random.choices([1, 2, 3], weights=[70, 22, 8])[0]
        customer_id = random.choice(customers_by_region[region])
        store_id = random.choice(stores_by_region[region])
        campaign_id = campaign_lookup[(month, region, channel)]
        gross_amount = 0.0
        net_revenue = 0.0
        cost = 0.0
        total_qty = 0
        chosen_products = [product_id] + [
            random.choice(products_by_category[random.choice(CATEGORIES)]) for _ in range(line_count - 1)
        ]
        for line_no, pid in enumerate(chosen_products, start=1):
            item_product = products[pid]
            quantity = random.choices([1, 2, 3, 4], weights=[45, 30, 18, 7])[0]
            line_gross = item_product["list_price"] * quantity
            line_net = line_gross * (1 - discount_rate)
            line_cost = float(item_product["unit_cost"]) * quantity
            order_items.append({
                "order_item_id": f"OI{index:08d}{line_no:02d}",
                "order_id": order_id,
                "line_no": line_no,
                "product_id": pid,
                "quantity": quantity,
                "unit_price": item_product["list_price"],
                "discount_rate": discount_rate,
                "line_gross": round(line_gross, 2),
                "line_net": round(line_net, 2),
                "line_cost": round(line_cost, 2),
            })
            gross_amount += line_gross
            net_revenue += line_net
            cost += line_cost
            total_qty += quantity

        status = random.choices(["已完成", "已完成", "已完成", "已取消", "履约中"], weights=[78, 8, 6, 4, 4])[0]
        orders.append({
            "order_id": order_id,
            "order_date": order_day.isoformat(),
            "month": month,
            "customer_id": customer_id,
            "store_id": store_id,
            "campaign_id": campaign_id,
            "promotion_id": promotion["promotion_id"] if promotion else "",
            "region": region,
            "channel": channel,
            "item_count": line_count,
            "quantity": total_qty,
            "gross_amount": round(gross_amount, 2),
            "discount_rate": discount_rate,
            "net_revenue": round(net_revenue, 2),
            "cost": round(cost, 2),
            "gross_margin": round(net_revenue - cost, 2),
            "order_status": status,
        })

        pay_method = random.choice(["微信", "支付宝", "银行卡", "企业月结"])
        paid = status != "已取消"
        payments.append({
            "payment_id": f"PAY{index:08d}",
            "order_id": order_id,
            "payment_date": order_day.isoformat(),
            "payment_method": pay_method,
            "payment_status": "成功" if paid else "关闭",
            "paid_amount": round(net_revenue if paid else 0, 2),
            "transaction_no": f"TX{index:012d}",
        })

        if status == "已取消":
            continue

        base_days = random.choices([1, 2, 3, 4, 5, 6, 7], weights=[8, 24, 28, 18, 11, 7, 4])[0]
        promised_days = random.choice([2, 3, 4])
        delay_days = max(0, base_days - promised_days)
        shipments.append({
            "shipment_id": f"SH{index:08d}",
            "order_id": order_id,
            "warehouse_id": WAREHOUSES[region],
            "carrier": random.choice(carriers),
            "ship_date": (order_day + timedelta(days=1)).isoformat(),
            "promised_days": promised_days,
            "actual_delivery_days": base_days,
            "delay_days": delay_days,
            "shipping_cost": round(random.uniform(8, 28) + total_qty * random.uniform(1.5, 4.0), 2),
            "delivery_status": "延迟" if delay_days else "按时",
        })

        if random.random() < 0.06 + discount_rate * 0.1 + min(delay_days, 5) * 0.015:
            returned_qty = random.randint(1, max(1, total_qty))
            reason = random.choice(return_reasons)
            returns.append({
                "return_id": f"RT{len(returns) + 1:07d}",
                "order_id": order_id,
                "return_date": (order_day + timedelta(days=base_days + random.randint(1, 10))).isoformat(),
                "returned_quantity": returned_qty,
                "return_reason": reason,
                "refund_amount": round(net_revenue * returned_qty / max(total_qty, 1), 2),
                "responsibility": "物流" if reason in ["物流延迟", "商品破损"] else "商品/运营",
                "is_resalable": random.choice(["是", "是", "否"]),
            })

        if random.random() < 0.08 + min(delay_days, 5) * 0.015:
            resolution_hours = round(random.uniform(1, 36), 2)
            tickets.append({
                "ticket_id": f"TK{len(tickets) + 1:07d}",
                "customer_id": customer_id,
                "order_id": order_id,
                "created_date": (order_day + timedelta(days=random.randint(0, base_days + 5))).isoformat(),
                "ticket_category": random.choice(ticket_categories),
                "contact_channel": random.choice(["在线客服", "电话", "社交媒体", "门店"]),
                "priority": random.choices(["低", "中", "高", "紧急"], weights=[30, 45, 20, 5])[0],
                "resolution_hours": resolution_hours,
                "first_contact_resolved": "是" if resolution_hours <= 8 else "否",
                "satisfaction_score": max(1, min(5, round(5.2 - resolution_hours / 16 - delay_days * 0.25 + random.uniform(-0.7, 0.7)))),
            })

        if status == "已完成" and random.random() < 0.22:
            reviews.append({
                "review_id": f"RV{len(reviews) + 1:07d}",
                "order_id": order_id,
                "customer_id": customer_id,
                "product_id": product_id,
                "review_date": (order_day + timedelta(days=base_days + random.randint(1, 14))).isoformat(),
                "rating": random.choices([1, 2, 3, 4, 5], weights=[3, 5, 12, 35, 45])[0],
                "content_tag": random.choice(["物流快", "性价比高", "质量一般", "包装差", "客服好", "功能强"]),
                "is_anonymous": random.choice(["是", "否", "否"]),
            })

    return orders, order_items, payments, shipments, returns, tickets, reviews


def build_inventory(products: dict[str, dict]) -> list[dict]:
    rows = []
    week = START_DATE
    weeks = []
    while week <= END_DATE:
        weeks.append(week)
        week += timedelta(days=7)
    # Keep weekly inventory manageable: sample products × regions.
    sample_products = list(products.values())[::2]
    for region in REGIONS:
        for product in sample_products:
            opening = random.randint(35, 180)
            for week_start in weeks:
                month = week_start.strftime("%Y-%m")
                inbound = random.randint(15, 85)
                demand = random.randint(12, 75)
                closing = max(0, opening + inbound - demand)
                rows.append({
                    "week_start": week_start.isoformat(),
                    "month": month,
                    "warehouse_id": WAREHOUSES[region],
                    "region": region,
                    "product_id": product["product_id"],
                    "opening_stock": opening,
                    "inbound_quantity": inbound,
                    "demand_quantity": demand,
                    "closing_stock": closing,
                    "stockout_days": random.choice([0, 0, 0, 1, 2]) if closing < 12 else 0,
                    "reorder_point": 25 if product["category"] == "智能小家电" else 18,
                    "supplier_lead_days": random.randint(4, 18),
                })
                opening = closing + random.randint(0, 25)
    return rows


def main() -> None:
    suppliers = build_suppliers()
    customers, customers_by_region = build_customers()
    products, product_lookup, products_by_category = build_products(suppliers)
    stores, stores_by_region = build_stores()
    campaigns, campaign_lookup = build_campaigns()
    promotions, promotion_lookup = build_promotions()
    orders, order_items, payments, shipments, returns, tickets, reviews = build_transactions(
        customers_by_region,
        product_lookup,
        products_by_category,
        stores_by_region,
        campaign_lookup,
        promotion_lookup,
    )
    inventory = build_inventory(product_lookup)

    tables = {
        "01_suppliers.csv": suppliers,
        "02_customers.csv": customers,
        "03_products.csv": products,
        "04_stores.csv": stores,
        "05_campaigns.csv": campaigns,
        "06_promotions.csv": promotions,
        "07_orders.csv": orders,
        "08_order_items.csv": order_items,
        "09_payments.csv": payments,
        "10_shipments.csv": shipments,
        "11_returns.csv": returns,
        "12_inventory_weekly.csv": inventory,
        "13_support_tickets.csv": tickets,
        "14_reviews.csv": reviews,
    }
    for name, rows in tables.items():
        write_csv(name, rows)

    print("generated ecommerce platform sample")
    for path in sorted((ROOT / "csv").glob("*.csv")):
        with path.open("r", encoding="utf-8-sig") as handle:
            row_count = sum(1 for _ in handle) - 1
        print(f"{path.name}: {row_count}")


if __name__ == "__main__":
    main()
