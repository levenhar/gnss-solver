import type { Solution } from "../../api/types";
import { arRatioData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function ArRatioTime({ solution, threshold }: { solution: Solution; threshold: number }) {
  const data = arRatioData(solution);
  const xs = solution.epochs.map((e) => e.t);
  const line = xs.length ? [{ x: [xs[0], xs[xs.length - 1]], y: [threshold, threshold], mode: "lines", line: { dash: "dash", color: "#dc2626" }, name: "threshold" }] : [];
  return <PlotlyChart data={[...data, ...(line as any)]} layout={{ yaxis: { title: "AR ratio" } }} />;
}
