import { useMemo, useState } from 'react';
import type { ReviewPosition } from '@/api/position-review-api';
import { positionPnl } from '@/features/position-review/position-review-types';
import { formatNumber } from '@/features/position-review/position-review-format';
import '@/styles/trading-calendar-heatmap.css';

interface TradingCalendarHeatmapProps {
  positions: ReviewPosition[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  anchorEndMs?: number;
}

interface DayStats {
  dateStr: string;
  dayOfWeek: number; // 0: Sun, 1: Mon, ...
  pnl: number;
  count: number;
  winCount: number;
  lossCount: number;
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

// Asia/Shanghai YYYY-MM-DD
function formatShanghaiDate(timestampMs: number): string {
  if (!timestampMs || Number.isNaN(timestampMs)) return '';
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value || '1970';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

export function TradingCalendarHeatmap({
  positions,
  selectedDate,
  onSelectDate,
  anchorEndMs,
}: TradingCalendarHeatmapProps) {
  const [hoveredDay, setHoveredDay] = useState<DayStats | null>(null);

  // Group positions by Shanghai YYYY-MM-DD
  const dailyMap = useMemo(() => {
    const map = new Map<string, { pnl: number; count: number; winCount: number; lossCount: number }>();
    for (const p of positions) {
      const timeMs = p.exitTimeMs ?? p.entryTimeMs;
      if (!timeMs || Number.isNaN(timeMs)) continue;
      const dateStr = formatShanghaiDate(timeMs);
      if (!dateStr) continue;
      const pnl = positionPnl(p);
      const current = map.get(dateStr) || { pnl: 0, count: 0, winCount: 0, lossCount: 0 };
      current.pnl += pnl;
      current.count += 1;
      if (pnl > 0) current.winCount += 1;
      else if (pnl < 0) current.lossCount += 1;
      map.set(dateStr, current);
    }
    return map;
  }, [positions]);

  // Generate 12 weeks grid ending at reference week's Sunday
  const weeks = useMemo(() => {
    let latestTimeMs = anchorEndMs;
    if (latestTimeMs == null) {
      let maxTime = 0;
      for (const p of positions) {
        const t = p.exitTimeMs ?? p.entryTimeMs;
        if (t && !Number.isNaN(t) && t > maxTime) maxTime = t;
      }
      latestTimeMs = maxTime > 0 ? maxTime : Date.now();
    }

    const refDate = new Date(latestTimeMs);
    // find Sunday of reference week
    const currentDay = refDate.getDay(); // 0 is Sun
    const daysToSun = currentDay === 0 ? 0 : 7 - currentDay;
    const endSun = new Date(refDate);
    endSun.setDate(refDate.getDate() + daysToSun);
    endSun.setHours(12, 0, 0, 0);

    const totalDays = 12 * 7;
    const startMon = new Date(endSun);
    startMon.setDate(endSun.getDate() - totalDays + 1);
    startMon.setHours(12, 0, 0, 0);

    const grid: DayStats[][] = [];
    let currentWeek: DayStats[] = [];

    const cursor = new Date(startMon);
    for (let i = 0; i < totalDays; i++) {
      const dateStr = formatShanghaiDate(cursor.getTime());
      const stats = dailyMap.get(dateStr);
      const dayOfWeek = (cursor.getDay() + 6) % 7; // Convert 0(Sun)..6(Sat) to 0(Mon)..6(Sun)

      currentWeek.push({
        dateStr,
        dayOfWeek,
        pnl: stats?.pnl || 0,
        count: stats?.count || 0,
        winCount: stats?.winCount || 0,
        lossCount: stats?.lossCount || 0,
      });

      if (currentWeek.length === 7) {
        grid.push(currentWeek);
        currentWeek = [];
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return grid;
  }, [anchorEndMs, dailyMap, positions]);

  return (
    <div className="cal-heatmap-root">
      <div className="cal-heatmap-wrapper">
        <div className="cal-heatmap-sidebar">
          {WEEKDAY_LABELS.map((label, idx) => (
            <span
              key={label}
              className={`cal-weekday-label ${idx % 2 === 0 ? 'visible' : ''}`}
            >
              {idx % 2 === 0 ? label : ''}
            </span>
          ))}
        </div>

        <div className="cal-heatmap-grid">
          {weeks.map((week, wIdx) => (
            <div key={wIdx} className="cal-heatmap-col">
              {week.map((day) => {
                let cellClass = 'cal-cell-empty';
                if (day.count > 0) {
                  if (day.pnl > 0) {
                    cellClass =
                      day.pnl > 300
                        ? 'cal-cell-profit-high'
                        : day.pnl > 80
                        ? 'cal-cell-profit-mid'
                        : 'cal-cell-profit-low';
                  } else if (day.pnl < 0) {
                    cellClass =
                      day.pnl < -300
                        ? 'cal-cell-loss-high'
                        : day.pnl < -80
                        ? 'cal-cell-loss-mid'
                        : 'cal-cell-loss-low';
                  } else {
                    cellClass = 'cal-cell-even';
                  }
                }

                const isSelected = selectedDate === day.dateStr;

                return (
                  <button
                    key={day.dateStr}
                    type="button"
                    className={`cal-cell ${cellClass} ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      if (day.count === 0) return;
                      onSelectDate(selectedDate === day.dateStr ? null : day.dateStr);
                    }}
                    onMouseEnter={() => setHoveredDay(day)}
                    onMouseLeave={() => setHoveredDay(null)}
                    title={
                      day.count > 0
                        ? `${day.dateStr}: ${day.pnl >= 0 ? '+' : ''}${formatNumber(day.pnl)} USDT (${day.count} 笔)`
                        : `${day.dateStr}: 无交易`
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="cal-heatmap-footer">
        <div className="cal-heatmap-legend">
          <span>亏损</span>
          <span className="cal-legend-dot cal-cell-loss-high" />
          <span className="cal-legend-dot cal-cell-loss-mid" />
          <span className="cal-legend-dot cal-cell-loss-low" />
          <span className="cal-legend-dot cal-cell-empty" />
          <span className="cal-legend-dot cal-cell-profit-low" />
          <span className="cal-legend-dot cal-cell-profit-mid" />
          <span className="cal-legend-dot cal-cell-profit-high" />
          <span>盈利</span>
        </div>

        <div className="cal-heatmap-tip">
          {hoveredDay ? (
            hoveredDay.count > 0 ? (
              <span>
                <strong>{hoveredDay.dateStr}</strong> 净盈亏:{' '}
                <strong className={hoveredDay.pnl >= 0 ? 'posrev-profit' : 'posrev-loss'}>
                  {hoveredDay.pnl >= 0 ? '+' : ''}{formatNumber(hoveredDay.pnl)} USDT
                </strong>{' '}
                ({hoveredDay.count} 笔 · {hoveredDay.winCount} 胜 {hoveredDay.lossCount} 负)
              </span>
            ) : (
              <span>{hoveredDay.dateStr} 无平仓交易</span>
            )
          ) : selectedDate ? (
            <span>
              当前已过滤 <strong>{selectedDate}</strong> 的交易（点击该单元格可重置）
            </span>
          ) : (
            <span>鼠标悬停查看各日盈亏，点击任意有交易的格子可快速过滤当日日记</span>
          )}
        </div>
      </div>
    </div>
  );
}
