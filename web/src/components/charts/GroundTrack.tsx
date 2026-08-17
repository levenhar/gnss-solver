import type { Solution } from "../../api/types";
import { groundTrackData } from "../../lib/chartData";
import { PlotlyChart } from "./PlotlyChart";

export function GroundTrack({ solution }: { solution: Solution }) {
  return <PlotlyChart data={groundTrackData(solution)} layout={{ xaxis: { title: "East (m)" }, yaxis: { title: "North (m)", scaleanchor: "x" } }} />;
}
