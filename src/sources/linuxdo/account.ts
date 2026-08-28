import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout } from '@/platform/network/request';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import type { Topic, UserProfile, UserReplyActivity } from '@/domain/forum/models';
import {
  decodeHtml,
  isRecord,
  parsePositiveInteger,
  sortTopicsByCreatedAt,
  textExcerpt,
  toIsoString
} from '@/domain/forum/html';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import { proveForumReadResponse } from '@/sources/forumSourceReadAttempt';
import { stripDiscourseCalloutMarkersFromExcerpt } from '@/sources/discourse/content';
import { discourseAccountCount } from '@/sources/discourse/level';
import {
  LINUXDO_BASE_URL as BASE_URL,
  linuxDoAvatarUrl as avatarUrl,
  linuxDoUserUrl as userUrl,
  normalizeLinuxDoTopicId as normalizeTopicId
} from './protocol';
import {
  LIST_PAGE_SIZE,
  categoryMapForTopics,
  categoryMapFromData,
  fetchLinuxDoJson,
  linuxDoErrorText,
  linuxDoLevelLabel,
  linuxDoOptionsWithBrowserIntent,
  normalizeTopic,
  type LinuxDoOptions
} from './reader';

interface LinuxDoCurrentUserOptions extends LinuxDoOptions {
  linuxDoUserAgent?: string;
}

function normalizeUserActionReply(
  raw: unknown,
  categoryMap: Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>,
  author: string,
  authorData?: Record<string, unknown>
): UserReplyActivity | null {
  if (!isRecord(raw)) {
    return null;
  }
  const topicId = normalizeTopicId(raw.topic_id || raw.topicId);
  const topicTitle = decodeHtml(raw.title || raw.topic_title || raw.unicode_title || '');
  if (!topicId || !topicTitle) {
    return null;
  }
  const floor = Number(raw.post_number || raw.postNumber || 0) || undefined;
  const postId = String(raw.post_id || raw.id || '').trim();
  const slug = String(raw.slug || topicId);
  const category = raw.category_id ? categoryMap.get(String(raw.category_id)) : undefined;
  const url = `${BASE_URL}/t/${slug}/${topicId}${floor ? `/${floor}` : ''}`;
  return {
    source: 'linuxdo',
    id: postId || `${topicId}:${floor || 0}`,
    topicId,
    topicTitle,
    topicUrl: `${BASE_URL}/t/${slug}/${topicId}`,
    url,
    author,
    authorId: author || undefined,
    authorAvatar: avatarUrl(authorData?.avatar_template),
    authorUrl: author ? userUrl(author) : undefined,
    categoryId: raw.category_id ? String(raw.category_id) : undefined,
    category: category?.name,
    createdAt: toIsoString(raw.created_at || raw.createdAt) || undefined,
    ...(floor ? { floor } : {}),
    excerpt: textExcerpt(stripDiscourseCalloutMarkersFromExcerpt(raw.excerpt || raw.content || raw.markdown || ''))
  };
}

export async function getLinuxDoUserProfile(
  id: string,
  username: string,
  options: LinuxDoOptions = {}
): Promise<UserProfile> {
  options = linuxDoOptionsWithBrowserIntent(options, 'user', 'foreground');
  const name = (username || id).trim();
  if (!name) {
    throw new Error('linux.do 用户信息不完整');
  }
  const cursorType = options.cursorType;
  const wantsTopics = cursorType !== 'replies';
  const wantsReplies = cursorType !== 'topics';
  const replyOffset = parsePositiveInteger(options.cursor);
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    `/u/${encodeURIComponent(name)}/summary.json`,
    undefined,
    options
  );
  const summary = isRecord(data.user_summary) ? data.user_summary : {};
  const summaryUser = isRecord(summary.user) ? summary.user : {};
  const dataUser = isRecord(data.user) ? data.user : {};
  const listedUsers = Array.isArray(data.users) ? data.users.filter(isRecord) : [];
  const listedUser =
    listedUsers.find((item) => String(item.username || item.name || '').toLowerCase() === name.toLowerCase()) ||
    listedUsers.find((item) => String(item.id || '') === String(summaryUser.id || dataUser.id || id)) ||
    listedUsers[0] ||
    {};
  const user = { ...listedUser, ...dataUser, ...summaryUser };
  const resolvedUsername = String(user.username || name);
  const displayName = typeof user.name === 'string' ? user.name : resolvedUsername;
  const avatar = avatarUrl(user.avatar_template);
  const levelLabel = linuxDoLevelLabel(user);
  const rawTopics = wantsTopics && Array.isArray(data.topics) ? data.topics : [];
  let rawUserActions: unknown[] = [];
  let partialErrorCount = 0;
  if (wantsReplies) {
    const readUserActions = async () => {
      const actionData = await fetchLinuxDoJson<Record<string, unknown>>(
        '/user_actions.json',
        {
          offset: replyOffset,
          username: resolvedUsername,
          filter: 5
        },
        options
      );
      return Array.isArray(actionData.user_actions) ? actionData.user_actions : [];
    };
    if (cursorType === 'replies') {
      rawUserActions = await readUserActions();
    } else {
      try {
        rawUserActions = await readUserActions();
      } catch {
        partialErrorCount += 1;
      }
    }
  }
  const categoryMap = await categoryMapForTopics(
    data,
    [...rawTopics, ...rawUserActions],
    categoryMapFromData(data),
    options
  );
  const topics = rawTopics
    .map((topic) => normalizeTopic(topic, categoryMap, resolvedUsername, user))
    .filter(Boolean) as Topic[];
  const visibleTopics = sortTopicsByCreatedAt(topics);
  const replies = rawUserActions
    .map((action) => normalizeUserActionReply(action, categoryMap, resolvedUsername, user))
    .filter(Boolean) as UserReplyActivity[];
  const result: UserProfile = {
    source: 'linuxdo',
    id: resolvedUsername,
    username: resolvedUsername,
    displayName,
    avatar,
    url: userUrl(resolvedUsername),
    bio:
      typeof user.bio_raw === 'string'
        ? user.bio_raw
        : typeof user.bio_excerpt === 'string'
          ? user.bio_excerpt
          : undefined,
    topicCount: discourseAccountCount(summary.topic_count) ?? (visibleTopics.length || undefined),
    replyCount: discourseAccountCount(summary.reply_count),
    postCount: discourseAccountCount(summary.post_count),
    ...(levelLabel ? { levelLabel } : {}),
    topics: visibleTopics,
    hasMoreTopics: false,
    nextTopicsCursor: null,
    replies,
    hasMoreReplies: wantsReplies && replies.length > 0,
    nextRepliesCursor: wantsReplies && replies.length > 0 ? String(replyOffset + LIST_PAGE_SIZE) : null
  };
  const candidateCount = 1 + rawTopics.length + rawUserActions.length;
  const hasUserIdentity = Boolean(user.username || user.name || user.id);
  const validCount = (hasUserIdentity ? 1 : 0) + visibleTopics.length + replies.length;
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'discourse-user',
    candidateCount,
    validCount,
    droppedCount: Math.max(0, candidateCount - validCount),
    partialErrorCount,
    missingFloorCount: rawUserActions.filter((action) => isRecord(action) && !parsePositiveInteger(action.post_number))
      .length,
    hasRepeatedCursor: result.nextTopicsCursor === options.cursor || result.nextRepliesCursor === options.cursor,
    isParseEmpty: !hasUserIdentity && visibleTopics.length === 0 && replies.length === 0
  });
}

export async function getLinuxDoCurrentUserProfile(options: LinuxDoCurrentUserOptions = {}): Promise<UserProfile> {
  options = linuxDoOptionsWithBrowserIntent(options, 'account', 'background');
  const response = await fetchWithTimeout(
    `${BASE_URL}/session/current.json`,
    withBrowserFetchIntent(
      {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: BASE_URL,
          'User-Agent': options.linuxDoUserAgent || DEFAULT_LINUXDO_ANDROID_USER_AGENT,
          'X-Requested-With': 'XMLHttpRequest'
        }
      },
      options.browserFetchIntent || { owner: 'account', priority: 'background' }
    ),
    options
  );
  const text = await response.text();
  const data = await proveForumReadResponse(response, () => {
    if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
      throw new LinuxDoCloudflareError();
    }
    if (response.status === 404) {
      throw Object.assign(new Error('linux.do 登录已失效，请重新登录'), {
        source: 'linuxdo' as const,
        kind: 'login-expired' as const,
        loginRequired: true,
        reason: 'expired' as const
      });
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('linux.do 当前用户返回内容格式不正确');
    }
    if (!response.ok) {
      throw new Error(linuxDoErrorText(parsed, `HTTP ${response.status}`));
    }
    return parsed;
  });
  if (isRecord(data) && (data.current_user === null || data.user === null)) {
    throw Object.assign(new Error('linux.do 登录已失效，请重新登录'), {
      source: 'linuxdo' as const,
      kind: 'login-expired' as const,
      loginRequired: true,
      reason: 'expired' as const
    });
  }
  const currentUser = isRecord(data) && isRecord(data.current_user) ? data.current_user : {};
  const user = isRecord(data) && isRecord(data.user) ? data.user : {};
  const merged = { ...user, ...currentUser };
  const username = String(merged.username || '').trim();
  if (!username) {
    throw new Error('无法读取当前 linux.do 用户名，请重新检测 linux.do 登录状态。');
  }
  const displayName = typeof merged.name === 'string' ? merged.name : username;
  const levelLabel = linuxDoLevelLabel(merged);
  return {
    source: 'linuxdo',
    id: username,
    username,
    displayName,
    avatar: avatarUrl(merged.avatar_template),
    url: userUrl(username),
    ...(levelLabel ? { levelLabel } : {}),
    topics: []
  };
}
