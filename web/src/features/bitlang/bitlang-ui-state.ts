import { REVIEW_TIMEFRAMES, type ReviewTimeframe } from '@/domain/timeframe';
import {
  readLocalUiState,
  storedBoolean,
  storedInteger,
  storedString,
} from '@/ui/persistence/local-ui-state';
import type { BitlangDirection } from './bitlang-types';

export const BITLANG_UI_STORAGE_KEY = 'tiabtc-bitlang-ui-v1';

export type DateRangeFilter = 'all' | '1d' | '3d' | '7d' | '30d' | '90d';
export const DATE_RANGE_MS_MAP: Record<Exclude<DateRangeFilter, 'all'>, number> = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export type ResultFilter = 'all' | 'profit' | 'loss';
export type SortField = 'entryTime' | 'profit' | 'returnRate' | 'holdingMinutes';

export type BitlangUiState = {
  search: string;
  instrument: string;
  direction: 'all' | BitlangDirection;
  result: ResultFilter;
  dateRange: DateRangeFilter;
  minimumHoldingMinutes: string;
  tagFilter: string;
  noNote: boolean;
  noTag: boolean;
  sortField: SortField;
  descending: boolean;
  timeframe: ReviewTimeframe;
  autoTimeframe: boolean;
  showMoreFilters: boolean;
  showUsSessionBands: boolean;
  showWeekendBands: boolean;
  page: number;
  selectedId: string;
  viewMode: 'chart' | 'dashboard';
};

export function loadBitlangUiState(): BitlangUiState {
  const stored = readLocalUiState(BITLANG_UI_STORAGE_KEY);
  const minimumHoldingMinutes = storedString(
    stored.minimumHoldingMinutes,
    '',
    undefined,
    16
  );
  const tagFilter = storedString(stored.tagFilter, 'all', undefined, 32);
  return {
    search: storedString(stored.search, ''),
    instrument: storedString(stored.instrument, 'all', undefined, 40),
    direction: storedString(stored.direction, 'all', [
      'all',
      '多',
      '空',
    ]) as BitlangUiState['direction'],
    result: storedString(stored.result, 'all', [
      'all',
      'profit',
      'loss',
    ]) as ResultFilter,
    dateRange: storedString(stored.dateRange, 'all', [
      'all',
      '1d',
      '3d',
      '7d',
      '30d',
      '90d',
    ]) as DateRangeFilter,
    minimumHoldingMinutes:
      minimumHoldingMinutes === '' ||
      (Number.isFinite(Number(minimumHoldingMinutes)) &&
        Number(minimumHoldingMinutes) >= 0)
        ? minimumHoldingMinutes
        : '',
    tagFilter:
      tagFilter === 'all' || /^\d+$/.test(tagFilter) ? tagFilter : 'all',
    noNote: storedBoolean(stored.noNote, false),
    noTag: storedBoolean(stored.noTag, false),
    sortField: storedString(stored.sortField, 'entryTime', [
      'entryTime',
      'profit',
      'returnRate',
      'holdingMinutes',
    ]) as SortField,
    descending: storedBoolean(stored.descending, true),
    timeframe: storedString(stored.timeframe, '60', REVIEW_TIMEFRAMES) as ReviewTimeframe,
    autoTimeframe: storedBoolean(stored.autoTimeframe, true),
    showMoreFilters: storedBoolean(stored.showMoreFilters, false),
    showUsSessionBands: storedBoolean(stored.showUsSessionBands, false),
    showWeekendBands: storedBoolean(stored.showWeekendBands, false),
    page: storedInteger(stored.page, 1, 1),
    selectedId: storedString(stored.selectedId, '', undefined, 128),
    viewMode: storedString(stored.viewMode, 'chart', [
      'chart',
      'dashboard',
    ]) as BitlangUiState['viewMode'],
  };
}
