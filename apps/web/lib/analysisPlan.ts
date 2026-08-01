const PLAN_PREFIX = "dragent_analysis_plan:";

export function saveAnalysisPlan(questions: string[]): string {
  const cleaned = questions.map((item) => item.trim()).filter(Boolean);
  const key = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(`${PLAN_PREFIX}${key}`, JSON.stringify(cleaned));
  }
  return key;
}

export function loadAnalysisPlan(key: string): string[] {
  if (typeof window === "undefined" || !key) return [];
  try {
    const raw = window.sessionStorage.getItem(`${PLAN_PREFIX}${key}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}
