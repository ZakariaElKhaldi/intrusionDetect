import type { Alert, Severity } from "../../types";

export type IdentityQuality = "address" | "port-only" | "unknown";

export interface TopologyNode {
  id: string;
  endpoint: string;
  label: string;
  alertCount: number;
  unresolvedCount: number;
  highestSeverity: Severity;
  protocols: string[];
  lastSeen: string;
  identityQuality: IdentityQuality;
  alertIds: string[];
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  sourceEndpoint: string;
  targetEndpoint: string;
  alertCount: number;
  unresolvedCount: number;
  highestSeverity: Severity;
  protocols: string[];
  lastSeen: string;
  alertIds: string[];
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  hasLimitedIdentity: boolean;
}

const severityRank: Record<Severity, number> = {
  normal: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function highestSeverity(left: Severity, right: Severity): Severity {
  return severityRank[right] > severityRank[left] ? right : left;
}

export function isElevated(severity: Severity): boolean {
  return severity === "high" || severity === "critical";
}

export function identityQuality(endpoint: string): IdentityQuality {
  const value = endpoint.trim();
  if (!value || value === "-" || /^unknown$/i.test(value) || /^n\/a$/i.test(value)) return "unknown";
  if (/^(?:port[:\s-]*)?\d{1,5}$/i.test(value)) return "port-only";
  return "address";
}

function nodeId(endpoint: string): string {
  return `node:${endpoint}`;
}

function edgeId(source: string, target: string): string {
  return `edge:${encodeURIComponent(source)}>${encodeURIComponent(target)}`;
}

function moreRecent(left: string, right: string): string {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}

export function aggregateTopology(alerts: Alert[]): TopologyGraph {
  const nodes = new Map<string, TopologyNode>();
  const edges = new Map<string, TopologyEdge>();

  const addNode = (endpoint: string, alert: Alert) => {
    const normalized = endpoint.trim() || "Unknown endpoint";
    const id = nodeId(normalized);
    const current = nodes.get(id);
    const unresolved = alert.status !== "resolved" ? 1 : 0;
    if (!current) {
      nodes.set(id, {
        id,
        endpoint: normalized,
        label: normalized,
        alertCount: 1,
        unresolvedCount: unresolved,
        highestSeverity: alert.severity,
        protocols: [alert.protocol],
        lastSeen: alert.timestamp,
        identityQuality: identityQuality(endpoint),
        alertIds: [alert.id],
      });
      return;
    }
    current.alertCount += 1;
    current.unresolvedCount += unresolved;
    current.highestSeverity = highestSeverity(current.highestSeverity, alert.severity);
    current.lastSeen = moreRecent(current.lastSeen, alert.timestamp);
    if (!current.protocols.includes(alert.protocol)) current.protocols.push(alert.protocol);
    if (!current.alertIds.includes(alert.id)) current.alertIds.push(alert.id);
  };

  for (const alert of alerts) {
    addNode(alert.source_ip, alert);
    addNode(alert.destination_ip, alert);

    const sourceEndpoint = alert.source_ip.trim() || "Unknown endpoint";
    const targetEndpoint = alert.destination_ip.trim() || "Unknown endpoint";
    const id = edgeId(sourceEndpoint, targetEndpoint);
    const current = edges.get(id);
    const unresolved = alert.status !== "resolved" ? 1 : 0;
    if (!current) {
      edges.set(id, {
        id,
        source: nodeId(sourceEndpoint),
        target: nodeId(targetEndpoint),
        sourceEndpoint,
        targetEndpoint,
        alertCount: 1,
        unresolvedCount: unresolved,
        highestSeverity: alert.severity,
        protocols: [alert.protocol],
        lastSeen: alert.timestamp,
        alertIds: [alert.id],
      });
      continue;
    }
    current.alertCount += 1;
    current.unresolvedCount += unresolved;
    current.highestSeverity = highestSeverity(current.highestSeverity, alert.severity);
    current.lastSeen = moreRecent(current.lastSeen, alert.timestamp);
    if (!current.protocols.includes(alert.protocol)) current.protocols.push(alert.protocol);
    if (!current.alertIds.includes(alert.id)) current.alertIds.push(alert.id);
  }

  const sortedNodes = [...nodes.values()].map((node) => ({
    ...node,
    protocols: node.protocols.sort(),
  })).sort((a, b) => b.alertCount - a.alertCount || a.endpoint.localeCompare(b.endpoint));
  const sortedEdges = [...edges.values()].map((edge) => ({
    ...edge,
    protocols: edge.protocols.sort(),
  })).sort((a, b) => b.alertCount - a.alertCount || a.id.localeCompare(b.id));

  return {
    nodes: sortedNodes,
    edges: sortedEdges,
    hasLimitedIdentity: sortedNodes.some((node) => node.identityQuality !== "address"),
  };
}

export function topologyMembership(graph: TopologyGraph): string {
  return [
    ...graph.nodes.map((node) => node.id),
    ...graph.edges.map((edge) => edge.id),
  ].sort().join("|");
}

