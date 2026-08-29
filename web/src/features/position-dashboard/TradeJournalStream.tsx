import { useEffect, useMemo, useState } from 'react';
import {
  positionPnl,
  savePositionNote,
  type PositionTag,
  type ReviewPosition,
} from '@/api/position-review-api';
import { formatChartTime } from '@/chart/chart-time';
import { toast } from '@/ui/feedback/toast';
import {
  readLocalUiState,
  storedBoolean,
  storedInteger,
  writeLocalUiState,
} from '@/ui/persistence/local-ui-state';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ExternalLink,
  MessageSquare,
  X,
} from 'lucide-react';

const POSITION_JOURNAL_UI_STORAGE_KEY = 'tiabtc-position-journal-ui-v1';

function loadJournalUiState() {
  const stored = readLocalUiState(POSITION_JOURNAL_UI_STORAGE_KEY);
  return {
    onlyWithNotes: storedBoolean(stored.onlyWithNotes, false),
    page: storedInteger(stored.page, 0, 0),
  };
}

interface Props {
  positions: ReviewPosition[];
  tags: PositionTag[];
  onNavigateToPosition?: (positionId: string) => void;
  onNoteUpdated?: (positionId: string, note: string) => void;
}

export function TradeJournalStream({
  positions,
  tags,
  onNavigateToPosition,
  onNoteUpdated,
}: Props) {
  const [initialUiState] = useState(loadJournalUiState);
  const [onlyWithNotes, setOnlyWithNotes] = useState(
    initialUiState.onlyWithNotes
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(initialUiState.page);
  const PAGE_SIZE = 20;

  const filtered = positions.filter((p) => {
    if (onlyWithNotes) {
      return Boolean(p.note?.trim());
    }
    return true;
  });

  useEffect(() => {
    writeLocalUiState(POSITION_JOURNAL_UI_STORAGE_KEY, {
      onlyWithNotes,
      page,
    });
  }, [onlyWithNotes, page]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(
    () =>
      filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage]
  );

  useEffect(() => {
    if (positions.length > 0 && page !== safePage) setPage(safePage);
  }, [page, positions.length, safePage]);

  const startEdit = (pos: ReviewPosition) => {
    setEditingId(pos.positionId);
    setDraftNote(pos.note || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftNote('');
  };

  const handleSave = async (pos: ReviewPosition) => {
    setSaving(true);
    try {
      await savePositionNote({
        venue: pos.venue,
        positionId: pos.positionId,
        note: draftNote,
      });
      onNoteUpdated?.(pos.positionId, draftNote);
      setEditingId(null);
      toast.success('复盘笔记已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存笔记失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="posdash-journal-controls">
        <button
          type="button"
          className={`posdash-segmented-pill ${onlyWithNotes ? 'active' : ''}`}
          onClick={() => {
            setOnlyWithNotes((value) => !value);
            setPage(0);
          }}
        >
          <BookOpen size={12} />
          {onlyWithNotes ? '仅看带笔记 (已筛选)' : '全部交易记录'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          展示 {filtered.length} 笔交易日记
        </span>
        {filtered.length > PAGE_SIZE && (
          <div className="posdash-journal-pager">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage(Math.max(0, safePage - 1))}
            >
              <ChevronLeft size={12} />
            </button>
            <span>
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={safePage + 1 >= pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRight size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="posdash-journal-list">
        {filtered.length === 0 ? (
          <div className="posdash-empty-state">
            <MessageSquare size={28} />
            <span>暂无{onlyWithNotes ? '带复盘笔记的' : ''}交易记录</span>
          </div>
        ) : pageItems.map((pos) => {
          const pnl = positionPnl(pos);
          const isProfit = pnl >= 0;
          const isEditing = editingId === pos.positionId;

          const tradeTags = pos.tagIds
            .map((id: number) => tags.find((t: PositionTag) => t.id === id))
            .filter((t): t is PositionTag => Boolean(t));

          return (
            <div
              key={pos.positionId}
              className={`posdash-journal-card ${isProfit ? 'profit-border' : 'loss-border'}`}
            >
              {/* 卡片头部 */}
              <div className="posdash-journal-card-header">
                <div className="posdash-journal-identity">
                  <span className="posdash-journal-symbol">{pos.chartSymbol}</span>
                  <span
                    className={`posrev-side-badge ${pos.side}`}
                    style={{ fontSize: 10, padding: '1px 6px', fontWeight: 600 }}
                  >
                    {pos.side === 'long' ? '多' : '空'}{' '}
                    {pos.leverage && pos.leverage > 0
                      ? `${Math.round(pos.leverage)}x`
                      : '杠杆未知'}
                  </span>
                  <span className="posdash-journal-time-pill">
                    {formatChartTime(pos.entryTimeMs)}
                  </span>
                </div>

                <div className="posdash-journal-pnl-chip">
                  <span
                    className={`posdash-journal-pnl-num ${
                      isProfit ? 'posrev-profit' : 'posrev-loss'
                    }`}
                  >
                    {isProfit ? '+' : ''}
                    {pnl.toFixed(2)} USDT
                  </span>
                </div>
              </div>

              {/* 笔记区域 */}
              {isEditing ? (
                <div className="posdash-journal-editor">
                  <textarea
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    rows={4}
                    placeholder="填写入场依据、失误反思或心得..."
                    className="posdash-journal-textarea"
                    autoFocus
                  />
                  <div className="posdash-journal-edit-actions">
                    <button
                      type="button"
                      className="posdash-btn"
                      onClick={cancelEdit}
                      style={{ height: 26, fontSize: 11 }}
                    >
                      <X size={11} /> 取消
                    </button>
                    <button
                      type="button"
                      className="posdash-btn primary"
                      onClick={() => handleSave(pos)}
                      disabled={saving}
                      style={{ height: 26, fontSize: 11 }}
                    >
                      <Check size={11} /> {saving ? '保存中...' : '保存笔记'}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="posdash-journal-content"
                  onClick={() => startEdit(pos)}
                  title="点击直接编辑心得"
                >
                  {pos.note?.trim() ? (
                    <div className="posdash-journal-text">{pos.note}</div>
                  ) : (
                    <div className="posdash-journal-placeholder">
                      <Edit3 size={12} />
                      <span>点击添加复盘笔记（入场依据、形态结构、失误反思）...</span>
                    </div>
                  )}
                </div>
              )}

              {/* 底部标签与跳转 */}
              <div className="posdash-journal-card-footer">
                <div className="posdash-journal-tags-row">
                  {tradeTags.map((tag: PositionTag) => (
                    <span
                      key={tag.id}
                      className="posrev-tag-pill"
                      style={{
                        borderColor: tag.color,
                        color: tag.color,
                        backgroundColor: `${tag.color}18`,
                        fontSize: 10,
                        padding: '2px 7px',
                        borderRadius: '4px',
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>

                <div className="posdash-journal-action-group">
                  {!isEditing && (
                    <button
                      type="button"
                      className="posdash-journal-action-btn"
                      onClick={() => startEdit(pos)}
                      title="编辑心得"
                    >
                      <Edit3 size={12} />
                      编辑
                    </button>
                  )}
                  {onNavigateToPosition && (
                    <button
                      type="button"
                      className="posdash-journal-action-btn highlight"
                      onClick={() => onNavigateToPosition(pos.positionId)}
                      title="在仓位复盘中查看对应 K 线与开平仓位"
                    >
                      <ExternalLink size={12} />
                      K线复盘
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
