import { memo } from 'react';
import { BarChart2 } from 'lucide-react';
import type { ReadoutInfo } from '@/chart/candlestick-readout';
import { formatChartTime } from '@/chart/chart-time';
import {
  TIMEFRAME_DISPLAY_MAP,
  type ReviewTimeframe,
} from '@/domain/timeframe';

type Props = {
  symbol: string;
  timeframe: ReviewTimeframe;
  readout: ReadoutInfo | null;
};

export const ChartReadoutBar = memo(function ChartReadoutBar({
  symbol,
  timeframe,
  readout,
}: Props) {
  return (
    <div
      style={{
        height: '32px',
        background: 'var(--bg-dark-800)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        fontSize: '12px',
        gap: '16px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          color: 'var(--text-primary)',
          fontWeight: 600,
        }}
      >
        <BarChart2 size={14} color="var(--accent-blue)" />
        <span>{symbol}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          ({TIMEFRAME_DISPLAY_MAP[timeframe]})
        </span>
      </div>

      {readout ? (
        <>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>时间: </span>
            <span>{formatChartTime(readout.candle!.timestampMs, timeframe)}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>O: </span>
            <span>{readout.formattedOpen}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>H: </span>
            <span>{readout.formattedHigh}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>L: </span>
            <span>{readout.formattedLow}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>C: </span>
            <span
              style={{
                color: readout.isUp
                  ? 'var(--accent-green)'
                  : 'var(--accent-red)',
              }}
            >
              {readout.formattedClose}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>幅: </span>
            <span
              style={{
                color: readout.isUp
                  ? 'var(--accent-green)'
                  : 'var(--accent-red)',
              }}
            >
              {readout.formattedChange}
            </span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Vol: </span>
            <span>{readout.formattedVolume}</span>
          </div>
          {readout.formattedOi != null && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>OI: </span>
              <span>{readout.formattedOi}</span>
            </div>
          )}
          {readout.formattedCvd != null && (
            <div>
              <span style={{ color: 'var(--text-muted)' }}>CVD: </span>
              <span>{readout.formattedCvd}</span>
            </div>
          )}
        </>
      ) : (
        <div style={{ color: 'var(--text-muted)' }}>
          暂无 Candlestick 数据
        </div>
      )}
    </div>
  );
});
