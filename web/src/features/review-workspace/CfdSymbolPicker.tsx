import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, RefreshCw, Search, Star } from 'lucide-react';
import type { CfdSymbol } from '@/api/cfd-api';
import { readLocalUiState, writeLocalUiState } from '@/ui/persistence/local-ui-state';
import './cfd-symbol-picker.css';

const STORAGE_KEY = 'tiabtc-cfd-symbol-picker-v1';
const ALL_CATEGORY = 'all';
const FAVORITES_CATEGORY = 'favorites';

type Category = { id: number; name: string; key: string };
type PickerPosition = { left: number; top: number; maxHeight: number };

function loadPickerState() {
  const stored = readLocalUiState(STORAGE_KEY);
  const favorites = Array.isArray(stored.favorites)
    ? stored.favorites.filter((symbol): symbol is string =>
        typeof symbol === 'string' && /^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(symbol))
    : [];
  const category = typeof stored.category === 'string' && stored.category.length <= 100
    ? stored.category
    : ALL_CATEGORY;
  return { favorites: [...new Set(favorites)], category, showLeverageVariants: stored.showLeverageVariants === true };
}

export function CfdSymbolPicker({
  symbols,
  value,
  onChange,
  loading = false,
  warning,
  onRefresh,
}: {
  symbols: CfdSymbol[];
  value: string;
  onChange: (symbol: string) => void;
  loading?: boolean;
  warning?: string | null;
  onRefresh: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [savedPreferences] = useState(loadPickerState);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>(savedPreferences.favorites);
  const [categoryKey, setCategoryKey] = useState(savedPreferences.category);
  const [showLeverageVariants, setShowLeverageVariants] = useState(savedPreferences.showLeverageVariants);
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());

  const displayedSymbols = useMemo(
    () => symbols.filter((item) => showLeverageVariants || item.isBase !== false),
    [showLeverageVariants, symbols]
  );

  const categories = useMemo<Category[]>(() => {
    const byId = new Map<number, Category>();
    displayedSymbols.forEach((item) => {
      if (!byId.has(item.categoryId)) {
        byId.set(item.categoryId, {
          id: item.categoryId,
          name: item.categoryName,
          key: `category:${item.categoryId}`,
        });
      }
    });
    return [...byId.values()].sort((a, b) => a.id - b.id);
  }, [displayedSymbols]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<number, number>();
    displayedSymbols.forEach((item) => counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1));
    return counts;
  }, [displayedSymbols]);

  const activeSymbol = symbols.find((item) => item.symbol === value);
  const activeCategoryExists = categoryKey === ALL_CATEGORY || categoryKey === FAVORITES_CATEGORY ||
    categories.some((category) => category.key === categoryKey);
  const effectiveCategory = activeCategoryExists ? categoryKey : ALL_CATEGORY;

  useEffect(() => {
    if (!loading && effectiveCategory !== categoryKey) setCategoryKey(effectiveCategory);
  }, [categoryKey, effectiveCategory, loading]);

  useEffect(() => {
    writeLocalUiState(STORAGE_KEY, { favorites, category: categoryKey, showLeverageVariants });
  }, [favorites, categoryKey, showLeverageVariants]);

  const visibleSymbols = useMemo(() => {
    return displayedSymbols.filter((item) => {
      if (!deferredSearch) {
        if (effectiveCategory === FAVORITES_CATEGORY && !favorites.includes(item.symbol)) return false;
        if (effectiveCategory.startsWith('category:') && item.categoryId !== Number(effectiveCategory.slice(9))) return false;
        return true;
      }
      return `${item.symbol} ${item.name} ${item.description ?? ''}`.toLocaleLowerCase().includes(deferredSearch);
    });
  }, [deferredSearch, displayedSymbols, effectiveCategory, favorites]);

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 12;
    const width = Math.min(580, window.innerWidth - viewportPadding * 2);
    const maxHeight = Math.min(640, window.innerHeight - viewportPadding * 2);
    const below = window.innerHeight - rect.bottom - 8;
    const top = below >= Math.min(maxHeight, 420)
      ? rect.bottom + 8
      : Math.max(viewportPadding, rect.top - maxHeight - 8);
    setPosition({
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding)),
      top,
      maxHeight: Math.min(maxHeight, window.innerHeight - top - viewportPadding),
    });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const focusFrame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const toggleFavorite = (symbol: string) => {
    setFavorites((current) => current.includes(symbol)
      ? current.filter((item) => item !== symbol)
      : [...current, symbol]);
  };

  const selectSymbol = (symbol: string) => {
    onChange(symbol);
    setOpen(false);
    setSearch('');
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="review-symbol-trigger cfd-symbol-picker-trigger"
        aria-label="全球市场品种"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          if (!open) updatePosition();
        }}
      >
        <span>{activeSymbol ? `${activeSymbol.name} · ${activeSymbol.symbol}` : value}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && position && createPortal(
        <div
          ref={panelRef}
          className="cfd-symbol-picker-panel"
          role="dialog"
          aria-label="选择全球市场品种"
          onBlurCapture={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || (!panelRef.current?.contains(next) && !triggerRef.current?.contains(next))) {
              setOpen(false);
            }
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === 'ArrowDown' && event.target === searchRef.current) {
              const firstSymbol = panelRef.current?.querySelector<HTMLButtonElement>('[data-cfd-symbol-option]');
              if (firstSymbol) {
                event.preventDefault();
                firstSymbol.focus();
              }
            }
          }}
          style={{ left: position.left, top: position.top, maxHeight: position.maxHeight }}
        >
          <div className="cfd-symbol-picker-heading">
            <div>
              <strong>选择品种</strong>
              <span>{displayedSymbols.length.toLocaleString()} 个可展示品种</span>
            </div>
            <button
              type="button"
              className="cfd-symbol-picker-refresh"
              onClick={onRefresh}
              disabled={loading}
              aria-label={loading ? '正在刷新品种目录' : '刷新品种目录'}
              title="刷新品种目录"
            >
              <RefreshCw size={14} className={loading ? 'spin' : undefined} aria-hidden="true" />
              <span>{loading ? '刷新中…' : '刷新'}</span>
            </button>
          </div>

          {warning && <p className="cfd-symbol-picker-warning" role="status">{warning}</p>}

          <label className="cfd-symbol-picker-variants">
            <input
              type="checkbox"
              checked={showLeverageVariants}
              onChange={(event) => setShowLeverageVariants(event.target.checked)}
            />
            显示杠杆变体
          </label>

          <label className="cfd-symbol-picker-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="跨分类搜索代码或名称"
              aria-label="搜索全球市场品种"
            />
          </label>

          <div className="cfd-symbol-picker-categories" role="group" aria-label="品种分类">
            <button
              type="button"
              aria-pressed={effectiveCategory === ALL_CATEGORY}
              className={effectiveCategory === ALL_CATEGORY ? 'active' : ''}
              onClick={() => setCategoryKey(ALL_CATEGORY)}
            >全部 <span>{displayedSymbols.length}</span></button>
            <button
              type="button"
              aria-pressed={effectiveCategory === FAVORITES_CATEGORY}
              className={effectiveCategory === FAVORITES_CATEGORY ? 'active' : ''}
              onClick={() => setCategoryKey(FAVORITES_CATEGORY)}
            >
              <Star size={12} aria-hidden="true" /> 自选 <span>{displayedSymbols.filter((item) => favorites.includes(item.symbol)).length}</span>
            </button>
            {categories.map((category) => (
              <button
                type="button"
                key={category.key}
                aria-pressed={effectiveCategory === category.key}
                className={effectiveCategory === category.key ? 'active' : ''}
                onClick={() => setCategoryKey(category.key)}
              >{category.name} <span>{categoryCounts.get(category.id) ?? 0}</span></button>
            ))}
          </div>

          <div className="cfd-symbol-picker-results" role="list" aria-label="Gate CFD 品种">
            {visibleSymbols.map((item) => {
              const favorite = favorites.includes(item.symbol);
              const selected = item.symbol === value;
              return (
                <div key={item.symbol} className={`cfd-symbol-picker-row${selected ? ' selected' : ''}`} role="listitem">
                  <button
                    type="button"
                    className="cfd-symbol-picker-option"
                    data-cfd-symbol-option
                    onClick={() => selectSymbol(item.symbol)}
                    aria-pressed={selected}
                    title={item.description || item.name}
                  >
                    <span className="cfd-symbol-picker-option-main">
                      <strong>{item.symbol}</strong>
                      <span>{item.name}</span>
                    </span>
                    <span className="cfd-symbol-picker-option-meta">
                      <span>{item.categoryName}</span>
                      {item.status === 'unavailable'
                        ? <span className="closed">历史品种</span>
                        : item.status && item.status !== 'open' && <span className="closed">休市</span>}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`cfd-symbol-picker-favorite${favorite ? ' active' : ''}`}
                    onClick={() => toggleFavorite(item.symbol)}
                    aria-label={favorite ? `取消收藏 ${item.symbol}` : `收藏 ${item.symbol}`}
                    aria-pressed={favorite}
                    title={favorite ? '取消收藏' : '加入自选'}
                  >
                    <Star size={15} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            {visibleSymbols.length === 0 && (
              <div className="cfd-symbol-picker-empty">
                {effectiveCategory === FAVORITES_CATEGORY && !deferredSearch
                  ? '还没有自选品种，点击星标即可收藏。'
                  : '没有找到符合条件的品种。'}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
