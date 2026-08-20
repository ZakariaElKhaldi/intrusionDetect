import type { ReactNode } from "react";

export function PanelHeading({
  title,
  action,
}: {
  /** Accepted temporarily for call-site compatibility; compact headers do not render decorative copy. */
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}
