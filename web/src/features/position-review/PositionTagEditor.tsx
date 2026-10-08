import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, Tags, Trash2, X } from 'lucide-react';
import { createPositionTag, deletePositionTag, savePositionTagMap } from '@/api/position-review-api';
import { confirmDialog } from '@/ui/feedback/confirm';
import { toast } from '@/ui/feedback/toast';
import { readLocalUiState, storedString, writeLocalUiState } from '@/ui/persistence/local-ui-state';
import { positionKey, type PositionTag, type ReviewPosition } from './position-review-types';

const TAG_UI_STORAGE_KEY = 'tiabtc-position-tag-picker-v1';
const MAX_POSITION_TAGS = 20;
const sameIds = (left: number[], right: number[]) => left.join(',') === right.join(',');

interface Props {
  position: ReviewPosition;
  positions: ReviewPosition[];
  tags: PositionTag[];
  onSelectionChange: (position: ReviewPosition, tagIds: number[]) => void;
  onTagsCreated: (tag: PositionTag) => void;
  onTagDeleted: (tagId: number) => void;
}

export function PositionTagEditor({ position, positions, tags, onSelectionChange, onTagsCreated, onTagDeleted }: Props) {
  const [selectedIds, setSelectedIds] = useState(position.tagIds);
  const [search, setSearch] = useState(() => storedString(readLocalUiState(TAG_UI_STORAGE_KEY).search, '', undefined, 80));
  const [tagName, setTagName] = useState('');
  const [saving, setSaving] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [managing, setManaging] = useState(false);
  const desiredIdsRef = useRef(position.tagIds);
  const confirmedIdsRef = useRef(position.tagIds);
  const saveLoopRef = useRef(false);
  const mutationRef = useRef(false);
  const mountedRef = useRef(true);
  const positionRef = useRef(position);
  positionRef.current = position;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (saveLoopRef.current || mutationRef.current) return;
    desiredIdsRef.current = position.tagIds;
    confirmedIdsRef.current = position.tagIds;
    setSelectedIds(position.tagIds);
  }, [position.tagIds]);
  useEffect(() => { writeLocalUiState(TAG_UI_STORAGE_KEY, { search }); }, [search]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedTags = tags.filter((tag) => selectedSet.has(tag.id));
  const query = search.trim().toLocaleLowerCase();
  const visibleTags = tags.filter((tag) => tag.name.toLocaleLowerCase().includes(query));
  const commonTags = useMemo(() => {
    const counts = new Map<number, number>();
    for (const other of positions) {
      if (other.chartSymbol !== position.chartSymbol || positionKey(other) === positionKey(position) ||
        (other.venue === 'gate-cfd') !== (position.venue === 'gate-cfd')) continue;
      for (const id of new Set(other.tagIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return tags.filter((tag) => counts.has(tag.id))
      .map((tag) => ({ tag, count: counts.get(tag.id)! }))
      .sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name, 'zh-CN'))
      .slice(0, 6);
  }, [position.chartSymbol, position.positionId, position.venue, positions, tags]);

  // Rapid clicks update the chips immediately. One writer saves the latest
  // desired selection after each response, so full-map writes cannot race.
  const persistSelection = async () => {
    if (saveLoopRef.current) return;
    saveLoopRef.current = true;
    setSaving(true);
    const target = positionRef.current;
    try {
      while (!sameIds(desiredIdsRef.current, confirmedIdsRef.current)) {
        const sentIds = [...desiredIdsRef.current];
        const result = await savePositionTagMap({ venue: target.venue, positionId: target.positionId, tagIds: sentIds });
        confirmedIdsRef.current = result.tagIds;
        onSelectionChange(target, result.tagIds);
        if (sameIds(desiredIdsRef.current, sentIds)) {
          desiredIdsRef.current = result.tagIds;
          if (mountedRef.current) setSelectedIds(result.tagIds);
        }
      }
    } catch (cause) {
      desiredIdsRef.current = confirmedIdsRef.current;
      if (mountedRef.current) setSelectedIds(confirmedIdsRef.current);
      toast.error(cause instanceof Error ? cause.message : '标签保存失败，已恢复上次保存的选择');
    } finally {
      saveLoopRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const selectIds = (ids: number[]) => {
    if (mutationRef.current) return false;
    const next = [...new Set(ids)];
    if (next.length > MAX_POSITION_TAGS) {
      toast.warning(`每笔仓位最多选择 ${MAX_POSITION_TAGS} 个标签`);
      return false;
    }
    desiredIdsRef.current = next;
    setSelectedIds(next);
    void persistSelection();
    return true;
  };
  const toggleTag = (id: number) => selectIds(desiredIdsRef.current.includes(id)
    ? desiredIdsRef.current.filter((selected) => selected !== id) : [...desiredIdsRef.current, id]);

  const createTag = async () => {
    const name = tagName.trim();
    if (!name || mutationRef.current || saveLoopRef.current) return;
    const existing = tags.find((tag) => tag.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) {
      if (selectIds([...desiredIdsRef.current, existing.id])) setTagName('');
      return;
    }
    if (desiredIdsRef.current.length >= MAX_POSITION_TAGS) {
      toast.warning(`每笔仓位最多选择 ${MAX_POSITION_TAGS} 个标签，请先移除一个标签`);
      return;
    }
    mutationRef.current = true;
    setMutating(true);
    try {
      const created = await createPositionTag(name);
      // Keep the new tag visible even if associating it with this position fails.
      onTagsCreated(created);
      desiredIdsRef.current = [...new Set([...desiredIdsRef.current, created.id])];
      if (mountedRef.current) {
        setSelectedIds(desiredIdsRef.current);
        setTagName('');
        setSearch('');
      }
      await persistSelection();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '标签创建失败');
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) setMutating(false);
    }
  };

  const deleteTag = async (tag: PositionTag) => {
    if (mutationRef.current || saveLoopRef.current) return;
    mutationRef.current = true;
    setMutating(true);
    try {
      const confirmed = await confirmDialog({
        title: '删除标签',
        message: `确定删除标签「${tag.name}」吗？所有仓位上的这个标签都会被移除。若只想取消当前仓位的标签，请点击已选标签上的 ×。`,
        confirmText: '删除全部关联',
        isDanger: true,
      });
      if (!confirmed) return;
      await deletePositionTag(tag.id);
      desiredIdsRef.current = desiredIdsRef.current.filter((id) => id !== tag.id);
      confirmedIdsRef.current = confirmedIdsRef.current.filter((id) => id !== tag.id);
      if (mountedRef.current) setSelectedIds(desiredIdsRef.current);
      onTagDeleted(tag.id);
      toast.success('标签已删除');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '删除标签失败');
    } finally {
      mutationRef.current = false;
      if (mountedRef.current) setMutating(false);
    }
  };

  const tagButton = (tag: PositionTag, count?: number) => (
    <button type="button" className={`posrev-tag-choice ${selectedSet.has(tag.id) ? 'active' : ''}`}
      style={{ '--tag-color': tag.color } as React.CSSProperties}
      aria-pressed={selectedSet.has(tag.id)} aria-label={`${selectedSet.has(tag.id) ? '取消' : '选择'}标签 ${tag.name}`}
      disabled={mutating} onClick={() => toggleTag(tag.id)}
      title={count ? `该交易对的其他 ${count} 笔仓位使用过此标签` : tag.name}>
      {selectedSet.has(tag.id) ? <Check size={12} /> : <span className="posrev-tag-dot" />}
      <span>{tag.name}</span>{count != null && <small>{count}</small>}
    </button>
  );

  return (
    <section className="posrev-tag-editor" aria-label="当前仓位标签" aria-busy={saving || mutating}>
      <div className="posrev-tag-section-heading">
        <strong><Tags size={13} /> 标签 · {position.chartSymbol} · 已选 {selectedTags.length}/{MAX_POSITION_TAGS}</strong>
      </div>
      <div className="posrev-tag-list posrev-selected-tags" aria-label="已选标签">
        {selectedTags.map((tag) => <button type="button" key={tag.id} className="posrev-tag-choice active"
          style={{ '--tag-color': tag.color } as React.CSSProperties} disabled={mutating}
          aria-label={`移除标签 ${tag.name}`} title="仅从当前仓位移除" onClick={() => toggleTag(tag.id)}>
          <Check size={12} /><span>{tag.name}</span><X size={12} />
        </button>)}
        {selectedTags.length === 0 && <span className="posrev-tag-help">尚未选择标签，点击下方标签即可添加</span>}
      </div>
      <div className="posrev-tag-selection-footer">
        <span role="status">{saving ? '保存中…' : '选择后自动保存 · 仅标记当前仓位'}</span>
        {selectedTags.length > 0 && <button type="button" className="posrev-tag-text-btn" disabled={mutating}
          onClick={() => selectIds([])}>清空当前选择</button>}
      </div>
      <div className="posrev-tag-picker" aria-label="标签选择">
        <div className="posrev-tag-section-heading"><strong>{position.chartSymbol} 常用标签</strong><span>按其他仓位使用次数</span></div>
        <div className="posrev-tag-list" aria-label="该交易对常用标签">
          {commonTags.map(({ tag, count }) => <span key={tag.id}>{tagButton(tag, count)}</span>)}
          {commonTags.length === 0 && <span className="posrev-tag-help">暂无历史标签，可从全部标签中选择</span>}
        </div>
        <div className="posrev-tag-section-heading">
          <strong>全部标签 ({tags.length})</strong>
          <button type="button" className="posrev-tag-text-btn" aria-pressed={managing} onClick={() => setManaging(!managing)}>
            {managing ? '完成管理' : '管理标签'}
          </button>
        </div>
        <div className="posrev-tag-search">
          <Search size={13} />
          <input aria-label="搜索已创建标签" value={search} maxLength={80} placeholder="搜索标签，Enter 快捷选择"
            onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Escape') setSearch('');
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && visibleTags.length === 1) {
                event.preventDefault(); toggleTag(visibleTags[0].id);
              }
            }} />
          {search && <button type="button" aria-label="清除标签搜索" onClick={() => setSearch('')}><X size={13} /></button>}
        </div>
        {query && <span className="posrev-tag-help">找到 {visibleTags.length} / {tags.length} 个标签</span>}
        <div className="posrev-tag-list" aria-label="全部已创建标签">
          {visibleTags.map((tag) => <div key={tag.id} className="posrev-tag-library-item">
            {tagButton(tag)}
            {managing && <button type="button" className="posrev-tag-delete-btn" disabled={saving || mutating}
              aria-label={`删除标签 ${tag.name}`} title="删除标签及所有仓位关联" onClick={() => void deleteTag(tag)}><Trash2 size={12} /></button>}
          </div>)}
          {visibleTags.length === 0 && <span className="posrev-tag-help">{tags.length ? '没有匹配的标签，请调整搜索' : '还没有标签，在下方创建第一个标签'}</span>}
        </div>
        {managing && <span className="posrev-tag-help">删除会解除所有仓位的关联；点击标签只切换当前仓位的选择。</span>}
        <form className="posrev-tag-create" onSubmit={(event) => { event.preventDefault(); void createTag(); }}>
          <input aria-label="新标签名称" value={tagName} maxLength={32} disabled={mutating}
            onChange={(event) => setTagName(event.target.value)} placeholder="新建标签，如：突破、执行到位" />
          <button type="submit" disabled={saving || mutating || !tagName.trim()}>创建并选中</button>
        </form>
      </div>
    </section>
  );
}
