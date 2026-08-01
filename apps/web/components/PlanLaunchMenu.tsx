"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, ChevronDown, MessageSquarePlus, MessagesSquare, X } from "lucide-react";
import { api, type Session } from "../lib/api";

type PlanLaunchMenuProps = {
  disabled?: boolean;
  busy?: boolean;
  selectedCount: number;
  onLaunch: (mode: "new" | "existing", sessionId?: string) => void | Promise<void>;
};

export function PlanLaunchMenu({ disabled, busy, selectedCount, onLaunch }: PlanLaunchMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  async function openSessionPicker() {
    setMenuOpen(false);
    setPickerOpen(true);
    setLoadingSessions(true);
    try {
      const result = await api.listSessions("active");
      const items = result.items || [];
      setSessions(items);
      setSelectedSessionId(items[0]?.id || "");
    } catch {
      setSessions([]);
      setSelectedSessionId("");
    } finally {
      setLoadingSessions(false);
    }
  }

  return (
    <>
      <div className="planLaunchWrap" ref={rootRef}>
        <button
          type="button"
          className="confirmButton planLaunchButton"
          disabled={disabled || busy || selectedCount < 1}
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <BarChart3 size={16} />
          {busy ? "正在处理..." : `带入对话并按序分析（${selectedCount}）`}
          <ChevronDown size={15} />
        </button>
        {menuOpen ? (
          <div className="planLaunchMenu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void onLaunch("new");
              }}
            >
              <MessageSquarePlus size={15} />
              <span>
                <strong>新对话</strong>
                <small>创建新会话并按所选问题依次分析</small>
              </span>
            </button>
            <button type="button" role="menuitem" onClick={() => void openSessionPicker()}>
              <MessagesSquare size={15} />
              <span>
                <strong>指定对话</strong>
                <small>选择已有会话后继续按序分析</small>
              </span>
            </button>
          </div>
        ) : null}
      </div>

      {pickerOpen ? (
        <div
          className="modalBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPickerOpen(false);
          }}
        >
          <section className="reportPicker sessionPickerModal" role="dialog" aria-modal="true" aria-labelledby="session-picker-title">
            <div className="sectionHeader">
              <div>
                <h2 id="session-picker-title">选择已有对话</h2>
                <p>将把所选推荐问题作为分析计划带入该对话，并按顺序提问。</p>
              </div>
              <button type="button" className="iconOnly" onClick={() => setPickerOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="pickerList">
              {loadingSessions ? (
                <div className="emptyChoice">正在加载对话列表…</div>
              ) : sessions.length ? (
                sessions.map((session) => (
                  <label key={session.id} className="pickerCheck">
                    <input
                      type="radio"
                      name="plan-target-session"
                      checked={selectedSessionId === session.id}
                      onChange={() => setSelectedSessionId(session.id)}
                    />
                    <span>{session.title || session.id}</span>
                    <small>{session.last_active_at}</small>
                  </label>
                ))
              ) : (
                <div className="emptyChoice">暂无可用对话，请改用「新对话」。</div>
              )}
            </div>
            <div className="modalActions">
              <button type="button" onClick={() => setPickerOpen(false)}>取消</button>
              <button
                type="button"
                className="confirmButton"
                disabled={!selectedSessionId || busy}
                onClick={() => {
                  setPickerOpen(false);
                  void onLaunch("existing", selectedSessionId);
                }}
              >
                确认带入该对话
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
