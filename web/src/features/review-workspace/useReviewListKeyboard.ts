import { useEffect } from 'react';
import type { ReviewTimeframe } from '@/domain/timeframe';

const TIMEFRAMES: ReviewTimeframe[] = ['1', '5', '15', '60', '240', 'D', 'W'];

export function useReviewListKeyboard(options: {
  enabled: boolean;
  itemIds: string[];
  selectedId: string | null | undefined;
  pageSize: number;
  onSelect: (id: string, pageIndex: number) => void;
  onTimeframe: (timeframe: ReviewTimeframe) => void;
}): void {
  const { enabled, itemIds, selectedId, pageSize, onSelect, onTimeframe } =
    options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        document.querySelector('[aria-modal="true"]')
      ) {
        return;
      }
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        activeTag === 'select' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }

      const keyNumber = Number.parseInt(event.key, 10);
      if (keyNumber >= 1 && keyNumber <= TIMEFRAMES.length) {
        const nextTimeframe = TIMEFRAMES[keyNumber - 1];
        if (nextTimeframe) {
          event.preventDefault();
          onTimeframe(nextTimeframe);
        }
        return;
      }

      const currentIndex = selectedId
        ? itemIds.indexOf(selectedId)
        : -1;
      let nextIndex = -1;
      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault();
        if (currentIndex >= 0 && currentIndex < itemIds.length - 1) {
          nextIndex = currentIndex + 1;
        }
      } else if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault();
        if (currentIndex > 0) {
          nextIndex = currentIndex - 1;
        }
      }
      if (nextIndex < 0) return;
      const nextId = itemIds[nextIndex];
      if (!nextId) return;
      onSelect(nextId, Math.floor(nextIndex / pageSize));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, itemIds, onSelect, onTimeframe, pageSize, selectedId]);
}

export function scrollReviewRowIntoView(
  listElement: HTMLElement | null,
  itemId: string | null | undefined
): void {
  if (!listElement || !itemId) return;
  const row = listElement.querySelector(
    `[data-review-id="${CSS.escape(itemId)}"]`
  );
  if (row instanceof HTMLElement) {
    row.scrollIntoView({ block: 'nearest' });
  }
}
