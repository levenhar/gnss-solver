import type {
  SweepConfig, PositioningMode, Constellation, Frequency, TropoModel,
  IonoModel, AmbiguityMode, EphemerisSource,
} from "../api/types";
import { Field } from "./Field";

const MODES: PositioningMode[] = ["static", "kinematic", "movingbase", "ppp-static", "ppp-kinematic"];
const OPTIONAL_CONSTS: Constellation[] = ["GLO", "GAL", "BDS", "QZSS", "SBAS"];
const FREQS: Frequency[] = ["l1", "l1+l2", "l1+l2+l5"];
const TROPOS: TropoModel[] = ["off", "saastamoinen", "sbas", "estimate-ztd", "estimate-ztd-grad"];
const IONOS: IonoModel[] = ["off", "broadcast", "sbas", "iono-free-lc", "estimate-stec", "ionex"];
const ARS: AmbiguityMode[] = ["off", "continuous", "instantaneous", "fix-and-hold"];
const EPHS: EphemerisSource[] = ["broadcast", "precise"];

const selCls = "w-full rounded-md border border-hair bg-base px-2 py-1.5 text-ink";

function ToggleGroup<T extends string>({
  label, options, selected, onToggle,
}: {
  label: string;
  options: T[];
  selected: T[];
  onToggle: (opt: T) => void;
}) {
  return (
    <div className="sm:col-span-2">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button type="button" key={o} onClick={() => onToggle(o)}
            className={`rounded-md border px-2.5 py-1 text-xs ${selected.includes(o) ? "border-accent bg-accent/20 text-accent" : "border-hair text-muted"}`}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function RangeField({
  label, min, max, step, value, onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input type="number" min={min} max={max} step={step} className={selCls}
          value={value[0]} onChange={(e) => onChange([Number(e.target.value), value[1]])} />
        <input type="number" min={min} max={max} step={step} className={selCls}
          value={value[1]} onChange={(e) => onChange([value[0], Number(e.target.value)])} />
      </div>
    </Field>
  );
}

export function SweepConfigForm({ value, onChange }: { value: SweepConfig; onChange: (v: SweepConfig) => void }) {
  const set = <K extends keyof SweepConfig>(k: K, v: SweepConfig[K]) => onChange({ ...value, [k]: v });
  const togglePool = <T extends string>(pool: T[], k: keyof SweepConfig, opt: T) =>
    set(k, (pool.includes(opt) ? pool.filter((x) => x !== opt) : [...pool, opt]) as SweepConfig[typeof k]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Positioning mode (fixed for whole batch)">
        <select className={selCls} value={value.mode} onChange={(e) => set("mode", e.target.value as PositioningMode)}>
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="SNR mask (fixed)">
        <input type="number" className={selCls} value={value.snr_mask_dbhz} disabled />
      </Field>

      <div className="sm:col-span-2">
        <span className="mb-1 block text-sm text-muted">Constellations (GPS always included)</span>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md border border-hair bg-panel px-2.5 py-1 text-xs text-muted">GPS</span>
          {OPTIONAL_CONSTS.map((c) => (
            <button type="button" key={c} disabled={false}
              onClick={() => togglePool(value.constellation_pool, "constellation_pool", c)}
              className={`rounded-md border px-2.5 py-1 text-xs ${value.constellation_pool.includes(c) ? "border-accent bg-accent/20 text-accent" : "border-hair text-muted"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <RangeField label="Elevation mask range (°)" min={0} max={90} step={0.1}
        value={value.elev_mask_range} onChange={(v) => set("elev_mask_range", v)} />
      <RangeField label="AR ratio min range" min={0} max={20} step={0.1}
        value={value.ar_ratio_min_range} onChange={(v) => set("ar_ratio_min_range", v)} />
      <RangeField label="AR min lock count range" min={0} max={100} step={1}
        value={value.ar_min_lock_range} onChange={(v) => set("ar_min_lock_range", v)} />
      <RangeField label="AR min elevation range (°)" min={0} max={90} step={0.1}
        value={value.ar_min_elev_range} onChange={(v) => set("ar_min_elev_range", v)} />

      <ToggleGroup label="Frequency candidates" options={FREQS} selected={value.frequency_pool}
        onToggle={(o) => togglePool(value.frequency_pool, "frequency_pool", o)} />
      <ToggleGroup label="Troposphere candidates" options={TROPOS} selected={value.tropo_pool}
        onToggle={(o) => togglePool(value.tropo_pool, "tropo_pool", o)} />
      <ToggleGroup label="Ionosphere candidates" options={IONOS} selected={value.iono_pool}
        onToggle={(o) => togglePool(value.iono_pool, "iono_pool", o)} />
      <ToggleGroup label="Ambiguity resolution candidates" options={ARS} selected={value.ambiguity_pool}
        onToggle={(o) => togglePool(value.ambiguity_pool, "ambiguity_pool", o)} />
      <ToggleGroup label="Ephemeris candidates" options={EPHS} selected={value.ephemeris_pool}
        onToggle={(o) => togglePool(value.ephemeris_pool, "ephemeris_pool", o)} />
    </div>
  );
}
