export type NavigationAnchor = {
  timeMs: number;
  ratio: number;
};

export type NumericVisibleRange = {
  fromMs: number;
  toMs: number;
};

export function visibleRangeForAnchor(anchor: NavigationAnchor, spanMs: number): NumericVisibleRange {
  return {
    fromMs: anchor.timeMs - spanMs * anchor.ratio,
    toMs: anchor.timeMs + spanMs * (1 - anchor.ratio),
  };
}

export function visibleRangeForLatestAnchor(
  visibleRange: NumericVisibleRange,
  anchor: NavigationAnchor
): NumericVisibleRange {
  return visibleRangeForAnchor(anchor, visibleRange.toMs - visibleRange.fromMs);
}
