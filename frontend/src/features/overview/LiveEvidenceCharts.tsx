import {
  area,
  bisector,
  curveMonotoneX,
  line,
  max,
  scaleBand,
  scaleLinear,
  scaleTime,
  stack,
  timeFormat,
} from "d3";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DashboardSummary, SensorStatus } from "../../types";

type TimelineRow = DashboardSummary["severity_timeline"][number];
type SeverityKey = "critical" | "high" | "medium" | "low";

const severityKeys: SeverityKey[] = ["low", "medium", "high", "critical"];
const severityColors: Record<SeverityKey, string> = {
  critical: "#8f2d13",
  high: "#e94b16",
  medium: "#b98461",
  low: "#8b8983",
};

function useChartWidth(minimum = 320) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(minimum, Math.round(node.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [minimum]);

  return { ref, width };
}

function intervalLabel(row: TimelineRow) {
  const when = new Date(row.bucket_start);
  return `${when.toLocaleString()}: ${row.total} alerts; ${row.critical} critical, ${row.high} high, ${row.medium} medium, ${row.low} low`;
}

export function SeverityTimelineChart({ rows, bucketMinutes, onSelect }: {
  rows: TimelineRow[];
  bucketMinutes: number;
  onSelect: (start: string, bucketMinutes?: number) => void;
}) {
  const { ref, width } = useChartWidth();
  const [activeStart, setActiveStart] = useState<string | null>(null);
  const height = 244;
  const margin = { top: 18, right: 14, bottom: 36, left: 42 };
  const innerHeight = height - margin.top - margin.bottom;
  const plotWidth = width - margin.left - margin.right;

  const chart = useMemo(() => {
    const x = scaleBand<string>()
      .domain(rows.map((row) => row.bucket_start))
      .range([margin.left, width - margin.right])
      .paddingInner(rows.length > 48 ? 0.08 : 0.2)
      .paddingOuter(0.05);
    const ceiling = max(rows, (row) => row.total) ?? 0;
    const y = scaleLinear()
      .domain([0, Math.max(1, ceiling)])
      .nice()
      .range([height - margin.bottom, margin.top]);
    const series = stack<TimelineRow>().keys(severityKeys).value((row, key) => row[key as SeverityKey])(rows);
    const yTicks = y.ticks(Math.min(5, Math.max(1, ceiling))).filter(Number.isInteger);
    const labelCount = Math.max(2, Math.min(6, Math.floor(plotWidth / 92)));
    const labelStep = Math.max(1, Math.ceil(rows.length / labelCount));
    const xTicks = rows.filter((_, index) => index % labelStep === 0 || index === rows.length - 1);
    return { x, y, series, yTicks, xTicks };
  }, [plotWidth, rows, width]);

  const active = rows.find((row) => row.bucket_start === activeStart) ?? null;
  const formatTick = timeFormat(bucketMinutes >= 1440 ? "%b %-d" : bucketMinutes >= 60 ? "%H:%M" : "%H:%M");

  return <div className="d3-chart" ref={ref}>
    <div className="chart-readout" aria-live="polite">
      {active ? <><strong>{new Date(active.bucket_start).toLocaleString()}</strong><span>{active.total} total · {active.critical} critical · {active.high} high · {active.medium} medium · {active.low} low</span></> : <><strong>Explore an interval</strong><span>Hover or focus a bar for exact counts; select it to open matching alerts.</span></>}
    </div>
    <svg className="d3-chart-svg" viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Stacked alert counts across ${rows.length} persisted time buckets`}>
      <title>Alert activity by severity</title>
      <desc>Stacked bars show the number of low, medium, high, and critical alerts in each persisted time bucket.</desc>
      <g className="d3-grid" aria-hidden="true">
        {chart.yTicks.map((tick) => <line key={tick} x1={margin.left} x2={width - margin.right} y1={chart.y(tick)} y2={chart.y(tick)}/>) }
      </g>
      <g className="d3-y-axis" aria-hidden="true">
        {chart.yTicks.map((tick) => <g key={tick} transform={`translate(0,${chart.y(tick)})`}><text x={margin.left - 9} dy="0.32em">{tick}</text></g>)}
        <text className="d3-axis-title" x={margin.left} y={11}>ALERTS</text>
      </g>
      <g className="d3-series" aria-hidden="true">
        {chart.series.flatMap((series) => series.map((point, index) => {
          const row = rows[index];
          const barWidth = chart.x.bandwidth();
          const y = chart.y(point[1]);
          const barHeight = Math.max(0, chart.y(point[0]) - y);
          return <rect key={`${series.key}-${row.bucket_start}`} className="d3-severity-bar" x={chart.x(row.bucket_start)} y={y} width={barWidth} height={barHeight} fill={severityColors[series.key as SeverityKey]}/>;
        }))}
      </g>
      <g className="d3-hit-targets">
        {rows.map((row) => <rect
          key={row.bucket_start}
          x={chart.x(row.bucket_start)}
          y={margin.top}
          width={Math.max(2, chart.x.bandwidth())}
          height={innerHeight}
          role="button"
          tabIndex={row.total ? 0 : -1}
          aria-label={`${intervalLabel(row)}. Open matching alerts.`}
          onMouseEnter={() => setActiveStart(row.bucket_start)}
          onMouseLeave={() => setActiveStart(null)}
          onFocus={() => setActiveStart(row.bucket_start)}
          onBlur={() => setActiveStart(null)}
          onClick={() => row.total && onSelect(row.bucket_start, bucketMinutes)}
          onKeyDown={(event) => {
            if (row.total && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              onSelect(row.bucket_start, bucketMinutes);
            }
          }}
        />)}
      </g>
      <g className="d3-x-axis" aria-hidden="true">
        <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom}/>
        {chart.xTicks.map((row) => <text key={row.bucket_start} x={(chart.x(row.bucket_start) ?? 0) + chart.x.bandwidth() / 2} y={height - 13}>{formatTick(new Date(row.bucket_start))}</text>)}
      </g>
    </svg>
  </div>;
}

interface PacketLoadSample {
  at: Date;
  packetsPerSecond: number | null;
  dropsPerSecond: number | null;
  totalPackets: number;
  totalDrops: number;
}

const packetLoadStorageKey = "sentinel-packet-load-history-v1";

interface StoredPacketLoadHistory {
  sensorKey: string;
  samples: Array<Omit<PacketLoadSample, "at"> & { at: string }>;
}

function readPacketLoadHistory(): { sensorKey: string; samples: PacketLoadSample[] } {
  try {
    const raw = window.sessionStorage.getItem(packetLoadStorageKey);
    if (!raw) return { sensorKey: "", samples: [] };
    const stored = JSON.parse(raw) as Partial<StoredPacketLoadHistory>;
    if (typeof stored.sensorKey !== "string" || !Array.isArray(stored.samples)) throw new Error("Invalid packet history");
    const samples = stored.samples.flatMap((sample) => {
      const at = new Date(sample.at);
      const valid = Number.isFinite(at.getTime())
        && (sample.packetsPerSecond === null || Number.isFinite(sample.packetsPerSecond))
        && (sample.dropsPerSecond === null || Number.isFinite(sample.dropsPerSecond))
        && Number.isFinite(sample.totalPackets)
        && Number.isFinite(sample.totalDrops);
      return valid ? [{ ...sample, at } as PacketLoadSample] : [];
    }).sort((left, right) => left.at.getTime() - right.at.getTime()).slice(-36);
    const newest = samples.at(-1)?.at.getTime();
    return {
      sensorKey: stored.sensorKey,
      samples: newest === undefined ? [] : samples.filter((sample) => newest - sample.at.getTime() <= 2 * 60_000),
    };
  } catch {
    window.sessionStorage.removeItem(packetLoadStorageKey);
    return { sensorKey: "", samples: [] };
  }
}

function sensorIdentity(status: SensorStatus) {
  const sensor = status.sensors[0];
  return sensor ? `${sensor.sensor_id}|${sensor.interface ?? ""}` : "aggregate";
}

export function LivePacketLoadChart({ status }: { status: SensorStatus | null }) {
  const { ref, width } = useChartWidth();
  const gradientId = useId().replaceAll(":", "");
  const restored = useRef<ReturnType<typeof readPacketLoadHistory> | null>(null);
  if (restored.current === null) restored.current = readPacketLoadHistory();
  const sensorKey = useRef(restored.current.sensorKey);
  const [samples, setSamples] = useState<PacketLoadSample[]>(restored.current.samples);
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const height = 238;
  const margin = { top: 18, right: 16, bottom: 34, left: 48 };

  useEffect(() => {
    // A null status is also used while the first request is in flight. Keeping
    // the short session history here prevents a refresh from erasing the chart.
    if (!status) return;
    const at = new Date(status.checked_at);
    if (!Number.isFinite(at.getTime())) return;
    setSamples((current) => {
      const nextSensorKey = sensorIdentity(status);
      const matchingSensor = !sensorKey.current || sensorKey.current === nextSensorKey;
      sensorKey.current = nextSensorKey;
      const history = matchingSensor ? current : [];
      const previous = history.at(-1);
      if (previous?.at.getTime() === at.getTime()) return history;
      const elapsed = previous ? (at.getTime() - previous.at.getTime()) / 1_000 : 0;
      const packetDelta = previous ? status.aggregate.packets - previous.totalPackets : 0;
      const dropDelta = previous ? status.aggregate.capture_drops - previous.totalDrops : 0;
      const comparable = Boolean(previous && elapsed > 0 && packetDelta >= 0 && dropDelta >= 0);
      const next: PacketLoadSample = {
        at,
        packetsPerSecond: comparable ? packetDelta / elapsed : null,
        dropsPerSecond: comparable ? dropDelta / elapsed : null,
        totalPackets: status.aggregate.packets,
        totalDrops: status.aggregate.capture_drops,
      };
      if (elapsed < 0) return [next];
      return [...history, next].filter((sample) => at.getTime() - sample.at.getTime() <= 2 * 60_000).slice(-36);
    });
  }, [status]);

  useEffect(() => {
    try {
      const stored: StoredPacketLoadHistory = {
        sensorKey: sensorKey.current,
        samples: samples.map((sample) => ({ ...sample, at: sample.at.toISOString() })),
      };
      window.sessionStorage.setItem(packetLoadStorageKey, JSON.stringify(stored));
    } catch {
      // Charting remains functional when browser storage is unavailable.
    }
  }, [samples]);

  const measured = samples.filter((sample): sample is PacketLoadSample & { packetsPerSecond: number; dropsPerSecond: number } => sample.packetsPerSecond !== null && sample.dropsPerSecond !== null);
  const chart = useMemo(() => {
    const now = samples.at(-1)?.at ?? new Date();
    const first = samples.at(0)?.at ?? new Date(now.getTime() - 30_000);
    const domainStart = first.getTime() === now.getTime() ? new Date(now.getTime() - 30_000) : first;
    const x = scaleTime().domain([domainStart, now]).range([margin.left, width - margin.right]);
    const ceiling = max(measured, (sample) => Math.max(sample.packetsPerSecond, sample.dropsPerSecond)) ?? 0;
    const y = scaleLinear().domain([0, Math.max(1, ceiling)]).nice().range([height - margin.bottom, margin.top]);
    const packetLine = line<(typeof measured)[number]>().x((sample) => x(sample.at)).y((sample) => y(sample.packetsPerSecond)).curve(curveMonotoneX);
    const dropLine = line<(typeof measured)[number]>().x((sample) => x(sample.at)).y((sample) => y(sample.dropsPerSecond)).curve(curveMonotoneX);
    const packetArea = area<(typeof measured)[number]>().x((sample) => x(sample.at)).y0(y(0)).y1((sample) => y(sample.packetsPerSecond)).curve(curveMonotoneX);
    return { x, y, packetLine: packetLine(measured) ?? "", dropLine: dropLine(measured) ?? "", packetArea: packetArea(measured) ?? "", yTicks: y.ticks(4).filter((tick) => tick >= 0) };
  }, [measured, samples, width]);

  const nearest = activeTime === null || !measured.length
    ? measured.at(-1) ?? null
    : measured[Math.min(measured.length - 1, bisector<(typeof measured)[number], number>((sample) => sample.at.getTime()).center(measured, activeTime))];
  const peak = max(measured, (sample) => sample.packetsPerSecond) ?? null;
  const currentRate = measured.at(-1)?.packetsPerSecond ?? null;
  const pathLabel = measured.length
    ? `Live packet throughput. Current ${currentRate?.toFixed(1)} packets per second; peak ${peak?.toFixed(1)} packets per second; ${status?.aggregate.capture_drops ?? 0} total capture drops.`
    : "Live packet throughput is collecting a second sensor sample to calculate a rate.";

  return <div className="d3-chart d3-load-chart" ref={ref}>
    <div className="load-chart-metrics" aria-live="polite">
      <div><span>Current rate</span><strong>{currentRate === null ? "Collecting…" : `${currentRate.toFixed(1)} pkt/s`}</strong></div>
      <div><span>2-minute peak</span><strong>{peak === null ? "—" : `${peak.toFixed(1)} pkt/s`}</strong></div>
      <div><span>Capture drops</span><strong>{status?.aggregate.capture_drops.toLocaleString() ?? "—"}</strong></div>
      <div><span>Samples</span><strong>{measured.length}</strong></div>
    </div>
    <div className="chart-readout chart-readout--load">
      {nearest ? <><strong>{nearest.at.toLocaleTimeString()}</strong><span>{nearest.packetsPerSecond.toFixed(1)} pkt/s · {nearest.dropsPerSecond.toFixed(2)} drops/s · {nearest.totalPackets.toLocaleString()} captured total</span></> : <><strong>Establishing baseline</strong><span>Two consecutive five-second sensor readings are required for an honest rate.</span></>}
    </div>
    <svg
      className="d3-chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={pathLabel}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width * width;
        setActiveTime(chart.x.invert(x).getTime());
      }}
      onPointerLeave={() => setActiveTime(null)}
    >
      <title>Live packet throughput</title>
      <desc>Packet and capture-drop rates are calculated from consecutive cumulative Suricata counters over a rolling two-minute browser window.</desc>
      <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#287857" stopOpacity="0.26"/><stop offset="1" stopColor="#287857" stopOpacity="0.02"/></linearGradient></defs>
      <g className="d3-grid" aria-hidden="true">{chart.yTicks.map((tick) => <line key={tick} x1={margin.left} x2={width - margin.right} y1={chart.y(tick)} y2={chart.y(tick)}/>)}</g>
      <g className="d3-y-axis" aria-hidden="true">
        {chart.yTicks.map((tick) => <g key={tick} transform={`translate(0,${chart.y(tick)})`}><text x={margin.left - 9} dy="0.32em">{tick}</text></g>)}
        <text className="d3-axis-title" x={margin.left} y={11}>PACKETS / SECOND</text>
      </g>
      {measured.length ? <g aria-hidden="true">
        <path className="packet-area" d={chart.packetArea} fill={`url(#${gradientId})`}/>
        <path className="packet-line" d={chart.packetLine}/>
        <path className="drop-line" d={chart.dropLine}/>
        {nearest ? <g className="load-cursor"><line x1={chart.x(nearest.at)} x2={chart.x(nearest.at)} y1={margin.top} y2={height - margin.bottom}/><circle cx={chart.x(nearest.at)} cy={chart.y(nearest.packetsPerSecond)} r="4"/></g> : null}
      </g> : null}
      <g className="d3-x-axis" aria-hidden="true">
        <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom}/>
        {chart.x.ticks(Math.max(2, Math.min(5, Math.floor(width / 150)))).map((tick) => <text key={tick.toISOString()} x={chart.x(tick)} y={height - 12}>{timeFormat("%H:%M:%S")(tick)}</text>)}
      </g>
    </svg>
    <div className="load-chart-legend" aria-hidden="true"><span className="packets">Packet rate</span><span className="drops">Capture-drop rate</span></div>
  </div>;
}
