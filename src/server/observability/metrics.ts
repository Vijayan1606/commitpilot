const counters = new Map<string, number>();
const timings = new Map<string, { count: number; totalMs: number; maxMs: number }>();

export function increment(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function observeLatency(name: string, ms: number): void {
  const current = timings.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
  timings.set(name, {
    count: current.count + 1,
    totalMs: current.totalMs + ms,
    maxMs: Math.max(current.maxMs, ms),
  });
}

export function snapshot(): {
  counters: Record<string, number>;
  timings: Record<string, { count: number; averageMs: number; maxMs: number }>;
} {
  return {
    counters: Object.fromEntries(counters),
    timings: Object.fromEntries(
      [...timings.entries()].map(([key, value]) => [
        key,
        {
          count: value.count,
          averageMs: value.count > 0 ? Math.round(value.totalMs / value.count) : 0,
          maxMs: value.maxMs,
        },
      ]),
    ),
  };
}

export function resetMetrics(): void {
  counters.clear();
  timings.clear();
}
