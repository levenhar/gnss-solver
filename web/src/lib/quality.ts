const LABELS: Record<number, string> = { 1: "Fixed", 2: "Float", 4: "DGPS/SBAS", 5: "Single" };
const COLORS: Record<number, string> = { 1: "#16a34a", 2: "#eab308", 4: "#2563eb", 5: "#dc2626" };

export function qLabel(q: number): string {
  return LABELS[q] ?? `Q${q}`;
}
export function qColor(q: number): string {
  return COLORS[q] ?? "#6b7280";
}
