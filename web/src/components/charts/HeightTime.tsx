import type { Solution } from "../../api/types";
import { heightTimeData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function HeightTime({ solution }: { solution: Solution }) {
  return <PlotlyChart data={heightTimeData(solution)} layout={{ yaxis: { title: "Height (m)" } }} />;
}
