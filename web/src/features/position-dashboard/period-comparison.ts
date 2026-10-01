import { summarizePositions } from '@/features/position-review/position-stats';
import type { ReviewPosition } from '@/features/position-review/position-review-types';

export function compareReviewPeriods(positions: ReviewPosition[], endMs: number, days: number, useEntryTime = false) {
  const spanMs = days * 86_400_000;
  const current: ReviewPosition[] = [];
  const previous: ReviewPosition[] = [];
  for (const position of positions) {
    if (position.status !== 'closed') continue;
    const time = useEntryTime ? position.entryTimeMs : position.exitTimeMs ?? position.entryTimeMs;
    if (time > endMs) continue;
    if (time >= endMs - spanMs) current.push(position);
    else if (time >= endMs - spanMs * 2) previous.push(position);
  }
  return { current: summarizePositions(current), previous: summarizePositions(previous) };
}
