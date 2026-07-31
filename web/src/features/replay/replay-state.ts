import type { FreeReplayContext, VideoReviewContext, TradeReviewContext } from '@/domain/review-context';

export type ReplayStatus = 'idle' | 'ready' | 'playing' | 'paused' | 'completed';

export type ActiveReplayState = {
  status: 'ready' | 'playing' | 'paused' | 'completed';
  context: VideoReviewContext | FreeReplayContext | TradeReviewContext;
  startTimeMs: number;
  progressTimeMs: number;
  cursorTimeMs: number;
  speed: number; // e.g. 1, 2, 5, 10
};

export type ReplayState =
  | { status: 'idle' }
  | ActiveReplayState;
