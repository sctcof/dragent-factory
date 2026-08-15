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
    const toNumber = (value: string | number | undefined | null) => {
      const parsed = Number(value ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const isScatter = chart.type === "scatter";
    const xValues = chart.dataset.map((row) => String(row[xField] ?? ""));
    const valueRows = chart.dataset.map((row) => ({
      name: String(row[xField] ?? ""),
      value: toNumber(row[yField])
    }));
    if (chart.type === "pie" || chart.type === "doughnut" || chart.type === "rose") {
      instance.setOption({
        title: { text: chart.title, left: 8, top: 8, textStyle: { fontSize: 14, fontWeight: 650 } },
        tooltip: { trigger: "item", formatter: "{b}<br/>{c}（{d}%）" },
        legend: { type: "scroll", bottom: 4 },
        series: [{
          type: "pie",
          radius: chart.type === "pie" ? "62%" : ["38%", "66%"],
          center: ["50%", "48%"],
          roseType: chart.type === "rose" ? "radius" : undefined,
          data: valueRows,
          label: { formatter: "{b}: {d}%" }
        }]
      });
    } else if (chart.type === "heatmap") {
      const heatmapData = yFields.flatMap((field, yIndex) =>
        chart.dataset.map((row, xIndex) => [xIndex, yIndex, toNumber(row[field])])
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
    } else if (chart.type === "funnel") {
      instance.setOption({
        title: { text: chart.title, left: 8, top: 8, textStyle: { fontSize: 14, fontWeight: 650 } },
        tooltip: { trigger: "item", formatter: "{b}<br/>{c}" },
        legend: { type: "scroll", bottom: 4 },
        series: [{
          type: "funnel",
          left: "10%",
          top: 62,
          bottom: 42,
          width: "80%",
          minSize: "18%",
          maxSize: "90%",
          sort: "descending",
          gap: 2,
          label: { position: "inside" },
          data: valueRows,
        }]
      });
    } else if (chart.type === "treemap") {
      instance.setOption({
        title: { text: chart.title, left: 8, top: 8, textStyle: { fontSize: 14, fontWeight: 650 } },
        tooltip: { trigger: "item", formatter: "{b}<br/>{c}" },
        series: [{
          type: "treemap",
          top: 58,
          bottom: 18,
          left: 16,
          right: 16,
          roam: false,
          breadcrumb: { show: false },
          label: { show: true, formatter: "{b}" },
          data: valueRows,
        }]
      });
    } else if (chart.type === "gauge") {
      const values = chart.dataset.map((row) => toNumber(row[yField]));
      const value = values[0] ?? 0;
      const maxValue = Math.max(100, ...values, value);
      instance.setOption({
        title: { text: chart.title, left: 8, top: 8, textStyle: { fontSize: 14, fontWeight: 650 } },
        tooltip: { formatter: `${yField}<br/>{c}` },
        series: [{
          type: "gauge",
          min: 0,
          max: maxValue,
          center: ["50%", "58%"],
          radius: "76%",
          progress: { show: true, width: 14 },
          axisLine: { lineStyle: { width: 14 } },
          detail: { valueAnimation: true, formatter: (value: number) => value.toLocaleString(), fontSize: 22 },
          data: [{ name: yField, value }],
        }]
      });
    } else if (chart.type === "radar") {
      const radarFields = yFields.length > 1 ? yFields : Object.keys(chart.dataset[0] || {}).filter((field) => field !== xField).slice(0, 6);
      const indicators = radarFields.map((field) => ({
        name: field,
        max: Math.max(1, ...chart.dataset.map((row) => toNumber(row[field]))) * 1.2,
      }));
      instance.setOption({
        title: { text: chart.title, left: 8, top: 8, textStyle: { fontSize: 14, fontWeight: 650 } },
        tooltip: {},
        legend: { type: "scroll", bottom: 4 },
        radar: { indicator: indicators, center: ["50%", "52%"], radius: "58%" },
        series: [{
          type: "radar",
          data: chart.dataset.slice(0, 6).map((row) => ({
            name: String(row[xField] ?? ""),
            value: radarFields.map((field) => toNumber(row[field])),
          })),
        }]
      });
    } else {
      const isArea = chart.type === "area";
      const isStacked = chart.type === "stacked_bar";
      const isHorizontal = chart.type === "horizontal_bar";
      const seriesType = chart.type === "line" || chart.type === "bar" || chart.type === "scatter" || isArea || isStacked || isHorizontal
        ? (isArea ? "line" : isStacked || isHorizontal ? "bar" : chart.type)
        : "bar";
      instance.setOption({
        title: { text: chart.title, left: 8, top: 8, textStyle: { fontSize: 14, fontWeight: 650 } },
        tooltip: { trigger: isScatter ? "item" : "axis" },
        legend: { show: yFields.length > 1, top: 32 },
        grid: { left: isHorizontal ? 120 : 76, right: 22, top: yFields.length > 1 ? 76 : 58, bottom: 42 },
        xAxis: isHorizontal
          ? { type: "value", axisLabel: { formatter: (value: number) => value.toLocaleString() } }
          : { type: "category", data: xValues },
        yAxis: isHorizontal
          ? { type: "category", data: xValues }
          : { type: "value", axisLabel: { formatter: (value: number) => value.toLocaleString() } },
        series: yFields.map((field) => ({
          name: field,
          type: seriesType,
          data: isScatter
            ? chart.dataset.map((row) => [String(row[xField] ?? ""), toNumber(row[field])])
            : chart.dataset.map((row) => toNumber(row[field])),
          stack: isStacked ? "total" : undefined,
          areaStyle: isArea ? {} : undefined,
          smooth: chart.type === "line" || isArea,
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
