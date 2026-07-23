import { AlertCircle, Check, Circle, ShieldAlert, TriangleAlert } from "lucide-react";
import type { Severity } from "../types";

const icons = {
  critical: ShieldAlert,
  high: TriangleAlert,
  medium: AlertCircle,
  low: Circle,
  normal: Check,
} satisfies Record<Severity, typeof Circle>;

export function SeverityLabel({ severity }: { severity: Severity }) {
  const Icon = icons[severity];
  return (
    <span className={`severity severity--${severity}`}>
      <Icon aria-hidden="true" />
      {severity.replace("_", " ")}
    </span>
  );
}

