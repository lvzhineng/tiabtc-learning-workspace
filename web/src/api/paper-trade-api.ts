import { requestJson } from './http';
import type { PaperTrade } from '@/domain/paper-trade';

type PaperTradeResponse = {
  id: string;
  videoId: string;
  symbol: string;
  interval: PaperTrade['interval'];
  direction: PaperTrade['direction'];
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  rrRatio: number;
  status: PaperTrade['status'];
  pnlR: number;
  createdAt: string;
  closedAt: string | null;
};

type StoredPaperTrade = {
  id: string;
  video_id: string;
  symbol: string;
  interval: PaperTrade['interval'];
  direction: PaperTrade['direction'];
  entry_price: number;
  tp_price: number;
  sl_price: number;
  rr_ratio: number;
  status: PaperTrade['status'];
  pnl_r: number;
  created_at: string;
  closed_at: string | null;
};

type PaperTradesResponse = {
  trades: StoredPaperTrade[];
};

function storedToPaperTrade(raw: StoredPaperTrade): PaperTrade {
  return {
    id: raw.id,
    videoId: raw.video_id,
    symbol: raw.symbol,
    interval: raw.interval || '60',
    direction: raw.direction,
    entryPrice: raw.entry_price,
    takeProfitPrice: raw.tp_price,
    stopLossPrice: raw.sl_price,
    riskRewardRatio: raw.rr_ratio,
    status: raw.status,
    pnlR: raw.pnl_r,
    createdAt: raw.created_at,
    closedAt: raw.closed_at,
  };
}

function responseToPaperTrade(raw: PaperTradeResponse): PaperTrade {
  return {
    id: raw.id,
    videoId: raw.videoId,
    symbol: raw.symbol,
    interval: raw.interval,
    direction: raw.direction,
    entryPrice: raw.entryPrice,
    takeProfitPrice: raw.tpPrice,
    stopLossPrice: raw.slPrice,
    riskRewardRatio: raw.rrRatio,
    status: raw.status,
    pnlR: raw.pnlR,
    createdAt: raw.createdAt,
    closedAt: raw.closedAt,
  };
}

export async function fetchPaperTrades(
  symbol = '',
  signal?: AbortSignal
): Promise<PaperTrade[]> {
  const params = new URLSearchParams();
  if (symbol) params.set('symbol', symbol);
  const data = await requestJson<PaperTradesResponse>(
    `/api/paper-trades?${params}`,
    { signal }
  );
  return (data.trades || []).map(storedToPaperTrade);
}

export async function savePaperTrade(
  trade: Omit<PaperTrade, 'createdAt' | 'closedAt'> & {
    createdAt?: string;
    closedAt?: string | null;
  }
): Promise<PaperTrade> {
  const data = await requestJson<PaperTradeResponse>('/api/paper-trades', {
    method: 'POST',
    body: JSON.stringify({
      id: trade.id,
      videoId: trade.videoId || '__global__',
      symbol: trade.symbol,
      interval: trade.interval,
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      tpPrice: trade.takeProfitPrice,
      slPrice: trade.stopLossPrice,
      status: trade.status,
      createdAt: trade.createdAt,
      closedAt: trade.closedAt,
    }),
  });
  return responseToPaperTrade(data);
}

export async function deletePaperTrade(id: string): Promise<void> {
  const params = new URLSearchParams({ id });
  await requestJson<{ ok: boolean }>(`/api/paper-trades?${params}`, {
    method: 'DELETE',
  });
}
