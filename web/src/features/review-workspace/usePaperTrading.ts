import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deletePaperTrade,
  fetchPaperTrades,
  savePaperTrade,
} from '@/api/paper-trade-api';
import type { Candlestick } from '@/domain/candle';
import type { PaperTrade } from '@/domain/paper-trade';
import type { ReviewTimeframe } from '@/domain/timeframe';
import {
  calculateRR,
  checkTradeTrigger,
} from '@/features/paper-trading/paper-trade-logic';
import type { ReplayState } from '@/features/replay/replay-state';
import { confirmDialog } from '@/ui/feedback/confirm';
import { toast } from '@/ui/feedback/toast';

type PaperTradingWorkspace = {
  trades: PaperTrade[];
  createTrade: (
    draft: Omit<PaperTrade, 'id' | 'createdAt' | 'closedAt'>
  ) => Promise<boolean>;
  closeTrade: (
    id: string,
    closePrice: number,
    forceStatus?: 'WIN' | 'LOSS'
  ) => Promise<void>;
  removeTrade: (id: string) => Promise<void>;
  checkTriggers: (candle: Candlestick) => void;
};

function replayTimeMs(replayState: ReplayState): number {
  return replayState.status === 'idle'
    ? Date.now()
    : replayState.cursorTimeMs;
}

export function usePaperTrading(
  symbol: string,
  timeframe: ReviewTimeframe,
  replayState: ReplayState
): PaperTradingWorkspace {
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const tradesRef = useRef<PaperTrade[]>([]);
  const replayStateRef = useRef(replayState);
  const timeframeRef = useRef(timeframe);
  const symbolRef = useRef(symbol);
  const workspaceRevisionRef = useRef(0);

  replayStateRef.current = replayState;
  timeframeRef.current = timeframe;
  symbolRef.current = symbol;

  const replaceTrades = useCallback((nextTrades: PaperTrade[]) => {
    tradesRef.current = nextTrades;
    setTrades(nextTrades);
  }, []);

  useEffect(() => {
    const workspaceRevision = ++workspaceRevisionRef.current;
    const controller = new AbortController();
    replaceTrades([]);
    void fetchPaperTrades(symbol, controller.signal)
      .then((storedTrades) => {
        if (
          !controller.signal.aborted &&
          workspaceRevisionRef.current === workspaceRevision
        ) {
          replaceTrades(storedTrades || []);
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          console.warn('拉取模拟交易记录失败:', requestError);
        }
      });
    return () => {
      controller.abort();
      if (workspaceRevisionRef.current === workspaceRevision) {
        workspaceRevisionRef.current += 1;
      }
    };
  }, [replaceTrades, symbol]);

  const createTrade = useCallback(
    async (
      draft: Omit<PaperTrade, 'id' | 'createdAt' | 'closedAt'>
    ): Promise<boolean> => {
      const workspaceRevision = workspaceRevisionRef.current;
      const payload: Omit<PaperTrade, 'closedAt'> = {
        ...draft,
        id: `trade_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 7)}`,
        interval: timeframeRef.current,
        createdAt: new Date(
          replayTimeMs(replayStateRef.current)
        ).toISOString(),
      };

      try {
        const saved = await savePaperTrade(payload);
        if (workspaceRevisionRef.current !== workspaceRevision) {
          return false;
        }
        replaceTrades([saved, ...tradesRef.current]);
        toast.success(`挂单成功: ${payload.direction === 'LONG' ? '做多' : '做空'} @ ${payload.entryPrice}`);
        return true;
      } catch (saveError) {
        toast.error(
          `挂单开仓失败: ${
            saveError instanceof Error ? saveError.message : '网络异常'
          }`
        );
        return false;
      }
    },
    [replaceTrades]
  );

  const closeTrade = useCallback(
    async (
      id: string,
      closePrice: number,
      forceStatus?: 'WIN' | 'LOSS'
    ) => {
      const target = tradesRef.current.find((trade) => trade.id === id);
      if (!target) return;
      const workspaceRevision = workspaceRevisionRef.current;

      const status =
        forceStatus ||
        (target.direction === 'LONG'
          ? closePrice >= target.entryPrice
            ? 'WIN'
            : 'LOSS'
          : closePrice <= target.entryPrice
          ? 'WIN'
          : 'LOSS');
      const rr = calculateRR(
        target.direction,
        target.entryPrice,
        target.takeProfitPrice,
        target.stopLossPrice
      );
      const updated: PaperTrade = {
        ...target,
        status,
        closedAt: new Date(
          replayTimeMs(replayStateRef.current)
        ).toISOString(),
        pnlR: status === 'WIN' ? rr : -1,
      };

      try {
        const saved = await savePaperTrade(updated);
        if (workspaceRevisionRef.current !== workspaceRevision) return;
        replaceTrades(
          tradesRef.current.map((trade) =>
            trade.id === id ? saved : trade
          )
        );
        toast.info(`模拟订单已结单 (${status === 'WIN' ? '盈利' : '亏损'})`);
      } catch (saveError) {
        toast.error(
          `平仓写库失败: ${
            saveError instanceof Error ? saveError.message : '网络异常'
          }`
        );
      }
    },
    [replaceTrades]
  );

  const removeTrade = useCallback(
    async (id: string) => {
      const confirmed = await confirmDialog({
        title: '删除交易记录',
        message: '确认删除这条模拟交易记录吗？',
        confirmText: '确认删除',
        isDanger: true,
      });
      if (!confirmed) return;
      const workspaceRevision = workspaceRevisionRef.current;
      try {
        await deletePaperTrade(id);
        if (workspaceRevisionRef.current !== workspaceRevision) return;
        replaceTrades(
          tradesRef.current.filter((trade) => trade.id !== id)
        );
        toast.success('交易记录已删除');
      } catch (deleteError) {
        toast.error(
          `删除交易记录失败: ${
            deleteError instanceof Error
              ? deleteError.message
              : '网络异常'
          }`
        );
      }
    },
    [replaceTrades]
  );

  const checkTriggers = useCallback(
    (candle: Candlestick) => {
      const workspaceRevision = workspaceRevisionRef.current;
      const triggeredById = new Map<string, PaperTrade>();
      const originalById = new Map<string, PaperTrade>();
      for (const trade of tradesRef.current) {
        if (trade.symbol !== symbolRef.current) continue;
        const triggered = checkTradeTrigger(
          trade,
          candle,
          timeframeRef.current
        );
        if (triggered) {
          triggeredById.set(trade.id, triggered);
          originalById.set(trade.id, trade);
        }
      }
      if (triggeredById.size === 0) return;

      replaceTrades(
        tradesRef.current.map(
          (trade) => triggeredById.get(trade.id) || trade
        )
      );
      for (const triggered of triggeredById.values()) {
        void savePaperTrade(triggered).catch((saveError) => {
          if (workspaceRevisionRef.current !== workspaceRevision) return;
          const original = originalById.get(triggered.id);
          const current = tradesRef.current.find(
            (trade) => trade.id === triggered.id
          );
          if (original && current?.closedAt === triggered.closedAt) {
            replaceTrades(
              tradesRef.current.map((trade) =>
                trade.id === original.id ? original : trade
              )
            );
          }
          toast.error(
            `自动结单写库失败: ${
              saveError instanceof Error ? saveError.message : '网络异常'
            }`
          );
        });
      }
    },
    [replaceTrades]
  );

  const scopedTrades = useMemo(
    () => trades.filter((trade) => trade.symbol === symbol),
    [symbol, trades]
  );

  return {
    trades: scopedTrades,
    createTrade,
    closeTrade,
    removeTrade,
    checkTriggers,
  };
}
