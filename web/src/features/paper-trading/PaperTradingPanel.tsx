import { useState, useEffect } from 'react';
import type {
  PaperTradeItem,
  PaperTradeStats,
  PositionToolParams,
  TradeType,
} from './paper-trade-types';
import { calculateRR, computePaperTradeStats } from './paper-trade-logic';
import { X, Target, Trash2 } from 'lucide-react';
import '@/styles/paper-trading.css';

interface Props {
  symbol: string;
  currentPrice: number;
  trades: PaperTradeItem[];
  pendingPositionParams?: PositionToolParams | null;
  onClosePanel: () => void;
  onCreateTrade: (trade: Omit<PaperTradeItem, 'id' | 'createdAt' | 'closedAt'>) => void;
  onCloseTrade: (id: string, closePrice: number, forceStatus?: 'WIN' | 'LOSS') => void;
  onDeleteTrade: (id: string) => void;
}

export function PaperTradingPanel({
  symbol,
  currentPrice,
  trades,
  pendingPositionParams,
  onClosePanel,
  onCreateTrade,
  onCloseTrade,
  onDeleteTrade,
}: Props) {
  const [tradeType, setTradeType] = useState<TradeType>('LONG');
  const [entryPrice, setEntryPrice] = useState<string>(
    currentPrice > 0 ? String(currentPrice) : ''
  );
  const [tpPrice, setTpPrice] = useState<string>('');
  const [slPrice, setSlPrice] = useState<string>('');

  // Pre-fill form if pendingPositionParams changes
  useEffect(() => {
    if (pendingPositionParams) {
      setTradeType(pendingPositionParams.type);
      setEntryPrice(String(pendingPositionParams.entryPrice));
      setTpPrice(String(pendingPositionParams.tpPrice));
      setSlPrice(String(pendingPositionParams.slPrice));
    }
  }, [pendingPositionParams]);

  const stats: PaperTradeStats = computePaperTradeStats(trades);

  const numEntry = Number(entryPrice) || 0;
  const numTp = Number(tpPrice) || 0;
  const numSl = Number(slPrice) || 0;

  const currentRR = calculateRR(tradeType, numEntry, numTp, numSl);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!numEntry || !numTp || !numSl) {
      alert('请输入完整的开仓价、止盈价和止损价');
      return;
    }
    if (currentRR <= 0) {
      alert(
        tradeType === 'LONG'
          ? '做多必须满足：止盈价 > 开仓价 > 止损价'
          : '做空必须满足：止盈价 < 开仓价 < 止损价'
      );
      return;
    }

    onCreateTrade({
      videoId: '',
      symbol,
      interval: '60',
      direction: tradeType,
      entryPrice: numEntry,
      takeProfitPrice: numTp,
      stopLossPrice: numSl,
      riskRewardRatio: currentRR,
      status: 'OPEN',
      pnlR: 0,
    });
  };

  return (
    <div className="paper-trading-drawer">
      {/* Header */}
      <div className="paper-trading-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Target size={16} color="var(--accent-blue)" />
          <span>模拟复盘开仓 ({symbol})</span>
        </div>
        <button
          onClick={onClosePanel}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Stats Cards Row */}
      <div className="paper-trading-stats-row">
        <div className="paper-stat-box">
          <span className="paper-stat-label">总单数 / 持仓</span>
          <span className="paper-stat-val" style={{ color: 'var(--text-primary)' }}>
            {stats.totalTrades} ({stats.openCount})
          </span>
        </div>
        <div className="paper-stat-box">
          <span className="paper-stat-label">胜率 (%)</span>
          <span className="paper-stat-val" style={{ color: 'var(--accent-green)' }}>
            {stats.winRatePercent}%
          </span>
        </div>
        <div className="paper-stat-box">
          <span className="paper-stat-label">净收益 (R)</span>
          <span
            className="paper-stat-val"
            style={{ color: stats.totalR >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}
          >
            {stats.totalR > 0 ? `+${stats.totalR}` : stats.totalR}R
          </span>
        </div>
      </div>

      {/* Open Trade Form */}
      <form onSubmit={handleSubmit} className="paper-form">
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            onClick={() => setTradeType('LONG')}
            style={{
              flex: 1,
              background: tradeType === 'LONG' ? 'var(--accent-green)' : 'var(--bg-dark-700)',
              color: tradeType === 'LONG' ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '6px',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            做多 (LONG)
          </button>
          <button
            type="button"
            onClick={() => setTradeType('SHORT')}
            style={{
              flex: 1,
              background: tradeType === 'SHORT' ? 'var(--accent-red)' : 'var(--bg-dark-700)',
              color: tradeType === 'SHORT' ? '#fff' : 'var(--text-secondary)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              padding: '6px',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            做空 (SHORT)
          </button>
        </div>

        <div className="paper-form-row">
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', width: '48px' }}>开仓价</span>
          <input
            type="number"
            step="any"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            className="paper-form-input"
            placeholder="Entry Price"
          />
        </div>

        <div className="paper-form-row">
          <span style={{ fontSize: '11px', color: 'var(--accent-green)', width: '48px' }}>止盈位</span>
          <input
            type="number"
            step="any"
            value={tpPrice}
            onChange={(e) => setTpPrice(e.target.value)}
            className="paper-form-input"
            placeholder="TP Price"
          />
        </div>

        <div className="paper-form-row">
          <span style={{ fontSize: '11px', color: 'var(--accent-red)', width: '48px' }}>止损位</span>
          <input
            type="number"
            step="any"
            value={slPrice}
            onChange={(e) => setSlPrice(e.target.value)}
            className="paper-form-input"
            placeholder="SL Price"
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
          <span>预期盈亏比 R:R</span>
          <strong style={{ color: 'var(--text-primary)' }}>{currentRR} R</strong>
        </div>

        <button
          type="submit"
          style={{
            background: tradeType === 'LONG' ? 'var(--accent-green)' : 'var(--accent-red)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            padding: '8px',
            fontWeight: 700,
            fontSize: '12px',
            cursor: 'pointer',
            marginTop: '4px',
          }}
        >
          提交模拟开仓 ({tradeType === 'LONG' ? '买多' : '卖空'})
        </button>
      </form>

      {/* Trades List */}
      <div className="paper-trade-list">
        {trades.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '12px' }}>
            暂无模拟交易记录
          </div>
        ) : (
          trades.map((t) => (
            <div key={t.id} className="paper-trade-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className={t.direction === 'LONG' ? 'paper-badge-long' : 'paper-badge-short'}>
                    {t.direction}
                  </span>
                  <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{t.entryPrice}</span>
                </div>

                {t.status === 'OPEN' ? (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      onClick={() => onCloseTrade(t.id, currentPrice, 'WIN')}
                      style={{
                        background: 'rgba(8, 153, 129, 0.2)',
                        color: 'var(--accent-green)',
                        border: '1px solid var(--accent-green)',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      止盈结单
                    </button>
                    <button
                      onClick={() => onCloseTrade(t.id, currentPrice, 'LOSS')}
                      style={{
                        background: 'rgba(242, 54, 69, 0.2)',
                        color: 'var(--accent-red)',
                        border: '1px solid var(--accent-red)',
                        borderRadius: '3px',
                        padding: '2px 6px',
                        fontSize: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      止损平仓
                    </button>
                  </div>
                ) : (
                  <span className={t.status === 'WIN' ? 'paper-badge-win' : 'paper-badge-loss'}>
                    {t.status === 'WIN' ? `+${t.pnlR}R` : `${t.pnlR}R`}
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '6px',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>TP: {t.takeProfitPrice}</span>
                <span>SL: {t.stopLossPrice}</span>
                <button
                  onClick={() => onDeleteTrade(t.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
