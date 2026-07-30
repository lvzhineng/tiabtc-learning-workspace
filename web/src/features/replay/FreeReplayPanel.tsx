import { useState, useEffect } from 'react';
import type { ReplayState } from './replay-state';
import { formatDateTimeLocalInput, parseDateTimeInput } from './free-replay-logic';
import { formatChartTime } from '@/chart/chart-time';
import type { ReviewTimeframe } from '@/domain/timeframe';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  PlayCircle,
  XCircle,
  Clock,
  Gauge,
} from 'lucide-react';

interface FreeReplayPanelProps {
  replayState: ReplayState;
  activeSymbol: string;
  activeTimeframe: ReviewTimeframe;
  onStartReplay: (symbol: string, startTimeMs: number) => void;
  onStopReplay: () => void;
  onNextBar: () => void;
  onPrevBar: () => void;
  onTogglePlay: () => void;
  onSetSpeed: (speed: number) => void;
}

const SPEEDS = [1, 2, 5, 10];

export function FreeReplayPanel({
  replayState,
  activeSymbol,
  activeTimeframe,
  onStartReplay,
  onStopReplay,
  onNextBar,
  onPrevBar,
  onTogglePlay,
  onSetSpeed,
}: FreeReplayPanelProps) {
  // Default start time: 30 days ago
  const defaultStartTimeMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const [startTimeInput, setStartTimeInput] = useState<string>(
    formatDateTimeLocalInput(defaultStartTimeMs)
  );
  const [showModal, setShowModal] = useState<boolean>(false);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    if (replayState.status === 'idle') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName.toUpperCase())
      ) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onPrevBar();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNextBar();
      } else if (e.key === ' ') {
        e.preventDefault();
        onTogglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [replayState.status, onNextBar, onPrevBar, onTogglePlay]);

  if (replayState.status === 'idle') {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          style={{
            background: 'var(--bg-dark-700)',
            color: 'var(--accent-orange)',
            border: '1px solid var(--accent-orange)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px 10px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <PlayCircle size={14} />
          <span>自由回放 (Free Replay)</span>
        </button>

        {showModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.65)',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              className="app-card"
              style={{
                width: '380px',
                background: 'var(--bg-dark-800)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '20px',
                color: 'var(--text-primary)',
              }}
            >
              <h3 style={{ fontSize: '16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PlayCircle size={18} color="var(--accent-orange)" />
                启动自由回放 (Free Replay)
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                选择回放起点时间，系统将隐藏起点之后的全部未来 Candlestick，供您逐步推演。
              </p>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Target Symbol
                </label>
                <input
                  type="text"
                  value={activeSymbol}
                  disabled
                  style={{
                    width: '100%',
                    background: 'var(--bg-dark-700)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    fontSize: '13px',
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  回放起点时间 (Start Time)
                </label>
                <input
                  type="datetime-local"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-dark-700)',
                    color: '#fff',
                    border: '1px solid var(--accent-blue)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 12px',
                    cursor: 'pointer',
                  }}
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    const parsedMs = parseDateTimeInput(startTimeInput);
                    onStartReplay(activeSymbol, parsedMs);
                    setShowModal(false);
                  }}
                  style={{
                    background: 'var(--accent-orange)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  开始回放
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Active Replay Control Bar
  const activeReplay = replayState;
  const isPlaying = activeReplay.status === 'playing';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: 'rgba(255, 152, 0, 0.12)',
        border: '1px solid var(--accent-orange)',
        borderRadius: 'var(--radius-sm)',
        padding: '2px 10px',
      }}
    >
      {/* Status Badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--accent-orange)', fontWeight: 600 }}>
        <Clock size={14} />
        <span>
          {isPlaying ? '播放中' : activeReplay.status === 'completed' ? '回放完结' : '自由复盘'}
        </span>
      </div>

      {/* Progress Date Display */}
      <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
        揭示至: {formatChartTime(activeReplay.cursorTimeMs, activeTimeframe)}
      </div>

      <div style={{ width: '1px', height: '14px', background: 'var(--border-color)' }} />

      {/* Controls: Prev, Play/Pause, Next */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button
          onClick={onPrevBar}
          title="上一根 (Left Arrow)"
          style={{
            background: 'var(--bg-dark-700)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px 6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <SkipBack size={14} />
        </button>

        <button
          onClick={onTogglePlay}
          title={isPlaying ? '暂停 (Space)' : '自动播放 (Space)'}
          style={{
            background: isPlaying ? 'var(--accent-orange)' : 'var(--accent-blue)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '3px 10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontWeight: 600,
            fontSize: '12px',
          }}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          <span>{isPlaying ? '暂停' : '播放'}</span>
        </button>

        <button
          onClick={onNextBar}
          title="下一根 (Right Arrow)"
          style={{
            background: 'var(--bg-dark-700)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px 6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <SkipForward size={14} />
        </button>
      </div>

      {/* Speed Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: 'var(--bg-dark-800)', padding: '2px', borderRadius: 'var(--radius-sm)' }}>
        <Gauge size={12} color="var(--text-muted)" style={{ margin: '0 4px' }} />
        {SPEEDS.map((spd) => {
          const active = activeReplay.speed === spd;
          return (
            <button
              key={spd}
              onClick={() => onSetSpeed(spd)}
              style={{
                background: active ? 'var(--accent-blue)' : 'transparent',
                color: active ? '#fff' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                fontSize: '11px',
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {spd}x
            </button>
          );
        })}
      </div>

      {/* Exit Replay Button */}
      <button
        onClick={onStopReplay}
        title="退出自由回放"
        style={{
          background: 'transparent',
          color: 'var(--accent-red)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          padding: '2px',
          marginLeft: '4px',
        }}
      >
        <XCircle size={16} />
      </button>
    </div>
  );
}
