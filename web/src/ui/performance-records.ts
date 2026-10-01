export type PerformanceSample = {
  operation: string;
  durationMs: number;
  count?: number;
};

const samples: PerformanceSample[] = [];
export const PERFORMANCE_SAMPLE_LIMIT = 200;

/** Only operation names and numbers; no request bodies, query strings or notes. */
export function recordPerformance(sample: PerformanceSample): void {
  samples.push({ ...sample });
  if (samples.length > PERFORMANCE_SAMPLE_LIMIT) samples.splice(0, samples.length - PERFORMANCE_SAMPLE_LIMIT);
}

export function performanceSamples(): PerformanceSample[] {
  return samples.map((sample) => ({ ...sample }));
}
