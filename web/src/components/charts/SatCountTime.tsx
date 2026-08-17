import type { Solution } from "../../api/types";
import { satCountData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function SatCountTime({ solution }: { solution: Solution }) {
  return <PlotlyChart data={satCountData(solution)} layout={{ yaxis: { title: "# satellites" } }} />;
}
