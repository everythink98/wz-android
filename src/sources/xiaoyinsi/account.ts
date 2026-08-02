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
import { buildDiscourseLevelProfileFromSummary, type DiscourseLevelProfile } from '@/sources/discourse/level';
import { discourseOriginalPoster, discourseUsersById } from '@/sources/discourse/model';
import { stripDiscourseCalloutMarkersFromExcerpt } from '@/sources/discourse/content';
import { XIAOYINSI_BASE_URL } from './protocol';
import { cleanCredentials } from './credentials';
import {
  LIST_PAGE_SIZE,
  avatarUrl,
  categoryMapForTopics,
  fetchXiaoyinsiJson,
  levelLabel,
  nonNegativeNumber,
  normalizeTopic,
  positiveNumber,
  topicId,
  userUrl,
  type CategoryMap,
  type XiaoyinsiOptions
} from './reader';

export type XiaoyinsiLevelProfile = DiscourseLevelProfile;

function normalizeUserAction(raw: unknown, username: string, categories: CategoryMap): UserReplyActivity | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = topicId(raw.topic_id);
  const title = decodeHtml(raw.title || raw.topic_title || '');
  if (!id || !title) {
    return null;
  }
  const floor = positiveNumber(raw.post_number);
  const slug = String(raw.slug || id);
  const url = `${XIAOYINSI_BASE_URL}/t/${slug}/${id}${floor ? `/${floor}` : ''}`;
  return {
    source: 'xiaoyinsi',
    id: String(raw.post_id || raw.id || `${id}:${floor || 0}`),
    topicId: id,
    topicTitle: title,
    topicUrl: `${XIAOYINSI_BASE_URL}/t/${slug}/${id}`,
    url,
    author: username,
    authorId: username,
    authorUrl: userUrl(username),
    categoryId: raw.category_id ? String(raw.category_id) : undefined,
    category: raw.category_id ? categories.get(String(raw.category_id)) : undefined,
    createdAt: toIsoString(raw.created_at) || undefined,
    ...(floor ? { floor } : {}),
    excerpt: textExcerpt(stripDiscourseCalloutMarkersFromExcerpt(raw.excerpt || raw.content || ''))
  };
}

export async function getXiaoyinsiUserProfile(
  id: string,
  username: string,
  options: XiaoyinsiOptions = {}
): Promise<UserProfile> {
  const name = (username || id).trim();
  if (!name) {
    throw new Error('小隐寺用户信息不完整');
  }
  const cursorType = options.cursorType;
  const wantsTopics = cursorType !== 'replies';
  const wantsReplies = cursorType !== 'topics';
  const topicPage = cursorType === 'topics' ? parsePositiveInteger(options.cursor) || 0 : 0;
  const replyOffset = parsePositiveInteger(options.cursor) || 0;
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(
    `/u/${encodeURIComponent(name)}/summary.json`,
    undefined,
    options
  );
  const summary = isRecord(data.user_summary) ? data.user_summary : {};
  const summaryUser = isRecord(summary.user) ? summary.user : {};
  const dataUser = isRecord(data.user) ? data.user : {};
  const listedUser = (Array.isArray(data.users) ? data.users : []).find(
    (candidate) =>
      isRecord(candidate) &&
      (String(candidate.username || '').toLowerCase() === name.toLowerCase() || String(candidate.id || '') === id)
  );
  const user = { ...(isRecord(listedUser) ? listedUser : {}), ...dataUser, ...summaryUser };
  const resolvedUsername = String(user.username || name).trim();
  let topicData: Record<string, unknown> = {};
  if (wantsTopics) {
    topicData = await fetchXiaoyinsiJson<Record<string, unknown>>(
      `/topics/created-by/${encodeURIComponent(resolvedUsername)}.json`,
      topicPage > 0 ? { page: topicPage } : undefined,
      options
    );
  }
  const topicList = isRecord(topicData.topic_list) ? topicData.topic_list : {};
  const rawTopics = Array.isArray(topicList.topics) ? topicList.topics : [];
  let rawActions: unknown[] = [];
  if (wantsReplies) {
    const actions = await fetchXiaoyinsiJson<Record<string, unknown>>(
      '/user_actions.json',
      {
        offset: replyOffset,
        username: resolvedUsername,
        filter: 5
      },
      options
    );
    rawActions = Array.isArray(actions.user_actions) ? actions.user_actions : [];
  }
  const categories = await categoryMapForTopics(topicData, [...rawTopics, ...rawActions], options);
  const topicUsers = discourseUsersById(topicData.users);
  const topics = rawTopics
    .map((raw) =>
      isRecord(raw) ? normalizeTopic(raw, categories, discourseOriginalPoster(raw, topicUsers) || user) : null
    )
    .filter((item): item is Topic => Boolean(item));
  const replies = rawActions
    .map((action) => normalizeUserAction(action, resolvedUsername, categories))
    .filter((item): item is UserReplyActivity => Boolean(item));
  const trustLevel = levelLabel(user);
  return annotateSourceDiagnosticSummary(
    {
      source: 'xiaoyinsi',
      id: resolvedUsername,
      username: resolvedUsername,
      displayName: typeof user.name === 'string' ? user.name : resolvedUsername,
      avatar: avatarUrl(user.avatar_template),
      url: userUrl(resolvedUsername),
      bio:
        typeof user.bio_raw === 'string'
          ? user.bio_raw
          : typeof user.bio_excerpt === 'string'
            ? user.bio_excerpt
            : undefined,
      topicCount: nonNegativeNumber(summary.topic_count) ?? (topics.length || undefined),
      replyCount: nonNegativeNumber(summary.reply_count),
      postCount: nonNegativeNumber(summary.post_count),
      ...(trustLevel ? { levelLabel: trustLevel } : {}),
      topics: sortTopicsByCreatedAt(topics),
      hasMoreTopics: Boolean(topicList.more_topics_url),
      nextTopicsCursor: topicList.more_topics_url ? String(topicPage + 1) : null,
      replies,
      hasMoreReplies: rawActions.length >= LIST_PAGE_SIZE,
      nextRepliesCursor: rawActions.length >= LIST_PAGE_SIZE ? String(replyOffset + LIST_PAGE_SIZE) : null
    },
    {
      parserVariant: 'xiaoyinsi-discourse-user',
      candidateCount: 1 + rawTopics.length + rawActions.length,
      validCount: 1 + topics.length + replies.length,
      droppedCount: Math.max(0, rawTopics.length + rawActions.length - topics.length - replies.length)
    }
  );
}

export async function getXiaoyinsiCurrentUserProfile(options: XiaoyinsiOptions = {}): Promise<UserProfile> {
  if (!cleanCredentials(options.credentials)) {
    throw new Error('请先授权小隐寺');
  }
  let data: Record<string, unknown>;
  try {
    data = await fetchXiaoyinsiJson<Record<string, unknown>>('/session/current.json', undefined, options);
  } catch (error) {
    const candidate =
      error && typeof error === 'object'
        ? (error as { responseErrorType?: unknown; responseFormat?: unknown; status?: unknown })
        : {};
    if (
      candidate.status === 403 &&
      candidate.responseFormat === 'json' &&
      candidate.responseErrorType === 'invalid_access'
    ) {
      throw Object.assign(new Error('小隐寺授权已失效，请重新授权。'), {
        source: 'xiaoyinsi' as const,
        kind: 'login-expired' as const,
        loginRequired: true,
        reason: 'expired' as const
      });
    }
    throw error;
  }
  if (data.current_user === null || data.user === null) {
    throw Object.assign(new Error('小隐寺授权已失效，请重新授权。'), {
      source: 'xiaoyinsi' as const,
      kind: 'login-expired' as const,
      loginRequired: true,
      reason: 'expired' as const
    });
  }
  const currentUser = isRecord(data.current_user) ? data.current_user : isRecord(data.user) ? data.user : {};
  const username = String(currentUser.username || '').trim();
  if (!username) {
    throw new Error('无法读取当前小隐寺用户，请重新授权。');
  }
  const trustLevel = levelLabel(currentUser);
  return {
    source: 'xiaoyinsi',
    id: username,
    username,
    displayName: typeof currentUser.name === 'string' ? currentUser.name : username,
    avatar: avatarUrl(currentUser.avatar_template),
    url: userUrl(username),
    ...(trustLevel ? { levelLabel: trustLevel } : {}),
    topics: []
  };
}

export async function getXiaoyinsiLevelProfile(options: XiaoyinsiOptions = {}): Promise<XiaoyinsiLevelProfile> {
  const currentUser = await getXiaoyinsiCurrentUserProfile(options);
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(
    `/u/${encodeURIComponent(currentUser.username)}/summary.json`,
    undefined,
    options
  );
  if (!isRecord(data.user_summary)) {
    throw new Error('小隐寺等级数据格式不正确');
  }
  const listedUser = (Array.isArray(data.users) ? data.users : []).find(
    (candidate) =>
      isRecord(candidate) && String(candidate.username || '').toLowerCase() === currentUser.username.toLowerCase()
  );
  return buildDiscourseLevelProfileFromSummary({
    ...data.user_summary,
    username: currentUser.username,
    user: isRecord(listedUser) ? listedUser : {}
  });
}
