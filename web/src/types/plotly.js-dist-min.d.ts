// plotly.js-dist-min ships no bundled type declarations and there is no
// published @types package for it. A bare `declare module "x";` would make
// the whole module `any`, but named type imports (`import type { Data,
// Layout } from "plotly.js-dist-min"`) then resolve to `any`-typed values
// rather than types, which TS rejects when used as type annotations
// (TS2709). So re-declare `Data`/`Layout` as real (loose) type aliases
// instead of re-exporting the strict, discriminated-union shapes from
// @types/plotly.js, which don't match the looser trace-object literals used
// throughout the chart builders (e.g. axis titles as plain strings).
declare module "plotly.js-dist-min" {
  export type Data = any;
  export type Layout = any;
}
