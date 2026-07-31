"use client";

import { useEffect, useState } from "react";
import { Archive, ArrowLeft, Copy, MessageSquare, RefreshCw, Trash2 } from "lucide-react";
import { api, type Session } from "../../lib/api";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [notice, setNotice] = useState("加载中");
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

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
      window.location.href = `/?session_id=${cloned.id}`;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "复制会话失败");
      setBusySessionId(null);
    }
  }

  return (
    <main className="detailPage">
      <header className="detailTopbar">
        <a className="linkButton" href="/"><ArrowLeft size={16} /> 返回对话</a>
        <button onClick={refresh}><RefreshCw size={16} /> 刷新</button>
      </header>

      <section className="detailHero">
        <div>
          <MessageSquare size={28} />
          <h1>会话列表</h1>
          <p>{sessions.length} 个会话 · {notice}</p>
        </div>
      </section>

      <section className="detailPanel">
        <h2>历史会话</h2>
        <div className="assetTable">
          {sessions.map((session) => (
            <article key={session.id} className="assetTableRow">
              <a href={`/?session_id=${session.id}`}>
                <strong>{session.title}</strong>
                <span>最近活跃 {session.last_active_at?.slice(0, 10) || "-"}</span>
              </a>
              <small>{session.archived_at ? "已关闭 · 只读" : "可继续"}</small>
              <div className="rowActions">
                {!session.archived_at ? (
                  <button disabled={busySessionId === session.id} onClick={() => closeSession(session.id)}><Archive size={15} /> 关闭</button>
                ) : (
                  <button disabled={busySessionId === session.id} onClick={() => cloneSession(session)}><Copy size={15} /> 复制继续</button>
                )}
                <a className="linkButton" href={`/?session_id=${session.id}`}>{session.archived_at ? "查看" : "继续对话"}</a>
                <button className="dangerButton" disabled={busySessionId === session.id} onClick={() => removeSession(session.id, session.title)}><Trash2 size={15} /> 删除</button>
              </div>
            </article>
          ))}
          {!sessions.length ? <div className="emptyChoice">暂无历史会话</div> : null}
        </div>
      </section>
    </main>
  );
}
