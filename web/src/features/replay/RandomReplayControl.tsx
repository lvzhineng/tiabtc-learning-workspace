import { useEffect, useRef, useState } from 'react';
import { Shuffle } from 'lucide-react';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { toast } from '@/ui/feedback/toast';
import { pickRandomReplayTime } from './random-replay';
import { supportsUsDayReplay, type UsDayReplay, type UsDayLookback } from './us-day-replay';
import { prepareUsDay, takeUsDay } from './us-day-prefetch';
import { readLocalUiState, writeLocalUiState } from '@/ui/persistence/local-ui-state';

interface Props {
  market: 'perpetual' | 'cfd';
  symbol: string;
  timeframe: ReviewTimeframe;
  disabled: boolean;
  onBegin: () => void;
  onStart: (symbol: string, cursorTimeMs: number) => void;
  onStartDay?: (symbol: string, session: UsDayReplay) => void;
  prefetchEnabled?: boolean;
}

export function RandomReplayControl({ market, symbol, timeframe, disabled, onBegin, onStart, onStartDay,
  prefetchEnabled = true }: Props) {
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [preparation, setPreparation] = useState<'idle' | 'pending' | 'ready'>('idle');
  const [lookback, setLookback] = useState<UsDayLookback>(() => {
    const saved = readLocalUiState('tiabtc-us-day-random-v1').lookback;
    return saved === '3' || saved === 'all' ? saved : '1';
  });
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const isUsDay = market === 'cfd' && supportsUsDayReplay(symbol) && Boolean(onStartDay);

  useEffect(() => {
    setPreparation('idle');
    if (!isUsDay || disabled || pending || !prefetchEnabled) return;
    let disposed = false;
    let expiryTimer: number | undefined;
    // Let the current chart and prior-session requests finish first.
    const timer = window.setTimeout(() => {
      const request = prepareUsDay(symbol, lookback);
      setPreparation('pending');
      void request.then((expiresAt) => {
        if (disposed) return;
        const remaining = expiresAt - Date.now();
        setPreparation(remaining > 0 ? 'ready' : 'idle');
        if (remaining > 0) expiryTimer = window.setTimeout(() => setPreparation('idle'), remaining);
      }).catch(() => {
        if (!disposed) setPreparation('idle');
      });
    }, 300);
    return () => { disposed = true; window.clearTimeout(timer); window.clearTimeout(expiryTimer); };
  }, [isUsDay, disabled, pending, prefetchEnabled, symbol, lookback]);

  const startRandomReplay = async (singleDay = false) => {
    if (disabled || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setProgress('正在准备抽取…');
    onBegin();
    try {
      if (singleDay && onStartDay) {
        const session = await takeUsDay(symbol, lookback, controller.signal, (message) => {
          if (!controller.signal.aborted) setProgress(message);
        });
        if (!controller.signal.aborted) onStartDay(symbol, session);
      } else {
        const result = await pickRandomReplayTime(market, symbol, timeframe, controller.signal);
        if (!controller.signal.aborted) onStart(symbol, result.cursorTimeMs);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        toast.error(cause instanceof Error ? cause.message : '随机复盘加载失败，请重试');
      }
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null;
        setPending(false);
      }
    }
  };

  return (
    <div className="random-replay-control" aria-busy={pending}>
      {isUsDay && (
        <>
        <select className="ui-btn" aria-label="随机美股交易日范围" value={lookback} disabled={disabled || pending}
          onChange={(event) => {
            const value = event.target.value;
            const next = value === '3' || value === 'all' ? value : '1';
            setLookback(next); writeLocalUiState('tiabtc-us-day-random-v1', { lookback: next });
          }}>
          <option value="1">近1年</option><option value="3">近3年</option>
          <option value="all" title="从工作台支持的2017年7月起随机选日；超出Gate覆盖的日期自动跳过，不扫描历史行情">全部历史（2017年至今）</option>
        </select>
        <button type="button" className="ui-btn" disabled={disabled || pending}
          title="按所选范围随机抽取完整美股交易日，纽约09:30开始、16:00结束；跳过休市、提前收盘与缺失行情"
          onClick={() => void startRandomReplay(true)}>
          <Shuffle size={14} /> 随机美股一天
        </button>
        {!pending && preparation !== 'idle' && <span role="status" title="后台最多准备一个交易日，点击时直接复用行情缓存">
          {preparation === 'ready' ? '行情已预载' : '预载下一天…'}
        </span>}
        </>
      )}
      <button
        type="button"
        className="ui-btn"
        disabled={disabled || pending}
        onClick={() => void startRandomReplay()}
        title={`从 ${symbol} 的历史日期随机选取已收盘K线，不扫描全部历史；按右方向键逐根推进`}
      >
        <Shuffle size={14} />
        随机复盘
      </button>
      {pending && <button type="button" className="ui-btn" onClick={() => {
        requestRef.current?.abort(); requestRef.current = null; setPending(false);
      }}>取消抽取</button>}
      {pending && <span role="status">{progress}</span>}
    </div>
  );
}
