export const selCls =
  "w-full rounded-lg border border-hair bg-panel2 px-3 py-2 text-sm text-ink outline-none " +
  "transition-colors duration-150 placeholder:text-faint " +
  "focus:border-accent/60 focus:ring-2 focus:ring-accent/25 " +
  "disabled:opacity-40 disabled:cursor-not-allowed";

export const chipCls = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 ${
    active
      ? "border-accent/50 bg-accent/15 text-accent"
      : "border-hair text-muted hover:border-hairStrong hover:text-ink"
  }`;
