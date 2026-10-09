import { Fragment, useMemo, useState, type CSSProperties } from 'react';
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

  const summary = useMemo(() => {
    let maxAbsPnl = 0;
    let tradingDays = 0;
    let profitDays = 0;
    let lossDays = 0;
    let totalPnl = 0;
    let best: DayStats | null = null;
    let worst: DayStats | null = null;
    for (const week of weeks) {
      for (const day of week) {
        if (day.count === 0) continue;
        tradingDays += 1;
        totalPnl += day.pnl;
        if (day.pnl > 0) profitDays += 1;
        else if (day.pnl < 0) lossDays += 1;
        maxAbsPnl = Math.max(maxAbsPnl, Math.abs(day.pnl));
        if (!best || day.pnl > best.pnl) best = day;
        if (!worst || day.pnl < worst.pnl) worst = day;
      }
    }
    return { maxAbsPnl, tradingDays, profitDays, lossDays, totalPnl, best, worst };
  }, [weeks]);

  const monthLabels = useMemo(
    () =>
      weeks.map((week, index) => {
        const month = Number(week[0].dateStr.slice(5, 7));
        const previousMonth = index > 0 ? Number(weeks[index - 1][0].dateStr.slice(5, 7)) : null;
        return month !== previousMonth ? `${month}月` : '';
      }),
    [weeks]
  );

  const cellClassFor = (day: DayStats): string => {
    if (day.count === 0) return 'cal-cell-empty';
    if (day.pnl === 0 || summary.maxAbsPnl === 0) return 'cal-cell-even';
    const ratio = Math.abs(day.pnl) / summary.maxAbsPnl;
    const level = ratio > 0.66 ? 'high' : ratio > 0.33 ? 'mid' : 'low';
    return `cal-cell-${day.pnl > 0 ? 'profit' : 'loss'}-${level}`;
  };

  const focusDay = hoveredDay ?? (selectedDate ? weeks.flat().find((day) => day.dateStr === selectedDate) ?? null : null);

  return (
    <div className="cal-heatmap-root">
      <div className="cal-heatmap-board" style={{ '--cal-weeks': weeks.length } as CSSProperties}>
        <span />
        {monthLabels.map((label, index) => (
          <span key={`m-${index}`} className="cal-month-label">
            {label}
          </span>
        ))}
        {WEEKDAY_LABELS.map((weekday, row) => (
          <Fragment key={weekday}>
            <span className="cal-weekday-label">{row % 2 === 0 ? weekday : ''}</span>
            {weeks.map((week) => {
              const day = week[row];
              const isSelected = selectedDate === day.dateStr;
              return (
                <button
                  key={day.dateStr}
                  type="button"
                  className={`cal-cell ${cellClassFor(day)} ${isSelected ? 'selected' : ''}`}
                  disabled={day.count === 0}
                  onClick={() => onSelectDate(isSelected ? null : day.dateStr)}
                  onMouseEnter={() => setHoveredDay(day)}
                  onMouseLeave={() => setHoveredDay(null)}
                  aria-label={
                    day.count > 0
                      ? `${day.dateStr}: ${day.pnl >= 0 ? '+' : ''}${formatNumber(day.pnl)} USDT (${day.count} 笔)`
                      : `${day.dateStr}: 无交易`
                  }
                />
              );
            })}
          </Fragment>
        ))}
      </div>

      <div className="cal-heatmap-footer">
        <div className="cal-heatmap-tip">
          {focusDay ? (
            focusDay.count > 0 ? (
              <>
                <strong>{focusDay.dateStr}</strong>
                <strong className={focusDay.pnl >= 0 ? 'posrev-profit' : 'posrev-loss'}>
                  {focusDay.pnl >= 0 ? '+' : ''}
                  {formatNumber(focusDay.pnl)} USDT
                </strong>
                <span>
                  {focusDay.count} 笔 · {focusDay.winCount} 胜 {focusDay.lossCount} 负
                </span>
              </>
            ) : (
              <span>{focusDay.dateStr} 无平仓交易</span>
            )
          ) : (
            <span>悬停查看当日盈亏，点击格子筛选下方日记</span>
          )}
        </div>
        <div className="cal-heatmap-legend">
          <span>亏</span>
          <span className="cal-legend-dot cal-cell-loss-high" />
          <span className="cal-legend-dot cal-cell-loss-mid" />
          <span className="cal-legend-dot cal-cell-loss-low" />
          <span className="cal-legend-dot cal-cell-empty" />
          <span className="cal-legend-dot cal-cell-profit-low" />
          <span className="cal-legend-dot cal-cell-profit-mid" />
          <span className="cal-legend-dot cal-cell-profit-high" />
          <span>盈</span>
        </div>
      </div>

      <div className="cal-heatmap-stats">
        <div>
          <span>交易日</span>
          <strong>{summary.tradingDays}</strong>
        </div>
        <div>
          <span>盈 / 亏日</span>
          <strong>
            <em className="posrev-profit">{summary.profitDays}</em>
            {' / '}
            <em className="posrev-loss">{summary.lossDays}</em>
          </strong>
        </div>
        <div>
          <span>最佳单日</span>
          <strong className={summary.best && summary.best.pnl > 0 ? 'posrev-profit' : undefined}>
            {summary.best ? `${summary.best.pnl >= 0 ? '+' : ''}${formatNumber(summary.best.pnl)}` : '—'}
          </strong>
        </div>
        <div>
          <span>最差单日</span>
          <strong className={summary.worst && summary.worst.pnl < 0 ? 'posrev-loss' : undefined}>
            {summary.worst ? `${summary.worst.pnl >= 0 ? '+' : ''}${formatNumber(summary.worst.pnl)}` : '—'}
          </strong>
        </div>
      </div>
    </div>
  );
}
