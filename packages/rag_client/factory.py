from __future__ import annotations

import os
from typing import Any, Callable, Optional

from .local_rag import LocalRagClient
from .ragflow_client import RagFlowClient


def create_rag_client(
    *,
    vector_backend: str | None = None,
    ragflow_base_url: str | None = None,
    ragflow_api_key: str | None = None,
    timeout_seconds: float | None = None,
    project_id: str = "p_local",
    chunk_sink: Optional[Callable[[dict[str, Any]], Any]] = None,
    kb_sink: Optional[Callable[[dict[str, Any]], Any]] = None,
):
    backend = (vector_backend or os.getenv("VECTOR_BACKEND", "local")).lower()
    base_url = ragflow_base_url if ragflow_base_url is not None else os.getenv("RAGFLOW_BASE_URL", "")
    api_key = ragflow_api_key if ragflow_api_key is not None else os.getenv("RAGFLOW_API_KEY", "")
    timeout = timeout_seconds if timeout_seconds is not None else float(os.getenv("RAGFLOW_TIMEOUT_SECONDS", "30"))

    if backend == "ragflow" and base_url:
        return RagFlowClient(
            base_url=base_url,
            api_key=api_key,
            timeout_seconds=timeout,
            project_id=project_id,
            chunk_sink=chunk_sink,
            kb_sink=kb_sink,
        )
    return LocalRagClient()
