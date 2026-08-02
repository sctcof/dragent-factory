"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "../lib/api";
import { PlanLaunchMenu } from "./PlanLaunchMenu";

type RecommendedQuestionsPanelProps = {
  assetIds: string[];
  initialQuestions: string[];
  busy?: boolean;
  onLaunch: (mode: "new" | "existing", sessionId?: string, questions?: string[]) => void | Promise<void>;
  onNotice?: (message: string) => void;
};

export function RecommendedQuestionsPanel({
  assetIds,
  initialQuestions,
  busy = false,
  onLaunch,
  onNotice,
}: RecommendedQuestionsPanelProps) {
  const [goal, setGoal] = useState("");
  const [questions, setQuestions] = useState<string[]>(initialQuestions);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>(
    initialQuestions.slice(0, 1)
  );
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setQuestions(initialQuestions);
    setSelectedQuestions((prev) => {
      const kept = prev.filter((item) => initialQuestions.includes(item));
      return kept.length ? kept : initialQuestions.slice(0, 1);
    });
  }, [initialQuestions]);

  function toggleQuestion(question: string) {
    setSelectedQuestions((items) =>
      items.includes(question) ? items.filter((item) => item !== question) : [...items, question]
    );
  }

  async function generateFromGoal() {
    const text = goal.trim();
    if (!assetIds.length) {
      onNotice?.("当前没有可用数据资产，无法生成问题");
      return;
    }
    setGenerating(true);
    try {
      const result = await api.generateAnalysisQuestions(text, assetIds, 8);
      setQuestions(result.questions);
      setSelectedQuestions(result.questions);
      if (result.goal_inferred || !text) {
        onNotice?.(`已基于数据集资产信息重新生成 ${result.questions.length} 个层层递进问题`);
      } else if (result.source === "llm") {
        onNotice?.(`已根据目标生成 ${result.questions.length} 个层层递进问题`);
      } else {
        onNotice?.(`已根据目标生成 ${result.questions.length} 个层层递进问题（本地规划）`);
      }
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "生成分析问题失败");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="recommendedQuestionsPanel">
      <div className="sectionHeader">
        <div>
          <h3>推荐分析问题</h3>
          <p>可输入目标生成递进问题；目标为空时将基于数据集资产信息重新生成。多选后可带入对话形成分析计划。</p>
        </div>
        <div className="buttonRow">
          <button
            type="button"
            onClick={() => setSelectedQuestions([...questions])}
            disabled={!questions.length}
          >
            全选
          </button>
          <button type="button" onClick={() => setSelectedQuestions([])} disabled={!selectedQuestions.length}>
            清空
          </button>
        </div>
      </div>

      <div className="analysisGoalRow">
        <label className="assetCreatorField">
          分析目标（可选）
          <input
            value={goal}
            placeholder="留空则按数据集资产信息重新生成；也可输入目标，例如：找出 inbound_quantity 下降原因"
            onChange={(event) => setGoal(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void generateFromGoal();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="confirmButton"
          disabled={generating || busy || !assetIds.length}
          onClick={() => void generateFromGoal()}
        >
          <Sparkles size={15} />
          {generating ? "生成中..." : goal.trim() ? "生成递进问题" : "按资产重新生成"}
        </button>
      </div>

      <div className="recommendedQuestionList">
        {questions.length ? questions.map((question, index) => {
          const checked = selectedQuestions.includes(question);
          return (
            <label key={`${index}-${question.slice(0, 24)}`} className={checked ? "selected" : undefined}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleQuestion(question)}
              />
              <span className="questionCheck" aria-hidden="true" />
              <strong>{index + 1}</strong>
              <span>{question}</span>
            </label>
          );
        }) : (
          <div className="emptyState">暂无推荐问题，可输入目标生成，或留空后按资产重新生成。</div>
        )}
      </div>

      <div className="modalActions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
        <PlanLaunchMenu
          busy={busy || generating}
          selectedCount={selectedQuestions.length}
          onLaunch={(mode, sessionId) => void onLaunch(mode, sessionId, selectedQuestions)}
        />
      </div>
    </div>
  );
}
