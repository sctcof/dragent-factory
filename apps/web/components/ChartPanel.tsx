"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { ChartConfig } from "../lib/api";

export function ChartPanel({ chart }: { chart: ChartConfig }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || chart.type === "table" || chart.type === "metric") return;
    const instance = echarts.init(ref.current);
    const xField = chart.x_field || Object.keys(chart.dataset[0] || {})[0];
    const yField = chart.y_fields[0] || Object.keys(chart.dataset[0] || {})[1];
    const yFields = chart.y_fields.length ? chart.y_fields : [yField];
    const isScatter = chart.type === "scatter";
    const xValues = chart.dataset.map((row) => String(row[xField] ?? ""));
    if (chart.type === "pie") {
      instance.setOption({
        title: { text: chart.title, left: 8, top: 8, textStyle: { fontSize: 14, fontWeight: 650 } },
        tooltip: { trigger: "item", formatter: "{b}<br/>{c}（{d}%）" },
        legend: { type: "scroll", bottom: 4 },
        series: [{
          type: "pie",
          radius: ["35%", "65%"],
          center: ["50%", "48%"],
          data: chart.dataset.map((row) => ({ name: String(row[xField] ?? ""), value: Number(row[yField] ?? 0) })),
          label: { formatter: "{b}: {d}%" }
        }]
      });
    } else if (chart.type === "heatmap") {
      const heatmapData = yFields.flatMap((field, yIndex) =>
        chart.dataset.map((row, xIndex) => [xIndex, yIndex, Number(row[field] ?? 0)])
      );
      const maxValue = Math.max(1, ...heatmapData.map((item) => Number(item[2])));
      instance.setOption({
        title: { text: chart.title, left: 8, top: 8, textStyle: { fontSize: 14, fontWeight: 650 } },
        tooltip: {
          formatter: (params: { value: [number, number, number] }) =>
            `${xValues[params.value[0]]}<br/>${yFields[params.value[1]]}：${params.value[2].toLocaleString()}`
        },
        grid: { left: 92, right: 72, top: 58, bottom: 62 },
        xAxis: { type: "category", data: xValues, splitArea: { show: true }, axisLabel: { rotate: xValues.length > 12 ? 35 : 0 } },
        yAxis: { type: "category", data: yFields, splitArea: { show: true } },
        visualMap: { min: 0, max: maxValue, calculable: true, orient: "vertical", right: 8, top: 70 },
        series: [{ type: "heatmap", data: heatmapData, label: { show: yFields.length <= 4 && xValues.length <= 15 } }]
      });
    } else {
      const seriesType = chart.type === "line" || chart.type === "bar" || chart.type === "scatter" ? chart.type : "bar";
      instance.setOption({
        title: { text: chart.title, left: 8, top: 8, textStyle: { fontSize: 14, fontWeight: 650 } },
        tooltip: { trigger: isScatter ? "item" : "axis" },
        legend: { show: yFields.length > 1, top: 32 },
        grid: { left: 76, right: 22, top: yFields.length > 1 ? 76 : 58, bottom: 42 },
        xAxis: { type: "category", data: xValues },
        yAxis: { type: "value", axisLabel: { formatter: (value: number) => value.toLocaleString() } },
        series: yFields.map((field) => ({
          name: field,
          type: seriesType,
          data: isScatter
            ? chart.dataset.map((row) => [String(row[xField] ?? ""), Number(row[field] ?? 0)])
            : chart.dataset.map((row) => Number(row[field] ?? 0)),
          smooth: chart.type === "line",
          symbolSize: isScatter ? 9 : 6,
        }))
      });
    }
    const resize = () => instance.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      instance.dispose();
    };
  }, [chart]);

  if (chart.type === "metric") {
    const row = chart.dataset[0] || {};
    const value = Object.values(row).find((item) => typeof item === "number") ?? Object.values(row)[0] ?? "-";
    return (
      <div className="metricTile">
        <span>{chart.title}</span>
        <strong>{String(value)}</strong>
        {chart.insight ? <small>{chart.insight}</small> : null}
      </div>
    );
  }

  if (chart.type === "table") {
    return <DataTable rows={chart.dataset} />;
  }

  return (
    <div className="chartShell">
      <div ref={ref} className="chartCanvas" />
      {chart.insight ? <p className="insight">{chart.insight}</p> : null}
    </div>
  );
}

export function DataTable({ rows }: { rows: Array<Record<string, string | number>> }) {
  const columns = Object.keys(rows[0] || {});
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 30).map((row, index) => (
            <tr key={index}>{columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
