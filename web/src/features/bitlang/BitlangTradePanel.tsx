import { useEffect, useRef, useState } from 'react';
import { FileText, Tags, Trash2 } from 'lucide-react';
import type { BitlangTag } from '@/api/bitlang-review-api';
import {
  createBitlangTag,
  deleteBitlangTag,
  saveBitlangNote,
  saveBitlangTagMap,
} from '@/api/bitlang-review-api';
import { confirmDialog } from '@/ui/feedback/confirm';
import { toast } from '@/ui/feedback/toast';
import { formatPrice, pricePrecision } from '@/chart/chart-price';
import {
  readLocalUiState,
  storedString,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import {
  formatHoldingMinutes,
  formatNumber,
  formatPercent,
} from './bitlang-format';
import type { AnnotatedBitlangTrade } from './bitlang-types';

const BITLANG_DETAIL_TAB_STORAGE_KEY = 'tiabtc-bitlang-detail-tab-v1';

function loadDetailTab(): 'overview' | 'source' | 'notes' {
  return storedString(
    readLocalUiState(BITLANG_DETAIL_TAB_STORAGE_KEY).activeTab,
    'overview',
    ['overview', 'source', 'notes']
  ) as 'overview' | 'source' | 'notes';
}

export function BitlangTradePanel({
  trade,
  tags,
  onChange,
  onTagsCreated,
  onTagDeleted,
}: {
  trade: AnnotatedBitlangTrade;
  tags: BitlangTag[];
  onChange: (trade: AnnotatedBitlangTrade) => void;
  onTagsCreated: (tag: BitlangTag) => void;
  onTagDeleted: (tagId: number) => void;
}) {
  const [note, setNote] = useState(trade.note);
  const [tagName, setTagName] = useState('');
  const [saving, setSaving] = useState(false);
  const [tagBusy, setTagBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'source' | 'notes'>(
    loadDetailTab
  );
  const tradeRef = useRef(trade);
  const noteSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingNoteSaveCountRef = useRef(0);
  const noteRevisionRef = useRef(0);
  const tagBusyRef = useRef(false);
  tradeRef.current = trade;

  useEffect(() => {
    setNote(trade.note);
  }, [trade.note, trade.id]);

  useEffect(() => {
    writeLocalUiState(BITLANG_DETAIL_TAB_STORAGE_KEY, { activeTab });
  }, [activeTab]);

  const persistNote = (value: string): Promise<void> => {
    const target = tradeRef.current;
    if (value === target.note && pendingNoteSaveCountRef.current === 0) {
      return Promise.resolve();
    }
    pendingNoteSaveCountRef.current += 1;
    const revision = ++noteRevisionRef.current;
    setSaving(true);
    const request = noteSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await saveBitlangNote({ tradeId: target.id, note: value });
        if (tradeRef.current.id !== target.id || revision !== noteRevisionRef.current) {
          return;
        }
        onChange({ ...tradeRef.current, note: value });
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

  const toggleTag = async (tagId: number) => {
    if (tagBusyRef.current) return;
    tagBusyRef.current = true;
    setTagBusy(true);
    const target = tradeRef.current;
    const nextIds = target.tagIds.includes(tagId)
      ? target.tagIds.filter((id) => id !== tagId)
      : [...target.tagIds, tagId];
    try {
      await saveBitlangTagMap({ tradeId: target.id, tagIds: nextIds });
      onChange({ ...tradeRef.current, tagIds: nextIds });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '标签保存失败');
    } finally {
      tagBusyRef.current = false;
      setTagBusy(false);
    }
  };

  const handleCreateTag = async () => {
    const name = tagName.trim();
    if (!name || tagBusyRef.current) return;
    tagBusyRef.current = true;
    setTagBusy(true);
    const target = tradeRef.current;
    try {
      const created = await createBitlangTag(name);
      const nextIds = [...new Set([...target.tagIds, created.id])];
      await saveBitlangTagMap({ tradeId: target.id, tagIds: nextIds });
      onTagsCreated(created);
      onChange({ ...tradeRef.current, tagIds: nextIds });
      setTagName('');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '标签创建失败');
    } finally {
      tagBusyRef.current = false;
      setTagBusy(false);
    }
  };

  const handleDeleteTag = async (tagId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    const tag = tags.find((item) => item.id === tagId);
    const label = tag ? ` "${tag.name}"` : '';
    const confirmed = await confirmDialog({
      title: '删除标签',
      message: `确定要删除标签${label}吗？已标记该标签的交易将自动解除关联。`,
      confirmText: '确认删除',
      isDanger: true,
    });
    if (!confirmed) return;
    try {
      await deleteBitlangTag(tagId);
      onTagDeleted(tagId);
      toast.success('标签已删除');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除标签失败');
    }
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

  const displayedPricePrecision = pricePrecision([
    trade.entryPrice,
    trade.exitPrice,
  ]);

  const metrics: Array<{
    label: string;
    value: string;
    isProfit?: boolean;
    isLoss?: boolean;
  }> = [
    {
      label: '方向 / 杠杆',
      value: `${trade.direction} · ${formatNumber(trade.leverage, 0)}x`,
    },
    {
      label: '持仓时长',
      value: formatHoldingMinutes(trade.holdingMinutes),
    },
    {
      label: '开仓均价',
      value: formatPrice(trade.entryPrice, displayedPricePrecision),
    },
    {
      label: '平仓均价',
      value: formatPrice(trade.exitPrice, displayedPricePrecision),
    },
    {
      label: '保证金',
      value: `${formatNumber(trade.margin)} USDT`,
    },
    {
      label: '持仓量',
      value: formatNumber(trade.size, 4),
    },
    {
      label: '收益 (USDT)',
      value: `${trade.profit >= 0 ? '+' : ''}${formatNumber(trade.profit)}`,
      isProfit: trade.profit > 0,
      isLoss: trade.profit < 0,
    },
    {
      label: '收益率',
      value: formatPercent(trade.returnRate),
      isProfit: trade.returnRate > 0,
      isLoss: trade.returnRate < 0,
    },
    {
      label: '手续费',
      value: `${formatNumber(trade.fee, 4)} USDT`,
    },
    {
      label: '振幅',
      value: formatPercent(trade.amplitude),
    },
  ];

  return (
    <div className="bitlang-review-panel posrev-panel">
      <div className="posrev-detail-tabs" role="tablist" aria-label="复盘详情分类">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setActiveTab('overview')}
        >
          概览
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'source'}
          className={activeTab === 'source' ? 'active' : ''}
          onClick={() => setActiveTab('source')}
        >
          原始备注
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'notes'}
          className={activeTab === 'notes' ? 'active' : ''}
          onClick={() => setActiveTab('notes')}
        >
          复盘笔记
        </button>
      </div>
      {activeTab === 'overview' && (
        <div className="bitlang-metrics posrev-metrics-grid" role="tabpanel">
          {metrics.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong className={item.isProfit ? 'profit' : item.isLoss ? 'loss' : ''}>
                {item.value}
              </strong>
            </div>
          ))}
        </div>
      )}
      {activeTab === 'source' && (
        <div className="posrev-annotate" role="tabpanel">
          <label className="posrev-note-label">
            <span>交割单原始备注（只读）</span>
          </label>
          <p className="bitlang-source-note-body">
            {trade.sourceNote?.trim() || '无原始备注'}
          </p>
        </div>
      )}
      {activeTab === 'notes' && (
        <div className="posrev-annotate" role="tabpanel">
          <div className="posrev-annotate-header">
            <label className="posrev-note-label">
              <span>备注 {saving ? '保存中' : ''}</span>
            </label>
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
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => {
              if (note !== trade.note) void persistNote(note);
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                event.preventDefault();
                void persistNote(note);
              }
            }}
            placeholder="记录当时为什么开仓、哪里做错、执行是否到位（Ctrl+S 或失焦自动保存）"
          />
          <div className="posrev-tags">
            <span>
              <Tags size={13} /> 标签
            </span>
            <div className="posrev-tag-list">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className={`posrev-tag-item ${
                    trade.tagIds.includes(tag.id) ? 'active' : ''
                  }`}
                  style={{ borderColor: tag.color }}
                >
                  <button
                    type="button"
                    className="posrev-tag-select-btn"
                    disabled={tagBusy}
                    onClick={() => void toggleTag(tag.id)}
                  >
                    {tag.name}
                  </button>
                  <button
                    type="button"
                    className="posrev-tag-delete-btn"
                    disabled={tagBusy}
                    title={`删除标签 "${tag.name}"`}
                    onClick={(event) => void handleDeleteTag(tag.id, event)}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
            <div className="posrev-tag-create">
              <input
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                disabled={tagBusy}
                placeholder="新建标签（如：突破、假突破止损、持单过久）"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleCreateTag();
                  }
                }}
              />
              <button
                type="button"
                disabled={tagBusy}
                onClick={() => void handleCreateTag()}
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
