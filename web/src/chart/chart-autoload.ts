import type { LogicalRange } from 'lightweight-charts';

export function shouldLoadEarlierByLogicalRange(
  logicalRange: LogicalRange | null,
  thresholdBars = 50
): boolean {
  if (!logicalRange) return false;
  return logicalRange.from < thresholdBars;
}

export function shouldLoadLaterByLogicalRange(
  logicalRange: LogicalRange | null,
  barsCount: number,
  thresholdBars = 50
): boolean {
  if (!logicalRange) return false;
  return barsCount - logicalRange.to < thresholdBars;
}
