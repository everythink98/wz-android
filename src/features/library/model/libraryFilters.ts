import type { Category, FeedSource } from '@/domain/forum/models';
import type { TopicRecord } from '@/domain/reader/readerData';

export interface LibraryFilter {
  source: FeedSource;
  category: string;
}

export interface LibrarySection {
  label: string;
  records: TopicRecord[];
}

export function libraryCategoryKey(source: FeedSource, categoryId: string) {
  return source === 'all' ? categoryId : `${source}:${categoryId}`;
}

function libraryCategoryLabel(source: FeedSource, category: Category) {
  if (source === 'linuxdo' && category.id === 'uncategorized') {
    return '未分类';
  }
  return category.name || category.id;
}

export function filterLibraryRecords(records: TopicRecord[], filter: LibraryFilter) {
  return records.filter(
    (record) =>
      (filter.source === 'all' || record.topic.source === filter.source) &&
      (filter.category === 'all' ||
        libraryCategoryKey(record.topic.source, record.topic.categoryId || record.topic.category || '') ===
          filter.category ||
        record.topic.category === filter.category)
  );
}

export function libraryCategoryFilterItems(categories: Category[], source: FeedSource) {
  const selected = source === 'all' ? categories : categories.filter((category) => category.source === source);
  const seen = new Set<string>();
  return [
    { value: 'all', label: '全部' },
    ...selected.flatMap((category) => {
      const key = libraryCategoryKey(category.source, category.id);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ value: key, label: libraryCategoryLabel(category.source, category) }];
    })
  ];
}

export function groupLibraryRecordsByTime(records: TopicRecord[], now = new Date()): LibrarySection[] {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);
  const groups: LibrarySection[] = [
    { label: '今天', records: [] },
    { label: '本周', records: [] },
    { label: '更早', records: [] }
  ];
  for (const record of records) {
    const time = Date.parse(record.savedAt);
    if (Number.isFinite(time) && time >= todayStart.getTime()) groups[0].records.push(record);
    else if (Number.isFinite(time) && time >= weekStart.getTime()) groups[1].records.push(record);
    else groups[2].records.push(record);
  }
  return groups.filter((group) => group.records.length > 0);
}
