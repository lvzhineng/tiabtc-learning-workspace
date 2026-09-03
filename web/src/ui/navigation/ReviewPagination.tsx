import { memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ReviewPaginationProps {
  page: number;
  pageCount: number;
  zeroIndexed?: boolean;
  onPageChange: (page: number) => void;
}

export const ReviewPagination = memo(function ReviewPagination({
  page,
  pageCount,
  zeroIndexed = false,
  onPageChange,
}: ReviewPaginationProps) {
  const minPage = zeroIndexed ? 0 : 1;
  const maxPage = zeroIndexed ? Math.max(0, pageCount - 1) : Math.max(1, pageCount);
  const displayCurrent = zeroIndexed ? (pageCount > 0 ? page + 1 : 0) : Math.min(page, pageCount);

  return (
    <div className="bitlang-pagination">
      <button
        type="button"
        disabled={page <= minPage}
        onClick={() => onPageChange(page - 1)}
        title="上一页"
      >
        <ChevronLeft size={14} />
      </button>
      <span>
        {displayCurrent} / {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= maxPage}
        onClick={() => onPageChange(page + 1)}
        title="下一页"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
});
