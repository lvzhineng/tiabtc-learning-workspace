import { useEffect, useRef, useState } from 'react';
import { FileText, Tags, Trash2 } from 'lucide-react';
import {
  createPositionTag,
  deletePositionTag,
  savePositionNote,
  savePositionTagMap,
} from '@/api/position-review-api';
import { confirmDialog } from '@/ui/feedback/confirm';
import { toast } from '@/ui/feedback/toast';
import {
  FILL_KIND_LABEL,
  calculatePositionRoi,
  formatHoldingDuration,
  formatLeverage,
  formatNumber,
  formatRoi,
  formatShanghaiTimeShort,
} from './position-review-format';
import {
  positionPnl,
  type PositionTag,
  type ReviewPosition,
} from './position-review-types';

export function PositionReviewPanel({
  position,
  tags,
  onChange,
  onTagsCreated,
  onTagDeleted,
}: {
  position: ReviewPosition;
  tags: PositionTag[];
  onChange: (position: ReviewPosition) => void;
  onTagsCreated: (tag: PositionTag) => void;
  onTagDeleted: (tagId: number) => void;
}) {
  const [note, setNote] = useState(position.note);
  const [tagName, setTagName] = useState('');
  const [saving, setSaving] = useState(false);
  const [tagBusy, setTagBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'operations' | 'notes'>(
    'overview'
  );
  const positionRef = useRef(position);
  const noteSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingNoteSaveCountRef = useRef(0);
  const noteRevisionRef = useRef(0);
  const tagBusyRef = useRef(false);
  positionRef.current = position;

  useEffect(() => {
    setNote(position.note);
  }, [position.note, position.positionId]);

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

  const toggleTag = async (tagId: number) => {
    if (tagBusyRef.current) return;
    tagBusyRef.current = true;
    setTagBusy(true);
    const target = positionRef.current;
    const nextIds = target.tagIds.includes(tagId)
      ? target.tagIds.filter((id) => id !== tagId)
      : [...target.tagIds, tagId];
    try {
      await savePositionTagMap({
        venue: target.venue,
        positionId: target.positionId,
        tagIds: nextIds,
      });
      onChange({ ...positionRef.current, tagIds: nextIds });
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
    const target = positionRef.current;
    try {
      const created = await createPositionTag(name);
      const nextIds = [...new Set([...target.tagIds, created.id])];
      await savePositionTagMap({
        venue: target.venue,
        positionId: target.positionId,
        tagIds: nextIds,
      });
      onTagsCreated(created);
      onChange({ ...positionRef.current, tagIds: nextIds });
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
      message: `确定要删除标签${label}吗？已标记该标签的仓位将自动解除关联。`,
      confirmText: '确认删除',
      isDanger: true,
    });
    if (!confirmed) return;
    try {
      await deletePositionTag(tagId);
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

  const pnl = positionPnl(position);
  const roi = calculatePositionRoi(position);
  const totalFee = (position.openFee || 0) + (position.closeFee || 0);

  const metrics: Array<{
    label: string;
    value: string;
    isProfit?: boolean;
    isLoss?: boolean;
  }> = [
    {
      label: '方向 / 杠杆',
      value: `${position.side === 'long' ? '多头 (Long)' : '空头 (Short)'} · ${formatLeverage(position.leverage)}`,
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
      value: formatNumber(position.entryPrice, 4),
    },
    {
      label: '平仓均价',
      value: position.status === 'open' ? '持仓中' : formatNumber(position.exitPrice, 4),
    },
    {
      label: '持仓数量',
      value: formatNumber(position.contracts, 4),
    },
    {
      label: '净盈亏 (USDT)',
      value: `${pnl >= 0 ? '+' : ''}${formatNumber(pnl)}`,
      isProfit: pnl > 0,
      isLoss: pnl < 0,
    },
    {
      label: '收益率估算 (ROI)',
      value: formatRoi(roi),
      isProfit: (roi ?? 0) > 0,
      isLoss: (roi ?? 0) < 0,
    },
    {
      label: '总手续费',
      value: `${formatNumber(totalFee, 4)} USDT`,
    },
    {
      label: '资金费',
      value: `${formatNumber(position.funding, 4)} USDT`,
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
          aria-selected={activeTab === 'operations'}
          className={activeTab === 'operations' ? 'active' : ''}
          onClick={() => setActiveTab('operations')}
        >
          操作路径
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
      {activeTab === 'operations' && (
        <div className="posrev-fills" role="tabpanel">
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
                      {formatNumber(fill.quantity, 4)} @ {formatNumber(fill.price, 4)}
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
        <div className="posrev-tags">
          <span>
            <Tags size={13} /> 标签
          </span>
          <div className="posrev-tag-list">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className={`posrev-tag-item ${
                  position.tagIds.includes(tag.id) ? 'active' : ''
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
