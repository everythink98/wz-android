import type {
  Topic,
  UserIdentity,
  UserDetails,
  UserTopicsPage,
  UserRepliesPage,
  UserReference,
  UserReplyActivity
} from '@/domain/forum/models';
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
import { annotateSourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
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
const USER_ACTIVITY_PAGE_SIZE = 15;

function nodeSeekLevelLabel(user: Record<string, unknown>) {
  const value = user.rank;
  const level =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isInteger(level) && level >= 0 ? `Lv${level}` : undefined;
}

function nodeSeekCurrentUserFromRecord(user: Record<string, unknown>): UserIdentity | null {
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
    url: nodeSeekSpaceUrl(id)
  };
}

export function nodeSeekCurrentUserFromConfig(value: unknown): UserIdentity | null {
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
    url: nodeSeekSpaceUrl(id)
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

export function parseNodeSeekUserDetails(requestedId: string, user: Record<string, unknown>): UserDetails {
  const username = String(user.member_name || user.username || user.name || requestedId).trim() || requestedId;
  const levelLabel = nodeSeekLevelLabel(user);
  const topicCount = optionalNonNegativeInteger(user.nPost);
  const hasIdentity = Boolean(user.member_name || user.username || user.name || user.member_id || user.id);
  return annotateSourceDiagnosticSummary(
    {
      source: 'nodeseek',
      id: requestedId,
      username,
      displayName: username,
      avatar: absoluteUrl(user.avatar || `/avatar/${encodeURIComponent(requestedId)}.png`, BASE_URL),
      url: nodeSeekSpaceUrl(requestedId),
      bio: String(user.bio || user.readme || '').trim() || undefined,
      joinedAt: toIsoString(user.created_at || user.createdAt || user.createdDate) || undefined,
      topicCount,
      postCount: topicCount,
      replyCount: optionalNonNegativeInteger(user.nComment),
      ...(levelLabel ? { levelLabel } : {})
    },
    { parserVariant: 'api-user', candidateCount: 1, validCount: hasIdentity ? 1 : 0, isParseEmpty: !hasIdentity }
  );
}

export function parseNodeSeekUserTopics(
  profile: UserDetails,
  discussions: unknown[],
  cursorPage: number
): UserTopicsPage {
  const { id: requestedId, username, avatar, topicCount } = profile;
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
  });
  const visibleTopics = sortNodeSeekUserTopics(topics.filter((topic) => topic !== null));

  const hasMoreTopics =
    visibleTopics.length > 0 &&
    (topicCount === undefined
      ? discussions.length >= USER_ACTIVITY_PAGE_SIZE
      : cursorPage * USER_ACTIVITY_PAGE_SIZE < topicCount);
  return annotateSourceDiagnosticSummary(
    { topics: visibleTopics, hasMoreTopics, nextTopicsCursor: hasMoreTopics ? String(cursorPage + 1) : null },
    {
      parserVariant: 'api-user',
      candidateCount: discussions.length,
      validCount: visibleTopics.length,
      droppedCount: Math.max(0, discussions.length - visibleTopics.length),
      isExpectedEmpty: discussions.length === 0
    }
  );
}

export function parseNodeSeekUserReplies(
  profile: UserDetails,
  comments: unknown[],
  cursorPage: number
): UserRepliesPage {
  const { id, username, avatar, replyCount } = profile;
  const replies = comments
    .filter(isRecord)
    .map((comment) => normalizeNodeSeekUserReply(comment, username, id, avatar))
    .filter((reply): reply is UserReplyActivity => reply !== null);
  const hasMoreReplies =
    replies.length > 0 &&
    (replyCount === undefined
      ? comments.length >= USER_ACTIVITY_PAGE_SIZE
      : cursorPage * USER_ACTIVITY_PAGE_SIZE < replyCount);
  return annotateSourceDiagnosticSummary(
    { replies, hasMoreReplies, nextRepliesCursor: hasMoreReplies ? String(cursorPage + 1) : null },
    {
      parserVariant: 'api-user',
      candidateCount: comments.length,
      validCount: replies.length,
      droppedCount: Math.max(0, comments.length - replies.length),
      isExpectedEmpty: comments.length === 0,
      missingFloorCount: comments.filter(
        (comment) => isRecord(comment) && !parsePositiveInteger(comment.floor_id || comment.floor || comment.rank)
      ).length
    }
  );
}
