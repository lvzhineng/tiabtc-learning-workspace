import { useEffect, useRef, useState } from 'react';
import { Shuffle } from 'lucide-react';
import type { ReviewTimeframe } from '@/domain/timeframe';
import { toast } from '@/ui/feedback/toast';
import { pickRandomReplayTime } from './random-replay';

interface Props {
  market: 'perpetual' | 'cfd';
  symbol: string;
  timeframe: ReviewTimeframe;
  disabled: boolean;
  onBegin: () => void;
  onStart: (symbol: string, cursorTimeMs: number) => void;
}

export function RandomReplayControl({ market, symbol, timeframe, disabled, onBegin, onStart }: Props) {
  const [pending, setPending] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const startRandomReplay = async () => {
    if (disabled || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    onBegin();
    try {
      const result = await pickRandomReplayTime(market, symbol, timeframe, controller.signal);
      if (controller.signal.aborted) return;
      onStart(symbol, result.cursorTimeMs);
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
      <button
        type="button"
        className="ui-btn"
        disabled={disabled || pending}
        onClick={() => void startRandomReplay()}
        title={`从 ${symbol} 的全部可用历史 K 线随机选择起点，隐藏未来行情；按右方向键逐根推进`}
      >
        <Shuffle size={14} />
        {pending ? '扫描历史并抽取…' : '随机复盘'}
      </button>
    </div>
  );
}
