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

function htmlTagEnd(html: string, start: number) {
  if (html.startsWith('<!--', start)) {
    const commentEnd = html.indexOf('-->', start + 4);
    return commentEnd < 0 ? -1 : commentEnd + 3;
  }

  const first = html[start + 1];
  const second = html[start + 2];
  if (!first || !(/[A-Za-z!?]/.test(first) || (first === '/' && Boolean(second) && /[A-Za-z]/.test(second)))) {
    return -1;
  }

  let quote = '';
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) {
        quote = '';
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return -1;
}

function transformHtmlSegments(
  html: string,
  transformText: (text: string) => string,
  transformTag: (tag: string) => string
) {
  let output = '';
  let textStart = 0;
  let index = 0;
  while (index < html.length) {
    if (html[index] !== '<') {
      index += 1;
      continue;
    }
    const tagEnd = htmlTagEnd(html, index);
    if (tagEnd < 0) {
      index += 1;
      continue;
    }
    output += transformText(html.slice(textStart, index));
    output += transformTag(html.slice(index, tagEnd));
    index = tagEnd;
    textStart = tagEnd;
  }
  return output + transformText(html.slice(textStart));
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
  return transformHtmlSegments(
    html,
    (text) => text.replace(pattern, '<mark>$1</mark>'),
    (tag) => tag
  );
}

export function stripHtml(html: string | undefined) {
  const preLineBreakToken = '\0WZ_PRE_NL\0';
  let ignoredElement = '';
  let preDepth = 0;
  const text = transformHtmlSegments(
    html || '',
    (segment) => {
      if (ignoredElement) {
        return '';
      }
      return preDepth > 0 ? segment.replace(/\n/g, preLineBreakToken) : segment;
    },
    (tag) => {
      if (tag.startsWith('<!--')) {
        return '';
      }
      const tagMatch = tag.match(/^<\s*(\/?)\s*([A-Za-z][\w:-]*)/);
      if (!tagMatch) {
        return '';
      }
      const closing = tagMatch[1] === '/';
      const name = tagMatch[2].toLowerCase();
      if (ignoredElement) {
        if (closing && name === ignoredElement) {
          ignoredElement = '';
        }
        return '';
      }
      if (!closing && (name === 'script' || name === 'style')) {
        ignoredElement = name;
        return '';
      }
      if (name === 'pre') {
        if (closing) {
          preDepth = Math.max(0, preDepth - 1);
          return '\n';
        }
        preDepth += 1;
        return '';
      }
      if (!closing && name === 'img') {
        const label = tag.match(/\b(?:alt|title)=(["'])(.*?)\1/i)?.[2] || '';
        return label ? ` ${label} ` : ' ';
      }
      if (!closing && (name === 'br' || name === 'li')) {
        return '\n';
      }
      if (closing && /^(?:p|div|blockquote|ul|ol|tr|h[1-6])$/.test(name)) {
        return '\n';
      }
      return '';
    }
  );
  return decodeHtml(text)
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

function replyPageForExpectedCount(count: number, pageSize = REPLY_PAGE_SIZE) {
  return Math.max(1, Math.ceil(Math.max(1, count) / pageSize));
}

function replyOffsetForExpectedCount(count: number, pageSize = REPLY_PAGE_SIZE) {
  return (replyPageForExpectedCount(count, pageSize) - 1) * pageSize;
}

function replyPageForIndex(index: number, pageSize = REPLY_PAGE_SIZE) {
  return Math.max(1, Math.floor(index / pageSize) + 1);
}

function nodeSeekReplyPageSize(replyNextPage?: number | null, replyNextOffset?: number | null) {
  if (!replyNextPage || replyNextPage <= 1 || !replyNextOffset || replyNextOffset <= 0) {
    return REPLY_PAGE_SIZE;
  }
  return Math.max(1, Math.floor(replyNextOffset / (replyNextPage - 1)));
}

function replyRefreshResult(page: number, offset: number, limit = REPLY_PAGE_SIZE) {
  return limit === REPLY_PAGE_SIZE ? { page, offset } : { page, offset, limit };
}

export function replyLoadMoreLimit({
  source,
  replyNextPage,
  replyNextOffset
}: {
  source: Source;
  replyNextPage?: number | null;
  replyNextOffset?: number | null;
}) {
  return source === 'nodeseek'
    ? nodeSeekReplyPageSize(replyNextPage, replyNextOffset)
    : REPLY_PAGE_SIZE;
}

export function replyCountAfterNewReplySubmit(currentReplyCount: number, loadedReplyCount: number) {
  return Math.max(currentReplyCount + 1, loadedReplyCount);
}

export function replyRefreshTarget({
  source,
  afterSubmit,
  expectedReplyCount,
  replyNextPage,
  replyNextOffset,
  loadedReplyCount,
  targetReplyIndex
}: {
  source: Source;
  afterSubmit: boolean;
  expectedReplyCount: number;
  replyNextPage?: number | null;
  replyNextOffset?: number | null;
  loadedReplyCount?: number;
  targetReplyIndex?: number;
}) {
  if (!afterSubmit) {
    const limit = source === 'nodeseek' ? (loadedReplyCount || REPLY_PAGE_SIZE) : REPLY_PAGE_SIZE;
    return replyRefreshResult(1, 0, limit);
  }
  const pageSize = source === 'nodeseek' ? nodeSeekReplyPageSize(replyNextPage, replyNextOffset) : REPLY_PAGE_SIZE;
  if (typeof targetReplyIndex === 'number' && targetReplyIndex >= 0) {
    const page = replyPageForIndex(targetReplyIndex, pageSize);
    const offset = source === 'yaohuo' ? 0 : (page - 1) * pageSize;
    if (source === 'nodeseek' && replyNextPage === 1) {
      return { page: 1, offset };
    }
    return replyRefreshResult(page, offset, source === 'nodeseek' ? pageSize : REPLY_PAGE_SIZE);
  }
  const offset = source === 'yaohuo' ? 0 : replyOffsetForExpectedCount(expectedReplyCount, pageSize);
  if (source === 'nodeseek' && replyNextPage === 1) {
    return { page: 1, offset };
  }
  return replyRefreshResult(
    replyPageForExpectedCount(expectedReplyCount, pageSize),
    offset,
    source === 'nodeseek' ? pageSize : REPLY_PAGE_SIZE
  );
}
