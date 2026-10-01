import {
  readLocalUiState,
  storedInteger,
  storedString,
} from '@/ui/persistence/local-ui-state';
import type { FilterParams } from './learning-types';

export const LEARNING_UI_STORAGE_KEY = 'tiabtc-learning-ui-v1';

export function loadLearningUiState(): { filters: FilterParams; page: number } {
  const stored = readLocalUiState(LEARNING_UI_STORAGE_KEY);
  const month = storedString(stored.monthFilter, 'all', undefined, 2);
  return {
    filters: {
      searchQuery: storedString(stored.searchQuery, ''),
      yearFilter: storedString(stored.yearFilter, 'all', undefined, 4),
      monthFilter:
        month === 'all' || /^(?:0?[1-9]|1[0-2])$/.test(month) ? month : 'all',
      quickFilter: storedString(
        stored.quickFilter,
        'all',
        ['all', 'unfinished', 'learned', 'bookmarked', 'noted']
      ) as FilterParams['quickFilter'],
      sortOrder: storedString(stored.sortOrder, 'asc', [
        'asc',
        'desc',
      ]) as FilterParams['sortOrder'],
    },
    page: storedInteger(stored.page, 1, 1),
  };
}
