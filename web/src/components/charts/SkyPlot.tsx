import type { Solution } from "../../api/types";
import { skyplotData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function SkyPlot({ solution }: { solution: Solution }) {
  return <PlotlyChart data={skyplotData(solution)} layout={{ polar: { radialaxis: { range: [0, 90] }, angularaxis: { direction: "clockwise", rotation: 90 } } as any }} />;
}
