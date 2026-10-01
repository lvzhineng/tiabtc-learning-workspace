import { useState } from 'react';
import { formatChartTime } from '@/chart/chart-time';
import { TIMEFRAME_DISPLAY_MAP, type ReviewTimeframe } from '@/domain/timeframe';
import { addReplayBookmark, loadReplayBookmarks, saveReplayBookmarks, type ReplayBookmark } from './replay-bookmarks';

export function ReplayBookmarks({ market, symbol, timeframe, timestampMs, onJump }: {
  market: 'perpetual' | 'cfd'; symbol: string; timeframe: ReviewTimeframe;
  timestampMs: number | null; onJump: (bookmark: ReplayBookmark) => void;
}) {
  const [bookmarks, setBookmarks] = useState(() => loadReplayBookmarks(market));
  const [selected, setSelected] = useState('');
  const update = (next: ReplayBookmark[]) => { setBookmarks(next); saveReplayBookmarks(market, next); };
  return <div className="replay-bookmarks">
    <button type="button" className="ui-btn" disabled={timestampMs === null} title="保存当前定位时间，稍后从这里重新进入回放"
      onClick={() => { if (timestampMs !== null) { update(addReplayBookmark(bookmarks, { symbol, timeframe, timestampMs })); setSelected(''); } }}>添加时间书签</button>
    <select className="ui-input" aria-label="回放时间书签" value={selected} onChange={(event) => {
      setSelected(event.target.value);
      if (event.target.value === '') return;
      const bookmark = bookmarks[Number(event.target.value)];
      if (bookmark) onJump(bookmark);
    }}>
      <option value="">时间书签 ({bookmarks.length})</option>
      {bookmarks.map((bookmark, index) => <option key={`${bookmark.symbol}:${bookmark.timeframe}:${bookmark.timestampMs}`} value={index}>
        {bookmark.symbol} · {TIMEFRAME_DISPLAY_MAP[bookmark.timeframe]} · {formatChartTime(bookmark.timestampMs, bookmark.timeframe)}
      </option>)}
    </select>
    {selected !== '' && <button type="button" className="ui-btn" onClick={() => {
      update(bookmarks.filter((_, index) => index !== Number(selected))); setSelected('');
    }}>删除书签</button>}
  </div>;
}
