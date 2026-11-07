import type { FreeReplayContext, VideoReviewContext, TradeReviewContext } from '@/domain/review-context';
import type { UsDayReplay } from './us-day-replay';

export type ActiveReplayState = {
  status: 'ready' | 'playing' | 'paused' | 'completed';
  context: VideoReviewContext | FreeReplayContext | TradeReviewContext;
  startTimeMs: number;
  progressTimeMs: number;
  cursorTimeMs: number;
  speed: number; // e.g. 1, 2, 5, 10
  daySession?: UsDayReplay;
};

export type ReplayState =
  | { status: 'idle' }
  | ActiveReplayState;
