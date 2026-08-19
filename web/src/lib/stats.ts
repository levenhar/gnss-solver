export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, v) => a + v, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function range(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}
