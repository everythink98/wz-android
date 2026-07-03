import type { Category, FeedSource, Reply, Source } from './types';
import type { TopicRecord } from './readerData';
import { decodeHtml } from './localHtml';

export interface HighlightPart {
  text: string;
  highlighted: boolean;
}

export interface LibraryFilter {
  source: FeedSource;
  category: string;
}

export interface LibrarySection {
  label: string;
  records: TopicRecord[];
}

export const REPLY_PAGE_SIZE = 30;

export function libraryCategoryKey(source: FeedSource, categoryId: string) {
  return source === 'all' ? categoryId : `${source}:${categoryId}`;
}

function libraryCategoryLabel(source: FeedSource, category: Category) {
  if (source === 'linuxdo' && category.id === 'uncategorized') {
    return '未分类';
  }
  return category.name || category.id;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueTerms(query: string) {
  const seen = new Set<string>();
  return query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term && !term.startsWith('-'))
    .filter((term) => {
      const key = term.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.length - left.length);
}

export function highlightTextParts(text: string, query: string): HighlightPart[] {
  const terms = uniqueTerms(query);
  if (!text || terms.length === 0) {
    return [{ text, highlighted: false }];
  }
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern).filter((part) => part.length > 0);
  return parts.map((part) => ({
    text: part,
    highlighted: terms.some((term) => term.toLowerCase() === part.toLowerCase())
  }));
}

export function highlightHtml(html: string, query: string) {
  const terms = uniqueTerms(query);
  if (!html || terms.length === 0) {
    return html;
  }
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => part.startsWith('<') ? part : part.replace(pattern, '<mark>$1</mark>'))
    .join('');
}

export function stripHtml(html: string | undefined) {
  const preLineBreakToken = '\0WZ_PRE_NL\0';
  return decodeHtml((html || '')
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (block) => block.replace(/\n/g, preLineBreakToken))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<img\b([^>]*)>/gi, (_match, attributes: string) => {
      const label = attributes.match(/\b(?:alt|title)=(["'])(.*?)\1/i)?.[2] || '';
      return label ? ` ${label} ` : ' ';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|blockquote|pre|ul|ol|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/[ \t\f\v]+\n/g, '\n')
    .replace(/\n[ \t\f\v]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replaceAll(preLineBreakToken, '\n')
    .trim();
}

export function filterLibraryRecords(records: TopicRecord[], filter: LibraryFilter) {
  return records.filter((record) => (
    (filter.source === 'all' || record.topic.source === filter.source)
    && (filter.category === 'all' || libraryCategoryKey(record.topic.source, record.topic.categoryId || record.topic.category || '') === filter.category || record.topic.category === filter.category)
  ));
}

export function libraryCategoryFilterItems(categories: Category[], source: FeedSource) {
  const selected = source === 'all' ? categories : categories.filter((category) => category.source === source);
  const seen = new Set<string>();
  return [
    { value: 'all', label: '全部' },
    ...selected.flatMap((category) => {
      const key = libraryCategoryKey(category.source, category.id);
      if (seen.has(key)) {
        return [];
      }
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
    if (Number.isFinite(time) && time >= todayStart.getTime()) {
      groups[0].records.push(record);
    } else if (Number.isFinite(time) && time >= weekStart.getTime()) {
      groups[1].records.push(record);
    } else {
      groups[2].records.push(record);
    }
  }
  return groups.filter((group) => group.records.length > 0);
}

export function createReplyTextIndex(replies: Reply[]) {
  return new Map(replies.map((reply) => [reply, stripHtml(reply.contentHtml).toLowerCase()]));
}

export function createReplyTextIndexForQuery(replies: Reply[], query: string) {
  return uniqueTerms(query).length > 0 ? createReplyTextIndex(replies) : undefined;
}

export function filterRepliesByQuery(replies: Reply[], query: string, textIndex?: Map<Reply, string>) {
  const terms = uniqueTerms(query);
  if (terms.length === 0) {
    return replies;
  }
  return replies.filter((reply) => {
    const text = textIndex?.get(reply) ?? stripHtml(reply.contentHtml).toLowerCase();
    return terms.every((term) => text.includes(term.toLowerCase()));
  });
}

function replyPageForExpectedCount(count: number) {
  return Math.max(1, Math.ceil(Math.max(1, count) / REPLY_PAGE_SIZE));
}

function replyOffsetForExpectedCount(count: number) {
  return (replyPageForExpectedCount(count) - 1) * REPLY_PAGE_SIZE;
}

function replyPageForIndex(index: number) {
  return Math.max(1, Math.floor(index / REPLY_PAGE_SIZE) + 1);
}

export function replyRefreshTarget({
  source,
  afterSubmit,
  expectedReplyCount,
  replyNextPage,
  targetReplyIndex
}: {
  source: Source;
  afterSubmit: boolean;
  expectedReplyCount: number;
  replyNextPage?: number | null;
  targetReplyIndex?: number;
}) {
  if (!afterSubmit) {
    return { page: 1, offset: 0 };
  }
  if (typeof targetReplyIndex === 'number' && targetReplyIndex >= 0) {
    const page = replyPageForIndex(targetReplyIndex);
    const offset = source === 'yaohuo' ? 0 : (page - 1) * REPLY_PAGE_SIZE;
    if (source === 'nodeseek' && replyNextPage === 1) {
      return { page: 1, offset };
    }
    return { page, offset };
  }
  const offset = source === 'yaohuo' ? 0 : replyOffsetForExpectedCount(expectedReplyCount);
  if (source === 'nodeseek' && replyNextPage === 1) {
    return { page: 1, offset };
  }
  return {
    page: replyPageForExpectedCount(expectedReplyCount),
    offset
  };
}
