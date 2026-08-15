"use client";

import { useEffect, useState } from "react";
import { Archive, ArrowLeft, BarChart3, Check, Copy, MessageSquare, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { api, type Session } from "../../lib/api";

function sessionHref(session: Session) {
  return session.kind === "report"
    ? `/report-studio?session_id=${session.id}`
    : `/workspace?session_id=${session.id}`;
}

function SessionRow({
  session,
  busy,
  editing,
  titleDraft,
  onStartRename,
  onCancelRename,
  onTitleDraft,
  onSaveRename,
  onClose,
  onClone,
  onRemove,
}: {
  session: Session;
  busy: boolean;
  editing: boolean;
  titleDraft: string;
  onStartRename: () => void;
  onCancelRename: () => void;
  onTitleDraft: (value: string) => void;
  onSaveRename: () => void;
  onClose: () => void;
  onClone: () => void;
  onRemove: () => void;
}) {
  const isReport = session.kind === "report";
  const openLabel = session.archived_at ? "查看" : isReport ? "继续编排" : "继续对话";
  return (
    <article className="assetTableRow sessionListRow">
      <div className="sessionListMain">
        {editing ? (
          <div className="sessionTitleEdit">
            <input
              autoFocus
              value={titleDraft}
              disabled={busy}
              maxLength={80}
              placeholder="输入会话名称"
              aria-label="编辑会话名称"
              onChange={(event) => onTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSaveRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
            />
            <button type="button" className="confirmButton" disabled={busy || !titleDraft.trim()} title="保存名称" onClick={onSaveRename}>
              <Check size={15} /> 保存
            </button>
            <button type="button" disabled={busy} title="取消" onClick={onCancelRename}>
              <X size={15} /> 取消
            </button>
          </div>
        ) : (
          <div className="sessionTitleView">
            <a href={sessionHref(session)}>
              <strong>
                {session.title}
                <em className={`sessionKindBadge ${isReport ? "report" : "chat"}`}>
                  {isReport ? "报表型" : "对话型"}
                </em>
              </strong>
              <span>最近活跃 {session.last_active_at?.slice(0, 10) || "-"}</span>
            </a>
            <button
              type="button"
              className="sessionRenameButton"
              disabled={busy}
              title="编辑会话名称"
              aria-label={`编辑会话名称：${session.title}`}
              onClick={onStartRename}
            >
              <Pencil size={14} />
            </button>
          </div>
        )}
      </div>
      <small>{session.archived_at ? "已关闭 · 只读" : "可继续"}</small>
      <div className="rowActions">
        {!session.archived_at ? (
          <button disabled={busy || editing} onClick={onClose}><Archive size={15} /> 关闭</button>
        ) : (
          <button disabled={busy || editing} onClick={onClone}><Copy size={15} /> 复制继续</button>
        )}
        <a className="linkButton" href={sessionHref(session)}>{openLabel}</a>
        <button className="dangerButton" disabled={busy} onClick={onRemove}>
          <Trash2 size={15} /> 删除
        </button>
      </div>
    </article>
  );
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [notice, setNotice] = useState("加载中");
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setNotice("加载中");
    try {
      const result = await api.listSessions("all");
      setSessions(result.items);
      setNotice("就绪");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "会话加载失败");
    }
  }

  function startRename(session: Session) {
    setEditingSessionId(session.id);
    setTitleDraft(session.title || "");
  }

  function cancelRename() {
    setEditingSessionId(null);
    setTitleDraft("");
  }

  async function saveRename(sessionId: string) {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setNotice("会话名称不能为空");
      return;
    }
    setBusySessionId(sessionId);
    try {
      const updated = await api.updateSession(sessionId, { title: nextTitle });
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setEditingSessionId(null);
      setTitleDraft("");
      setNotice("会话名称已更新");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "重命名失败");
    } finally {
      setBusySessionId(null);
    }
  }

  async function closeSession(sessionId: string) {
    setBusySessionId(sessionId);
    try {
      const updated = await api.updateSession(sessionId, { archived: true });
      setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setNotice("会话已关闭");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "关闭会话失败");
    } finally {
      setBusySessionId(null);
    }
  }

  async function removeSession(sessionId: string, title: string) {
    if (!window.confirm(`确认删除会话「${title}」？删除后将不再出现在历史列表中。`)) return;
    setBusySessionId(sessionId);
    try {
      await api.deleteSession(sessionId);
      setSessions((items) => items.filter((item) => item.id !== sessionId));
      if (editingSessionId === sessionId) cancelRename();
      setNotice("会话已删除");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除会话失败");
    } finally {
      setBusySessionId(null);
    }
  }

  async function cloneSession(session: Session) {
    setBusySessionId(session.id);
    setNotice("正在复制会话上下文");
    try {
      const cloned = await api.cloneSession(session.id, `${session.title} 续聊`);
      window.location.href = session.kind === "report"
        ? `/report-studio?session_id=${cloned.id}`
        : `/workspace?session_id=${cloned.id}`;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "复制会话失败");
      setBusySessionId(null);
    }
  }

  const reportSessions = sessions.filter((session) => session.kind === "report");
  const chatSessions = sessions.filter((session) => session.kind !== "report");

  return (
    <main className="detailPage">
      <header className="detailTopbar">
        <a className="linkButton" href="/workspace"><ArrowLeft size={16} /> 返回对话</a>
        <button onClick={refresh}><RefreshCw size={16} /> 刷新</button>
      </header>

      <section className="detailHero">
        <div>
          <MessageSquare size={28} />
          <h1>会话列表</h1>
          <p>{sessions.length} 个会话 · 报表型 {reportSessions.length} · 对话型 {chatSessions.length} · {notice}</p>
        </div>
      </section>

      <section className="detailPanel">
        <h2><BarChart3 size={17} /> 报表型会话</h2>
        <p className="sessionGroupHint">由「报表生成舱」创建，点击后回到生成舱继续编排图表报告。</p>
        <div className="assetTable">
          {reportSessions.map((session) => {
            const busy = busySessionId === session.id;
            const editing = editingSessionId === session.id;
            return (
              <SessionRow
                key={session.id}
                session={session}
                busy={busy}
                editing={editing}
                titleDraft={titleDraft}
                onStartRename={() => startRename(session)}
                onCancelRename={cancelRename}
                onTitleDraft={setTitleDraft}
                onSaveRename={() => void saveRename(session.id)}
                onClose={() => void closeSession(session.id)}
                onClone={() => void cloneSession(session)}
                onRemove={() => void removeSession(session.id, session.title)}
              />
            );
          })}
          {!reportSessions.length ? <div className="emptyChoice">暂无报表型会话，可在工作台点击「新增报表」创建</div> : null}
        </div>
      </section>

      <section className="detailPanel">
        <h2><MessageSquare size={17} /> 对话型会话</h2>
        <p className="sessionGroupHint">工作台多轮分析会话，点击后回到对话界面继续分析。</p>
        <div className="assetTable">
          {chatSessions.map((session) => {
            const busy = busySessionId === session.id;
            const editing = editingSessionId === session.id;
            return (
              <SessionRow
                key={session.id}
                session={session}
                busy={busy}
                editing={editing}
                titleDraft={titleDraft}
                onStartRename={() => startRename(session)}
                onCancelRename={cancelRename}
                onTitleDraft={setTitleDraft}
                onSaveRename={() => void saveRename(session.id)}
                onClose={() => void closeSession(session.id)}
                onClone={() => void cloneSession(session)}
                onRemove={() => void removeSession(session.id, session.title)}
              />
            );
          })}
          {!chatSessions.length ? <div className="emptyChoice">暂无对话型会话</div> : null}
        </div>
      </section>
    </main>
  );
}
