import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  Check,
  Clock3,
  LoaderCircle,
  Plus,
  Search,
  WifiOff,
  X,
} from 'lucide-react';
import {
  searchPerpetualSymbols,
  type PerpetualSymbolSearchItem,
  type PerpetualSymbolSearchResponse,
} from '@/api/market-api';

const RECENT_SYMBOLS_STORAGE_KEY = 'tiabtc-review-recent-symbols-v1';
const MAX_RECENT_SYMBOLS = 8;
const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 32;

type SearchCacheEntry = {
  cachedAt: number;
  response: PerpetualSymbolSearchResponse;
};

const searchCache = new Map<string, SearchCacheEntry>();

interface PerpetualSymbolSearchDialogProps {
  activeSymbol: string;
  savedSymbols: string[];
  onClose: () => void;
  onSelectSymbol: (item: PerpetualSymbolSearchItem) => Promise<void>;
}

function normalizeQuery(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function loadRecentSymbols(): string[] {
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(RECENT_SYMBOLS_STORAGE_KEY) || '[]'
    );
    if (!Array.isArray(saved)) return [];
    return saved
      .map((value) => String(value).trim().toUpperCase())
      .filter((value) => /^[A-Z0-9]{3,15}USDT$/.test(value))
      .slice(0, MAX_RECENT_SYMBOLS);
  } catch {
    return [];
  }
}

function rememberRecentSymbol(symbol: string): void {
  try {
    const next = [symbol, ...loadRecentSymbols().filter((item) => item !== symbol)]
      .slice(0, MAX_RECENT_SYMBOLS);
    window.localStorage.setItem(
      RECENT_SYMBOLS_STORAGE_KEY,
      JSON.stringify(next)
    );
  } catch {
    // Search remains usable when browser storage is unavailable.
  }
}

function savedSymbolItem(symbol: string): PerpetualSymbolSearchItem {
  return {
    symbol,
    base: symbol.slice(0, -4),
    quote: 'USDT',
    name: `${symbol.slice(0, -4)}/USDT 永续`,
    added: true,
  };
}

function rememberSearchResponse(
  key: string,
  response: PerpetualSymbolSearchResponse
): void {
  // A warm-up/offline fallback is intentionally short-lived. Caching it would
  // hide newly available online recommendations for several minutes.
  if (response.offlineMode || response.warning) return;
  searchCache.delete(key);
  searchCache.set(key, { cachedAt: Date.now(), response });
  while (searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = searchCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    searchCache.delete(oldestKey);
  }
}

export function PerpetualSymbolSearchDialog({
  activeSymbol,
  savedSymbols,
  onClose,
  onSelectSymbol,
}: PerpetualSymbolSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PerpetualSymbolSearchItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectingSymbol, setSelectingSymbol] = useState<string | null>(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialRecommendations = useMemo(() => {
    const unique = new Set([
      activeSymbol,
      ...loadRecentSymbols(),
      ...savedSymbols,
    ]);
    return Array.from(unique).slice(0, 20).map(savedSymbolItem);
  }, [activeSymbol, savedSymbols]);

  const localMatches = useMemo(() => {
    const normalized = normalizeQuery(query);
    if (!normalized) return initialRecommendations;
    return initialRecommendations.filter(
      (item) =>
        item.symbol.includes(normalized) || item.base.includes(normalized)
    );
  }, [initialRecommendations, query]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
    setError(null);
    const normalized = normalizeQuery(query);
    if (!normalized) {
      setResults(initialRecommendations);
      setLoading(false);
      setOfflineMode(false);
      setWarning(null);
      return;
    }

    setResults(localMatches);
    const cached = searchCache.get(normalized);
    if (
      cached &&
      Date.now() - cached.cachedAt <= SEARCH_CACHE_TTL_MS
    ) {
      setResults(cached.response.symbols);
      setOfflineMode(cached.response.offlineMode);
      setWarning(cached.response.warning || null);
      setLoading(false);
      return;
    }
    if (cached) searchCache.delete(normalized);

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchPerpetualSymbols(query, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return;
          rememberSearchResponse(normalized, response);
          setResults(response.symbols);
          setOfflineMode(response.offlineMode);
          setWarning(response.warning || null);
        })
        .catch((requestError) => {
          if (controller.signal.aborted) return;
          setError(
            requestError instanceof Error
              ? requestError.message
              : '搜索永续合约失败'
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [initialRecommendations, localMatches, query]);

  useEffect(() => {
    if (results.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => Math.min(current, results.length - 1));
  }, [results.length]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const chooseSymbol = useCallback(
    async (item: PerpetualSymbolSearchItem) => {
      if (selectingSymbol) return;
      setSelectingSymbol(item.symbol);
      setError(null);
      try {
        await onSelectSymbol(item);
        rememberRecentSymbol(item.symbol);
        onClose();
      } catch (selectionError) {
        setError(
          selectionError instanceof Error
            ? selectionError.message
            : '切换永续合约失败'
        );
      } finally {
        setSelectingSymbol(null);
      }
    },
    [onClose, onSelectSymbol, selectingSymbol]
  );

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(
        (current) => (current - 1 + results.length) % results.length
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[activeIndex];
      if (item) {
        void chooseSymbol({
          ...item,
          added: item.added || savedSymbols.includes(item.symbol),
        });
      }
    }
  };

  return (
    <div
      className="symbol-search-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !selectingSymbol) {
          event.preventDefault();
          onClose();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !selectingSymbol) onClose();
      }}
    >
      <section
        className="symbol-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="symbol-search-title"
      >
        <header className="symbol-search-header">
          <div>
            <h2 id="symbol-search-title">搜索永续合约</h2>
            <p>仅显示 Bybit 线性 USDT 永续合约</p>
          </div>
          <button
            type="button"
            className="symbol-search-close"
            onClick={onClose}
            disabled={Boolean(selectingSymbol)}
            aria-label="关闭永续合约搜索"
          >
            <X size={17} />
          </button>
        </header>

        <div className="symbol-search-input-wrap">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="输入 BTC、BTCUSDT 或 BTC/USDT"
            aria-label="搜索永续合约"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="symbol-search-results"
            aria-activedescendant={
              results[activeIndex]
                ? `symbol-search-option-${results[activeIndex].symbol}`
                : undefined
            }
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <LoaderCircle className="spin" size={16} />}
        </div>

        <div className="symbol-search-status-row">
          <span>
            {query.trim() ? '搜索结果' : '最近使用与已添加合约'}
          </span>
          <span>{results.length} 个结果</span>
        </div>

        {(offlineMode || warning || error) && (
          <div
            className={`symbol-search-message ${error ? 'error' : 'warning'}`}
          >
            {offlineMode ? (
              <WifiOff size={14} />
            ) : (
              <AlertCircle size={14} />
            )}
            <span>
              {error ||
                (offlineMode
                  ? '当前为离线缓存模式，仅显示已添加合约。'
                  : '在线合约目录暂不可用，已显示本地匹配结果。')}
            </span>
          </div>
        )}

        <div
          id="symbol-search-results"
          className="symbol-search-results"
          role="listbox"
        >
          {results.length === 0 && !loading ? (
            <div className="symbol-search-empty">
              <Search size={22} />
              <strong>没有找到匹配的永续合约</strong>
              <span>请检查代码，或尝试输入基础币名称。</span>
            </div>
          ) : (
            results.map((item, index) => {
              const isActive = item.symbol === activeSymbol;
              const isAdded = item.added || savedSymbols.includes(item.symbol);
              const isSelecting = selectingSymbol === item.symbol;
              return (
                <button
                  key={item.symbol}
                  id={`symbol-search-option-${item.symbol}`}
                  ref={(element) => {
                    resultRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === activeIndex}
                  className={`symbol-search-result ${
                    index === activeIndex ? 'highlighted' : ''
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() =>
                    void chooseSymbol({ ...item, added: isAdded })
                  }
                  disabled={Boolean(selectingSymbol)}
                >
                  <span className="symbol-search-result-icon">
                    {isSelecting ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : isAdded ? (
                      <Check size={15} />
                    ) : (
                      <Plus size={15} />
                    )}
                  </span>
                  <span className="symbol-search-result-main">
                    <strong>{item.symbol}</strong>
                    <small>{item.name}</small>
                  </span>
                  <span
                    className={`symbol-search-result-badge ${
                      isActive ? 'active' : isAdded ? 'saved' : ''
                    }`}
                  >
                    {isActive ? '当前' : isAdded ? '已添加' : '可添加'}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <footer className="symbol-search-footer">
          <span>
            <Clock3 size={13} /> 最近使用最多保留 {MAX_RECENT_SYMBOLS} 个
          </span>
          <span>↑↓ 选择 · Enter 确认 · Esc 关闭</span>
        </footer>
      </section>
    </div>
  );
}
