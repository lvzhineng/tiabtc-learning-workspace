import type {
  VideoItem,
  UserLearningState,
  FilterParams,
  LearningStats,
} from './learning-types';

export function computeLearningStats(
  videos: VideoItem[],
  stateMap: Record<string, UserLearningState>
): LearningStats {
  const totalCount = videos.length;
  let learnedCount = 0;
  let bookmarkCount = 0;

  for (const v of videos) {
    const st = stateMap[v.videoId];
    if (st?.status === 'learned') {
      learnedCount += 1;
    }
    if (st?.bookmarked) {
      bookmarkCount += 1;
    }
  }

  const remainingCount = totalCount - learnedCount;
  const overallPercent = totalCount > 0 ? Math.round((learnedCount / totalCount) * 100) : 0;

  return {
    totalCount,
    learnedCount,
    remainingCount,
    bookmarkCount,
    overallPercent,
  };
}

export function filterAndSortVideos(
  videos: VideoItem[],
  stateMap: Record<string, UserLearningState>,
  params: FilterParams
): VideoItem[] {
  let result = [...videos];

  // 1. Search Query Filter (title, date, note)
  if (params.searchQuery.trim()) {
    const q = params.searchQuery.trim().toLowerCase();
    result = result.filter((v) => {
      const st = stateMap[v.videoId];
      const matchTitle = v.title.toLowerCase().includes(q);
      const matchDate = v.date.toLowerCase().includes(q);
      const matchNotes = st?.note ? st.note.toLowerCase().includes(q) : false;
      return matchTitle || matchDate || matchNotes;
    });
  }

  // 2. Year Filter
  if (params.yearFilter !== 'all') {
    result = result.filter((v) => v.date.startsWith(params.yearFilter));
  }

  // 3. Month Filter
  if (params.monthFilter !== 'all' && params.yearFilter !== 'all') {
    const prefix = `${params.yearFilter}-${params.monthFilter.padStart(2, '0')}`;
    result = result.filter((v) => v.date.startsWith(prefix));
  }

  // 4. Quick Filter Chip
  if (params.quickFilter === 'unfinished') {
    result = result.filter((v) => stateMap[v.videoId]?.status !== 'learned');
  } else if (params.quickFilter === 'learned') {
    result = result.filter((v) => stateMap[v.videoId]?.status === 'learned');
  } else if (params.quickFilter === 'bookmarked') {
    result = result.filter((v) => Boolean(stateMap[v.videoId]?.bookmarked));
  } else if (params.quickFilter === 'noted') {
    result = result.filter((v) => Boolean(stateMap[v.videoId]?.note?.trim()));
  }

  // 5. Sort Order (asc: earliest first, desc: latest first)
  result.sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) {
      return params.sortOrder === 'asc' ? cmp : -cmp;
    }
    return params.sortOrder === 'asc' ? a.index - b.index : b.index - a.index;
  });

  return result;
}
