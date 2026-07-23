import type { Alert, ModelInfo } from "./types";

const attacks = ["DDoS-UDP", "Brute Force", "Port Scan", "MQTT Abuse", "Normal"];
const protocols = ["TCP", "UDP", "MQTT", "HTTP"];
const severity = ["critical", "high", "medium", "low", "normal"] as const;

export const sampleAlerts: Alert[] = Array.from({ length: 180 }, (_, index) => {
  const type = attacks[index % attacks.length];
  return {
    id: `ALT-${String(3048 - index).padStart(5, "0")}`,
    timestamp: new Date(Date.now() - index * 97_000).toISOString(),
    attack_type: type,
    confidence: type === "Normal" ? 0.94 - (index % 5) / 100 : 0.99 - (index % 19) / 100,
    severity: type === "Normal" ? "normal" : severity[index % 4],
    source_ip: `192.168.${10 + (index % 4)}.${20 + (index % 17)}`,
    destination_ip: `10.0.0.${2 + (index % 8)}`,
    protocol: protocols[index % protocols.length],
    status: index % 11 === 0 ? "resolved" : index % 5 === 0 ? "investigating" : "new",
    features: {
      flow_duration: 1200 + index * 17,
      packet_rate: 84 + (index % 30),
      total_fwd_packets: 10 + (index % 40),
      total_bwd_packets: 2 + (index % 12),
    },
    explanations: [
      { feature: "packet_rate", impact: 0.31 },
      { feature: "flow_duration", impact: 0.18 },
      { feature: "total_bwd_packets", impact: -0.08 },
    ],
  };
});

export const sampleModels: ModelInfo[] = [
  { name: "Random Forest", version: "1.4.2", status: "active", macro_f1: 0.947, weighted_f1: 0.982, false_positive_rate: 0.013, inference_ms: 3.8, trained_at: "2026-07-18" },
  { name: "HistGradientBoosting", version: "1.3.0", status: "candidate", macro_f1: 0.953, weighted_f1: 0.979, false_positive_rate: 0.017, inference_ms: 5.2, trained_at: "2026-07-17" },
  { name: "Logistic Regression", version: "1.1.1", status: "baseline", macro_f1: 0.811, weighted_f1: 0.923, false_positive_rate: 0.041, inference_ms: 0.7, trained_at: "2026-07-12" },
];
