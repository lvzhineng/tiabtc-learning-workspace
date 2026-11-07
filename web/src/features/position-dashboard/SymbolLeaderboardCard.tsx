import { useMemo } from 'react';
import { positionPnl, type ReviewPosition } from '@/api/position-review-api';
import { Layers } from 'lucide-react';
import { positionStatisticsCurrency, type ReviewCurrency } from '@/features/position-review/position-review-types';

interface Props {
  currency?: ReviewCurrency;
  positions: ReviewPosition[];
}

interface SymbolStat {
  symbol: string;
  count: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  pnlByCurrency: Record<string, number>;
}

export function SymbolLeaderboardCard({ positions }: Props) {
  const { stats, maxCount } = useMemo(() => {
    const map = new Map<
      string,
      { count: number; winCount: number; lossCount: number; pnlByCurrency: Record<string, number> }
    >();

    for (const p of positions) {
      const sym = p.chartSymbol;
      const current = map.get(sym) || {
        count: 0,
        winCount: 0,
        lossCount: 0,
        pnlByCurrency: {},
      };
      const pnl = positionPnl(p);

      current.count += 1;
      if (pnl > 0) current.winCount += 1;
      else if (pnl < 0) current.lossCount += 1;
      const unit = positionStatisticsCurrency(p);
      current.pnlByCurrency[unit] = (current.pnlByCurrency[unit] || 0) + pnl;
      map.set(sym, current);
    }

    const list: SymbolStat[] = [];
    let max = 1;
    for (const [symbol, data] of map.entries()) {
      max = Math.max(max, data.count);
      list.push({
        symbol,
        count: data.count,
        winCount: data.winCount,
        lossCount: data.lossCount,
        winRate:
          data.winCount + data.lossCount > 0
            ? (data.winCount / (data.winCount + data.lossCount)) * 100
            : 0,
        pnlByCurrency: data.pnlByCurrency,
      });
    }

    // Put the most frequently traded symbols first; monetary amounts use separate currency units.
    return {
      stats: list.sort((a, b) => b.count - a.count),
      maxCount: max,
    };
  }, [positions]);

  if (stats.length === 0) {
    return (
      <div className="posdash-empty-state">
        <Layers size={28} />
        <span>暂无交易对数据</span>
      </div>
    );
  }

  const getRankBadge = (index: number) => {
    if (index === 0) return <span className="posdash-rank-medal gold">1</span>;
    if (index === 1) return <span className="posdash-rank-medal silver">2</span>;
    if (index === 2) return <span className="posdash-rank-medal bronze">3</span>;
    return <span className="posdash-rank-medal normal">{index + 1}</span>;
  };

  return (
    <div className="posdash-symbol-list">
      {stats.map((item, index) => {
        const isProfit = item.winRate >= 50;
        const barWidth = Math.min(100, (item.count / maxCount) * 100);

        return (
          <div key={item.symbol} className="posdash-symbol-card">
            {/* 相对盈亏比例背景微光 (电光青蓝与珊瑚粉) */}
            <div
              className={`posdash-symbol-ambient-bar ${isProfit ? 'profit' : 'loss'}`}
              style={{ width: `${barWidth.toFixed(1)}%` }}
            />

            <div className="posdash-symbol-content">
              <div className="posdash-symbol-main">
                {getRankBadge(index)}
                <span className="posdash-symbol-ticker">{item.symbol}</span>
                <span className="posdash-symbol-meta-pill">
                  {item.count} 笔 · 胜率 {item.winRate.toFixed(0)}%
                </span>
              </div>

              <div className="posdash-symbol-right">
                {Object.entries(item.pnlByCurrency).map(([unit, amount]) => (
                  <span key={unit} className={`posdash-symbol-pnl-val ${amount >= 0 ? 'posrev-profit' : 'posrev-loss'}`}>
                    {amount >= 0 ? '+' : ''}{amount.toFixed(2)} {unit === '未标注币种' ? '文件原值（未标注币种）' : unit}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
