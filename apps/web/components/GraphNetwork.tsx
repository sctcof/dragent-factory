"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

type GraphNode = {
  id?: string;
  label?: string;
  type?: string;
  logical_type?: string;
  [key: string]: unknown;
};

type GraphEdge = {
  source?: string;
  target?: string;
  type?: string;
  [key: string]: unknown;
};

const TYPE_STYLE: Record<string, { color: string; size: number; category: string }> = {
  Collection: { color: "#dc2626", size: 70, category: "Collection" },
  Dataset: { color: "#2563eb", size: 58, category: "Dataset" },
  Table: { color: "#0f766e", size: 50, category: "Table" },
  Column: { color: "#64748b", size: 38, category: "Column" },
  Metric: { color: "#b45309", size: 44, category: "Metric" },
  Assertion: { color: "#7c3aed", size: 42, category: "Assertion" },
  Evidence: { color: "#16a34a", size: 36, category: "Evidence" }
};

export function GraphNetwork({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const instance = echarts.init(ref.current);
    const graphNodes = nodes.map((node) => {
      const type = String(node.type || "Node");
      const style = TYPE_STYLE[type] || { color: "#475569", size: 36, category: type };
      return {
        id: String(node.id),
        name: String(node.label || node.id),
        value: String(node.id),
        category: style.category,
        symbolSize: style.size,
        itemStyle: { color: style.color },
        label: { show: true, formatter: "{b}", fontSize: 12 },
        tooltip: {
          formatter: [
            `<strong>${String(node.label || node.id)}</strong>`,
            `类型：${type}`,
            node.logical_type ? `字段类型：${String(node.logical_type)}` : "",
            `ID：${String(node.id)}`
          ].filter(Boolean).join("<br/>")
        }
      };
    });
    const graphLinks = edges
      .filter((edge) => edge.source && edge.target)
      .map((edge) => ({
        source: String(edge.source),
        target: String(edge.target),
        value: String(edge.type || "RELATES"),
        label: { show: true, formatter: String(edge.type || ""), fontSize: 10, color: "#64748b" },
        lineStyle: { color: "#94a3b8", width: 1.4, curveness: 0.08 },
        tooltip: { formatter: `${String(edge.source)}<br/>${String(edge.type || "RELATES")}<br/>${String(edge.target)}` }
      }));
    const categories = Array.from(new Set(graphNodes.map((node) => node.category))).map((name) => ({ name }));

    instance.setOption({
      tooltip: { confine: true },
      legend: {
        top: 8,
        left: 8,
        data: categories.map((category) => category.name),
        textStyle: { color: "#64748b" }
      },
      series: [
        {
          type: "graph",
          layout: "force",
          data: graphNodes,
          links: graphLinks,
          categories,
          roam: true,
          draggable: true,
          edgeSymbol: ["none", "arrow"],
          edgeSymbolSize: [0, 8],
          force: {
            repulsion: 260,
            gravity: 0.08,
            edgeLength: [80, 180],
            friction: 0.28
          },
          emphasis: {
            focus: "adjacency",
            lineStyle: { width: 3 }
          }
        }
      ]
    });
    const resize = () => instance.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      instance.dispose();
    };
  }, [nodes, edges]);

  return <div className="graphNetworkCanvas" ref={ref} />;
}
