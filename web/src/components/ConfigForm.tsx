import type {
  ProcessingConfig, PositioningMode, Constellation, Frequency, TropoModel,
  IonoModel, AmbiguityMode, EphemerisSource, BaseCoordMode,
} from "../api/types";

const MODES: PositioningMode[] = ["static", "kinematic", "movingbase", "ppp-static", "ppp-kinematic"];
const CONSTS: Constellation[] = ["GPS", "GLO", "GAL", "BDS", "QZSS", "SBAS"];
const FREQS: Frequency[] = ["l1", "l1+l2", "l1+l2+l5"];
const TROPOS: TropoModel[] = ["off", "saastamoinen", "sbas", "estimate-ztd", "estimate-ztd-grad"];
const IONOS: IonoModel[] = ["off", "broadcast", "sbas", "iono-free-lc", "estimate-stec", "ionex"];
const ARS: AmbiguityMode[] = ["off", "continuous", "instantaneous", "fix-and-hold"];
const EPHS: EphemerisSource[] = ["broadcast", "precise"];
const BASEMODES: BaseCoordMode[] = ["single", "known-llh", "known-xyz"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-muted">{label}</span>
      {children}
    </label>
  );
}
const selCls = "w-full rounded-md border border-hair bg-base px-2 py-1.5 text-ink";

export function ConfigForm({ value, onChange }: { value: ProcessingConfig; onChange: (v: ProcessingConfig) => void }) {
  const set = <K extends keyof ProcessingConfig>(k: K, v: ProcessingConfig[K]) => onChange({ ...value, [k]: v });
  const toggleConst = (c: Constellation) =>
    set("constellations", value.constellations.includes(c)
      ? value.constellations.filter((x) => x !== c)
      : [...value.constellations, c]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Positioning mode">
        <select className={selCls} value={value.mode} onChange={(e) => set("mode", e.target.value as PositioningMode)}>
          {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="Frequency">
        <select className={selCls} value={value.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>
          {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <span className="mb-1 block text-sm text-muted">Constellations</span>
        <div className="flex flex-wrap gap-2">
          {CONSTS.map((c) => (
            <button type="button" key={c} onClick={() => toggleConst(c)}
              className={`rounded-md border px-2.5 py-1 text-xs ${value.constellations.includes(c) ? "border-accent bg-accent/20 text-accent" : "border-hair text-muted"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <Field label={`Elevation mask: ${value.elev_mask_deg}°`}>
        <input type="range" min={0} max={90} value={value.elev_mask_deg} onChange={(e) => set("elev_mask_deg", Number(e.target.value))} className="w-full" />
      </Field>
      <Field label={`SNR mask: ${value.snr_mask_dbhz} dBHz`}>
        <input type="range" min={0} max={60} value={value.snr_mask_dbhz} onChange={(e) => set("snr_mask_dbhz", Number(e.target.value))} className="w-full" />
      </Field>
      <Field label="Troposphere">
        <select className={selCls} value={value.tropo} onChange={(e) => set("tropo", e.target.value as TropoModel)}>
          {TROPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Ionosphere">
        <select className={selCls} value={value.iono} onChange={(e) => set("iono", e.target.value as IonoModel)}>
          {IONOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Ambiguity resolution">
        <select className={selCls} value={value.ambiguity} onChange={(e) => set("ambiguity", e.target.value as AmbiguityMode)}>
          {ARS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="AR ratio min">
        <input type="number" step="0.1" className={selCls} value={value.ar_ratio_min} onChange={(e) => set("ar_ratio_min", Number(e.target.value))} />
      </Field>
      <Field label="AR min lock count">
        <input type="number" step="1" min={0} className={selCls} value={value.ar_min_lock} onChange={(e) => set("ar_min_lock", Number(e.target.value))} />
      </Field>
      <Field label="AR min elevation (°)">
        <input type="number" step="0.1" min={0} max={90} className={selCls} value={value.ar_min_elev_deg} onChange={(e) => set("ar_min_elev_deg", Number(e.target.value))} />
      </Field>
      <Field label="Ephemeris">
        <select className={selCls} value={value.ephemeris} onChange={(e) => set("ephemeris", e.target.value as EphemerisSource)}>
          {EPHS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      <Field label="Base coordinate mode">
        <select className={selCls} value={value.base_coord_mode}
          onChange={(e) => {
            const m = e.target.value as BaseCoordMode;
            onChange({ ...value, base_coord_mode: m, base_coord: m === "single" ? null : (value.base_coord ?? [0, 0, 0]) });
          }}>
          {BASEMODES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </Field>
      {value.base_coord_mode !== "single" && (
        <div className="grid grid-cols-3 gap-2 sm:col-span-2">
          {[0, 1, 2].map((i) => (
            <input key={i} type="number" step="any" className={selCls}
              value={value.base_coord?.[i] ?? 0}
              onChange={(e) => {
                const bc = [...(value.base_coord ?? [0, 0, 0])] as [number, number, number];
                bc[i] = Number(e.target.value);
                set("base_coord", bc);
              }} />
          ))}
        </div>
      )}
    </div>
  );
}
