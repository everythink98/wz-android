import { withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout } from '@/platform/network/request';
import { DEFAULT_LINUXDO_ANDROID_USER_AGENT } from '@/platform/android/linuxDoUserAgent';
import { isCloudflareChallengeResponse, LinuxDoCloudflareError } from '@/platform/network/cloudflareChallenge';
import type {
  Topic,
  UserIdentity,
  UserDetails,
  UserTopicsPage,
  UserRepliesPage,
  UserReplyActivity
} from '@/domain/forum/models';
import {
  decodeHtml,
  isRecord,
  parsePositiveInteger,
  sortTopicsByCreatedAt,
  textExcerpt,
  toIsoString
} from '@/domain/forum/html';
import { annotateSourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
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
  authorData?: UserDetails
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
    authorAvatar: authorData?.avatar,
    authorUrl: author ? userUrl(author) : undefined,
    categoryId: raw.category_id ? String(raw.category_id) : undefined,
    category: category?.name,
    createdAt: toIsoString(raw.created_at || raw.createdAt) || undefined,
    ...(floor ? { floor } : {}),
    excerpt: textExcerpt(stripDiscourseCalloutMarkersFromExcerpt(raw.excerpt || raw.content || raw.markdown || ''))
  };
}

export async function getLinuxDoUserDetails(
  id: string,
  username: string,
  options: LinuxDoOptions = {}
): Promise<UserDetails> {
  options = linuxDoOptionsWithBrowserIntent(options, 'user', 'foreground');
  const name = (username || id).trim();
  if (!name) throw new Error('linux.do 用户信息不完整');
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

  const hasIdentity = Boolean(user.username || user.name || user.id);
  return annotateSourceDiagnosticSummary(
    {
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
      topicCount: discourseAccountCount(summary.topic_count),
      replyCount: discourseAccountCount(summary.reply_count),
      postCount: discourseAccountCount(summary.post_count),
      ...(levelLabel ? { levelLabel } : {})
    },
    { parserVariant: 'discourse-user', candidateCount: 1, validCount: hasIdentity ? 1 : 0, isParseEmpty: !hasIdentity }
  );
}

export async function getLinuxDoUserTopics(
  profile: UserDetails,
  options: LinuxDoOptions = {}
): Promise<UserTopicsPage> {
  options = linuxDoOptionsWithBrowserIntent(options, 'user', 'foreground');
  const page = parsePositiveInteger(options.cursor);
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    `/topics/created-by/${encodeURIComponent(profile.username)}.json`,
    { page, per_page: LIST_PAGE_SIZE },
    options
  );
  if (!isRecord(data.topic_list) || !Array.isArray(data.topic_list.topics))
    throw new Error('linux.do 主题列表响应不完整');
  const rawTopics = data.topic_list.topics;
  const categories = await categoryMapForTopics(data, rawTopics, categoryMapFromData(data), options);
  const topics = sortTopicsByCreatedAt(
    rawTopics
      .map((raw) => normalizeTopic(raw, categories, profile.username))
      .filter((topic): topic is Topic => topic !== null)
      .map((topic) => ({
        ...topic,
        authorAvatar: profile.avatar || topic.authorAvatar,
        authorLevelLabel: profile.levelLabel || topic.authorLevelLabel
      }))
  );
  const hasMoreTopics =
    rawTopics.length > 0 &&
    topics.length > 0 &&
    (profile.topicCount === undefined
      ? rawTopics.length >= LIST_PAGE_SIZE
      : page * LIST_PAGE_SIZE + rawTopics.length < profile.topicCount);
  return annotateSourceDiagnosticSummary(
    { topics, hasMoreTopics, nextTopicsCursor: hasMoreTopics ? String(page + 1) : null },
    {
      parserVariant: 'discourse-user',
      candidateCount: rawTopics.length,
      validCount: topics.length,
      droppedCount: rawTopics.length - topics.length,
      isExpectedEmpty: rawTopics.length === 0
    }
  );
}

export async function getLinuxDoUserReplies(
  profile: UserDetails,
  options: LinuxDoOptions = {}
): Promise<UserRepliesPage> {
  options = linuxDoOptionsWithBrowserIntent(options, 'user', 'foreground');
  const offset = parsePositiveInteger(options.cursor);
  const data = await fetchLinuxDoJson<Record<string, unknown>>(
    '/user_actions.json',
    {
      offset,
      username: profile.username,
      filter: 5,
      limit: LIST_PAGE_SIZE + 1
    },
    options
  );
  if (!Array.isArray(data.user_actions)) throw new Error('linux.do 回复列表响应不完整');
  const raw = data.user_actions.slice(0, LIST_PAGE_SIZE);
  const categories = await categoryMapForTopics(data, raw, categoryMapFromData(data), options);
  const replies = raw
    .map((action) => normalizeUserActionReply(action, categories, profile.username, profile))
    .filter((reply): reply is UserReplyActivity => reply !== null);
  const hasMoreReplies = Boolean(
    data.user_actions[LIST_PAGE_SIZE] &&
    normalizeUserActionReply(data.user_actions[LIST_PAGE_SIZE], categories, profile.username, profile)
  );
  return annotateSourceDiagnosticSummary(
    { replies, hasMoreReplies, nextRepliesCursor: hasMoreReplies ? String(offset + LIST_PAGE_SIZE) : null },
    {
      parserVariant: 'discourse-user',
      candidateCount: raw.length,
      validCount: replies.length,
      droppedCount: raw.length - replies.length,
      isExpectedEmpty: raw.length === 0,
      missingFloorCount: raw.filter((action) => isRecord(action) && !parsePositiveInteger(action.post_number)).length
    }
  );
}

export async function getLinuxDoCurrentUserIdentity(options: LinuxDoCurrentUserOptions = {}): Promise<UserIdentity> {
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
  const accountTrace = beginDiagnosticTrace('session', 'check', { source: 'linuxdo', status: response.status });
  const accountEvidence = (
    evidence: 'current-user' | 'session-404' | 'null-user' | 'challenge' | 'http-error' | 'invalid-response'
  ) => {
    finishDiagnosticTrace(accountTrace, evidence === 'current-user' ? 'success' : 'blocked', {
      source: 'linuxdo',
      status: response.status,
      accountEvidence: evidence
    });
  };
  const data = await proveForumReadResponse(response, () => {
    if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
      accountEvidence('challenge');
      throw new LinuxDoCloudflareError();
    }
    if (response.status === 404) {
      accountEvidence('session-404');
      throw Object.assign(new Error('linux.do 登录已失效，请重新登录'), {
        source: 'linuxdo' as const,
        kind: 'login-expired' as const,
        accountEvidence: 'session-404' as const,
        loginRequired: true,
        reason: 'expired' as const
      });
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      accountEvidence('invalid-response');
      throw new Error('linux.do 当前用户返回内容格式不正确');
    }
    if (!response.ok) {
      accountEvidence('http-error');
      throw new Error(linuxDoErrorText(parsed, `HTTP ${response.status}`));
    }
    return parsed;
  });
  if (isRecord(data) && (data.current_user === null || data.user === null)) {
    accountEvidence('null-user');
    throw Object.assign(new Error('linux.do 登录已失效，请重新登录'), {
      source: 'linuxdo' as const,
      kind: 'login-expired' as const,
      accountEvidence: 'null-user' as const,
      loginRequired: true,
      reason: 'expired' as const
    });
  }
  const currentUser = isRecord(data) && isRecord(data.current_user) ? data.current_user : {};
  const user = isRecord(data) && isRecord(data.user) ? data.user : {};
  const merged = { ...user, ...currentUser };
  const username = String(merged.username || '').trim();
  if (!username) {
    accountEvidence('invalid-response');
    throw new Error('无法读取当前 linux.do 用户名，请重新检测 linux.do 登录状态。');
  }
  accountEvidence('current-user');
  const displayName = typeof merged.name === 'string' ? merged.name : username;
  const levelLabel = linuxDoLevelLabel(merged);
  return {
    source: 'linuxdo',
    id: username,
    username,
    displayName,
    avatar: avatarUrl(merged.avatar_template),
    url: userUrl(username),
    ...(levelLabel ? { levelLabel } : {})
  };
}
