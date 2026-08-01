from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, List

from packages.agent_graph.agents import AnalyzerAgent, CoderAgent, DataAgent, PlannerAgent, ReportAgent
from packages.llm_gateway import ModelRouter
from packages.rag_client import LocalRagClient
from packages.sandbox_client import LocalSandboxExecutor
from packages.shared_types.models import Asset, ExecutionResult, Strategy, StrategyTemplate


ProgressSink = Callable[[str, Dict[str, Any]], None]


class AgentWorkflow:
    def __init__(self, router: ModelRouter, rag: LocalRagClient, sandbox: LocalSandboxExecutor) -> None:
        self.data_agent = DataAgent()
        self.planner = PlannerAgent(rag=rag, router=router)
        self.coder = CoderAgent(router=router)
        self.analyzer = AnalyzerAgent(router=router)
        self.report_agent = ReportAgent()
        self.sandbox = sandbox

    def draft_strategy(
        self,
        strategy_id: str,
        task_id: str,
        intent: str,
        assets: List[Asset],
        strategy_templates: List[StrategyTemplate] | None = None,
        feedback_context: List[Dict[str, Any]] | None = None,
        emit: ProgressSink | None = None,
    ) -> Strategy:
        self._emit(emit, "retrieval", {"message": "读取数据字典与本地 RAG 上下文"})
        self.data_agent.describe_assets(assets)
        self._emit(emit, "strategy_draft", {"message": "Planner Agent 生成分析策略书"})
        return self.planner.plan(
            strategy_id=strategy_id,
            task_id=task_id,
            intent=intent,
            assets=assets,
            strategy_templates=strategy_templates,
            feedback_context=feedback_context,
        )

    def run_confirmed_strategy(
        self,
        execution_id: str,
        strategy: Strategy,
        assets: List[Asset],
        asset_paths: Dict[str, Path],
        emit: ProgressSink | None = None,
    ) -> Dict[str, Any]:
        self._emit(emit, "code_generation", {"message": "Coder Agent 基于确认策略生成 Python 代码"})
        code = self.coder.generate_python(strategy, assets)
        self._emit(emit, "execution", {"message": "Executor Sandbox 开始执行代码"})
        execution = self.sandbox.execute_python(
            execution_id=execution_id,
            task_id=strategy.task_id,
            code=code,
            asset_paths=asset_paths,
        )
        self._emit(emit, "analysis", {"message": "Analyzer Agent 解释执行结果并生成图表协议"})
        analysis = self.analyzer.explain(strategy, execution)
        enriched_charts = analysis.get("charts") or execution.charts
        if enriched_charts:
            execution.charts = enriched_charts
        return {"code": code, "execution": execution, "analysis": analysis}

    def rerun_code(
        self,
        execution_id: str,
        task_id: str,
        code: str,
        asset_paths: Dict[str, Path],
    ) -> ExecutionResult:
        return self.sandbox.execute_python(
            execution_id=execution_id,
            task_id=task_id,
            code=code,
            asset_paths=asset_paths,
        )

    def _emit(self, emit: ProgressSink | None, event: str, payload: Dict[str, Any]) -> None:
        if emit:
            emit(event, payload)
