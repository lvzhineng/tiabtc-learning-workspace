import { useMemo } from 'react';
import { positionPnl, type ReviewPosition } from '@/api/position-review-api';
import { Layers } from 'lucide-react';

interface Props {
  positions: ReviewPosition[];
}

interface SymbolStat {
  symbol: string;
  count: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
}

export function SymbolLeaderboardCard({ positions }: Props) {
  const { stats, maxAbsPnl } = useMemo(() => {
    const map = new Map<
      string,
      { count: number; winCount: number; lossCount: number; totalPnl: number }
    >();

    for (const p of positions) {
      const sym = p.chartSymbol;
      const current = map.get(sym) || {
        count: 0,
        winCount: 0,
        lossCount: 0,
        totalPnl: 0,
      };
      const pnl = positionPnl(p);

      current.count += 1;
      if (pnl > 0) current.winCount += 1;
      else if (pnl < 0) current.lossCount += 1;
      current.totalPnl += pnl;
      map.set(sym, current);
    }

    const list: SymbolStat[] = [];
    let maxAbs = 1;
    for (const [symbol, data] of map.entries()) {
      if (Math.abs(data.totalPnl) > maxAbs) {
        maxAbs = Math.abs(data.totalPnl);
      }
      list.push({
        symbol,
        count: data.count,
        winCount: data.winCount,
        lossCount: data.lossCount,
        winRate:
          data.winCount + data.lossCount > 0
            ? (data.winCount / (data.winCount + data.lossCount)) * 100
            : 0,
        totalPnl: data.totalPnl,
      });
    }

    // Sort by totalPnl descending
    return {
      stats: list.sort((a, b) => b.totalPnl - a.totalPnl),
      maxAbsPnl: maxAbs,
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
        const isProfit = item.totalPnl >= 0;
        const barWidth = Math.min(100, (Math.abs(item.totalPnl) / maxAbsPnl) * 100);

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
                <span
                  className={`posdash-symbol-pnl-val ${
                    isProfit ? 'posrev-profit' : 'posrev-loss'
                  }`}
                >
                  {isProfit ? '+' : ''}
                  {item.totalPnl.toFixed(2)} USDT
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
