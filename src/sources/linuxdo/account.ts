import { normalizeTopicId } from '@/domain/forum/numericValues';
import { withBrowserFetchIntent, withDefaultBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import { fetchWithTimeout } from '@/platform/network/request';
import { resolveWebViewUserAgent } from '@/platform/android/resolveWebViewUserAgent';
import { isCanceledRequest } from '@/platform/network/errors';
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
  recordText,
  sortTopicsByCreatedAt,
  textExcerpt,
  toIsoString
} from '@/domain/forum/html';
import { annotateSourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { proveForumReadResponse } from '@/sources/forumSourceReadAttempt';
import { stripDiscourseCalloutMarkersFromExcerpt } from '@/sources/discourse/content';
import { discourseAccountCount } from '@/sources/discourse/level';
import { discourseDisplayName } from '@/sources/discourse/model';
import { LINUXDO_BASE_URL as BASE_URL, linuxDoAvatarUrl as avatarUrl, linuxDoUserUrl as userUrl } from './protocol';
import {
  LIST_PAGE_SIZE,
  categoryMapForTopics,
  categoryMapFromData,
  fetchLinuxDoJson,
  linuxDoErrorText,
  linuxDoLevelLabel,
  normalizeTopic,
  type LinuxDoOptions
} from './reader';

interface LinuxDoCurrentUserOptions extends LinuxDoOptions {
  linuxDoUserAgent?: string;
}

function normalizeUserActionReply(
  raw: unknown,
  categoryMap: Map<string, { name: string; accessRequirement?: Topic['accessRequirement'] }>,
  profile: UserDetails
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
    author: profile.displayName?.trim() || profile.username,
    authorId: profile.username,
    authorAvatar: profile.avatar,
    authorUrl: userUrl(profile.username),
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
  options = withDefaultBrowserFetchIntent(options, 'user', 'foreground');
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
  const userId = summaryUser.id ?? dataUser.id;
  const matchesAccount = (row: Record<string, unknown>) =>
    recordText(row, 'username').toLowerCase() === name.toLowerCase();
  const listedUser =
    listedUsers.find(matchesAccount) ?? listedUsers.find((row) => userId != null && String(row.id) === String(userId));
  let user = { ...listedUser, ...dataUser, ...summaryUser };
  const hasProfile =
    Boolean(user.username || user.name || user.id) ||
    (typeof summary.can_see_summary_stats === 'boolean' && typeof summary.can_see_user_actions === 'boolean');
  // Standard Discourse summaries can contain only stats and unrelated badge grantors.
  if (hasProfile && !('name' in user) && !discourseDisplayName(user)) {
    const profile = await fetchLinuxDoJson<Record<string, unknown>>(
      `/u/${encodeURIComponent(name)}.json`,
      undefined,
      options
    ).catch((error: unknown) => {
      if (options.signal?.aborted || isCanceledRequest(error)) throw error;
      return null;
    });
    if (isRecord(profile?.user) && matchesAccount(profile.user)) user = { ...user, ...profile.user };
  }
  const resolvedUsername = recordText(user, 'username') || name;
  const displayName = discourseDisplayName(user) || resolvedUsername;
  const avatar = avatarUrl(user.avatar_template);
  const levelLabel = linuxDoLevelLabel(user);
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
      // Discourse counts regular non-first posts here; first posts belong to topic_count.
      replyCount: discourseAccountCount(summary.post_count),
      daysVisited: discourseAccountCount(summary.days_visited),
      topicsEntered: discourseAccountCount(summary.topics_entered),
      postsReadCount: discourseAccountCount(summary.posts_read_count),
      timeRead: discourseAccountCount(summary.time_read),
      likesGiven: discourseAccountCount(summary.likes_given),
      likesReceived: discourseAccountCount(summary.likes_received),
      ...(levelLabel ? { levelLabel } : {})
    },
    { parserVariant: 'discourse-user', candidateCount: 1, validCount: hasProfile ? 1 : 0, isParseEmpty: !hasProfile }
  );
}

function userTopicContinuation(link: unknown, path: string, currentPage: number) {
  if (typeof link !== 'string' || !link.trim()) return null;
  try {
    const target = new URL(link, BASE_URL + path);
    const pages = target.searchParams.getAll('page');
    const page = pages.length === 1 && /^\d+$/.test(pages[0]) ? Number(pages[0]) : NaN;
    return target.origin === BASE_URL && Number.isSafeInteger(page) && page > currentPage ? page : null;
  } catch {
    return null;
  }
}

export async function getLinuxDoUserTopics(
  profile: UserDetails,
  options: LinuxDoOptions = {}
): Promise<UserTopicsPage> {
  options = withDefaultBrowserFetchIntent(options, 'user', 'foreground');
  const page = parsePositiveInteger(options.cursor);
  const path = `/topics/created-by/${encodeURIComponent(profile.username)}.json`;
  const data = await fetchLinuxDoJson<Record<string, unknown>>(path, { page, per_page: LIST_PAGE_SIZE }, options);
  if (!isRecord(data.topic_list) || !Array.isArray(data.topic_list.topics))
    throw new Error('linux.do 主题列表响应不完整');
  const rawTopics = data.topic_list.topics;
  const categories = await categoryMapForTopics(data, rawTopics, categoryMapFromData(data), options);
  const topics = sortTopicsByCreatedAt(
    rawTopics
      .map((raw) => normalizeTopic(raw, categories, { username: profile.username, name: profile.displayName }))
      .filter((topic): topic is Topic => topic !== null)
      .map((topic) => ({
        ...topic,
        authorAvatar: profile.avatar || topic.authorAvatar,
        authorLevelLabel: profile.levelLabel || topic.authorLevelLabel
      }))
  );
  const nextLink = data.topic_list.more_topics_url;
  // Discourse supplies the continuation on the current list; older responses omit the field.
  const hasMoreByCount =
    profile.topicCount === undefined
      ? rawTopics.length >= LIST_PAGE_SIZE
      : page * LIST_PAGE_SIZE + rawTopics.length < profile.topicCount;
  const next =
    nextLink === undefined ? (hasMoreByCount ? page + 1 : null) : userTopicContinuation(nextLink, path, page);
  const hasMoreTopics = topics.length > 0 && next !== null;
  return annotateSourceDiagnosticSummary(
    { topics, hasMoreTopics, nextTopicsCursor: hasMoreTopics ? String(next) : null },
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
  options = withDefaultBrowserFetchIntent(options, 'user', 'foreground');
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
    .map((action) => normalizeUserActionReply(action, categories, profile))
    .filter((reply): reply is UserReplyActivity => reply !== null);
  const hasMoreReplies = Boolean(
    data.user_actions[LIST_PAGE_SIZE] &&
    normalizeUserActionReply(data.user_actions[LIST_PAGE_SIZE], categories, profile)
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

export class LinuxDoLoggedOutError extends Error {
  readonly source = 'linuxdo';
  readonly kind = 'login-expired';
  readonly loginRequired = true;
  readonly reason = 'expired';

  constructor(readonly accountEvidence: 'session-404' | 'null-user' | 'server-logged-out') {
    super('linux.do 登录已失效，请重新登录');
  }
}

export async function getLinuxDoCurrentUserIdentity(options: LinuxDoCurrentUserOptions = {}): Promise<UserIdentity> {
  options = withDefaultBrowserFetchIntent(options, 'account', 'background');
  const currentSessionUrl = `${BASE_URL}/session/current.json`;
  const response = await fetchWithTimeout(
    currentSessionUrl,
    withBrowserFetchIntent(
      {
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Referer: BASE_URL,
          'User-Agent': await resolveWebViewUserAgent(options.linuxDoUserAgent, options.signal),
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
    evidence:
      LinuxDoLoggedOutError['accountEvidence'] | 'current-user' | 'challenge' | 'http-error' | 'invalid-response'
  ) => {
    finishDiagnosticTrace(accountTrace, evidence === 'current-user' ? 'success' : 'blocked', {
      source: 'linuxdo',
      status: response.status,
      accountEvidence: evidence
    });
  };
  const noUser = (evidence: LinuxDoLoggedOutError['accountEvidence']) => {
    accountEvidence(evidence);
    return new LinuxDoLoggedOutError(evidence);
  };
  const data = await proveForumReadResponse(response, () => {
    if (isCloudflareChallengeResponse({ status: response.status, headers: response.headers, bodyText: text })) {
      accountEvidence('challenge');
      throw new LinuxDoCloudflareError(response);
    }
    if (response.url && response.url.split(/[?#]/, 1)[0] !== currentSessionUrl) {
      accountEvidence('invalid-response');
      throw new Error('linux.do 当前用户响应地址与账号接口不符');
    }
    if (response.status === 404 && !text.trim()) throw noUser('session-404');
    const unauthorized = response.status === 401 || response.status === 403 || response.status === 404;
    if (unauthorized && response.headers.get('Discourse-Logged-Out')?.trim() === '1') throw noUser('server-logged-out');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      accountEvidence('invalid-response');
      throw new Error('linux.do 当前用户返回内容格式不正确');
    }
    if (!response.ok) {
      if (unauthorized && isRecord(parsed) && parsed.error_type === 'not_logged_in') throw noUser('server-logged-out');
      accountEvidence('http-error');
      throw new Error(linuxDoErrorText(parsed, `HTTP ${response.status}`));
    }
    return parsed;
  });
  if (isRecord(data) && (data.current_user === null || data.user === null)) {
    throw noUser('null-user');
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
  const displayName = discourseDisplayName(merged) || username;
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
