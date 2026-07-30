export type VideoItem = {
  index: number;
  date: string;
  time: string;
  title: string;
  url: string;
  videoId: string;
};

export type LearningStatus = 'unlearned' | 'learning' | 'learned';

export type UserLearningState = {
  status: LearningStatus;
  updatedAt: string;
  notes?: string;
  bookmarked?: boolean;
};

export type QuickFilter = 'all' | 'unfinished' | 'learned' | 'bookmarked' | 'noted';

export type SortOrder = 'asc' | 'desc';

export type FilterParams = {
  searchQuery: string;
  yearFilter: string;
  monthFilter: string;
  quickFilter: QuickFilter;
  sortOrder: SortOrder;
};

export type LearningStats = {
  totalCount: number;
  learnedCount: number;
  remainingCount: number;
  bookmarkCount: number;
  overallPercent: number;
};
