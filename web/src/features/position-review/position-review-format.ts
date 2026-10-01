import type { PositionFillKind, ReviewPosition } from './position-review-types';

export const FILL_KIND_LABEL: Record<PositionFillKind, string> = {
  open: '开',
  scaleIn: '加',
  reduce: '减',
  close: '平',
};

export {
  formatLeverage,
  formatShanghaiTime,
  formatShanghaiTimeShort,
  formatNumber,
  formatHoldingDuration,
} from '@/domain/formatters';

/** Display-only cap for tiny-margin ROI blow-ups. Does not change PnL math. */
export const ROI_DISPLAY_CAP = 999;

export function isExtremeRoi(roi: number | null | undefined): boolean {
  return roi != null && Number.isFinite(roi) && Math.abs(roi) >= ROI_DISPLAY_CAP;
}

export function formatRoi(roi: number | null | undefined): string {
  if (roi == null || Number.isNaN(roi)) return '—';
  if (isExtremeRoi(roi)) {
    const sign = roi > 0 ? '+' : '-';
    return `>${sign}${ROI_DISPLAY_CAP}%`;
  }
  const prefix = roi > 0 ? '+' : '';
  return `${prefix}${roi.toFixed(2)}%`;
}

export function formatRoiWithHint(roi: number | null | undefined): string {
  const text = formatRoi(roi);
  return isExtremeRoi(roi) ? `${text}（保证金过小）` : text;
}

export function roiDisplayTitle(roi: number | null | undefined): string | undefined {
  return isExtremeRoi(roi) ? '保证金过小，收益率仅供参考' : undefined;
}

export function calculatePositionRoi(position: ReviewPosition): number | null {
  const pnl = position.netPnl ?? position.realizedPnl;
  const { entryPrice, contracts, leverage } = position;
  if (pnl == null || !Number.isFinite(pnl)) return null;
  if (entryPrice == null || !(entryPrice > 0)) return null;
  if (contracts == null || !(contracts > 0)) return null;
  const lev = leverage != null && leverage > 0 ? leverage : 1;
  const initialMargin = (entryPrice * contracts) / lev;
  if (!(initialMargin > 0) || !Number.isFinite(initialMargin)) return null;
  return (pnl / initialMargin) * 100;
}
