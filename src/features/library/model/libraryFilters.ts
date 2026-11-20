import type { Category, FeedSource } from '@/domain/forum/models';
import { sourceCatalog, type Source } from '@/domain/forum/sourceCatalog';
import type { TopicRecord } from '@/domain/reader/readerData';

interface LibrarySection {
  label: string;
  records: TopicRecord[];
}

function libraryCategoryLabel(category: Category) {
  if (category.source === 'linuxdo' && category.id === 'uncategorized') {
    return '未分类';
  }
  return category.name || category.id;
}

export function libraryCategoryFilterItems(categories: Category[], source: FeedSource) {
  const options = new Map<string, { source: Source; label: string }>();
  const labelSources = new Map<string, Source | 'shared'>();
  for (const category of categories) {
    if (source !== 'all' && category.source !== source) continue;
    const value = `${category.source}:${category.id}`;
    if (options.has(value)) continue;
    const label = libraryCategoryLabel(category);
    options.set(value, { source: category.source, label });
    const previousSource = labelSources.get(label);
    labelSources.set(label, previousSource && previousSource !== category.source ? 'shared' : category.source);
  }
  return [
    { value: 'all', label: '全部' },
    ...Array.from(options, ([value, option]) => ({
      value,
      label:
        labelSources.get(option.label) === 'shared'
          ? `${sourceCatalog[option.source].label} · ${option.label}`
          : option.label
    }))
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
