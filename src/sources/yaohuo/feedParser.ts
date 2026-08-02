import type { HTMLElement } from 'node-html-parser';
import type { FeedResponse, SearchResponse, Topic } from '@/domain/forum/models';
import {
  absoluteUrl,
  elementText,
  parseHtml,
  parsePositiveInteger,
  sortTopicsByTime,
  textExcerpt
} from '@/domain/forum/html';
import { accessRequirementFromText } from '@/domain/forum/accessRequirements';
import { annotateSourceDiagnosticSummary, sourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  YAOHUO_BASE_URL as BASE_URL,
  YAOHUO_CATEGORIES,
  extractYaohuoTopicParts as extractTopicParts,
  extractYaohuoUserIdFromHref as extractUserIdFromHref,
  nextYaohuoPageFromHtml as nextPageFromHtml,
  yaohuoUserUrl as userUrl
} from './protocol';
import { categoryNames, currentYaohuoClock, parseYaohuoDate } from './normalization';
import { ensureYaohuoHtmlLoggedIn } from './sessionParser';

function extractClassIdFromRow(element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number]) {
  return element
    .querySelectorAll('a[href]')
    .map((item) => item.getAttribute('href')?.match(/[?&]classid=(\d+)/i)?.[1])
    .find(Boolean);
}

function parseListItem(
  element: ReturnType<ReturnType<typeof parseHtml>['querySelectorAll']>[number],
  fallbackClassId?: string,
  fallbackCreatedAt = new Date().toISOString(),
  now = currentYaohuoClock()
) {
  const link = element.querySelectorAll('a[href]').find((item) => {
    const href = item.getAttribute('href') || '';
    return (
      elementText(item) &&
      (/bbs-\d+\.html/i.test(href) ||
        /view\.aspx/i.test(href) ||
        (/[?&]id=\d+/i.test(href) && !/book_re\.aspx/i.test(href)))
    );
  });
  const { id, classId, url } = extractTopicParts(link?.getAttribute('href'));
  if (!id) {
    return null;
  }
  const text = elementText(element);
  const title = elementText(link);
  const resolvedClassId = classId || extractClassIdFromRow(element) || fallbackClassId;
  const accessRequirement = accessRequirementFromText(text.replace(title, ' '));
  const replyCount = parsePositiveInteger(
    element.querySelectorAll('a').find((item) => /^\d+$/.test(elementText(item)))?.text
  );
  const viewCount = parsePositiveInteger(
    text.match(/阅\s*(\d+)/)?.[1] || text.match(/(\d+)\s*阅/)?.[1] || text.match(/\/\s*阅(\d+)/)?.[1]
  );
  const rightText = element.querySelectorAll('.right').map(elementText).find(Boolean) || '';
  const timeText =
    rightText ||
    text.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0] ||
    text.match(/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/)?.[0] ||
    '';
  const displayTimeText = timeText;
  const parsedCreatedAt = parseYaohuoDate(timeText || text, now);
  const createdAt = parsedCreatedAt || fallbackCreatedAt;
  const author =
    text
      .replace(title, '')
      .split('/')
      .map((part) => part.trim().replace(/^\d+\.\s*/, ''))
      .find(
        (part) =>
          part && !/^\d+$/.test(part) && !/阅\s*\d+/.test(part) && !/\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{1,2}/.test(part)
      ) || '';
  const authorLink = element.querySelector('a[href*="userinfo"], a[href*="touserid"]');
  const authorHref = authorLink?.getAttribute('href') || '';
  const authorId = extractUserIdFromHref(authorHref);
  return {
    source: 'yaohuo' as const,
    id,
    title,
    author,
    authorId,
    authorUrl: authorId ? userUrl(authorId) : authorHref ? absoluteUrl(authorHref, BASE_URL) : undefined,
    categoryId: resolvedClassId,
    category: resolvedClassId ? categoryNames.get(resolvedClassId) : undefined,
    url: url || `${BASE_URL}/bbs-${id}.html`,
    createdAt,
    lastReplyAt: createdAt,
    ...(displayTimeText ? { displayTimeText } : {}),
    replyCount,
    viewCount: viewCount || undefined,
    excerpt: textExcerpt(text),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

function parseListDataChunks(html: string) {
  return [
    ...html.matchAll(
      /<div\b[^>]*class=["'][^"']*\blistdata\b[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*class=["'][^"']*\blistdata\b|<!--listE-->|$)/gi
    )
  ].map((match) => match[0]);
}

function parseCompactListItems(root: ReturnType<typeof parseHtml>, fallbackClassId?: string, limit = 30) {
  const items: Topic[] = [];
  const seen = new Set<string>();
  const fallbackCreatedAt = new Date().toISOString();
  for (const list of root.querySelectorAll('div.list, .list')) {
    for (const link of list.querySelectorAll('a[href]')) {
      const title = elementText(link);
      const { id, classId, url } = extractTopicParts(link.getAttribute('href'));
      if (!id || !title || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const resolvedClassId = classId || fallbackClassId;
      const parent = link.parentNode as HTMLElement | null;
      const row = parent && typeof parent.querySelectorAll === 'function' ? parent : list;
      const text = elementText(row);
      const accessRequirement = accessRequirementFromText(text.replace(title, ' '));
      items.push({
        source: 'yaohuo',
        id,
        title,
        author: '',
        categoryId: resolvedClassId,
        category: resolvedClassId ? categoryNames.get(resolvedClassId) : undefined,
        url: url || `${BASE_URL}/bbs-${id}.html`,
        createdAt: fallbackCreatedAt,
        lastReplyAt: fallbackCreatedAt,
        replyCount: 0,
        excerpt: title,
        ...(accessRequirement ? { accessRequirement } : {})
      });
      if (items.length >= limit) {
        return items;
      }
    }
  }
  return items;
}

export function parseYaohuoListHtml(
  html: string,
  {
    classId,
    limit = 30,
    page = 1,
    preserveOrder = false,
    url
  }: { classId?: string; limit?: number; page?: number; preserveOrder?: boolean; url?: string } = {}
): FeedResponse {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  let rows = root.querySelectorAll('.listdata');
  if (!rows.length) {
    rows = root.querySelectorAll('div.line1, div.line2');
  }
  const seen = new Set<string>();
  const items: Topic[] = [];
  const fallbackCreatedAt = new Date().toISOString();
  const now = currentYaohuoClock();
  for (const row of rows) {
    const item = parseListItem(row, classId, fallbackCreatedAt, now) as Topic | null;
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
      if (items.length >= limit) {
        break;
      }
    }
  }
  const chunks = items.length < limit ? parseListDataChunks(html) : [];
  if (chunks.length > items.length) {
    for (const chunk of chunks) {
      if (items.length >= limit) {
        break;
      }
      const item = parseListItem(parseHtml(chunk), classId, fallbackCreatedAt, now) as Topic | null;
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
    }
  }
  if (!items.length) {
    items.push(...parseCompactListItems(root, classId, limit));
  }
  const nextPage = nextPageFromHtml(html, page, items.length, limit);
  const result = {
    items: preserveOrder ? items : sortTopicsByTime(items),
    errors: {},
    hasMore: Boolean(nextPage),
    nextPage
  };
  const compactCandidates = root.querySelectorAll('a[href*="/bbs-"], a[href*="book_view"]').length;
  const candidateCount = Math.max(rows.length, chunks.length, compactCandidates);
  const explicitEmpty = /暂无|没有(?:相关)?(?:帖子|主题|内容)|无(?:帖子|主题|内容)/.test(elementText(root));
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'html-list',
    candidateCount,
    validCount: result.items.length,
    droppedCount: Math.max(0, candidateCount - result.items.length),
    isExpectedEmpty: candidateCount === 0 && (page > 1 || explicitEmpty || Boolean(classId)),
    isParseEmpty: candidateCount === 0 && page === 1 && !classId && !explicitEmpty,
    hasRepeatedCursor: Boolean(nextPage && nextPage === page)
  });
}

export function parseYaohuoSearchHtml(
  html: string,
  options: { classId?: string; page?: number; limit?: number; url?: string } = {}
): SearchResponse {
  const result = parseYaohuoListHtml(html, { ...options, classId: options.classId || '0', preserveOrder: true });
  const response = {
    items: result.items,
    errors: result.errors,
    hasMore: result.hasMore,
    nextPage: result.nextPage
  };
  const summary = sourceDiagnosticSummary(result);
  return annotateSourceDiagnosticSummary(response, {
    parserVariant: 'html-search',
    candidateCount: summary?.candidateCount || 0,
    validCount: response.items.length,
    droppedCount: summary?.droppedCount || 0,
    partialErrorCount: summary?.partialErrorCount || 0,
    missingFloorCount: summary?.missingFloorCount || 0,
    hasDegradation: summary?.hasDegradation || false,
    hasRepeatedCursor: summary?.hasRepeatedCursor || false,
    isExpectedEmpty: (summary?.candidateCount || 0) === 0,
    isParseEmpty: (summary?.candidateCount || 0) > 0 && summary?.isParseEmpty === true
  });
}

export function yaohuoCategoriesResponse() {
  const result = { items: YAOHUO_CATEGORIES, errors: {} };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'static-categories',
    candidateCount: YAOHUO_CATEGORIES.length,
    validCount: YAOHUO_CATEGORIES.length,
    droppedCount: 0
  });
}
