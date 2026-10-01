import { REVIEW_TIMEFRAMES, type ReviewTimeframe } from '@/domain/timeframe';
import {
  readLocalUiState,
  storedBoolean,
  storedInteger,
  storedString,
} from '@/ui/persistence/local-ui-state';
import type { ReviewVenue } from './position-review-types';

export const POSITION_REVIEW_UI_STORAGE_KEY = 'tiabtc-position-review-ui-v1';

export type ResultFilter = 'all' | 'profit' | 'loss';
export type StatusFilter = 'all' | 'open' | 'closed';
export type SideFilter = 'all' | 'long' | 'short';
export type SortField = 'entryTimeMs' | 'netPnl';
export type DateRangeFilter = 'all' | '1d' | '3d' | '7d' | '30d' | '90d';
export type VenueFilter = 'all' | ReviewVenue;

export const DATE_RANGE_MS_MAP: Record<Exclude<DateRangeFilter, 'all'>, number> = {
  '1d': 1 * 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export type PositionReviewUiState = {
  search: string;
  dateRange: DateRangeFilter;
  symbolFilter: string;
  venueFilter: VenueFilter;
  side: SideFilter;
  status: StatusFilter;
  result: ResultFilter;
  tagFilter: string;
  noNote: boolean;
  noTag: boolean;
  sortField: SortField;
  descending: boolean;
  page: number;
  selectedId: string | null;
  timeframe: ReviewTimeframe;
  autoTimeframe: boolean;
  showMoreFilters: boolean;
  showUsSessionBands: boolean;
  showWeekendBands: boolean;
  showOtherPositions: boolean;
  viewMode: 'chart' | 'dashboard';
};

export function loadPositionReviewUiState(): PositionReviewUiState {
  const stored = readLocalUiState(POSITION_REVIEW_UI_STORAGE_KEY);
  const selectedId = storedString(stored.selectedId, '', undefined, 128);
  const tagFilter = storedString(stored.tagFilter, 'all', undefined, 32);
  return {
    search: storedString(stored.search, ''),
    dateRange: storedString(stored.dateRange, 'all', [
      'all',
      '1d',
      '3d',
      '7d',
      '30d',
      '90d',
    ]) as DateRangeFilter,
    symbolFilter: storedString(stored.symbolFilter, 'all', undefined, 40),
    venueFilter: storedString(stored.venueFilter, 'all', [
      'all',
      'bitget',
      'gate',
    ]) as VenueFilter,
    side: storedString(stored.side, 'all', [
      'all',
      'long',
      'short',
    ]) as SideFilter,
    status: storedString(stored.status, 'all', [
      'all',
      'open',
      'closed',
    ]) as StatusFilter,
    result: storedString(stored.result, 'all', [
      'all',
      'profit',
      'loss',
    ]) as ResultFilter,
    tagFilter:
      tagFilter === 'all' || /^\d+$/.test(tagFilter) ? tagFilter : 'all',
    noNote: storedBoolean(stored.noNote, false),
    noTag: storedBoolean(stored.noTag, false),
    sortField: storedString(stored.sortField, 'entryTimeMs', [
      'entryTimeMs',
      'netPnl',
    ]) as SortField,
    descending: storedBoolean(stored.descending, true),
    page: storedInteger(stored.page, 0, 0),
    selectedId: selectedId || null,
    timeframe: storedString(stored.timeframe, '15', REVIEW_TIMEFRAMES) as ReviewTimeframe,
    autoTimeframe: storedBoolean(stored.autoTimeframe, true),
    showMoreFilters: storedBoolean(stored.showMoreFilters, false),
    showUsSessionBands: storedBoolean(stored.showUsSessionBands, false),
    showWeekendBands: storedBoolean(stored.showWeekendBands, false),
    showOtherPositions: storedBoolean(stored.showOtherPositions, true),
    viewMode: storedString(stored.viewMode, 'chart', [
      'chart',
      'dashboard',
    ]) as PositionReviewUiState['viewMode'],
  };
}
