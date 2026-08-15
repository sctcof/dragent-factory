from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, Optional, Tuple
from urllib import error, request

from packages.shared_types.models import AgentType, ModelConfig


def resolve_llm_gateway(
    config: ModelConfig | None = None,
    model_id: str | None = None,
) -> tuple[str, str]:
    """Resolve gateway credentials: model entry → global config → process env."""
    base_url = ""
    api_key = ""
    if config is not None and model_id:
        entry = next((item for item in (config.catalog or []) if item.id == model_id), None)
        if entry is not None:
            base_url = (getattr(entry, "llm_base_url", None) or "").strip()
            api_key = (getattr(entry, "llm_api_key", None) or "").strip()
    if config is not None:
        if not base_url:
            base_url = (getattr(config, "llm_base_url", None) or "").strip()
        if not api_key:
            api_key = (getattr(config, "llm_api_key", None) or "").strip()
    if not base_url:
        base_url = (os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "").strip()
    if not api_key:
        api_key = (os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
    return base_url, api_key


def _catalog_entry(config: ModelConfig, model_id: str):
    return next((item for item in (config.catalog or []) if item.id == model_id), None)


def _is_local_model(config: ModelConfig, model_id: str) -> bool:
    entry = _catalog_entry(config, model_id)
    if entry is not None and (entry.provider or "").strip() == "local":
        return True
    return model_id.startswith("local-")


def _request_headers(base_url: str, api_key: str) -> Dict[str, str]:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    # OpenRouter 推荐附带站点标识；缺省不影响多数调用
    if "openrouter.ai" in base_url.lower():
        referer = (os.getenv("OPENROUTER_HTTP_REFERER") or "http://localhost:3000").strip()
        title = (os.getenv("OPENROUTER_APP_TITLE") or "dragent-factory").strip()
        if referer:
            headers["HTTP-Referer"] = referer
        if title:
            headers["X-Title"] = title
    return headers


def _normalize_base_url(base_url: str) -> str:
    url = (base_url or "").strip().rstrip("/")
    # DeepSeek 官方根域名需带 /v1
    if url.lower() in {"https://api.deepseek.com", "http://api.deepseek.com"}:
        url = f"{url}/v1"
    return url


def _post_chat_completions(
    base_url: str,
    api_key: str,
    payload: Dict[str, Any],
    timeout: int = 60,
) -> Dict[str, Any]:
    root = _normalize_base_url(base_url)
    http_request = request.Request(
        f"{root}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=_request_headers(root, api_key),
        method="POST",
    )
    try:
        with request.urlopen(http_request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise RuntimeError(f"HTTP {exc.code}: {detail or exc.reason}") from exc


def _parse_json_content(body: Dict[str, Any]) -> Dict[str, Any]:
    content = body["choices"][0]["message"]["content"].strip()
    if content.startswith("```"):
        content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(content)


class ModelRouter:
    def __init__(self, config: ModelConfig) -> None:
        self.config = config

    def select(self, agent_type: AgentType | str) -> str:
        key = agent_type.value if isinstance(agent_type, AgentType) else str(agent_type)
        return self.config.agents.get(key) or self.config.global_default

    def audit_envelope(self, agent_type: AgentType | str, prompt: str) -> Dict[str, Any]:
        started = time.perf_counter()
        model = self.select(agent_type)
        return {
            "model": model,
            "prompt_chars": len(prompt),
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "status": "routed",
        }

    def generate_json(
        self,
        agent_type: AgentType | str,
        system_prompt: str,
        user_prompt: str,
    ) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
        started = time.perf_counter()
        model = self.select(agent_type)
        base_url, api_key = resolve_llm_gateway(self.config, model_id=model)
        envelope: Dict[str, Any] = {
            "model": model,
            "prompt_chars": len(system_prompt) + len(user_prompt),
            "latency_ms": 0,
            "status": "fallback",
        }
        if _is_local_model(self.config, model):
            envelope["reason"] = "本地模型不走外部网关"
            return None, envelope
        if not base_url or not api_key:
            missing = []
            if not base_url:
                missing.append("LLM_BASE_URL")
            if not api_key:
                missing.append("LLM_API_KEY")
            envelope["reason"] = (
                f"模型 {model} 未配置 {' / '.join(missing)}，"
                "请在「模型管理」中编辑该模型并保存密钥"
            )
            return None, envelope

        force_json = bool(self.config.params.get("force_json_object", True))
        base_payload = {
            "model": model,
            "temperature": self.config.params.get("temperature", 0.2),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        attempts = []
        if force_json:
            attempts.append({**base_payload, "response_format": {"type": "json_object"}})
        attempts.append(base_payload)

        last_error = ""
        for index, payload in enumerate(attempts):
            try:
                body = _post_chat_completions(base_url, api_key, payload)
                result = _parse_json_content(body)
                envelope["status"] = "success"
                if index > 0:
                    envelope["note"] = "retried_without_response_format"
                envelope["latency_ms"] = int((time.perf_counter() - started) * 1000)
                return result, envelope
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"

        envelope["status"] = "fallback"
        envelope["reason"] = last_error or "未知错误"
        envelope["latency_ms"] = int((time.perf_counter() - started) * 1000)
        return None, envelope
