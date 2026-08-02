import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Data-RAG-Agent",
  description: "可确认、可执行、可追溯的商业数据智能诊断工作台",
  icons: {
    icon: "/icon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
