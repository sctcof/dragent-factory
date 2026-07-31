from __future__ import annotations

from typing import Any, Dict, List

from packages.shared_types.models import Asset


class LocalRagClient:
    """Local deterministic RAG adapter with the same contract as a RAGFlow client."""

    def index_asset(self, asset: Asset) -> List[Dict[str, Any]]:
        if not asset.data_dictionary:
            return []
        chunks = []
        dictionary = asset.data_dictionary
        chunks.append(
            {
                "id": f"{asset.id}:schema",
                "kb_kind": "dict",
                "asset_id": asset.id,
                "text": f"{asset.name} has {dictionary.row_count} rows and columns: "
                + ", ".join(column.name for column in dictionary.columns),
            }
        )
        for column in dictionary.columns:
            chunks.append(
                {
                    "id": f"{asset.id}:column:{column.name}",
                    "kb_kind": "dict",
                    "asset_id": asset.id,
                    "text": f"Column {column.name} type={column.logical_type} unique={column.unique_count}",
                }
            )
        return chunks

    def retrieve(self, query: str, assets: List[Asset], limit: int = 8) -> List[Dict[str, Any]]:
        terms = {term.lower() for term in query.replace("_", " ").split() if len(term) > 1}
        candidates: List[Dict[str, Any]] = []
        for asset in assets:
            for chunk in self.index_asset(asset):
                text = chunk["text"].lower()
                score = sum(1 for term in terms if term in text)
                if score or not terms:
                    candidates.append({**chunk, "score": score})
        if not candidates:
            for asset in assets:
                for chunk in self.index_asset(asset):
                    candidates.append({**chunk, "score": 0})
        return sorted(candidates, key=lambda item: item["score"], reverse=True)[:limit]
