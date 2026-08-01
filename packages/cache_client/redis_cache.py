from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)


class RedisCache:
    """Thin Redis wrapper that degrades to no-op when Redis is unavailable."""

    def __init__(self, redis_url: str) -> None:
        self.redis_url = redis_url
        self._client = None
        self._disabled = False

    def _connect(self):
        if self._disabled:
            return None
        if self._client is not None:
            return self._client
        try:
            import redis

            client = redis.Redis.from_url(self.redis_url, decode_responses=True, socket_connect_timeout=1.5)
            client.ping()
            self._client = client
            return self._client
        except Exception as exc:  # noqa: BLE001
            logger.warning("Redis unavailable, cache disabled: %s", exc)
            self._disabled = True
            return None

    def get_json(self, key: str) -> Optional[Any]:
        client = self._connect()
        if not client:
            return None
        try:
            value = client.get(key)
            return json.loads(value) if value else None
        except Exception:  # noqa: BLE001
            return None

    def set_json(self, key: str, value: Any, ttl_seconds: int = 120) -> None:
        client = self._connect()
        if not client:
            return
        try:
            client.setex(key, ttl_seconds, json.dumps(value, ensure_ascii=False, default=str))
        except Exception:  # noqa: BLE001
            return

    def set_text(self, key: str, value: str, ttl_seconds: int = 3600) -> None:
        client = self._connect()
        if not client:
            return
        try:
            client.setex(key, ttl_seconds, value)
        except Exception:  # noqa: BLE001
            return

    def get_text(self, key: str) -> Optional[str]:
        client = self._connect()
        if not client:
            return None
        try:
            return client.get(key)
        except Exception:  # noqa: BLE001
            return None

    def ping(self) -> bool:
        client = self._connect()
        if not client:
            return False
        try:
            return bool(client.ping())
        except Exception:  # noqa: BLE001
            return False


_cache: Optional[RedisCache] = None


def get_cache(redis_url: str | None = None) -> RedisCache:
    global _cache
    if _cache is None:
        _cache = RedisCache(redis_url or os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    return _cache
