import { motion } from "framer-motion";
import { springSmooth } from "./transitions";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  layoutId,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  layoutId: string;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-xl border border-hair bg-panel2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className="relative rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors duration-150"
        >
          {value === o.value && (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-0 rounded-lg bg-accent/15 ring-1 ring-accent/40"
              transition={springSmooth}
            />
          )}
          <span className={`relative ${value === o.value ? "text-accent" : "text-muted"}`}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}
