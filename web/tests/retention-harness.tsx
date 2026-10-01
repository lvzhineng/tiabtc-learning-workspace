import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useCandleWorkspaceData } from '../src/features/review-workspace/useCandleWorkspaceData';
import { ChartCanvas } from '../src/chart/ChartCanvas';
import { filterVisibleCandles } from '../src/features/replay/free-replay-logic';
import type { ReplayState } from '../src/features/replay/replay-state';

const base = Date.UTC(2024, 0, 1);
function Harness() {
  const [replay, setReplay] = useState<ReplayState>({ status: 'paused', context: { mode: 'free', symbol: 'BTCUSDT', anchorTimeMs: base },
    startTimeMs: base, progressTimeMs: base + 500 * 60_000, cursorTimeMs: base + 500 * 60_000, speed: 1 });
  const [focus, setFocus] = useState<number | null>(null);
  const data = useCandleWorkspaceData('BTCUSDT', '1', replay);
  const cursor = replay.status === 'idle' ? base : replay.cursorTimeMs;
  const visible = filterVisibleCandles(data.candles, cursor, '1');
  const [anchor, setAnchor] = useState(0);
  return <>
    <output id="state" data-count={data.candles.length} data-first={data.candles[0]?.timestampMs ?? 0}
      data-last={data.candles.at(-1)?.timestampMs ?? 0} data-cursor={cursor} data-visible={visible.length}
      data-anchor={anchor} data-loading={String(data.loading || data.isLoadingEarlier)} />
    <button id="reveal" onClick={() => {
      const time = data.candles.at(-1)!.timestampMs + 60_000;
      setReplay((prev) => prev.status === 'idle' ? prev : { ...prev, cursorTimeMs: time, progressTimeMs: time });
      setFocus(time - 120 * 60_000);
    }}>Reveal loaded</button>
    <button id="prefetch" onClick={() => void data.prefetchFuture()}>Prefetch</button>
    <button id="edge" onClick={() => {
      const time = data.candles[0].timestampMs + 60_000;
      setReplay((prev) => prev.status === 'idle' ? prev : { ...prev, cursorTimeMs: time });
    }}>Rewind edge</button>
    <button id="rewind" onClick={() => void data.previousReplayCursor().then((time) => {
      if (time !== null) setReplay((prev) => prev.status === 'idle' ? prev : { ...prev, cursorTimeMs: time });
    })}>Previous</button>
    <div style={{ width: 1000, height: 600 }}>
      <ChartCanvas candles={visible} symbol="BTCUSDT" interval="1" focusTimeMs={focus}
        onViewportAnchorChange={(time) => setAnchor(time)} showVolume />
    </div>
  </>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>);
