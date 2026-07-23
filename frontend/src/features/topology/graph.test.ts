import { describe, expect, it } from "vitest";
import type { Alert } from "../../types";
import { aggregateTopology, identityQuality, topologyMembership } from "./graph";

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "a-1",
    timestamp: "2026-07-23T10:00:00Z",
    attack_type: "Scanning",
    confidence: 0.9,
    severity: "medium",
    source_ip: "10.0.0.2",
    destination_ip: "10.0.0.3",
    protocol: "TCP",
    status: "new",
    ...overrides,
  };
}

describe("aggregateTopology", () => {
  it("aggregates directed routes and endpoint evidence", () => {
    const graph = aggregateTopology([
      alert(),
      alert({
        id: "a-2",
        timestamp: "2026-07-23T10:05:00Z",
        severity: "critical",
        protocol: "HTTP",
        status: "resolved",
      }),
      alert({
        id: "a-3",
        source_ip: "10.0.0.3",
        destination_ip: "10.0.0.2",
        severity: "high",
      }),
    ]);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);
    const forward = graph.edges.find((edge) => edge.sourceEndpoint === "10.0.0.2");
    expect(forward).toMatchObject({
      alertCount: 2,
      unresolvedCount: 1,
      highestSeverity: "critical",
      protocols: ["HTTP", "TCP"],
      lastSeen: "2026-07-23T10:05:00Z",
    });
    expect(graph.nodes.find((node) => node.endpoint === "10.0.0.2")).toMatchObject({
      alertCount: 3,
      unresolvedCount: 2,
      highestSeverity: "critical",
    });
  });

  it("marks port-only and missing identities without inventing devices", () => {
    const graph = aggregateTopology([
      alert({ source_ip: "port:443", destination_ip: "" }),
    ]);

    expect(graph.hasLimitedIdentity).toBe(true);
    expect(graph.nodes.map((node) => node.identityQuality).sort()).toEqual(["port-only", "unknown"]);
    expect(identityQuality("8080")).toBe("port-only");
    expect(identityQuality("host-a")).toBe("address");
  });

  it("keeps membership stable when only aggregate values change", () => {
    const first = aggregateTopology([alert()]);
    const updated = aggregateTopology([alert(), alert({ id: "a-2", severity: "critical" })]);
    expect(topologyMembership(updated)).toBe(topologyMembership(first));
  });

  it("handles malformed dates and empty data", () => {
    const graph = aggregateTopology([
      alert({ timestamp: "not-a-date" }),
      alert({ id: "a-2", timestamp: "2026-07-23T11:00:00Z" }),
    ]);
    expect(graph.edges[0].lastSeen).toBe("2026-07-23T11:00:00Z");
    expect(aggregateTopology([])).toEqual({ nodes: [], edges: [], hasLimitedIdentity: false });
  });
});

