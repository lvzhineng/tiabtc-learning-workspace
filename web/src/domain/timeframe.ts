export type ReviewTimeframe = '1' | '5' | '15' | '60' | '240' | 'D' | 'W';

export const TIMEFRAME_DISPLAY_MAP: Record<ReviewTimeframe, string> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '60': '1h',
  '240': '4h',
  D: '1d',
  W: '1w',
};

export const TIMEFRAME_SECONDS_MAP: Record<ReviewTimeframe, number> = {
  '1': 60,
  '5': 300,
  '15': 900,
  '60': 3600,
  '240': 14400,
  D: 86400,
  W: 604800,
};

export function timeframeToDisplay(tf: ReviewTimeframe): string {
  return TIMEFRAME_DISPLAY_MAP[tf] || tf;
}

/** Pick a review timeframe from holding duration. Never suggests 1m. */
export function suggestReviewTimeframe(holdingMs: number): ReviewTimeframe {
  const minutes = Math.max(0, holdingMs) / 60_000;
  if (minutes <= 45) return '5';
  if (minutes <= 6 * 60) return '15';
  if (minutes <= 36 * 60) return '60';
  if (minutes <= 10 * 24 * 60) return '240';
  return 'D';
}
