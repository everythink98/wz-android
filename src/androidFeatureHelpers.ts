import type { FeedSource, Reply } from './types';
import type { TopicRecord } from './readerData';

export interface HighlightPart {
  text: string;
  highlighted: boolean;
}

export interface LibraryFilter {
  source: FeedSource;
  category: string;
  tag: string;
}

export interface LibrarySection {
  label: string;
  records: TopicRecord[];
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
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function readerModeHtml(html: string) {
  return html
    .replace(/<hr\b[^>]*>\s*(<hr\b[^>]*>\s*)+/gi, '<hr>')
    .replace(/(<p>\s*<\/p>\s*)+/gi, '');
}

export function filterLibraryRecords(records: TopicRecord[], filter: LibraryFilter) {
  return records.filter((record) => (
    (filter.source === 'all' || record.topic.source === filter.source)
    && (filter.category === 'all' || record.topic.category === filter.category)
    && (filter.tag === 'all' || record.tags?.includes(filter.tag))
  ));
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

export function filterRepliesByQuery(replies: Reply[], query: string) {
  const terms = uniqueTerms(query);
  if (terms.length === 0) {
    return replies;
  }
  return replies.filter((reply) => {
    const text = stripHtml(reply.contentHtml).toLowerCase();
    return terms.every((term) => text.includes(term.toLowerCase()));
  });
}
