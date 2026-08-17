import { useState } from "react";
import type { Solution } from "../api/types";
import { GroundTrack } from "./charts/GroundTrack";
import { HeightTime } from "./charts/HeightTime";
import { SatCountTime } from "./charts/SatCountTime";
import { ArRatioTime } from "./charts/ArRatioTime";
import { ResidualHist } from "./charts/ResidualHist";
import { SkyPlot } from "./charts/SkyPlot";

const TABS = ["Track", "Height", "Sats", "AR", "Residuals", "Sky"] as const;
type Tab = typeof TABS[number];

export function ChartTabs({ solution, arThreshold }: { solution: Solution; arThreshold: number }) {
  const [tab, setTab] = useState<Tab>("Track");
  return (
    <div className="rounded-lg border border-hair bg-panel p-3">
      <div className="mb-2 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-2.5 py-1 text-xs ${tab === t ? "bg-accent/20 text-accent" : "text-muted hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Track" && <GroundTrack solution={solution} />}
      {tab === "Height" && <HeightTime solution={solution} />}
      {tab === "Sats" && <SatCountTime solution={solution} />}
      {tab === "AR" && <ArRatioTime solution={solution} threshold={arThreshold} />}
      {tab === "Residuals" && <ResidualHist solution={solution} />}
      {tab === "Sky" && <SkyPlot solution={solution} />}
    </div>
  );
}
