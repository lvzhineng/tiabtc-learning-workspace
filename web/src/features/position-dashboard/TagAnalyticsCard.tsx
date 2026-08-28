import { useMemo } from 'react';
import {
  positionPnl,
  type PositionTag,
  type ReviewPosition,
} from '@/api/position-review-api';
import { Tags } from 'lucide-react';

interface Props {
  positions: ReviewPosition[];
  tags: PositionTag[];
}

interface TagStat {
  id: number | string;
  name: string;
  color: string;
  count: number;
  winCount: number;
  lossCount: number;
  flatCount: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number | null;
}

export function TagAnalyticsCard({ positions, tags }: Props) {
  const stats: TagStat[] = useMemo(() => {
    const byTagId = new Map<number, ReviewPosition[]>();
    const untagged: ReviewPosition[] = [];
    for (const position of positions) {
      if (position.tagIds.length === 0) {
        untagged.push(position);
        continue;
      }
      for (const tagId of position.tagIds) {
        const bucket = byTagId.get(tagId);
        if (bucket) bucket.push(position);
        else byTagId.set(tagId, [position]);
      }
    }

    const toStat = (
      id: number | string,
      name: string,
      color: string,
      tagged: ReviewPosition[]
    ): TagStat => {
      let winCount = 0;
      let lossCount = 0;
      let totalWin = 0;
      let totalLoss = 0;
      let totalPnl = 0;
      for (const item of tagged) {
        const pnl = positionPnl(item);
        totalPnl += pnl;
        if (pnl > 0) {
          winCount += 1;
          totalWin += pnl;
        } else if (pnl < 0) {
          lossCount += 1;
          totalLoss += Math.abs(pnl);
        }
      }
      const count = tagged.length;
      const decided = winCount + lossCount;
      return {
        id,
        name,
        color,
        count,
        winCount,
        lossCount,
        flatCount: count - winCount - lossCount,
        winRate: decided > 0 ? (winCount / decided) * 100 : 0,
        totalPnl,
        profitFactor: totalLoss > 0 ? totalWin / totalLoss : null,
      };
    };

    const list: TagStat[] = [];
    for (const tag of tags) {
      const tagged = byTagId.get(tag.id);
      if (!tagged?.length) continue;
      list.push(toStat(tag.id, tag.name, tag.color, tagged));
    }
    if (untagged.length > 0) {
      list.push(toStat('untagged', '未打标仓位', '#64748b', untagged));
    }
    return list.sort((left, right) => right.totalPnl - left.totalPnl);
  }, [positions, tags]);

  if (stats.length === 0) {
    return (
      <div className="posdash-empty-state">
        <Tags size={28} />
        <span>暂无标签统计数据</span>
      </div>
    );
  }

  return (
    <div className="posdash-tag-list">
      {stats.map((item) => {
        const isProfit = item.totalPnl >= 0;
        const winPercent = item.winRate;
        const decided = item.winCount + item.lossCount;
        const lossPercent = decided > 0 ? (item.lossCount / decided) * 100 : 0;

        return (
          <div key={item.id} className="posdash-tag-card">
            <div className="posdash-tag-card-top">
              <div className="posdash-tag-identity">
                <span
                  className="posdash-tag-indicator"
                  style={{ backgroundColor: item.color }}
                />
                <span className="posdash-tag-title">{item.name}</span>
                <span className="posdash-tag-count-badge">{item.count} 笔</span>
              </div>

              <div className="posdash-tag-figures">
                {item.profitFactor != null && (
                  <span className="posdash-pf-badge" title="Profit Factor 盈亏比">
                    PF {item.profitFactor.toFixed(2)}
                  </span>
                )}
                <span
                  className={`posdash-tag-pnl-val ${
                    isProfit ? 'posrev-profit' : 'posrev-loss'
                  }`}
                >
                  {isProfit ? '+' : ''}
                  {item.totalPnl.toFixed(2)} USDT
                </span>
              </div>
            </div>

            {/* 双色胜负分割进度条 (电光青蓝与珊瑚粉) */}
            <div className="posdash-dual-track">
              {winPercent > 0 && (
                <div
                  className="posdash-dual-bar win"
                  style={{ width: `${winPercent}%` }}
                  title={`胜率: ${winPercent.toFixed(1)}%`}
                />
              )}
              {lossPercent > 0 && (
                <div
                  className="posdash-dual-bar loss"
                  style={{ width: `${lossPercent}%` }}
                  title={`败率: ${lossPercent.toFixed(1)}%`}
                />
              )}
            </div>

            <div className="posdash-tag-card-bottom">
              <span>
                胜率: <strong>{winPercent.toFixed(1)}%</strong>
              </span>
              <span className="posdash-tag-winloss-split">
                <span className="win-text">{item.winCount} 胜</span>
                <span>/</span>
                <span className="loss-text">{item.lossCount} 负</span>
                {item.flatCount > 0 && <span>/ {item.flatCount} 平</span>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
