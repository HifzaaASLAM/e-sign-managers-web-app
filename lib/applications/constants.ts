export const APPLICATION_DECISIONS = [
  "Under review",
  "Accepted",
  "Declined",
  "Withdrawn",
] as const;

export type ApplicationDecision = (typeof APPLICATION_DECISIONS)[number];

export function isApplicationDecision(value: string): value is ApplicationDecision {
  return (APPLICATION_DECISIONS as readonly string[]).includes(value);
}

export function decisionTone(decision: string): "neutral" | "success" | "danger" | "warning" {
  if (decision === "Accepted") return "success";
  if (decision === "Declined" || decision === "Withdrawn") return "danger";
  if (decision === "Under review") return "warning";
  return "neutral";
}
