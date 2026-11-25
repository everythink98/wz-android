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
  textExcerptFromPlainText,
  toIsoString
} from '@/domain/forum/html';
import { accessRequirementFromObject } from '@/domain/forum/accessRequirements';
import { annotateSourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { nodeSeekGuestControls } from '@/platform/network/nodeSeekGuestControls';
import {
  NODESEEK_BASE_URL,
  type NodeSeekPageDocument,
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
  const excerpt = textExcerptFromPlainText(raw.text || raw.content || raw.markdown || raw.comment || '');
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

export function parseNodeSeekCurrentUserRoot(
  root: ReturnType<typeof parseHtml>,
  { allowUidText = false }: { allowUidText?: boolean } = {}
) {
  const uid = allowUidText ? elementText(root).match(/UID\s*[:：]\s*(\d+)/i)?.[1] || '' : '';
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

const hiddenStyle =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\.0+)?)(?:\s*!important)?\s*(?:;|$)/i;

export function isNodeSeekLoggedOutRoot(root: ReturnType<typeof parseHtml>, url = BASE_URL) {
  const marker = 'meta[name="nodeseekAccountState"]';
  const rendered = root
    .querySelector(`head > ${marker}, html > ${marker}, :scope > ${marker}`)
    ?.getAttribute('content');
  if (rendered === 'anonymous') return true;
  if (rendered === 'no-visible-guest-controls') return false;
  const rules = nodeSeekGuestControls;
  const selector = rules.accountPage.test(url) ? rules.accountPageLinks : rules.navigationLinks;
  const links = root.querySelectorAll(selector);
  if (!links.length) return false;
  // A matching visibility rule can depend on the viewport. Let the WebView resolve it.
  const hiddenSelectors = root.querySelectorAll('style').flatMap((style) =>
    style.rawText.split('}').flatMap((rule) => {
      const [selector, declarations] = rule.split('{').slice(-2);
      return declarations && hiddenStyle.test(declarations) ? [selector.trim()] : [];
    })
  );
  let login = false;
  let register = false;
  for (const link of links) {
    const href = link.getAttribute('href')?.trim();
    if (!href) continue;
    let target: URL;
    try {
      target = new URL(href, url);
    } catch {
      continue;
    }
    const key = `${target.href}\n${elementText(link)}`;
    const loginLink = rules.login.test(key);
    const registerLink = rules.register.test(key);
    if ((!loginLink && !registerLink) || link.closest(rules.excluded)) continue;
    if (
      hiddenSelectors.some((selector) => {
        try {
          return Boolean(link.closest(selector));
        } catch {
          // Browser-only selectors cannot identify a hidden ancestor in the HTML parser.
          return false;
        }
      })
    )
      continue;
    let node: typeof link | null = link;
    while (node) {
      if (hiddenStyle.test(node.getAttribute('style') || '')) break;
      node = node.parentNode;
    }
    if (node) continue;
    login ||= loginLink;
    register ||= registerLink;
    if (login && register) return true;
  }
  return false;
}

export function hasNodeSeekAccountEvidence(document: NodeSeekPageDocument, url = BASE_URL) {
  if (nodeSeekCurrentUserFromConfig(document.embedded)) return true;
  let allowUidText = false;
  try {
    allowUidText = new URL(url, BASE_URL).pathname === '/setting';
  } catch {
    // Keep ambiguous URLs on the stricter path.
  }
  const root = document.root;
  return Boolean(parseNodeSeekCurrentUserRoot(root, { allowUidText }) || isNodeSeekLoggedOutRoot(root, url));
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
    const excerpt = textExcerptFromPlainText(
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
