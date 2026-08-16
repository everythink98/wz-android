import { XMLParser } from 'fast-xml-parser';
import type { Topic, UserProfile, UserReplyActivity } from '@/domain/forum/models';
import {
  absoluteUrl,
  elementText,
  isRecord,
  parseHtml,
  parsePositiveInteger,
  sortTopicsByCreatedAt,
  textExcerpt,
  toIsoString
} from '@/domain/forum/html';
import { annotateSourceDiagnosticSummary, sourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  V2EX_BASE_URL as BASE_URL,
  safeV2exTopicUrl as safeTopicUrl,
  v2exMemberUrl as memberUrl,
  v2exNodeIdFromHref as nodeIdFromHref
} from './protocol';
import { fetchJson, fetchText, normalizeHtmlTopic, v2exMemberLevelLabel, type V2exOptions } from './reader';

const atomParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  trimValues: true
});

function parseV2exMemberTopics(root: ReturnType<typeof parseHtml>, username: string, avatar?: string) {
  return root
    .querySelectorAll('.cell, .box .item')
    .map((element) => normalizeHtmlTopic(element))
    .filter(Boolean)
    .map((topic) => ({
      ...topic,
      author: topic?.author || username,
      authorId: username,
      authorAvatar: topic?.authorAvatar || avatar,
      authorUrl: memberUrl(username)
    })) as Topic[];
}

function v2exMemberActivityDate(text: string) {
  const match = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!match) {
    return '';
  }
  const year = new Date().getFullYear();
  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function v2exMemberActivityDisplayTime(text: string) {
  return text.match(/^\s*(.+?)\s*回复了/)?.[1]?.trim() || '';
}

function nextV2exMemberPageCursor(root: ReturnType<typeof parseHtml>, page: number) {
  const pages = root
    .querySelectorAll('a[href*="?p="], a[href*="&p="]')
    .map((link) => parsePositiveInteger(link.getAttribute('href')))
    .filter((value) => value > page);
  return pages.length ? String(Math.min(...pages)) : null;
}

function parseV2exMemberReplies(
  root: ReturnType<typeof parseHtml>,
  username: string,
  avatar: string | undefined,
  page: number
) {
  const items = root
    .querySelectorAll('.dock_area')
    .map((element) => {
      const topicLink = element.querySelector('a[href*="/t/"]');
      const href = topicLink?.getAttribute('href') || '';
      const topicId = href.match(/\/t\/(\d+)/)?.[1] || '';
      const topicTitle = elementText(topicLink);
      if (!topicId || !topicTitle) {
        return null;
      }
      const text = elementText(element);
      const categoryLink = element.querySelector('a[href^="/go/"]');
      const categoryId = nodeIdFromHref(categoryLink?.getAttribute('href'));
      const parts = text
        .split('›')
        .map((part) => part.trim())
        .filter(Boolean);
      const category = elementText(categoryLink) || (parts.length >= 2 ? parts[parts.length - 2] : undefined);
      const floor = parsePositiveInteger(href.match(/#reply(\d+)/)?.[1]);
      const createdAt = v2exMemberActivityDate(text);
      const topicUrl = safeTopicUrl(topicId, href.split('#')[0]);
      const displayTimeText = v2exMemberActivityDisplayTime(text);
      return {
        source: 'v2ex' as const,
        id: `${topicId}:${floor || 0}`,
        topicId,
        topicTitle,
        topicUrl,
        url: safeTopicUrl(topicId, href),
        author: username,
        authorId: username,
        authorUrl: memberUrl(username),
        categoryId,
        category,
        ...(avatar ? { authorAvatar: avatar } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(displayTimeText ? { displayTimeText } : {}),
        ...(floor ? { floor } : {})
      };
    })
    .filter(Boolean) as UserReplyActivity[];
  return {
    items,
    nextCursor: nextV2exMemberPageCursor(root, page)
  };
}

function parseV2exAtomFeed(xml: string, username: string, avatar?: string) {
  const data = atomParser.parse(xml);
  const entries = isRecord(data) && isRecord(data.feed) ? data.feed.entry : [];
  return (Array.isArray(entries) ? entries : [entries])
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const links = Array.isArray(entry.link) ? entry.link : [entry.link];
      const link = links.find((item) => isRecord(item) && typeof item.href === 'string') || {};
      const href = isRecord(link) ? String(link.href || '') : '';
      const id = href.match(/\/t\/(\d+)/)?.[1] || String(entry.id || '').match(/\/t\/(\d+)/)?.[1];
      const rawTitle = String(entry.title || '').trim();
      const titleMatch = rawTitle.match(/^\[([^\]]+)\]\s*(.+)$/);
      const category = titleMatch ? titleMatch[1].trim() : undefined;
      const title = (titleMatch ? titleMatch[2] : rawTitle).trim();
      if (!id || !title) {
        return null;
      }
      const createdAt = toIsoString(entry.published) || toIsoString(entry.updated) || new Date().toISOString();
      const updatedAt = toIsoString(entry.updated) || createdAt;
      const content = isRecord(entry.content)
        ? String(entry.content['#cdata'] || entry.content['#text'] || '')
        : String(entry.content || '');
      return {
        source: 'v2ex' as const,
        id,
        title,
        author: username,
        authorId: username,
        authorAvatar: avatar,
        authorUrl: memberUrl(username),
        category,
        url: safeTopicUrl(id, href),
        createdAt,
        lastReplyAt: updatedAt,
        replyCount: Number.parseInt(href.match(/#reply(\d+)/)?.[1] || '0', 10) || 0,
        excerpt: textExcerpt(content)
      };
    })
    .filter(Boolean) as Topic[];
}

async function fetchV2exMemberTopics(username: string, avatar: string | undefined, options: V2exOptions, page = 1) {
  const pageQuery = page > 1 ? `?p=${encodeURIComponent(String(page))}` : '';
  try {
    const html = await fetchText(`${memberUrl(username)}/topics${pageQuery}`, options);
    const root = parseHtml(html);
    const items = parseV2exMemberTopics(root, username, avatar).slice(0, 30);
    const candidateCount = Math.max(
      (html.match(/class=["'][^"']*\bitem\b/gi) || []).length,
      (html.match(/<a\b[^>]*href=["'][^"']*\/t\//gi) || []).length
    );
    return annotateSourceDiagnosticSummary(
      {
        items,
        nextCursor: nextV2exMemberPageCursor(root, page)
      },
      {
        parserVariant: 'html-user-topics',
        candidateCount,
        validCount: items.length,
        droppedCount: Math.max(0, candidateCount - items.length),
        isExpectedEmpty: candidateCount === 0
      }
    );
  } catch {
    return annotateSourceDiagnosticSummary(
      { items: [] as Topic[], nextCursor: null },
      {
        parserVariant: 'html-user-topics',
        candidateCount: 0,
        validCount: 0,
        droppedCount: 0,
        partialErrorCount: 1,
        hasDegradation: true,
        isExpectedEmpty: true
      }
    );
  }
}

async function fetchV2exMemberReplies(username: string, avatar: string | undefined, options: V2exOptions, page = 1) {
  const pageQuery = page > 1 ? `?p=${encodeURIComponent(String(page))}` : '';
  const html = await fetchText(`${memberUrl(username)}/replies${pageQuery}`, options);
  const root = parseHtml(html);
  return parseV2exMemberReplies(root, username, avatar, page);
}

async function fetchV2exMemberFeedTopics(username: string, avatar: string | undefined, options: V2exOptions) {
  try {
    const xml = await fetchText(`${BASE_URL}/feed/member/${encodeURIComponent(username)}.xml`, options);
    const topics = xml ? parseV2exAtomFeed(xml, username, avatar).slice(0, 30) : [];
    return annotateSourceDiagnosticSummary(topics, {
      parserVariant: 'atom-user-topics',
      candidateCount: topics.length,
      validCount: topics.length,
      droppedCount: 0,
      isExpectedEmpty: topics.length === 0
    });
  } catch {
    return annotateSourceDiagnosticSummary([] as Topic[], {
      parserVariant: 'atom-user-topics',
      candidateCount: 0,
      validCount: 0,
      droppedCount: 0,
      partialErrorCount: 1,
      hasDegradation: true,
      isExpectedEmpty: true
    });
  }
}

export async function getV2exUserProfile(
  id: string,
  username: string,
  options: V2exOptions = {}
): Promise<UserProfile> {
  const key = (username || id).trim();
  if (!key) {
    throw new Error('V2EX 用户信息不完整');
  }
  const cursorType = options.cursorType;
  const wantsTopics = cursorType !== 'replies';
  const wantsReplies = cursorType !== 'topics';
  const page = parsePositiveInteger(options.cursor) || 1;
  const memberData = await fetchJson<Record<string, unknown>>(
    `${BASE_URL}/api/members/show.json?username=${encodeURIComponent(key)}`,
    options
  );
  if (isRecord(memberData) && memberData.status === 'notfound') {
    throw new Error('V2EX 用户不存在');
  }
  const resolvedUsername = String(memberData.username || key);
  const avatar = absoluteUrl(memberData.avatar_large || memberData.avatar_normal || memberData.avatar_mini, BASE_URL);
  const levelLabel = v2exMemberLevelLabel(memberData);
  const topicsPage = wantsTopics
    ? await fetchV2exMemberTopics(resolvedUsername, avatar, options, page)
    : { items: [], nextCursor: null };
  const feedTopics =
    wantsTopics && !topicsPage.items.length && !options.cursor
      ? await fetchV2exMemberFeedTopics(resolvedUsername, avatar, options)
      : topicsPage.items;
  const profileTopics = sortTopicsByCreatedAt(feedTopics)
    .slice(0, 30)
    .map((topic) => (levelLabel ? { ...topic, authorLevelLabel: topic.authorLevelLabel || levelLabel } : topic));
  let replyResult = { items: [] as UserReplyActivity[], nextCursor: null as string | null };
  let replyPartialErrorCount = 0;
  if (wantsReplies) {
    if (options.cursorType === 'replies') {
      replyResult = await fetchV2exMemberReplies(resolvedUsername, avatar, options, page);
    } else {
      try {
        replyResult = await fetchV2exMemberReplies(resolvedUsername, avatar, options, page);
      } catch {
        replyPartialErrorCount += 1;
      }
    }
  }
  const result: UserProfile = {
    source: 'v2ex',
    id: resolvedUsername,
    username: resolvedUsername,
    displayName: resolvedUsername,
    avatar,
    ...(levelLabel ? { levelLabel } : {}),
    url: memberUrl(resolvedUsername),
    bio: typeof memberData.tagline === 'string' ? memberData.tagline : undefined,
    topics: profileTopics,
    topicCount: profileTopics.length || undefined,
    postCount: profileTopics.length || undefined,
    hasMoreTopics: Boolean(topicsPage.nextCursor),
    nextTopicsCursor: topicsPage.nextCursor,
    replies: replyResult.items,
    replyCount: replyResult.items.length || undefined,
    hasMoreReplies: Boolean(replyResult.nextCursor),
    nextRepliesCursor: replyResult.nextCursor
  };
  const topicsSummary = sourceDiagnosticSummary(topicsPage);
  const feedSummary = sourceDiagnosticSummary(feedTopics);
  const partialErrorCount =
    (topicsSummary?.partialErrorCount || 0) + (feedSummary?.partialErrorCount || 0) + replyPartialErrorCount;
  const hasUserIdentity = Boolean(memberData.username || memberData.id);
  const candidateCount = 1 + profileTopics.length + replyResult.items.length;
  const validCount = (hasUserIdentity ? 1 : 0) + profileTopics.length + replyResult.items.length;
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: !topicsPage.items.length && profileTopics.length ? 'atom-user-topics' : 'api-user',
    candidateCount,
    validCount,
    droppedCount: (topicsSummary?.droppedCount || 0) + (feedSummary?.droppedCount || 0),
    partialErrorCount,
    missingFloorCount: replyResult.items.filter((reply) => !reply.floor).length,
    hasRepeatedCursor: result.nextTopicsCursor === options.cursor || result.nextRepliesCursor === options.cursor,
    isParseEmpty: !hasUserIdentity && profileTopics.length === 0 && replyResult.items.length === 0
  });
}
