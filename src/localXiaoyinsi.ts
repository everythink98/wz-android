import { fetchWithTimeout, type Fetcher } from './request';
import type {
  CategoriesResponse,
  FeedResponse,
  LinuxDoTagOption,
  LinuxDoUserOption,
  ReactionSummary,
  Reply,
  RepliesResponse,
  SearchResponse,
  Topic,
  TopicDetail,
  TopicPoll,
  TopicPollOption,
  UserProfile,
  UserReplyActivity,
  XiaoyinsiFeedFilter
} from './types';
import {
  decodeHtml,
  isRecord,
  parseHtml,
  parsePositiveInteger,
  sanitizeContentHtml,
  sortTopicsByCreatedAt,
  textContentFromHtml,
  textExcerpt,
  toIsoString
} from './localHtml';
import { annotateSourceDiagnosticSummary } from './sourceAdapterDiagnostics';
import { buildDiscourseLevelProfileFromSummary, type DiscourseLevelProfile } from './discourseLevel';

export const XIAOYINSI_BASE_URL = 'https://forum.xiaoyinsi.com';
const LIST_PAGE_SIZE = 30;
const POLL_PLACEHOLDER_TAG = 'forum-xiaoyinsi-poll';

export type XiaoyinsiApiCredentials = {
  apiKey: string;
  clientId: string;
};

export type XiaoyinsiLevelProfile = DiscourseLevelProfile;

export type XiaoyinsiContentPart =
  | { type: 'html'; html: string }
  | { type: 'poll'; poll: TopicPoll };

export interface XiaoyinsiOptions {
  credentials?: XiaoyinsiApiCredentials;
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function cleanCredentials(credentials?: XiaoyinsiApiCredentials) {
  const apiKey = credentials?.apiKey.trim() || '';
  const clientId = credentials?.clientId.trim() || '';
  return apiKey && clientId ? { apiKey, clientId } : undefined;
}

function requestHeaders(credentials?: XiaoyinsiApiCredentials) {
  const clean = cleanCredentials(credentials);
  return {
    Accept: 'application/json',
    ...(clean ? {
      'User-Api-Key': clean.apiKey,
      'User-Api-Client-Id': clean.clientId
    } : {})
  };
}

function errorText(data: unknown, fallback: string) {
  if (!isRecord(data)) {
    return fallback;
  }
  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error.trim();
  }
  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message.trim();
  }
  if (Array.isArray(data.errors)) {
    const message = data.errors.map((item) => String(item || '').trim()).filter(Boolean).join(' ');
    return message || fallback;
  }
  return fallback;
}

async function fetchXiaoyinsiJson<T>(
  path: string,
  params: Record<string, string | number | Array<string | number> | undefined> | undefined,
  options: XiaoyinsiOptions = {}
) {
  const url = new URL(path, XIAOYINSI_BASE_URL);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetchWithTimeout(url.toString(), {
    headers: requestHeaders(options.credentials)
  }, options);
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const error = new Error(response.ok ? '小隐寺返回内容格式不正确' : `HTTP ${response.status}`);
    Object.assign(error, { source: 'xiaoyinsi', status: response.status });
    throw error;
  }
  if (!response.ok) {
    const error = new Error(errorText(data, `HTTP ${response.status}`));
    Object.assign(error, { source: 'xiaoyinsi', status: response.status });
    throw error;
  }
  return data as T;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function nonNegativeNumber(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function topicId(value: unknown) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

function avatarUrl(value: unknown) {
  const path = String(value || '').trim();
  return path ? new URL(path.replace('{size}', '96'), XIAOYINSI_BASE_URL).toString() : undefined;
}

function userUrl(username: string) {
  return `${XIAOYINSI_BASE_URL}/u/${encodeURIComponent(username)}`;
}

function levelLabel(raw?: Record<string, unknown>) {
  const value = raw?.trust_level ?? raw?.trustLevel;
  const level = value === '' || value === null || value === undefined ? NaN : Number(value);
  return Number.isInteger(level) && level >= 0 ? `Lv${level}` : undefined;
}

function usersById(value: unknown) {
  const users = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(value)) {
    return users;
  }
  value.filter(isRecord).forEach((user) => {
    if (user.id !== undefined && user.id !== null) {
      users.set(String(user.id), user);
    }
  });
  return users;
}

function originalPoster(topic: Record<string, unknown>, users: Map<string, Record<string, unknown>>) {
  const posters = Array.isArray(topic.posters) ? topic.posters : [];
  const poster = posters.find((item) => isRecord(item) && /original poster/i.test(String(item.description || '')))
    || posters.find(isRecord);
  return isRecord(poster) ? users.get(String(poster.user_id)) : undefined;
}

type CategoryMap = Map<string, string>;

function categoryMapFromData(data: unknown) {
  const result: CategoryMap = new Map();
  if (!isRecord(data)) {
    return result;
  }
  const lists = [
    data.categories,
    isRecord(data.category_list) ? data.category_list.categories : undefined,
    isRecord(data.topic_list) ? data.topic_list.categories : undefined
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    list.filter(isRecord).forEach((category) => {
      if (category.id !== undefined && category.name) {
        result.set(String(category.id), String(category.name));
      }
    });
  }
  return result;
}

async function categoryMapForTopics(data: unknown, topics: unknown[], options: XiaoyinsiOptions) {
  const categories = categoryMapFromData(data);
  const needsSiteCategories = topics.some((topic) => {
    if (!isRecord(topic) || topic.category_id === undefined || topic.category_id === null) {
      return false;
    }
    return !categories.has(String(topic.category_id));
  });
  if (!needsSiteCategories) {
    return categories;
  }
  try {
    const siteData = await fetchXiaoyinsiJson<Record<string, unknown>>('/site.json', undefined, options);
    return new Map([...categories, ...categoryMapFromData(siteData)]);
  } catch {
    return categories;
  }
}

function tagNames(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((tag) => {
    if (typeof tag === 'string') {
      return tag.trim();
    }
    return isRecord(tag) ? String(tag.name || tag.slug || '').trim() : '';
  }).filter(Boolean);
}

function acceptedAnswerPostNumber(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.accepted_answers)) {
    return undefined;
  }
  return positiveNumber(value.accepted_answers.find(isRecord)?.post_number);
}

function normalizeTopic(
  raw: unknown,
  categories: CategoryMap,
  authorData?: Record<string, unknown>
): Topic | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = topicId(raw.id);
  if (!id) {
    return null;
  }
  const createdBy = isRecord(raw.details) && isRecord(raw.details.created_by) ? raw.details.created_by : {};
  const author = String(authorData?.username || createdBy.username || raw.last_poster_username || '').trim();
  const createdAt = toIsoString(raw.created_at) || '';
  const lastReplyAt = toIsoString(raw.bumped_at || raw.last_posted_at || raw.created_at);
  const viewCount = nonNegativeNumber(raw.views);
  const categoryId = raw.category_id === undefined || raw.category_id === null ? undefined : String(raw.category_id);
  const tags = tagNames(raw.tags);
  const trustLevel = levelLabel(authorData) || levelLabel(createdBy);
  const acceptedAnswerFloor = acceptedAnswerPostNumber(raw);
  const slowModeSeconds = positiveNumber(raw.slow_mode_seconds);
  return {
    source: 'xiaoyinsi',
    id,
    title: decodeHtml(raw.unicode_title || raw.title || ''),
    author,
    authorId: author || undefined,
    authorAvatar: avatarUrl(authorData?.avatar_template || createdBy.avatar_template),
    authorUrl: author ? userUrl(author) : undefined,
    categoryId,
    category: categoryId ? categories.get(categoryId) || '未分类' : '未分类',
    url: `${XIAOYINSI_BASE_URL}/t/${raw.slug || id}/${id}`,
    createdAt,
    ...(lastReplyAt ? { lastReplyAt } : {}),
    replyCount: Math.max(Number(raw.posts_count || 1) - 1, 0),
    ...(viewCount === undefined ? {} : { viewCount }),
    excerpt: textExcerpt(raw.excerpt || ''),
    ...(trustLevel ? { authorLevelLabel: trustLevel } : {}),
    ...(tags.length ? { tags } : {}),
    ...(raw.closed === true ? { closed: true } : {}),
    ...(raw.archived === true ? { archived: true } : {}),
    ...(raw.pinned === true || raw.pinned_globally === true ? { pinned: true } : {}),
    ...(raw.has_accepted_answer === true || acceptedAnswerFloor ? { solved: true } : {}),
    ...(acceptedAnswerFloor ? { acceptedAnswerFloor } : {}),
    ...(slowModeSeconds ? { slowModeSeconds } : {})
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function normalizePolls(post: unknown): TopicPoll[] | undefined {
  if (!isRecord(post) || !Array.isArray(post.polls)) {
    return undefined;
  }
  const votesByPoll = isRecord(post.polls_votes) ? post.polls_votes : {};
  const postId = positiveNumber(post.id);
  const polls = post.polls.filter(isRecord).flatMap((poll): TopicPoll[] => {
    const name = String(poll.name || '').trim();
    const selectedIds = new Set(stringArray(name ? votesByPoll[name] : undefined));
    const options = (Array.isArray(poll.options) ? poll.options : []).filter(isRecord).flatMap((option): TopicPollOption[] => {
      const id = String(option.id || '').trim();
      const label = textContentFromHtml(String(option.html || option.label || '')).trim();
      if (!id || !label) {
        return [];
      }
      const count = nonNegativeNumber(option.votes);
      return [{ id, label, ...(count !== undefined ? { count } : {}), selected: selectedIds.has(id) }];
    });
    if (!options.length) {
      return [];
    }
    const type = String(poll.type || '').trim();
    const participantCount = nonNegativeNumber(poll.voters);
    const min = positiveNumber(poll.min);
    const max = positiveNumber(poll.max);
    return [{
      id: String(poll.id || name || '').trim() || undefined,
      name: name || undefined,
      postId: postId ? String(postId) : undefined,
      type: type || undefined,
      title: textContentFromHtml(String(poll.title || '')).trim() || undefined,
      multiple: type === 'multiple',
      voted: selectedIds.size > 0,
      closed: String(poll.status || '').toLowerCase() === 'closed'
        || Boolean(poll.close && Date.parse(String(poll.close)) <= Date.now()),
      public: typeof poll.public === 'boolean' ? poll.public : undefined,
      ...(type === 'ranked_choice' || type === 'number' ? { readonly: true } : {}),
      ...(participantCount !== undefined ? { participantCount } : {}),
      ...(min ? { min } : {}),
      ...(max ? { max } : {}),
      options
    }];
  });
  return polls.length ? polls : undefined;
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeXiaoyinsiContentHtml(html: unknown, polls?: TopicPoll[]) {
  const root = parseHtml(html);
  const names = new Set((polls || []).map((poll) => poll.name).filter((name): name is string => Boolean(name)));
  root.querySelectorAll('.poll').forEach((node) => {
    const name = String(node.getAttribute('data-poll-name') || '').trim();
    if (name && names.has(name)) {
      node.replaceWith(`<${POLL_PLACEHOLDER_TAG} name="${escapeAttribute(name)}"></${POLL_PLACEHOLDER_TAG}>`);
    }
  });
  return sanitizeContentHtml(root.toString(), XIAOYINSI_BASE_URL);
}

function nodeTagName(node: unknown) {
  const value = node as { rawTagName?: unknown; tagName?: unknown };
  return String(value.rawTagName || value.tagName || '').toLowerCase();
}

export function splitXiaoyinsiContentHtml(html: string | undefined, polls: TopicPoll[] | undefined): XiaoyinsiContentPart[] {
  const clean = String(html || '').trim();
  const pollList = polls || [];
  if (!clean) {
    return pollList.map((poll) => ({ type: 'poll', poll }));
  }
  const pollsByName = new Map(pollList.map((poll) => [poll.name || '', poll]));
  const matched = new Set<TopicPoll>();
  const parts: XiaoyinsiContentPart[] = [];
  let currentHtml = '';
  const pushHtml = () => {
    const value = currentHtml.trim();
    if (value) {
      parts.push({ type: 'html', html: value });
    }
    currentHtml = '';
  };
  try {
    const nodes = parseHtml(`<body>${clean}</body>`).querySelector('body')?.childNodes || [];
    for (const node of nodes) {
      if (nodeTagName(node) === POLL_PLACEHOLDER_TAG) {
        const name = String((node as unknown as { getAttribute?: (key: string) => string | undefined }).getAttribute?.('name') || '').trim();
        const poll = pollsByName.get(name);
        if (poll) {
          pushHtml();
          parts.push({ type: 'poll', poll });
          matched.add(poll);
        }
      } else {
        currentHtml += node.toString();
      }
    }
    pushHtml();
  } catch {
    const fallback = clean.replace(new RegExp(`<${POLL_PLACEHOLDER_TAG}\\b[^>]*>\\s*</${POLL_PLACEHOLDER_TAG}\\s*>`, 'gi'), '').trim();
    if (fallback) {
      parts.push({ type: 'html', html: fallback });
    }
  }
  pollList.filter((poll) => !matched.has(poll)).forEach((poll) => parts.push({ type: 'poll', poll }));
  return parts;
}

function localQuoteFloor(node: ReturnType<typeof parseHtml>, currentTopicId?: string) {
  if (!/\bquote\b/i.test(String(node.getAttribute('class') || ''))) {
    return undefined;
  }
  const quoteTopicId = String(node.getAttribute('data-topic') || '');
  if (currentTopicId && quoteTopicId && quoteTopicId !== currentTopicId) {
    return undefined;
  }
  return positiveNumber(node.getAttribute('data-post'));
}

function quoteMetadata(html: string, currentTopicId?: string) {
  const floors = new Set<number>();
  const authors: Record<number, string> = {};
  const previews: Record<number, string> = {};
  const root = parseHtml(html);
  root.querySelectorAll('aside').forEach((node) => {
    const floor = localQuoteFloor(node, currentTopicId);
    if (!floor) {
      return;
    }
    floors.add(floor);
    const author = decodeHtml(node.getAttribute('data-username') || '').trim();
    const preview = textContentFromHtml(node.querySelector('blockquote')?.toString() || '').replace(/\s+/g, ' ').trim();
    if (author) {
      authors[floor] = author;
    }
    if (preview) {
      previews[floor] = preview;
    }
    node.remove();
  });
  return { html: root.toString(), floors: [...floors], authors, previews };
}

function likedFromActions(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const action = value.find((item) => isRecord(item) && Number(item.id) === 2);
  return isRecord(action) ? Boolean(action.acted) : undefined;
}

function canLikeFromActions(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const action = value.find((item) => isRecord(item) && Number(item.id) === 2);
  return isRecord(action) && typeof action.can_act === 'boolean' ? action.can_act : undefined;
}

function reactionSummary(value: unknown): ReactionSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value.filter(isRecord).flatMap((item): ReactionSummary[] => {
    const id = String(item.id || '').trim();
    const count = positiveNumber(item.count);
    return id && count ? [{ id, count }] : [];
  });
  return items.length ? items : undefined;
}

function normalizePost(raw: unknown, fallbackFloor: number, currentTopicId?: string): Reply | null {
  if (!isRecord(raw) || raw.deleted_at || raw.user_deleted === true) {
    return null;
  }
  const polls = normalizePolls(raw);
  const sanitized = sanitizeXiaoyinsiContentHtml(raw.cooked || '', polls);
  const quote = quoteMetadata(sanitized, currentTopicId);
  const username = String(raw.username || '').trim();
  const liked = likedFromActions(raw.actions_summary);
  const canLike = raw.yours === true ? false : canLikeFromActions(raw.actions_summary);
  const markdown = typeof raw.raw === 'string' ? raw.raw : '';
  const reactions = reactionSummary(raw.reactions);
  const bookmarkId = positiveNumber(raw.bookmark_id);
  const authorTrustLevel = levelLabel(raw);
  const postType = Number(raw.post_type);
  const isSystemAction = Number.isFinite(postType) && postType !== 1;
  return {
    author: username,
    authorId: username || undefined,
    authorAvatar: avatarUrl(raw.avatar_template),
    authorUrl: username ? userUrl(username) : undefined,
    contentHtml: quote.html,
    createdAt: toIsoString(raw.created_at),
    floor: positiveNumber(raw.post_number) || fallbackFloor,
    ...(quote.floors.length ? { quotedFloors: quote.floors } : {}),
    ...(Object.keys(quote.authors).length ? { quotedAuthors: quote.authors } : {}),
    ...(Object.keys(quote.previews).length ? { quotedPreviews: quote.previews } : {}),
    ...(positiveNumber(raw.id) ? { commentId: positiveNumber(raw.id) } : {}),
    ...(nonNegativeNumber(raw.like_count) !== undefined ? { likeCount: nonNegativeNumber(raw.like_count) } : {}),
    ...(liked !== undefined ? { liked } : {}),
    ...(canLike !== undefined ? { canLike } : {}),
    ...(raw.can_edit === true ? { canEdit: true } : {}),
    ...(typeof raw.can_delete === 'boolean' ? { canDelete: raw.can_delete } : {}),
    ...(markdown ? { contentMarkdown: markdown } : {}),
    ...(bookmarkId ? { bookmarkId, bookmarked: true } : typeof raw.bookmarked === 'boolean' ? { bookmarked: raw.bookmarked } : {}),
    ...(isRecord(raw.reply_to_user) && raw.reply_to_user.username ? { replyTargetAuthor: String(raw.reply_to_user.username) } : {}),
    ...(raw.accepted_answer === true ? { acceptedAnswer: true } : {}),
    ...(raw.wiki === true ? { wiki: true } : {}),
    ...(raw.hidden === true ? { hidden: true } : {}),
    ...(raw.post_folding_status ? { folded: true } : {}),
    ...(isSystemAction ? { systemAction: true } : {}),
    ...(raw.action_code ? { actionCode: String(raw.action_code) } : {}),
    ...(reactions ? { reactionSummary: reactions } : {}),
    ...(authorTrustLevel ? { authorLevelLabel: authorTrustLevel } : {}),
    ...(polls ? { polls } : {})
  };
}

export async function getXiaoyinsiFeed(options: XiaoyinsiOptions & {
  page?: number;
  limit?: number;
  category?: string;
  feedFilter?: XiaoyinsiFeedFilter;
} = {}): Promise<FeedResponse> {
  const page = options.page || 1;
  const limit = options.limit || LIST_PAGE_SIZE;
  const feedFilter = options.feedFilter || 'latest';
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(
    feedFilter === 'hot' ? '/hot.json' : feedFilter.startsWith('new-') ? '/new.json' : '/latest.json',
    {
      ...(page > 1 ? { page: page - 1 } : {}),
      ...(options.category ? { category: options.category } : {}),
      ...(feedFilter === 'new-topics' ? { subset: 'topics' } : {}),
      ...(feedFilter === 'new-replies' ? { subset: 'replies' } : {})
    },
    options
  );
  const rawTopics = isRecord(data.topic_list) && Array.isArray(data.topic_list.topics) ? data.topic_list.topics : [];
  const users = usersById(data.users);
  const categories = await categoryMapForTopics(data, rawTopics, options);
  const items = rawTopics.map((raw) => isRecord(raw) ? normalizeTopic(raw, categories, originalPoster(raw, users)) : null)
    .filter((item): item is Topic => Boolean(item))
    .slice(0, limit);
  const hasMore = Boolean(isRecord(data.topic_list) && data.topic_list.more_topics_url);
  return annotateSourceDiagnosticSummary({ items, errors: {}, hasMore, nextPage: hasMore ? page + 1 : null }, {
    parserVariant: 'xiaoyinsi-discourse-feed',
    candidateCount: rawTopics.length,
    validCount: items.length,
    droppedCount: Math.max(0, rawTopics.length - items.length),
    isExpectedEmpty: rawTopics.length === 0 && (page > 1 || Boolean(options.category))
  });
}

export async function getXiaoyinsiCategories(options: XiaoyinsiOptions = {}): Promise<CategoriesResponse> {
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/site.json', undefined, options);
  const categories = Array.isArray(data.categories)
    ? data.categories
    : isRecord(data.category_list) && Array.isArray(data.category_list.categories) ? data.category_list.categories : [];
  const items = categories.filter(isRecord).flatMap((category) => {
    const id = String(category.id || '').trim();
    const name = String(category.name || '').trim();
    if (!id || id === '1' || !name || String(category.slug || '').toLowerCase() === 'uncategorized') {
      return [];
    }
    const topicCount = nonNegativeNumber(category.topic_count);
    return [{
      source: 'xiaoyinsi' as const,
      id,
      name,
      ...(typeof category.slug === 'string' ? { slug: category.slug } : {}),
      ...(category.parent_category_id ? { parentId: String(category.parent_category_id) } : {}),
      ...(topicCount !== undefined ? { topicCount } : {}),
      ...(category.read_restricted === true ? { readRestricted: true } : {})
    }];
  });
  return annotateSourceDiagnosticSummary({ items, errors: {} }, {
    parserVariant: 'xiaoyinsi-discourse-categories',
    candidateCount: categories.length,
    validCount: items.length,
    droppedCount: Math.max(0, categories.length - items.length)
  });
}

async function topicData(id: string, options: XiaoyinsiOptions) {
  return fetchXiaoyinsiJson<Record<string, unknown>>(
    `/t/${encodeURIComponent(id)}.json`,
    cleanCredentials(options.credentials) ? { include_raw: 1 } : undefined,
    options
  );
}

export async function getXiaoyinsiTopic(id: string, options: XiaoyinsiOptions & { replyLimit?: number } = {}): Promise<TopicDetail> {
  const data = await topicData(id, options);
  const posts = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
  const [firstPost, ...replyPosts] = posts;
  const categories = await categoryMapForTopics(data, [data], options);
  const normalized = normalizeTopic(data, categories, isRecord(firstPost) ? firstPost : undefined);
  if (!normalized) {
    throw new Error('小隐寺主题不存在');
  }
  const replyLimit = options.replyLimit || LIST_PAGE_SIZE;
  const initialReplyPosts = replyPosts.slice(0, replyLimit);
  const replies = initialReplyPosts
    .map((post, index) => normalizePost(post, index + 2, normalized.id))
    .filter((reply): reply is Reply => Boolean(reply));
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const polls = normalizePolls(firstPost);
  const first = isRecord(firstPost) ? firstPost : {};
  const details = isRecord(data.details) ? data.details : {};
  const liked = likedFromActions(first.actions_summary);
  const canLike = first.yours === true ? false : canLikeFromActions(first.actions_summary);
  const reactions = reactionSummary(first.reactions);
  const bookmarkId = positiveNumber(first.bookmark_id) || positiveNumber(data.bookmark_id);
  const totalPosts = stream.length || Number(data.posts_count || posts.length);
  const result: TopicDetail = {
    ...normalized,
    contentHtml: sanitizeXiaoyinsiContentHtml(first.cooked || '', polls),
    replies,
    replyHasMore: totalPosts > initialReplyPosts.length + 1,
    replyNextPage: totalPosts > initialReplyPosts.length + 1 ? 2 : null,
    replyNextOffset: totalPosts > initialReplyPosts.length + 1 ? initialReplyPosts.length : null,
    ...(details.can_create_post === true ? { canCreatePost: true } : {}),
    ...(positiveNumber(first.id) ? { commentId: positiveNumber(first.id) } : {}),
    ...(nonNegativeNumber(first.like_count) !== undefined ? { likeCount: nonNegativeNumber(first.like_count) } : {}),
    ...(liked !== undefined ? { liked } : {}),
    ...(canLike !== undefined ? { canLike } : {}),
    ...(bookmarkId ? { bookmarkId, bookmarked: true } : typeof data.bookmarked === 'boolean' ? { bookmarked: data.bookmarked } : {}),
    ...(polls ? { polls } : {}),
    ...(reactions ? { reactionSummary: reactions } : {})
  };
  return annotateSourceDiagnosticSummary(result, {
    parserVariant: 'xiaoyinsi-discourse-topic',
    candidateCount: posts.length,
    validCount: 1 + replies.length,
    droppedCount: Math.max(0, initialReplyPosts.length - replies.length),
    missingFloorCount: initialReplyPosts.filter((post) => isRecord(post) && !parsePositiveInteger(post.post_number)).length
  });
}

async function fetchPosts(id: string, postIds: unknown[], options: XiaoyinsiOptions) {
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(`/t/${encodeURIComponent(id)}/posts.json`, {
    'post_ids[]': postIds.map(String),
    ...(cleanCredentials(options.credentials) ? { include_raw: 1 } : {})
  }, options);
  return isRecord(data.post_stream) && Array.isArray(data.post_stream.posts) ? data.post_stream.posts : [];
}

export async function getXiaoyinsiReplies(id: string, options: XiaoyinsiOptions & {
  page?: number;
  limit?: number;
  offset?: number | null;
} = {}): Promise<RepliesResponse> {
  const page = options.page || 1;
  const limit = options.limit || LIST_PAGE_SIZE;
  const data = await topicData(id, options);
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const previousReplyCount = typeof options.offset === 'number' ? options.offset : Math.max(0, (page - 1) * limit);
  const start = 1 + previousReplyCount;
  const postIds = stream.slice(start, start + limit);
  if (!postIds.length) {
    return annotateSourceDiagnosticSummary({ items: [], hasMore: false, nextPage: null, totalCount: Math.max(0, stream.length - 1) }, {
      parserVariant: 'xiaoyinsi-discourse-replies', candidateCount: 0, validCount: 0, droppedCount: 0, isExpectedEmpty: true
    });
  }
  const posts = await fetchPosts(id, postIds, options);
  const items = posts.map((post, index) => normalizePost(post, previousReplyCount + index + 2, id))
    .filter((reply): reply is Reply => Boolean(reply));
  const hasMore = stream.length > start + postIds.length;
  return annotateSourceDiagnosticSummary({
    items,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    nextOffset: hasMore ? previousReplyCount + postIds.length : null,
    totalCount: Math.max(0, stream.length - 1)
  }, {
    parserVariant: 'xiaoyinsi-discourse-replies',
    candidateCount: posts.length,
    validCount: items.length,
    droppedCount: Math.max(0, posts.length - items.length)
  });
}

export async function getXiaoyinsiReply(id: string, floor: number, options: XiaoyinsiOptions = {}): Promise<Reply> {
  const data = await topicData(id, options);
  const embedded = isRecord(data.post_stream) && Array.isArray(data.post_stream.posts)
    ? data.post_stream.posts.find((post) => isRecord(post) && Number(post.post_number) === floor)
    : undefined;
  if (embedded) {
    const reply = normalizePost(embedded, floor, id);
    if (reply) {
      return reply;
    }
  }
  const stream = isRecord(data.post_stream) && Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
  const postId = stream[floor - 1];
  if (!postId) {
    throw new Error('引用楼层未找到');
  }
  const posts = await fetchPosts(id, [postId], options);
  const reply = normalizePost(posts.find((post) => isRecord(post) && Number(post.post_number) === floor), floor, id);
  if (!reply) {
    throw new Error('引用楼层未找到');
  }
  return reply;
}

async function topicsFromSearch(data: Record<string, unknown>, options: XiaoyinsiOptions) {
  const rawTopics = Array.isArray(data.topics) ? data.topics : [];
  const users = usersById(data.users);
  const postsByTopic = new Map<string, Record<string, unknown>>();
  (Array.isArray(data.posts) ? data.posts : []).filter(isRecord).forEach((post) => postsByTopic.set(String(post.topic_id), post));
  const categories = await categoryMapForTopics(data, rawTopics, options);
  const items: Topic[] = rawTopics.flatMap((raw): Topic[] => {
    if (!isRecord(raw)) {
      return [];
    }
    const post = postsByTopic.get(String(raw.id));
    const authorData = post || originalPoster(raw, users);
    const topic = normalizeTopic(raw, categories, authorData);
    return topic ? [{ ...topic, excerpt: textExcerpt(post?.blurb || topic.excerpt || '') }] : [];
  });
  const grouped = isRecord(data.grouped_search_result) ? data.grouped_search_result : {};
  return { items, hasMore: Boolean(grouped.more_full_page_results), options };
}

export async function searchXiaoyinsi(query: string, options: XiaoyinsiOptions & { page?: number; limit?: number } = {}): Promise<SearchResponse> {
  const cleanQuery = query.trim();
  const page = options.page || 1;
  const limit = options.limit || LIST_PAGE_SIZE;
  if (!cleanQuery) {
    return { items: [], errors: {}, hasMore: false, nextPage: null };
  }
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/search.json', { q: cleanQuery, page }, options);
  const parsed = await topicsFromSearch(data, options);
  const items = parsed.items.slice(0, limit);
  return annotateSourceDiagnosticSummary({ items, errors: {}, hasMore: parsed.hasMore, nextPage: parsed.hasMore ? page + 1 : null }, {
    parserVariant: 'xiaoyinsi-discourse-search',
    candidateCount: parsed.items.length,
    validCount: items.length,
    droppedCount: Math.max(0, parsed.items.length - items.length),
    isExpectedEmpty: parsed.items.length === 0
  });
}

export async function searchXiaoyinsiTags(options: XiaoyinsiOptions & {
  query?: string;
  categoryId?: string;
  selectedTags?: string[];
  limit?: number;
} = {}): Promise<LinuxDoTagOption[]> {
  const limit = Math.min(8, Math.max(1, Math.floor(options.limit || 8)));
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/tags/filter/search', {
    q: options.query?.trim() || '',
    ...(options.categoryId?.trim() ? { categoryId: options.categoryId.trim() } : {}),
    ...(options.selectedTags?.length ? { 'selected_tags[]': options.selectedTags } : {})
  }, options);
  const results = Array.isArray(data.results) ? data.results : [];
  const seen = new Set<string>();
  return results.filter(isRecord).flatMap((item) => {
    const name = String(item.name || item.id || '').trim();
    if (!name || seen.has(name)) {
      return [];
    }
    seen.add(name);
    const count = Number(item.count ?? item.topic_count);
    return [{ name, ...(Number.isInteger(count) && count >= 0 ? { topicCount: count } : {}) }];
  }).slice(0, limit);
}

export async function searchXiaoyinsiUsers(options: XiaoyinsiOptions & {
  term: string;
  categoryId?: string;
  limit?: number;
}): Promise<LinuxDoUserOption[]> {
  const term = options.term.trim();
  if (!term) {
    return [];
  }
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/u/search/users', {
    term,
    include_groups: 'false',
    limit: options.limit || 20,
    ...(options.categoryId?.trim() ? { category_id: options.categoryId.trim() } : {})
  }, options);
  const users = Array.isArray(data.users) ? data.users : [];
  return users.filter(isRecord).flatMap((user) => {
    const username = String(user.username || '').trim();
    if (!username) {
      return [];
    }
    return [{
      id: String(user.id || username),
      username,
      ...(String(user.name || '').trim() ? { displayName: String(user.name).trim() } : {}),
      ...(avatarUrl(user.avatar_template) ? { avatar: avatarUrl(user.avatar_template) } : {})
    }];
  });
}

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
    excerpt: textExcerpt(raw.excerpt || raw.content || '')
  };
}

export async function getXiaoyinsiUserProfile(id: string, username: string, options: XiaoyinsiOptions = {}): Promise<UserProfile> {
  const name = (username || id).trim();
  if (!name) {
    throw new Error('小隐寺用户信息不完整');
  }
  const cursorType = options.cursorType;
  const wantsTopics = cursorType !== 'replies';
  const wantsReplies = cursorType !== 'topics';
  const topicPage = cursorType === 'topics' ? parsePositiveInteger(options.cursor) || 0 : 0;
  const replyOffset = parsePositiveInteger(options.cursor) || 0;
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>(`/u/${encodeURIComponent(name)}/summary.json`, undefined, options);
  const summary = isRecord(data.user_summary) ? data.user_summary : {};
  const summaryUser = isRecord(summary.user) ? summary.user : {};
  const dataUser = isRecord(data.user) ? data.user : {};
  const listedUser = (Array.isArray(data.users) ? data.users : []).find((candidate) => (
    isRecord(candidate)
    && (String(candidate.username || '').toLowerCase() === name.toLowerCase() || String(candidate.id || '') === id)
  ));
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
    const actions = await fetchXiaoyinsiJson<Record<string, unknown>>('/user_actions.json', {
      offset: replyOffset,
      username: resolvedUsername,
      filter: 5
    }, options);
    rawActions = Array.isArray(actions.user_actions) ? actions.user_actions : [];
  }
  const categories = await categoryMapForTopics(topicData, [...rawTopics, ...rawActions], options);
  const topicUsers = usersById(topicData.users);
  const topics = rawTopics.map((raw) => isRecord(raw)
    ? normalizeTopic(raw, categories, originalPoster(raw, topicUsers) || user)
    : null).filter((item): item is Topic => Boolean(item));
  const replies = rawActions.map((action) => normalizeUserAction(action, resolvedUsername, categories))
    .filter((item): item is UserReplyActivity => Boolean(item));
  const trustLevel = levelLabel(user);
  return annotateSourceDiagnosticSummary({
    source: 'xiaoyinsi',
    id: resolvedUsername,
    username: resolvedUsername,
    displayName: typeof user.name === 'string' ? user.name : resolvedUsername,
    avatar: avatarUrl(user.avatar_template),
    url: userUrl(resolvedUsername),
    bio: typeof user.bio_raw === 'string' ? user.bio_raw : typeof user.bio_excerpt === 'string' ? user.bio_excerpt : undefined,
    topicCount: positiveNumber(summary.topic_count) || topics.length || undefined,
    replyCount: positiveNumber(summary.reply_count),
    postCount: positiveNumber(summary.post_count),
    ...(trustLevel ? { levelLabel: trustLevel } : {}),
    topics: sortTopicsByCreatedAt(topics),
    hasMoreTopics: Boolean(topicList.more_topics_url),
    nextTopicsCursor: topicList.more_topics_url ? String(topicPage + 1) : null,
    replies,
    hasMoreReplies: rawActions.length >= LIST_PAGE_SIZE,
    nextRepliesCursor: rawActions.length >= LIST_PAGE_SIZE ? String(replyOffset + LIST_PAGE_SIZE) : null
  }, {
    parserVariant: 'xiaoyinsi-discourse-user',
    candidateCount: 1 + rawTopics.length + rawActions.length,
    validCount: 1 + topics.length + replies.length,
    droppedCount: Math.max(0, rawTopics.length + rawActions.length - topics.length - replies.length)
  });
}

export async function getXiaoyinsiCurrentUserProfile(options: XiaoyinsiOptions = {}): Promise<UserProfile> {
  if (!cleanCredentials(options.credentials)) {
    throw new Error('请先授权小隐寺');
  }
  const data = await fetchXiaoyinsiJson<Record<string, unknown>>('/session/current.json', undefined, options);
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
  const listedUser = (Array.isArray(data.users) ? data.users : []).find((candidate) => (
    isRecord(candidate) && String(candidate.username || '').toLowerCase() === currentUser.username.toLowerCase()
  ));
  return buildDiscourseLevelProfileFromSummary({
    ...data.user_summary,
    username: currentUser.username,
    user: isRecord(listedUser) ? listedUser : {}
  });
}
