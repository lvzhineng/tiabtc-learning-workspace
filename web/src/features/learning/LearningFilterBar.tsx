import type { FilterParams, QuickFilter } from './learning-types';
import { Search } from 'lucide-react';

interface Props {
  filters: FilterParams;
  years: string[];
  onChange: (newFilters: FilterParams) => void;
}

export function LearningFilterBar({ filters, years, onChange }: Props) {
  const quickFilterChips: { key: QuickFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'unfinished', label: '未完成' },
    { key: 'learned', label: '已学完' },
    { key: 'bookmarked', label: '仅书签' },
    { key: 'noted', label: '有笔记' },
  ];

  return (
    <div className="learning-filters-card">
      <div className="learning-filter-row">
        {/* Search Input */}
        <div style={{ flex: '1 1 300px', position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '10px' }} />
          <input
            type="search"
            value={filters.searchQuery}
            onChange={(e) => onChange({ ...filters, searchQuery: e.target.value })}
            placeholder="搜索视频标题、日期或笔记内容..."
            style={{
              width: '100%',
              paddingLeft: '32px',
              background: 'var(--bg-dark-700)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              paddingTop: '6px',
              paddingBottom: '6px',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>

        {/* Year Filter */}
        <select
          value={filters.yearFilter}
          onChange={(e) => onChange({ ...filters, yearFilter: e.target.value })}
          style={{
            background: 'var(--bg-dark-700)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <option value="all">全部年份</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>

        {/* Sort Order */}
        <select
          value={filters.sortOrder}
          onChange={(e) => onChange({ ...filters, sortOrder: e.target.value as any })}
          style={{
            background: 'var(--bg-dark-700)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <option value="asc">最早优先 (顺序)</option>
          <option value="desc">最新优先 (倒序)</option>
        </select>
      </div>

      {/* Quick Filter Chips */}
      <div className="learning-filter-row">
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {quickFilterChips.map((chip) => {
            const active = filters.quickFilter === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                className={`learning-chip ${active ? 'active' : ''}`}
                onClick={() => onChange({ ...filters, quickFilter: chip.key })}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
