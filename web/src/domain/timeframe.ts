export type ReviewTimeframe = '5' | '15' | '60' | '240' | 'D' | 'W';

export const TIMEFRAME_DISPLAY_MAP: Record<ReviewTimeframe, string> = {
  '5': '5m',
  '15': '15m',
  '60': '1h',
  '240': '4h',
  D: '1d',
  W: '1w',
};

export const TIMEFRAME_SECONDS_MAP: Record<ReviewTimeframe, number> = {
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
