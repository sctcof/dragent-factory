from __future__ import annotations

from typing import Any, Dict, List, Protocol

from packages.shared_types.models import Asset


class RagClient(Protocol):
    def index_asset(self, asset: Asset) -> List[Dict[str, Any]]:
        ...

    def retrieve(self, query: str, assets: List[Asset], limit: int = 8) -> List[Dict[str, Any]]:
        ...

    def ensure_kb(self, kind: str, name: str) -> str:
        ...
