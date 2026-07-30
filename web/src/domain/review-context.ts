export type BybitSymbol = string;

export type VideoReviewContext = {
  mode: 'video';
  videoId: string;
  title: string;
  symbol: BybitSymbol;
  anchorTimeMs: number;
};

export type FreeReplayContext = {
  mode: 'free';
  symbol: BybitSymbol;
  anchorTimeMs: number;
};

export type TradeReviewContext = {
  mode: 'trade';
  tradeId: string;
  symbol: BybitSymbol;
  anchorTimeMs: number;
  entryTimeMs: number;
  exitTimeMs: number;
};

export type ReviewContext =
  | VideoReviewContext
  | FreeReplayContext
  | TradeReviewContext;
