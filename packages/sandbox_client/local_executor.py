from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Dict, List

from packages.shared_types.models import ChartConfig, ChartType, ExecutionResult


DISALLOWED = [
    "import sys",
    "import socket",
    "import subprocess",
    "from os",
    "from sys",
    "from socket",
    "from subprocess",
    "os.system",
    "os.remove",
    "os.rmdir",
    "os.listdir",
    "os.walk",
    "open('/",
    'open("/',
    "__import__",
    "eval(",
    "exec(",
]


class LocalSandboxExecutor:
    def execute_python(
        self,
        execution_id: str,
        task_id: str,
        code: str,
        asset_paths: Dict[str, Path],
        timeout_seconds: int = 10,
    ) -> ExecutionResult:
        violation = self._validate(code)
        if violation:
            return ExecutionResult(
                execution_id=execution_id,
                task_id=task_id,
                language="python",
                code_hash=self._hash(code),
                status="failed",
                stderr=f"Sandbox policy violation: {violation}",
            )
        started = time.perf_counter()
        with tempfile.TemporaryDirectory(prefix="dragent_sandbox_") as temp:
            temp_path = Path(temp)
            code_path = temp_path / "analysis.py"
            result_path = temp_path / "result.json"
            code_path.write_text(code, encoding="utf-8")
            env = {
                **os.environ,
                "DRAGENT_ASSETS": json.dumps({key: str(value) for key, value in asset_paths.items()}),
                "DRAGENT_RESULT_PATH": str(result_path),
                "PYTHONIOENCODING": "utf-8",
            }
            completed = subprocess.run(
                ["python3", str(code_path)],
                cwd=str(temp_path),
                env=env,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
            )
            duration = int((time.perf_counter() - started) * 1000)
            payload = {}
            if result_path.exists():
                payload = json.loads(result_path.read_text(encoding="utf-8"))
            charts = [
                ChartConfig(
                    id=chart.get("id", f"chart_{index}"),
                    type=ChartType(chart.get("type", "table")),
                    title=chart.get("title", "分析图表"),
                    x_field=chart.get("x_field"),
                    y_fields=chart.get("y_fields", []),
                    dataset=chart.get("dataset", []),
                    insight=chart.get("insight"),
                )
                for index, chart in enumerate(payload.get("charts", []), start=1)
            ]
            return ExecutionResult(
                execution_id=execution_id,
                task_id=task_id,
                language="python",
                code_hash=self._hash(code),
                stdout=completed.stdout[-12000:],
                stderr=completed.stderr[-12000:],
                duration_ms=duration,
                status="success" if completed.returncode == 0 else "failed",
                table=payload.get("table", []),
                charts=charts,
                process_steps=payload.get("process_steps", []),
                quality_table=payload.get("quality_table", []),
                lineage=[{"upstream_type": "asset", "upstream_id": asset_id} for asset_id in asset_paths],
            )

    def _validate(self, code: str) -> str | None:
        lowered = code.lower()
        for token in DISALLOWED:
            if token in lowered:
                return token
        return None

    def _hash(self, code: str) -> str:
        return hashlib.sha256(code.encode("utf-8")).hexdigest()
