import { requestJson } from './http';
import type { PaperTrade } from '@/domain/paper-trade';
import type { ReviewTimeframe } from '@/domain/timeframe';

type RawPaperTrade = {
  id: string;
  video_id: string;
  symbol: string;
  interval: string;
  direction: 'LONG' | 'SHORT';
  entry_price: number;
  tp_price: number;
  sl_price: number;
  rr_ratio: number;
  status: 'OPEN' | 'CLOSED';
  pnl_r: number;
  created_at: string;
  closed_at: string | null;
};

type PaperTradesResponse = {
  trades: RawPaperTrade[];
};

function rawToPaperTrade(raw: RawPaperTrade): PaperTrade {
  return {
    id: raw.id,
    videoId: raw.video_id,
    symbol: raw.symbol,
    interval: raw.interval as ReviewTimeframe,
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

function paperTradeToRaw(trade: Omit<PaperTrade, 'createdAt' | 'closedAt'> & { createdAt?: string; closedAt?: string | null }): RawPaperTrade {
  return {
    id: trade.id,
    video_id: trade.videoId,
    symbol: trade.symbol,
    interval: trade.interval,
    direction: trade.direction,
    entry_price: trade.entryPrice,
    tp_price: trade.takeProfitPrice,
    sl_price: trade.stopLossPrice,
    rr_ratio: trade.riskRewardRatio,
    status: trade.status,
    pnl_r: trade.pnlR,
    created_at: trade.createdAt || new Date().toISOString(),
    closed_at: trade.closedAt || null,
  };
}

export async function fetchPaperTrades(symbol = '', signal?: AbortSignal): Promise<PaperTrade[]> {
  const params = new URLSearchParams();
  if (symbol) params.set('symbol', symbol);
  const data = await requestJson<PaperTradesResponse>(`/api/paper-trades?${params}`, { signal });
  return (data.trades || []).map(rawToPaperTrade);
}

export async function savePaperTrade(trade: Omit<PaperTrade, 'createdAt' | 'closedAt'>): Promise<PaperTrade> {
  const raw = paperTradeToRaw(trade);
  const data = await requestJson<RawPaperTrade>('/api/paper-trades', {
    method: 'POST',
    body: JSON.stringify(raw),
  });
  return rawToPaperTrade(data);
}

export async function deletePaperTrade(id?: string): Promise<void> {
  const params = new URLSearchParams();
  if (id) params.set('id', id);
  await requestJson<{ ok: boolean }>(`/api/paper-trades?${params}`, {
    method: 'DELETE',
  });
}
