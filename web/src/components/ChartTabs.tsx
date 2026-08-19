import { useState } from "react";
import { motion } from "framer-motion";
import type { Solution } from "../api/types";
import { GroundTrack } from "./charts/GroundTrack";
import { HeightTime } from "./charts/HeightTime";
import { SatCountTime } from "./charts/SatCountTime";
import { ArRatioTime } from "./charts/ArRatioTime";
import { ResidualHist } from "./charts/ResidualHist";
import { SkyPlot } from "./charts/SkyPlot";
import { Card } from "./ui/Card";
import { springSmooth } from "./ui/transitions";

const TABS = ["Track", "Height", "Sats", "AR", "Residuals", "Sky"] as const;
type Tab = typeof TABS[number];

export function ChartTabs({ solution, arThreshold }: { solution: Solution; arThreshold: number }) {
  const [tab, setTab] = useState<Tab>("Track");
  return (
    <Card className="p-3">
      <div className="mb-2 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="relative rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors duration-150"
          >
            {tab === t && (
              <motion.span
                layoutId="chart-tab-indicator"
                className="absolute inset-0 rounded-lg bg-accent/15 ring-1 ring-accent/30"
                transition={springSmooth}
              />
            )}
            <span className={`relative ${tab === t ? "text-accent" : "text-muted hover:text-ink"}`}>{t}</span>
          </button>
        ))}
      </div>
      {tab === "Track" && <GroundTrack solution={solution} />}
      {tab === "Height" && <HeightTime solution={solution} />}
      {tab === "Sats" && <SatCountTime solution={solution} />}
      {tab === "AR" && <ArRatioTime solution={solution} threshold={arThreshold} />}
      {tab === "Residuals" && <ResidualHist solution={solution} />}
      {tab === "Sky" && <SkyPlot solution={solution} />}
    </Card>
  );
}
