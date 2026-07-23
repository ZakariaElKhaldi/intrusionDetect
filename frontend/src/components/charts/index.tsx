import { useMemo } from "react";
import type { Alert, ModelInfo } from "../../types";
import {
  aggregateDetections,
  aggregateProtocols,
  aggregateSeverityTimeline,
} from "../../lib/analytics";
import { EChart } from "./EChart";
import {
  confusionMatrixOption,
  detectionRankingOption,
  evidenceOption,
  modelComparisonOption,
  protocolDistributionOption,
  severityTimelineOption,
} from "./chartOptions";

interface ChartShellProps {
  className?: string;
  height?: number;
}

export interface SeverityTimelineChartProps extends ChartShellProps {
  alerts: Alert[];
  bucketMinutes?: number;
  onBucketSelect?: (start: string) => void;
}

export function SeverityTimelineChart({
  alerts,
  bucketMinutes = 5,
  onBucketSelect,
  className,
  height = 320,
}: SeverityTimelineChartProps) {
  const buckets = useMemo(
    () => aggregateSeverityTimeline(alerts, bucketMinutes),
    [alerts, bucketMinutes],
  );
  const option = useMemo(() => severityTimelineOption(buckets), [buckets]);
  return <EChart
    option={option}
    className={className}
    style={{ height }}
    ariaLabel="Alerts over time by severity"
    onEvents={onBucketSelect ? {
      click: (params) => {
        const start = (params as { name?: string }).name;
        if (start) onBucketSelect(start);
      },
    } : undefined}
  />;
}

export interface AlertChartProps extends ChartShellProps {
  alerts: Alert[];
}

export function ProtocolDistributionChart({
  alerts,
  className,
  height = 300,
}: AlertChartProps) {
  const data = useMemo(() => aggregateProtocols(alerts), [alerts]);
  const option = useMemo(() => protocolDistributionOption(data), [data]);
  return <EChart
    option={option}
    className={className}
    style={{ height }}
    ariaLabel="Protocols among alerts"
  />;
}

export function DetectionRankingChart({
  alerts,
  className,
  height = 360,
}: AlertChartProps) {
  const data = useMemo(() => aggregateDetections(alerts), [alerts]);
  const option = useMemo(() => detectionRankingOption(data), [data]);
  return <EChart
    option={option}
    className={className}
    style={{ height }}
    ariaLabel="Detection families ranked by alert count"
  />;
}

export interface ModelComparisonChartProps extends ChartShellProps {
  models: ModelInfo[];
}

export function ModelComparisonChart({
  models,
  className,
  height = 390,
}: ModelComparisonChartProps) {
  const option = useMemo(() => modelComparisonOption(models), [models]);
  return <EChart
    option={option}
    className={className}
    style={{ height }}
    ariaLabel="Model quality, false-positive rate, and latency comparison"
  />;
}

export interface ConfusionMatrixChartProps extends ChartShellProps {
  matrix: number[][];
  classes?: string[];
}

export function ConfusionMatrixChart({
  matrix,
  classes = [],
  className,
  height = 390,
}: ConfusionMatrixChartProps) {
  const option = useMemo(() => confusionMatrixOption(matrix, classes), [matrix, classes]);
  return <EChart
    option={option}
    className={className}
    style={{ height }}
    ariaLabel="Confusion matrix with counts and actual-class percentages"
  />;
}

export interface EvidenceChartProps extends ChartShellProps {
  evidence: NonNullable<Alert["explanations"]>;
}

export function EvidenceChart({
  evidence,
  className,
  height = 320,
}: EvidenceChartProps) {
  const option = useMemo(() => evidenceOption(evidence), [evidence]);
  return <EChart
    option={option}
    className={className}
    style={{ height }}
    ariaLabel="Signed model evidence around a zero baseline"
  />;
}

export { EChart } from "./EChart";
export * from "./chartOptions";
export { chartPalette } from "./palette";
