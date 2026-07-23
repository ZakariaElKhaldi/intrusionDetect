import cytoscape, { type Core, type ElementDefinition, type EventObject } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Alert } from "../../types";
import {
  aggregateTopology,
  isElevated,
  topologyMembership,
  type TopologyEdge,
  type TopologyNode,
} from "./graph";
import "./topology.css";

cytoscape.use(fcose);

export interface TopologyWorkspaceProps {
  alerts: Alert[];
  onViewAlerts: (endpoint: string) => void;
  reducedMotion?: boolean;
}

type Selection =
  | { kind: "node"; item: TopologyNode }
  | { kind: "edge"; item: TopologyEdge }
  | null;

type WindowFilter = "all" | "15m" | "1h" | "24h";

const layoutOptions = {
  name: "fcose",
  quality: "default",
  randomize: true,
  animate: false,
  nodeRepulsion: 6500,
  idealEdgeLength: 100,
  edgeElasticity: 0.35,
  nestingFactor: 0.1,
  gravity: 0.25,
  numIter: 2500,
  fit: true,
  padding: 45,
};

function filteredAlerts(
  alerts: Alert[],
  query: string,
  protocol: string,
  windowFilter: WindowFilter,
  elevatedOnly: boolean,
): Alert[] {
  const normalizedQuery = query.trim().toLowerCase();
  const windowMs = windowFilter === "15m" ? 15 * 60_000
    : windowFilter === "1h" ? 60 * 60_000
      : windowFilter === "24h" ? 24 * 60 * 60_000 : null;
  const cutoff = windowMs === null ? null : Date.now() - windowMs;

  return alerts.filter((alert) => {
    const timestamp = Date.parse(alert.timestamp);
    if (cutoff !== null && (Number.isNaN(timestamp) || timestamp < cutoff)) return false;
    if (protocol !== "all" && alert.protocol !== protocol) return false;
    if (elevatedOnly && (!isElevated(alert.severity) || alert.status === "resolved")) return false;
    if (normalizedQuery && ![
      alert.id,
      alert.source_ip,
      alert.destination_ip,
      alert.attack_type,
      alert.protocol,
    ].some((value) => value.toLowerCase().includes(normalizedQuery))) return false;
    return true;
  });
}

function elementDefinitions(nodes: TopologyNode[], edges: TopologyEdge[]): ElementDefinition[] {
  return [
    ...nodes.map((node) => ({
      group: "nodes" as const,
      data: {
        ...node,
        elevated: isElevated(node.highestSeverity) && node.unresolvedCount > 0 ? 1 : 0,
        size: Math.min(58, 28 + Math.sqrt(node.alertCount) * 7),
      },
    })),
    ...edges.map((edge) => ({
      group: "edges" as const,
      data: {
        ...edge,
        elevated: isElevated(edge.highestSeverity) && edge.unresolvedCount > 0 ? 1 : 0,
        width: Math.min(7, 1 + Math.log2(edge.alertCount + 1)),
      },
    })),
  ];
}

function formatSeen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString();
}

export function TopologyWorkspace({ alerts, onViewAlerts, reducedMotion = false }: TopologyWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const membershipRef = useRef("");
  const nodeLookupRef = useRef(new Map<string, TopologyNode>());
  const edgeLookupRef = useRef(new Map<string, TopologyEdge>());
  const [query, setQuery] = useState("");
  const [protocol, setProtocol] = useState("all");
  const [windowFilter, setWindowFilter] = useState<WindowFilter>("all");
  const [elevatedOnly, setElevatedOnly] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);

  const protocols = useMemo(
    () => [...new Set(alerts.map((alert) => alert.protocol))].sort(),
    [alerts],
  );
  const visibleAlerts = useMemo(
    () => filteredAlerts(alerts, query, protocol, windowFilter, elevatedOnly),
    [alerts, elevatedOnly, protocol, query, windowFilter],
  );
  const graph = useMemo(() => aggregateTopology(visibleAlerts), [visibleAlerts]);
  const membership = useMemo(() => topologyMembership(graph), [graph]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const edgeById = useMemo(() => new Map(graph.edges.map((edge) => [edge.id, edge])), [graph.edges]);
  nodeLookupRef.current = nodeById;
  edgeLookupRef.current = edgeById;

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      minZoom: 0.25,
      maxZoom: 2.5,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#f3f1ec",
            "border-color": "#67635d",
            "border-width": 1.5,
            color: "#171614",
            label: "data(label)",
            width: "data(size)",
            height: "data(size)",
            "font-size": 10,
            "text-valign": "bottom",
            "text-margin-y": 8,
            "text-wrap": "ellipsis",
            "text-max-width": "120px",
            opacity: 1,
          },
        },
        {
          selector: "node[elevated = 1]",
          style: {
            "border-color": "#e85a16",
            "border-width": 4,
          },
        },
        {
          selector: "edge",
          style: {
            width: "data(width)",
            "line-color": "#a9a49c",
            "target-arrow-color": "#a9a49c",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "arrow-scale": 0.75,
            opacity: 0.72,
          },
        },
        {
          selector: "edge[elevated = 1]",
          style: {
            "line-color": "#a93b08",
            "target-arrow-color": "#a93b08",
          },
        },
        {
          selector: ".dimmed",
          style: { opacity: 0.12 },
        },
        {
          selector: ".focused",
          style: {
            "border-color": "#171614",
            "border-width": 4,
            opacity: 1,
          },
        },
        {
          selector: "edge.focused",
          style: {
            "line-color": "#171614",
            "target-arrow-color": "#171614",
            opacity: 1,
          },
        },
      ],
    });

    const selectNode = (event: EventObject) => {
      const node = nodeLookupRef.current.get(event.target.id());
      if (node) setSelection({ kind: "node", item: node });
    };
    const selectEdge = (event: EventObject) => {
      const edge = edgeLookupRef.current.get(event.target.id());
      if (edge) setSelection({ kind: "edge", item: edge });
    };
    const clearSelection = (event: EventObject) => {
      if (event.target === cy) setSelection(null);
    };
    cy.on("tap", "node", selectNode);
    cy.on("tap", "edge", selectEdge);
    cy.on("tap", clearSelection);
    cyRef.current = cy;
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => cy.resize());
    resizeObserver?.observe(containerRef.current);

    return () => {
      resizeObserver?.disconnect();
      cy.removeAllListeners();
      cy.destroy();
      cyRef.current = null;
      membershipRef.current = "";
    };
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const definitions = elementDefinitions(graph.nodes, graph.edges);
    const membershipChanged = membershipRef.current !== membership;
    cy.batch(() => {
      if (membershipChanged) {
        cy.elements().remove();
        cy.add(definitions);
      } else {
        for (const definition of definitions) {
          const id = String(definition.data?.id);
          cy.getElementById(id).data(definition.data ?? {});
        }
      }
    });
    if (membershipChanged) {
      membershipRef.current = membership;
      if (definitions.length) {
        requestAnimationFrame(() => {
          if (cyRef.current !== cy) return;
          cy.resize();
          if (containerRef.current) {
            containerRef.current.dataset.graphState = `${cy.elements().length} elements at ${cy.width()}×${cy.height()}`;
          }
          const layout = cy.layout(layoutOptions as cytoscape.LayoutOptions);
          cy.one("layoutstop", () => {
            cy.fit(undefined, 45);
            cy.forceRender();
          });
          layout.run();
        });
      }
    }
  }, [graph.edges, graph.nodes, membership, reducedMotion]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("dimmed focused");
      if (!selection) return;
      const selected = cy.getElementById(selection.item.id);
      if (!selected.length) return;
      cy.elements().addClass("dimmed");
      selected.removeClass("dimmed").addClass("focused");
      if (selection.kind === "node") {
        selected.neighborhood().removeClass("dimmed");
      } else {
        selected.connectedNodes().removeClass("dimmed");
      }
    });
  }, [selection]);

  useEffect(() => {
    if (!selection) return;
    const exists = selection.kind === "node"
      ? nodeById.has(selection.item.id)
      : edgeById.has(selection.item.id);
    if (!exists) setSelection(null);
  }, [edgeById, nodeById, selection]);

  const selectNodeFromList = (node: TopologyNode) => {
    setSelection({ kind: "node", item: node });
    const element = cyRef.current?.getElementById(node.id);
    if (element?.length) cyRef.current?.animate({ center: { eles: element }, zoom: 1.15 }, { duration: reducedMotion ? 0 : 250 });
  };

  const selectEdgeFromList = (edge: TopologyEdge) => {
    setSelection({ kind: "edge", item: edge });
    const element = cyRef.current?.getElementById(edge.id);
    if (element?.length) cyRef.current?.animate({ center: { eles: element } }, { duration: reducedMotion ? 0 : 250 });
  };

  const resetLayout = () => {
    const cy = cyRef.current;
    if (!cy || !cy.elements().length) return;
    cy.layout(layoutOptions as cytoscape.LayoutOptions).run();
  };

  return <section className="topology-workspace" aria-label="Network topology investigation">
    <div className="topology-toolbar">
      <label>Search
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Endpoint, detection, protocol…" />
      </label>
      <label>Time range
        <select value={windowFilter} onChange={(event) => setWindowFilter(event.target.value as WindowFilter)}>
          <option value="all">All observed</option>
          <option value="15m">Last 15 minutes</option>
          <option value="1h">Last hour</option>
          <option value="24h">Last 24 hours</option>
        </select>
      </label>
      <label>Protocol
        <select value={protocol} onChange={(event) => setProtocol(event.target.value)}>
          <option value="all">All protocols</option>
          {protocols.map((item) => <option key={item}>{item}</option>)}
        </select>
      </label>
      <div className="topology-filter-group">
        <span>Risk</span>
        <button type="button" aria-pressed={elevatedOnly} onClick={() => setElevatedOnly((value) => !value)}>
          {elevatedOnly ? "Elevated only" : "All activity"}
        </button>
      </div>
      <span className="topology-summary" aria-live="polite">
        {graph.nodes.length} endpoints · {graph.edges.length} directed routes · {visibleAlerts.length} alerts
      </span>
    </div>

    {graph.hasLimitedIdentity && <p className="topology-identity-notice" role="note">
      Some records identify endpoints by port or do not include an address. These nodes are limited observations, not confirmed devices.
    </p>}

    <div className="topology-main">
      <div className="topology-graph-panel">
        <div className="topology-actions" aria-label="Map controls">
          <button type="button" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.2)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.2)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => cyRef.current?.fit(undefined, 40)} aria-label="Fit graph">Fit</button>
          <button type="button" onClick={resetLayout} aria-label="Reset graph layout">↻</button>
        </div>
        <div
          ref={containerRef}
          className="topology-graph"
          role="img"
          aria-label={`Directed network map with ${graph.nodes.length} endpoints and ${graph.edges.length} routes. Use the adjacent lists for keyboard access.`}
        />
        {!graph.nodes.length && <p className="topology-empty">No routes match the current filters.</p>}
      </div>

      <aside className="topology-side" aria-label="Accessible topology inventory">
        <div className="topology-side-header"><h2>Endpoints and routes</h2></div>
        <div className="topology-list">
          <h3>Endpoints</h3>
          {graph.nodes.map((node) => <button
            type="button"
            key={node.id}
            aria-current={selection?.kind === "node" && selection.item.id === node.id}
            onClick={() => selectNodeFromList(node)}
          >
            <strong>{node.label}</strong>
            <span className={isElevated(node.highestSeverity) && node.unresolvedCount ? "topology-risk" : ""}>
              {node.highestSeverity}
            </span>
            <small>{node.alertCount} alerts · {node.unresolvedCount} unresolved</small>
            <small>{node.protocols.join(", ")}</small>
          </button>)}
          <h3>Directed routes</h3>
          {graph.edges.map((edge) => <button
            type="button"
            key={edge.id}
            aria-current={selection?.kind === "edge" && selection.item.id === edge.id}
            onClick={() => selectEdgeFromList(edge)}
          >
            <strong>{edge.sourceEndpoint} → {edge.targetEndpoint}</strong>
            <span className={isElevated(edge.highestSeverity) && edge.unresolvedCount ? "topology-risk" : ""}>
              {edge.highestSeverity}
            </span>
            <small>{edge.alertCount} alerts · {edge.unresolvedCount} unresolved</small>
            <small>{edge.protocols.join(", ")}</small>
          </button>)}
        </div>

        {selection && <div className="topology-detail" aria-live="polite">
          <h3>{selection.kind === "node" ? selection.item.endpoint : `${selection.item.sourceEndpoint} → ${selection.item.targetEndpoint}`}</h3>
          <dl>
            <dt>Highest severity</dt><dd>{selection.item.highestSeverity}</dd>
            <dt>Alerts</dt><dd>{selection.item.alertCount}</dd>
            <dt>Unresolved</dt><dd>{selection.item.unresolvedCount}</dd>
            <dt>Protocols</dt><dd>{selection.item.protocols.join(", ") || "Unknown"}</dd>
            <dt>Last observed</dt><dd>{formatSeen(selection.item.lastSeen)}</dd>
            {selection.kind === "node" && <><dt>Identity</dt><dd>{selection.item.identityQuality === "address" ? "Address observed" : "Limited endpoint identity"}</dd></>}
          </dl>
          <button
            type="button"
            className="primary"
            onClick={() => onViewAlerts(selection.kind === "node" ? selection.item.endpoint : selection.item.sourceEndpoint)}
          >
            View related alerts
          </button>
        </div>}
      </aside>
    </div>
  </section>;
}
