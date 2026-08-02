"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, FileText, RefreshCw, Trash2 } from "lucide-react";
import { api, type Report } from "../../lib/api";

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [notice, setNotice] = useState("加载中");

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    const result = await api.listReports();
    setReports(result.items);
    setNotice("就绪");
  }

  async function remove(reportId: string) {
    await api.deleteReport(reportId);
    setReports((items) => items.filter((item) => item.id !== reportId));
    setNotice("报告已删除");
  }

  return (
    <main className="detailPage">
      <header className="detailTopbar">
        <a className="linkButton" href="/workspace"><ArrowLeft size={16} /> 返回对话</a>
        <button onClick={refresh}><RefreshCw size={16} /> 刷新</button>
      </header>

      <section className="detailHero">
        <div>
          <FileText size={28} />
          <h1>报告列表</h1>
          <p>{reports.length} 份报告 · {notice}</p>
        </div>
      </section>

      <section className="detailPanel">
        <h2>历史报告</h2>
        <div className="assetTable">
          {reports.map((report) => (
            <article key={report.id} className="assetTableRow">
              <a href={`/reports/${report.id}`}>
                <strong>{report.title}</strong>
                <span>版本 {report.versions?.length || 0} · {report.created_at?.slice(0, 10) || "-"}</span>
              </a>
              <small>{report.status || "ready"}</small>
              <button onClick={() => remove(report.id)}><Trash2 size={15} /> 删除</button>
            </article>
          ))}
          {!reports.length ? <div className="emptyChoice">暂无历史报告</div> : null}
        </div>
      </section>
    </main>
  );
}
