import type { Solution } from "../../api/types";
import { residualData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function ResidualHist({ solution }: { solution: Solution }) {
  return <PlotlyChart data={residualData(solution)} layout={{ barmode: "overlay", xaxis: { title: "residual (m)" }, yaxis: { title: "count" } }} />;
}
