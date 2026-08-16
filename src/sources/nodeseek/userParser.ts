import type { Topic, UserProfile, UserReference, UserReplyActivity } from '@/domain/forum/models';
import {
  absoluteUrl,
  elementText,
  isRecord,
  parseHtml,
  parsePositiveInteger,
  textExcerpt,
  toIsoString
} from '@/domain/forum/html';
import { accessRequirementFromObject } from '@/domain/forum/accessRequirements';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import {
  NODESEEK_BASE_URL,
  extractNodeSeekEmbeddedData,
  nodeSeekCreatedAt,
  nodeSeekSpaceUrl,
  optionalNonNegativeInteger,
  parseViewCount,
  safeNodeSeekTopicUrl
} from './protocol';

const BASE_URL = NODESEEK_BASE_URL;

function nodeSeekLevelLabel(user: Record<string, unknown>) {
  const value = user.rank;
  const level =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(level) && level >= 0 ? `Lv${level}` : undefined;
}

function nodeSeekCurrentUserFromRecord(user: Record<string, unknown>): UserProfile | null {
  const id = String(user.member_id || user.uid || user.id || user.userId || user.user_id || '').trim();
  const username = String(user.member_name || user.username || user.name || user.displayName || '').trim();
  if (!id || !username) {
    return null;
  }
  return {
    source: 'nodeseek',
    id,
    username,
    displayName: username,
    avatar: absoluteUrl(user.avatar || `/avatar/${encodeURIComponent(id)}.png`, BASE_URL),
    url: nodeSeekSpaceUrl(id),
    topics: []
  };
}

export function nodeSeekCurrentUserFromConfig(value: unknown): UserProfile | null {
  if (!isRecord(value) || !isRecord(value.user)) {
    return null;
  }
  return nodeSeekCurrentUserFromRecord(value.user);
}

function sortNodeSeekUserTopics(topics: Topic[]) {
  return topics
    .map((topic, index) => ({ topic, index, time: Date.parse(topic.createdAt || '') }))
    .sort((left, right) => {
      const leftTimed = Number.isFinite(left.time);
      const rightTimed = Number.isFinite(right.time);
      if (leftTimed && rightTimed) {
        return right.time - left.time;
      }
      if (leftTimed !== rightTimed) {
        return leftTimed ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((item) => item.topic);
}

function normalizeNodeSeekUserReply(
  raw: Record<string, unknown>,
  username: string,
  userId: string,
  avatar?: string
): UserReplyActivity | null {
  const topicId = String(raw.post_id || raw.postId || raw.id || '').trim();
  const topicTitle = String(raw.title || raw.titleText || '').trim();
  if (!topicId || !topicTitle) {
    return null;
  }
  const floor = parsePositiveInteger(raw.floor_id || raw.floor || raw.rank);
  const excerpt = textExcerpt(raw.text || raw.content || raw.markdown || raw.comment || '');
  const topicUrl = safeNodeSeekTopicUrl(topicId, raw.url || `/post-${topicId}-1`);
  return {
    source: 'nodeseek',
    id: `${topicId}:${floor || 0}:${excerpt}`,
    topicId,
    topicTitle,
    topicUrl,
    url: topicUrl,
    author: username,
    authorId: userId,
    authorUrl: nodeSeekSpaceUrl(userId),
    ...(avatar ? { authorAvatar: avatar } : {}),
    ...(floor ? { floor } : {}),
    ...(excerpt ? { excerpt } : {})
  };
}

export function parseNodeSeekCurrentUserHtml(html: string, { allowUidText = false }: { allowUidText?: boolean } = {}) {
  const embeddedUser = nodeSeekCurrentUserFromConfig(extractNodeSeekEmbeddedData(html));
  if (embeddedUser) {
    return embeddedUser;
  }
  return parseNodeSeekCurrentUserRoot(parseHtml(html), { allowUidText });
}

export function parseNodeSeekCurrentUserRoot(
  root: ReturnType<typeof parseHtml>,
  { allowUidText = false }: { allowUidText?: boolean } = {}
) {
  const text = elementText(root);
  const uid = allowUidText ? text.match(/UID\s*[:：]\s*(\d+)/i)?.[1] || '' : '';
  const explicitUserLink =
    root.querySelector('a.Username[href*="/space/"]') || root.querySelector('.Username a[href*="/space/"]');
  const explicitUserId = explicitUserLink?.getAttribute('href')?.match(/\/space\/(\d+)/i)?.[1] || '';
  const spaceLinks = root
    .querySelectorAll('a[href*="/space/"]')
    .filter((link) => /\/space\/\d+/i.test(link.getAttribute('href') || ''));
  const spaceLink = uid
    ? spaceLinks.find((link) => link.getAttribute('href')?.match(/\/space\/(\d+)/i)?.[1] === uid)
    : explicitUserLink;
  const id = (uid && spaceLink ? uid : '') || explicitUserId;
  if (!id) {
    return null;
  }
  const img = spaceLink?.querySelector('img');
  const username = elementText(spaceLink) || String(img?.getAttribute('alt') || '').trim() || id;
  return {
    source: 'nodeseek' as const,
    id,
    username,
    displayName: username,
    avatar: absoluteUrl(img?.getAttribute('src'), BASE_URL),
    url: nodeSeekSpaceUrl(id),
    topics: []
  };
}

export function isNodeSeekLoggedOutHtml(html: string) {
  return isNodeSeekLoggedOutRoot(parseHtml(html));
}

export function isNodeSeekLoggedOutRoot(root: ReturnType<typeof parseHtml>) {
  if (root.querySelector('meta[name="nodeseekAccountState"][content="anonymous"]')) {
    return true;
  }
  const controls = root.querySelectorAll(
    'a.btn[href], header a[href], nav a[href], .header a[href], .navbar a[href], .topbar a[href]'
  );
  const kinds = new Set(
    controls.flatMap((link) => {
      const href = link.getAttribute('href') || '';
      const label = elementText(link).trim();
      if (
        /^\/(?:login|signin|sign-in)(?:\.html?)?(?:[/?#]|$)/i.test(href) &&
        /^(?:登录|sign in|log in)$/i.test(label)
      ) {
        return ['login'];
      }
      if (
        /^\/(?:register|signup|sign-up)(?:\.html?)?(?:[/?#]|$)/i.test(href) &&
        /^(?:注册|sign up|register)$/i.test(label)
      ) {
        return ['register'];
      }
      return [];
    })
  );
  return kinds.has('login') && kinds.has('register');
}

export function hasNodeSeekAccountEvidenceHtml(html: string, url = BASE_URL) {
  let allowUidText = false;
  try {
    allowUidText = new URL(url, BASE_URL).pathname === '/setting';
  } catch {
    // Keep ambiguous URLs on the stricter path.
  }
  return Boolean(parseNodeSeekCurrentUserHtml(html, { allowUidText }) || isNodeSeekLoggedOutHtml(html));
}

export function parseNodeSeekUserReference(requestedUsername: string, data: unknown): UserReference {
  if (!isRecord(data) || data.success === false || !Array.isArray(data.memberList)) {
    throw new Error('NodeSeek 用户名解析失败');
  }
  const candidates = data.memberList.filter(isRecord);
  const exactMembers = candidates.filter(
    (candidate) => String(candidate.member_name || '').trim() === requestedUsername
  );
  const foldedMembers = exactMembers.length
    ? []
    : candidates.filter(
        (candidate) =>
          String(candidate.member_name || '')
            .trim()
            .toLowerCase() === requestedUsername.toLowerCase()
      );
  const member =
    exactMembers.length === 1 ? exactMembers[0] : foldedMembers.length === 1 ? foldedMembers[0] : undefined;
  const id = member ? String(member.member_id || '').trim() : '';
  if (!member || !/^\d+$/.test(id)) {
    throw new Error('NodeSeek 用户名解析失败');
  }
  const canonicalUsername = String(member.member_name || '').trim();
  return {
    source: 'nodeseek',
    id,
    username: canonicalUsername,
    displayName: canonicalUsername,
    url: nodeSeekSpaceUrl(id)
  };
}

export function parseNodeSeekUserIdentity(requestedId: string, data: unknown) {
  if (!isRecord(data) || data.success === false || !isRecord(data.detail)) {
    throw new Error('NodeSeek 用户主页读取失败');
  }
  const responseId = String(data.detail.member_id || data.detail.id || '').trim();
  if (responseId && (!/^\d+$/.test(responseId) || responseId !== requestedId)) {
    throw new Error('NodeSeek 用户主页身份不匹配');
  }
  return data.detail;
}

export function parseNodeSeekUserProfile({
  comments,
  cursor,
  cursorPage,
  cursorType,
  discussions,
  partialErrorCount,
  requestedId,
  user
}: {
  comments: unknown[];
  cursor?: string | null;
  cursorPage: number;
  cursorType?: 'topics' | 'replies';
  discussions: unknown[];
  partialErrorCount: number;
  requestedId: string;
  user: Record<string, unknown>;
}): UserProfile {
  const username = String(user.member_name || user.username || user.name || requestedId).trim() || requestedId;
  const avatar = absoluteUrl(user.avatar || `/avatar/${encodeURIComponent(requestedId)}.png`, BASE_URL);
  const wantsTopics = cursorType !== 'replies';
  const wantsReplies = cursorType !== 'topics';
  const topics = discussions.filter(isRecord).map((discussion) => {
    const topicId = String(discussion.post_id || discussion.postId || discussion.id || '').trim();
    const title = String(discussion.title || discussion.titleText || '').trim();
    if (!topicId || !title) {
      return null;
    }
    const createdAt = nodeSeekCreatedAt(discussion);
    const accessRequirement = accessRequirementFromObject(discussion);
    const categoryId =
      String(
        discussion.category_id ||
          discussion.categoryId ||
          discussion.tag_id ||
          discussion.tagId ||
          discussion.tag_name ||
          ''
      ).trim() || undefined;
    const category =
      String(
        discussion.category_name || discussion.categoryName || discussion.tag_cn_text || discussion.tagName || ''
      ).trim() || undefined;
    const excerpt = textExcerpt(
      discussion.text || discussion.content || discussion.markdown || discussion.excerpt || ''
    );
    return {
      source: 'nodeseek' as const,
      id: topicId,
      title,
      author: username,
      authorAvatar: avatar,
      authorId: requestedId,
      authorUrl: nodeSeekSpaceUrl(requestedId),
      url: safeNodeSeekTopicUrl(topicId, `/post-${topicId}-1`),
      createdAt,
      lastReplyAt: createdAt,
      ...(categoryId ? { categoryId } : {}),
      ...(category ? { category } : {}),
      replyCount: parsePositiveInteger(discussion.comments || discussion.commentCount || discussion.nComment),
      viewCount: parseViewCount(discussion.views || discussion.viewCount),
      ...(excerpt ? { excerpt } : {}),
      ...(accessRequirement ? { accessRequirement } : {})
    };
  }) as (Topic | null)[];
  const visibleTopics = sortNodeSeekUserTopics(topics.filter(Boolean) as Topic[]);
  const replyCandidateCount = comments.length;
  const missingFloorCount = comments.filter(
    (comment) => isRecord(comment) && !parsePositiveInteger(comment.floor_id || comment.floor || comment.rank)
  ).length;
  const replies = comments
    .filter(isRecord)
    .map((comment) => normalizeNodeSeekUserReply(comment, username, requestedId, avatar))
    .filter(Boolean) as UserReplyActivity[];
  const levelLabel = nodeSeekLevelLabel(user);
  const result: UserProfile = {
    source: 'nodeseek',
    id: requestedId,
    username,
    displayName: username,
    avatar,
    url: nodeSeekSpaceUrl(requestedId),
    bio: String(user.bio || user.readme || '').trim() || undefined,
    joinedAt: toIsoString(user.created_at || user.createdAt || user.createdDate) || undefined,
    topicCount: optionalNonNegativeInteger(user.nPost) ?? (visibleTopics.length || undefined),
    postCount: optionalNonNegativeInteger(user.nPost) ?? (visibleTopics.length || undefined),
    replyCount: optionalNonNegativeInteger(user.nComment),
    ...(levelLabel ? { levelLabel } : {}),
    topics: visibleTopics,
    hasMoreTopics: wantsTopics && visibleTopics.length > 0,
    nextTopicsCursor: wantsTopics && visibleTopics.length > 0 ? String(cursorPage + 1) : null,
    replies,
    hasMoreReplies: wantsReplies && replies.length > 0,
    nextRepliesCursor: wantsReplies && replies.length > 0 ? String(cursorPage + 1) : null
  };
  const candidateCount = 1 + discussions.length + replyCandidateCount;
  const hasUserIdentity = Boolean(user.member_name || user.username || user.name || user.member_id || user.id);
  const validCount = (hasUserIdentity ? 1 : 0) + visibleTopics.length + replies.length;
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'api-user',
    candidateCount,
    validCount,
    droppedCount: Math.max(0, candidateCount - validCount),
    partialErrorCount,
    missingFloorCount,
    hasRepeatedCursor: result.nextTopicsCursor === cursor || result.nextRepliesCursor === cursor,
    isParseEmpty: !hasUserIdentity && visibleTopics.length === 0 && replies.length === 0
  });
}
