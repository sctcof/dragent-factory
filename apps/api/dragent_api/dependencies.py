from __future__ import annotations

from .config import (
    DATABASE_URL,
    DRAGENT_STORE,
    NEO4J_PASSWORD,
    NEO4J_URI,
    NEO4J_USER,
    PROJECT_ID,
    RAGFLOW_API_KEY,
    RAGFLOW_BASE_URL,
    RAGFLOW_TIMEOUT_SECONDS,
    REDIS_URL,
    VECTOR_BACKEND,
)
from .storage import JsonRepository, ObjectStore


def _build_repo():
    if DRAGENT_STORE == "postgres":
        try:
            from .postgres_repo import PostgresRepository

            return PostgresRepository(DATABASE_URL)
        except Exception:
            # Fall back to JSON when Postgres is unreachable during local boot.
            return JsonRepository()
    return JsonRepository()


repo = _build_repo()
objects = ObjectStore()


def _chunk_sink(item):
    if hasattr(repo, "upsert_chunk"):
        repo.upsert_chunk(item)


def _kb_sink(item):
    if hasattr(repo, "upsert_knowledge_base"):
        repo.upsert_knowledge_base(item)


def get_rag_client():
    from packages.rag_client import create_rag_client

    return create_rag_client(
        vector_backend=VECTOR_BACKEND,
        ragflow_base_url=RAGFLOW_BASE_URL,
        ragflow_api_key=RAGFLOW_API_KEY,
        timeout_seconds=RAGFLOW_TIMEOUT_SECONDS,
        project_id=PROJECT_ID,
        chunk_sink=_chunk_sink,
        kb_sink=_kb_sink,
    )


def get_cache():
    from packages.cache_client import get_cache as _get_cache

    return _get_cache(REDIS_URL)


def get_graph_store():
    from packages.graph_store import get_graph_store as _get_graph_store

    return _get_graph_store(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
