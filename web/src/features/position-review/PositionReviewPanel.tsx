import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { savePositionNote } from '@/api/position-review-api';
import { PositionTagEditor } from './PositionTagEditor';
import { toast } from '@/ui/feedback/toast';
import { formatPrice, pricePrecision } from '@/chart/chart-price';
import {
  readLocalUiState,
  storedBoolean,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import {
  FILL_KIND_LABEL,
  calculatePositionRoi,
  formatHoldingDuration,
  formatLeverage,
  formatNumber,
  formatRoiWithHint,
  formatShanghaiTimeShort,
} from './position-review-format';
import {
  positionPnl,
  venueLabel,
  positionCurrency,
  type PositionTag,
  type ReviewPosition,
} from './position-review-types';

const POSITION_DETAIL_TAB_STORAGE_KEY = 'tiabtc-position-detail-tab-v1';

function loadOperationsExpanded(): boolean {
  const state = readLocalUiState(POSITION_DETAIL_TAB_STORAGE_KEY);
  return storedBoolean(state.operationsExpanded, state.activeTab === 'operations');
}

export function PositionReviewPanel({
  position,
  positions,
  tags,
  onChange,
  onTagIdsChange,
  onTagsCreated,
  onTagDeleted,
}: {
  position: ReviewPosition;
  positions: ReviewPosition[];
  tags: PositionTag[];
  onChange: (position: ReviewPosition) => void;
  onTagIdsChange: (position: ReviewPosition, tagIds: number[]) => void;
  onTagsCreated: (tag: PositionTag) => void;
  onTagDeleted: (tagId: number) => void;
}) {
  const [note, setNote] = useState(position.note);
  const [saving, setSaving] = useState(false);
  const [operationsExpanded, setOperationsExpanded] = useState(loadOperationsExpanded);
  const positionRef = useRef(position);
  const noteSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingNoteSaveCountRef = useRef(0);
  const noteRevisionRef = useRef(0);
  positionRef.current = position;

  useEffect(() => {
    setNote(position.note);
  }, [position.note, position.positionId]);

  useEffect(() => {
    writeLocalUiState(POSITION_DETAIL_TAB_STORAGE_KEY, { operationsExpanded });
  }, [operationsExpanded]);

  const persistNote = (value: string): Promise<void> => {
    const target = positionRef.current;
    if (value === target.note && pendingNoteSaveCountRef.current === 0) {
      return Promise.resolve();
    }
    pendingNoteSaveCountRef.current += 1;
    const revision = ++noteRevisionRef.current;
    setSaving(true);
    const request = noteSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await savePositionNote({
          venue: target.venue,
          positionId: target.positionId,
          note: value,
        });
        if (
          positionRef.current.positionId !== target.positionId ||
          revision !== noteRevisionRef.current
        ) {
          return;
        }
        onChange({ ...positionRef.current, note: value });
      })
      .catch((cause) => {
        toast.error(cause instanceof Error ? cause.message : '备注保存失败');
      })
      .finally(() => {
        pendingNoteSaveCountRef.current -= 1;
        if (pendingNoteSaveCountRef.current === 0) setSaving(false);
      });
    noteSaveQueueRef.current = request;
    return request;
  };

  const insertTemplate = (templateType: 'entry' | 'review') => {
    const snippet =
      templateType === 'entry'
        ? '【入场依据】\n- 形态/结构：\n- 关键位/流动性：\n\n【止损止盈】\n- 止损价：\n- 目标位：\n'
        : '【交易复盘】\n- 执行问题：\n- 情绪管理：\n\n【后续改进】\n- ';
    const nextNote = note ? `${note.trim()}\n\n${snippet}` : snippet;
    setNote(nextNote);
    void persistNote(nextNote);
  };

  const pnl = positionPnl(position);
  const currency = positionCurrency(position);
  const isCfd = position.venue === 'gate-cfd';
  const roi = calculatePositionRoi(position);
  const totalFee = (position.openFee || 0) + (position.closeFee || 0);
  const displayedPricePrecision = pricePrecision([
    position.entryPrice,
    position.exitPrice,
    ...(position.fills ?? []).map((fill) => fill.price),
  ]);

  const metrics: Array<{
    label: string;
    value: string;
    isProfit?: boolean;
    isLoss?: boolean;
  }> = [
    {
      label: '交易所',
      value: venueLabel(position.venue),
    },
    {
      label: '方向 / 杠杆',
      value: `${position.side === 'long' ? '多头' : '空头'} · ${formatLeverage(position.leverage)}`,
    },
    {
      label: '持仓模式',
      value:
        position.marginMode === 'isolated'
          ? '逐仓'
          : position.marginMode === 'cross' || position.marginMode === 'crossed'
            ? '全仓'
            : '未知',
    },
    {
      label: '持仓时长',
      value: formatHoldingDuration(position.entryTimeMs, position.exitTimeMs),
    },
    {
      label: '开仓均价',
      value: formatPrice(position.entryPrice, displayedPricePrecision),
    },
    {
      label: '平仓均价',
      value:
        position.status === 'open'
          ? '持仓中'
          : formatPrice(position.exitPrice, displayedPricePrecision),
    },
    {
      label: isCfd ? '持仓数量 (手)' : '持仓数量',
      value: formatNumber(position.contracts, 4),
    },
    {
      label: `已实现净盈亏 (${currency})`,
      value: isCfd && position.netPnl == null ? '—' : `${pnl >= 0 ? '+' : ''}${formatNumber(pnl)}`,
      isProfit: pnl > 0,
      isLoss: pnl < 0,
    },
    {
      label: '收益率 (净盈亏 / 保证金)',
      value: formatRoiWithHint(roi),
      isProfit: (roi ?? 0) > 0,
      isLoss: (roi ?? 0) < 0,
    },
    {
      label: '总手续费',
      value: `${formatNumber(isCfd && position.closeFee == null ? null : totalFee, 4)} ${currency}`,
    },
    {
      label: isCfd ? '隔夜费' : '资金费',
      value: `${formatNumber(position.funding, 4)} ${currency}`,
    },
  ];

  return (
    <div className="bitlang-review-panel posrev-panel">
      <section className="posrev-overview" aria-label="仓位概览">
        <h3 className="posrev-detail-section-title">概览</h3>
        <div className="bitlang-metrics posrev-metrics-grid">
          {metrics.map((item) => (
            <div key={item.label}>
              <span title={item.label}>{item.label}</span>
              <strong title={item.value} className={item.isProfit ? 'profit' : item.isLoss ? 'loss' : ''}>
                {item.value}
              </strong>
            </div>
          ))}
        </div>
      </section>
      <section className="posrev-annotate" aria-label="复盘笔记">
        <div className="posrev-annotate-header">
          <h3 className="posrev-detail-section-title">
            <label htmlFor="posrev-review-note">复盘笔记</label>
            {saving && <span className="posrev-note-label">保存中</span>}
          </h3>
          <div className="posrev-templates">
            <button
              type="button"
              className="posrev-template-btn"
              onClick={() => insertTemplate('entry')}
              title="插入入场依据与止损止盈模板"
            >
              <FileText size={11} /> + 入场依据
            </button>
            <button
              type="button"
              className="posrev-template-btn"
              onClick={() => insertTemplate('review')}
              title="插入交易反思与执行复盘模板"
            >
              <FileText size={11} /> + 交易反思
            </button>
          </div>
        </div>
        <textarea
          id="posrev-review-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (note !== position.note) void persistNote(note);
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 's') {
              event.preventDefault();
              void persistNote(note);
            }
          }}
          placeholder="记录当时为什么开仓、哪里做错、执行是否到位（Ctrl+S 或失焦自动保存）"
        />
        <PositionTagEditor
          position={position}
          positions={positions}
          tags={tags}
          onSelectionChange={onTagIdsChange}
          onTagsCreated={onTagsCreated}
          onTagDeleted={onTagDeleted}
        />
      </section>
      <section className="posrev-operations" aria-label="操作路径">
        <button
          type="button"
          className="posrev-operations-toggle"
          aria-expanded={operationsExpanded}
          aria-controls="posrev-operation-fills"
          onClick={() => setOperationsExpanded((expanded) => !expanded)}
        >
          <span>操作路径 · {position.fills?.length ?? 0} 笔成交</span>
          <ChevronDown size={14} />
        </button>
        <div id="posrev-operation-fills" className="posrev-fills" hidden={!operationsExpanded}>
          {(position.fills?.length ?? 0) > 0 ? (
            <ul className="posrev-fills-list">
              {(position.fills ?? []).map((fill) => {
                const fillPnl = fill.pnl;
                return (
                  <li key={fill.execId} className={`posrev-fill-row kind-${fill.kind}`}>
                    <span className="posrev-fill-kind">{FILL_KIND_LABEL[fill.kind]}</span>
                    <span className="posrev-fill-time">
                      {formatShanghaiTimeShort(fill.timeMs)}
                    </span>
                    <span className="posrev-fill-qty">
                      {formatNumber(fill.quantity, 4)} @{' '}
                      {formatPrice(fill.price, displayedPricePrecision)}
                    </span>
                    <span
                      className={`posrev-fill-pnl ${
                        fillPnl == null ? '' : fillPnl >= 0 ? 'profit' : 'loss'
                      }`}
                    >
                      {fill.kind === 'open' || fill.kind === 'scaleIn'
                        ? ''
                        : fillPnl == null
                          ? '—'
                          : `${fillPnl >= 0 ? '+' : ''}${formatNumber(fillPnl)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="posrev-detail-empty">暂无成交操作明细</div>
          )}
        </div>
      </section>
    </div>
  );
}
