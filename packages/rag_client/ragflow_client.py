from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from packages.shared_types.models import Asset

from .local_rag import LocalRagClient

logger = logging.getLogger(__name__)


class RagFlowClient:
    """HTTP client for RAGFlow with LocalRagClient fallback on transport/API errors."""

    def __init__(
        self,
        base_url: str,
        api_key: str = "",
        timeout_seconds: float = 30,
        project_id: str = "p_local",
        chunk_sink=None,
        kb_sink=None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.project_id = project_id
        self.chunk_sink = chunk_sink
        self.kb_sink = kb_sink
        self._local = LocalRagClient()
        self._kb_cache: Dict[str, str] = {}

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            headers=self._headers(),
            method=method,
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}

    def list_datasets(self) -> List[Dict[str, Any]]:
        """列出 RAGFlow 账户下的知识库（用于状态探测）。"""
        listed = self._request("GET", "/api/v1/datasets?page=1&page_size=100")
        datasets = listed.get("data") or listed.get("datasets") or []
        return datasets if isinstance(datasets, list) else []

    def ensure_kb(self, kind: str, name: str) -> str:
        if kind in self._kb_cache:
            return self._kb_cache[kind]
        # Try list datasets
        try:
            listed = self._request("GET", "/api/v1/datasets?page=1&page_size=100")
            datasets = listed.get("data", listed.get("datasets", []))
            if isinstance(datasets, dict):
                datasets = datasets.get("data", []) or datasets.get("datasets", [])
            for item in datasets or []:
                if item.get("name") == name:
                    kb_id = str(item.get("id") or item.get("dataset_id"))
                    self._kb_cache[kind] = kb_id
                    self._persist_kb(kind, name, kb_id)
                    return kb_id
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAGFlow list datasets failed: %s", exc)

        created = self._request(
            "POST",
            "/api/v1/datasets",
            {"name": name, "description": f"dragent {kind} knowledge base"},
        )
        data = created.get("data") or created
        kb_id = str(data.get("id") or data.get("dataset_id") or f"local-{kind}")
        self._kb_cache[kind] = kb_id
        self._persist_kb(kind, name, kb_id)
        return kb_id

    def _persist_kb(self, kind: str, name: str, ragflow_kb_id: str) -> None:
        if not self.kb_sink:
            return
        self.kb_sink(
            {
                "id": f"kb_{self.project_id}_{kind}",
                "project_id": self.project_id,
                "kind": kind,
                "ragflow_kb_id": ragflow_kb_id,
                "name": name,
                "meta": {"backend": "ragflow"},
            }
        )

    def index_asset(self, asset: Asset) -> List[Dict[str, Any]]:
        chunks = self._local.index_asset(asset)
        if not chunks:
            return []
        try:
            kb_id = self.ensure_kb("dict", f"dragent-{self.project_id}-dict")
            text = "\n\n".join(chunk["text"] for chunk in chunks)
            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / f"{asset.id}_dictionary.md"
                path.write_text(f"# {asset.name}\n\n{text}\n", encoding="utf-8")
                self._upload_document(kb_id, path, display_name=f"{asset.name}-dictionary.md")
            for chunk in chunks:
                if self.chunk_sink:
                    self.chunk_sink(
                        {
                            "id": chunk["id"],
                            "asset_id": asset.id,
                            "kb_id": f"kb_{self.project_id}_dict",
                            "project_id": self.project_id,
                            "text": chunk["text"],
                            "embedding_version": "ragflow",
                            "meta": {"kb_kind": chunk.get("kb_kind", "dict")},
                        }
                    )
            return chunks
        except Exception as exc:  # noqa: BLE001
            logger.warning("RAGFlow index failed, keeping local chunks only: %s", exc)
            return chunks

    def _upload_document(self, dataset_id: str, path: Path, display_name: str) -> None:
        # Prefer multipart upload when available; fall back to document create with content.
        boundary = "----dragentBoundary7MA4YWxkTrZu0gW"
        file_bytes = path.read_bytes()
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{display_name}"\r\n'
            f"Content-Type: text/markdown\r\n\r\n"
        ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.api_key}" if self.api_key else "",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
        request = Request(
            f"{self.base_url}/api/v1/datasets/{dataset_id}/documents",
            data=body,
            headers={key: value for key, value in headers.items() if value},
            method="POST",
        )
        response_body = ""
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                response_body = response.read().decode("utf-8")
        except HTTPError as exc:
            # Fallback: create document metadata endpoint used by some RAGFlow versions
            if exc.code in {404, 405}:
                self._request(
                    "POST",
                    f"/api/v1/datasets/{dataset_id}/documents",
                    {"name": display_name, "content": path.read_text(encoding="utf-8")},
                )
            else:
                raise
        # 新版 RAGFlow 上传后不会自动解析，需要显式触发 chunks 解析任务。
        document_id = self._extract_document_id(response_body)
        if document_id:
            try:
                self._request(
                    "POST",
                    f"/api/v1/datasets/{dataset_id}/chunks",
                    {"document_ids": [document_id]},
                )
            except Exception as exc:  # noqa: BLE001
                # 旧版 RAGFlow 上传即自动解析，没有该端点，忽略即可。
                logger.warning("RAGFlow start parsing failed (older API may auto-parse): %s", exc)

    @staticmethod
    def _extract_document_id(body: str) -> str:
        try:
            payload = json.loads(body or "{}")
            data = payload.get("data") or []
            items = data if isinstance(data, list) else [data]
            for item in items:
                if isinstance(item, dict):
                    document_id = item.get("id") or item.get("document_id")
                    if document_id:
                        return str(document_id)
        except (ValueError, TypeError):
            pass
        return ""

    def retrieve(self, query: str, assets: List[Asset], limit: int = 8) -> List[Dict[str, Any]]:
        asset_ids = {asset.id for asset in assets}
        try:
            kb_id = self.ensure_kb("dict", f"dragent-{self.project_id}-dict")
            payload = {
                "question": query or "数据字典",
                "dataset_ids": [kb_id],
                "top_k": max(1, min(limit, 20)),
                # 0.1/0.2 会被新版 RAGFlow 视为旧参数强制升级为 0.42，这里用 0.08 保持宽松召回。
                "similarity_threshold": 0.08,
                "vector_similarity_weight": 0.4,
            }
            result = self._request("POST", "/api/v1/retrieval", payload)
            chunks = result.get("data", {}).get("chunks") or result.get("chunks") or []
            mapped: List[Dict[str, Any]] = []
            for index, chunk in enumerate(chunks):
                content = chunk.get("content") or chunk.get("content_with_weight") or chunk.get("text") or ""
                mapped.append(
                    {
                        "id": str(chunk.get("id") or chunk.get("chunk_id") or f"ragflow:{index}"),
                        "kb_kind": "dict",
                        "asset_id": next((asset_id for asset_id in asset_ids if asset_id in content), (assets[0].id if assets else "")),
                        "text": content,
                        "score": float(chunk.get("similarity") or chunk.get("score") or 0),
                    }
                )
            if mapped:
                return mapped[:limit]
        except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as exc:
            logger.warning("RAGFlow retrieve failed, fallback to local: %s", exc)
        return self._local.retrieve(query, assets, limit=limit)
