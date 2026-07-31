"use client";

import { ArrowRight } from "lucide-react";

export function StrategyFlow({ methods }: { methods: string[] }) {
  const steps = methods.length ? methods : ["数据范围确认", "指标口径定义", "趋势与贡献分析", "结论生成"];
  return (
    <div className="strategyFlow">
      {steps.map((method, index) => (
        <div className="flowStepWrap" key={`${method}-${index}`}>
          <div className="flowStep">
            <span>{index + 1}</span>
            <strong>{formatMethod(method)}</strong>
          </div>
          {index < steps.length - 1 ? <ArrowRight className="flowArrow" size={18} /> : null}
        </div>
      ))}
    </div>
  );
}

function formatMethod(method: string) {
  const legacyNames: Record<string, string> = {
    "1_data_scope_and_quality_check": "确认分析范围并检查数据完整性与质量",
    "2_metric_definition_and_field_mapping": "明确指标口径并映射到可用数据字段",
    "2_target_metric_definition_and_field_mapping": "明确目标指标口径，并映射到可用数据字段",
    "3_time_trend_decomposition": "按时间拆解目标指标的变化趋势",
    "4_dimension_group_comparison": "对关键业务维度进行分组比较",
    "5_contribution_and_outlier_drilldown": "计算各分组贡献，并定位主要贡献项与异常项",
    "6_cross_dataset_consistency_check": "检查跨数据集连接关系与口径一致性",
    "7_business_summary_and_risk_notes": "汇总业务结论、支持证据与风险限制",
    "8_segment_ranking": "按照关键业务分组进行影响排序",
    "9_multi_metric_correlation_hint": "分析多个指标之间的联动关系",
    "3_candidate_driver_field_screening": "筛选可能影响目标指标的候选因素",
    "4_multidimensional_drilldown": "按关键业务维度逐层下钻",
    "5_correlation_and_effect_size_ranking": "比较候选因素的相关强度与影响幅度",
    "6_confounder_and_stability_validation": "校验混杂因素及结论稳定性",
    "7_direct_driver_ranking_and_evidence": "按证据强弱排列最直接的影响因素",
  };
  return legacyNames[method.trim()] || method.trim();
}
