import type { UserProfile, UserReplyActivity } from '@/domain/forum/models';
import { elementText, parseHtml, parsePositiveInteger, sortTopicsByCreatedAt, textExcerpt } from '@/domain/forum/html';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  YAOHUO_BASE_URL as BASE_URL,
  extractYaohuoTopicParts as extractTopicParts,
  yaohuoUserUrl as userUrl
} from './protocol';
import {
  categoryNames,
  parseYaohuoDate,
  profileStats,
  safeYaohuoProfileName,
  yaohuoDisplayTimeText,
  yaohuoProfileLevelLabel
} from './normalization';
import { ensureYaohuoHtmlLoggedIn } from './sessionParser';

export function parseYaohuoUserProfileHtml(
  html: string,
  { id, username, url }: { id: string; username?: string; url?: string }
): UserProfile {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  const visibleText = elementText(root);
  const displayName =
    safeYaohuoProfileName(visibleText.match(/(?:昵称|用户名)\s*[:：]\s*([^\s<]+)/)?.[1]) ||
    safeYaohuoProfileName(elementText(root.querySelector('.username, .user-name, h1'))) ||
    username ||
    id;
  const levelLabel = yaohuoProfileLevelLabel(visibleText);
  const stats = profileStats(root, visibleText);
  const seen = new Set<string>();
  const rows = [...root.querySelectorAll('.listdata, div.line1, div.line2'), ...root.querySelectorAll('a[href]')];
  const topics = rows.flatMap((row) => {
    const link = row.rawTagName === 'a' ? row : row.querySelector('a[href]');
    const title = elementText(link);
    const { id: topicId, classId, url: topicUrl } = extractTopicParts(link?.getAttribute('href'));
    if (!topicId || !title || seen.has(topicId)) {
      return [];
    }
    seen.add(topicId);
    const text = elementText(row);
    const timeText = yaohuoDisplayTimeText(text);
    const createdAt = parseYaohuoDate(timeText || text) || new Date().toISOString();
    return [
      {
        source: 'yaohuo' as const,
        id: topicId,
        title,
        author: displayName,
        authorId: id,
        authorUrl: userUrl(id),
        categoryId: classId,
        category: classId ? categoryNames.get(classId) : undefined,
        url: topicUrl || `${BASE_URL}/bbs-${topicId}.html`,
        createdAt,
        lastReplyAt: createdAt,
        ...(timeText ? { displayTimeText: timeText } : {}),
        replyCount: 0,
        ...(levelLabel ? { authorLevelLabel: levelLabel } : {})
      }
    ];
  });
  const result: UserProfile = {
    source: 'yaohuo',
    id,
    username: displayName,
    displayName,
    ...(levelLabel ? { levelLabel } : {}),
    url: userUrl(id),
    ...stats,
    topics: sortTopicsByCreatedAt(topics).slice(0, 30)
  };
  const hasProfileSurface =
    /昵称|用户名|发帖|回帖|等级|注册/.test(visibleText) ||
    Boolean(root.querySelector('.username, .user-name, h1')) ||
    result.topics.length > 0;
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'html-user',
    candidateCount: 1 + topics.length,
    validCount: (hasProfileSurface ? 1 : 0) + result.topics.length,
    droppedCount: Math.max(0, topics.length - result.topics.length) + (hasProfileSurface ? 0 : 1),
    partialErrorCount: 0,
    isParseEmpty: !hasProfileSurface && result.topics.length === 0
  });
}

export function parseYaohuoUserRepliesHtml(
  html: string,
  { id, username, url }: { id: string; username?: string; url?: string }
): UserReplyActivity[] {
  ensureYaohuoHtmlLoggedIn(html, url);
  const root = parseHtml(html);
  const author = username || id;
  const seen = new Set<string>();
  const seenTopicDates = new Set<string>();
  const replyRows = root.querySelectorAll('div.listdata, div.line1, div.line2');
  const rows = replyRows.length ? replyRows : root.querySelectorAll('div');
  const replies = rows
    .map((row, index) => {
      const viewLinks = row.querySelectorAll('a[href*="/bbs-"], a[href*="book_view"]');
      if (viewLinks.length !== 1) {
        return null;
      }
      const viewLink = viewLinks[0];
      const { id: topicId, classId, url: topicUrl } = extractTopicParts(viewLink?.getAttribute('href'));
      if (!topicId) {
        return null;
      }
      const text = elementText(row);
      const dateText = yaohuoDisplayTimeText(text);
      const floor = parsePositiveInteger(text.match(/#\s*(\d+)/)?.[1]);
      const createdAt = parseYaohuoDate(dateText || text);
      const topicTitle = /^查看$/.test(elementText(viewLink)) ? '查看原帖' : elementText(viewLink) || '查看原帖';
      let excerpt = text
        .replace(dateText, ' ')
        .replace(new RegExp(`^\\s*${author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), ' ')
        .replace(new RegExp(`\\(${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g'), ' ')
        .replace(/#\s*\d+/g, ' ')
        .replace(/查看/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      excerpt = textExcerpt(excerpt);
      const replyIdentity =
        floor || createdAt
          ? [topicId, floor || '', createdAt || ''].join(':')
          : excerpt
            ? `${topicId}:${excerpt}`
            : `${topicId}:row:${index}`;
      const topicDateIdentity = createdAt ? `${topicId}:${createdAt}` : '';
      if (seen.has(replyIdentity) || (!floor && topicDateIdentity && seenTopicDates.has(topicDateIdentity))) {
        return null;
      }
      seen.add(replyIdentity);
      if (topicDateIdentity) {
        seenTopicDates.add(topicDateIdentity);
      }
      return {
        source: 'yaohuo' as const,
        id: replyIdentity,
        topicId,
        topicTitle,
        topicUrl: topicUrl || `${BASE_URL}/bbs-${topicId}.html`,
        url: topicUrl || `${BASE_URL}/bbs-${topicId}.html`,
        author,
        authorId: id,
        authorUrl: userUrl(id),
        categoryId: classId,
        category: classId ? categoryNames.get(classId) : undefined,
        ...(createdAt ? { createdAt } : {}),
        ...(dateText ? { displayTimeText: dateText } : {}),
        ...(floor ? { floor } : {}),
        ...(excerpt ? { excerpt } : {})
      };
    })
    .filter(Boolean) as UserReplyActivity[];
  const candidateCount = rows.filter(
    (row) => row.querySelectorAll('a[href*="/bbs-"], a[href*="book_view"]').length === 1
  ).length;
  return annotateSourceDiagnosticSummary(replies, {
    parserVariant: 'html-user-replies',
    candidateCount,
    validCount: replies.length,
    droppedCount: Math.max(0, candidateCount - replies.length),
    missingFloorCount: replies.filter((reply) => !reply.floor).length,
    isExpectedEmpty: candidateCount === 0
  });
}
