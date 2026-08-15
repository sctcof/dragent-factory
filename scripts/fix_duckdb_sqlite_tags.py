#!/usr/bin/env python3
"""为 DuckDB / Ecommerce SQLite 资产补打数据源类型和业务域标签."""
import json
import urllib.request
import urllib.error

BASE = "http://localhost:8000"


def api_call(method, path, payload=None):
    url = f"{BASE}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    assets = api_call("GET", "/api/assets")
    datasources = api_call("GET", "/api/datasources")
    ds_map = {ds["id"]: ds for ds in datasources}

    tag_rules = {
        # Ecommerce SQLite
        "ds_69b505b0a840": ["SQLite", "电商"],
        # Ecommerce DuckDB
        "ds_66dec4a6c65a": ["DuckDB", "电商"],
    }

    batches = []
    for asset in assets:
        ds_id = asset.get("datasource_id")
        rules = tag_rules.get(ds_id)
        if not rules:
            continue
        current = set(asset.get("tags") or [])
        missing = [t for t in rules if t not in current]
        if missing:
            batches.append(asset["id"])
            print(f"will tag {asset['id']} {asset.get('name')!r} -> +{missing}")

    if not batches:
        print("no assets need tagging")
        return

    # Add tags in two batch calls so each group gets the right tags
    for ds_id, tags in tag_rules.items():
        asset_ids = [
            a["id"]
            for a in assets
            if a.get("datasource_id") == ds_id and not set(tags).issubset(set(a.get("tags") or []))
        ]
        if not asset_ids:
            continue
        result = api_call(
            "POST",
            "/api/assets/tags/batch",
            {"asset_ids": asset_ids, "tags": tags, "mode": "add"},
        )
        print(f"{ds_id} +{tags}: updated {result.get('updated_count')} assets")


if __name__ == "__main__":
    main()
