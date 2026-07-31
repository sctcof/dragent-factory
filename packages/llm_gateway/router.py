from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, Optional, Tuple
from urllib import request

from packages.shared_types.models import AgentType, ModelConfig


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
        base_url = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")
        api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
        envelope: Dict[str, Any] = {
            "model": model,
            "prompt_chars": len(system_prompt) + len(user_prompt),
            "latency_ms": 0,
            "status": "fallback",
        }
        if model.startswith("local-") or not base_url or not api_key:
            envelope["reason"] = "外部模型网关未配置"
            return None, envelope

        payload = {
            "model": model,
            "temperature": self.config.params.get("temperature", 0.2),
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        http_request = request.Request(
            f"{base_url.rstrip('/')}/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with request.urlopen(http_request, timeout=60) as response:
                body = json.loads(response.read().decode("utf-8"))
            content = body["choices"][0]["message"]["content"].strip()
            if content.startswith("```"):
                content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            result = json.loads(content)
            envelope["status"] = "success"
            return result, envelope
        except Exception as exc:
            envelope["status"] = "fallback"
            envelope["reason"] = f"{type(exc).__name__}: {exc}"
            return None, envelope
        finally:
            envelope["latency_ms"] = int((time.perf_counter() - started) * 1000)
