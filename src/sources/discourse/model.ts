import {
  decodeHtml,
  hasRenderableHtmlContent,
  isRecord,
  textContentFromHtml,
  textExcerpt,
  toIsoString
} from '@/domain/forum/html';
import { stripDiscourseCalloutMarkersFromExcerpt } from './content';
import type {
  Category,
  DiscourseTagOption,
  DiscourseUserOption,
  ReactionSummary,
  Reply,
  RepliesResponse,
  ReplyOrder,
  ReplyWindowPosition,
  Source,
  TopicPoll,
  TopicPollOption
} from '@/domain/forum/models';

export function discourseTagOptions(value: unknown): DiscourseTagOption[] {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : []).filter(isRecord).flatMap((item) => {
    const name = String(item.name || item.id || '').trim();
    if (!name || seen.has(name)) return [];
    seen.add(name);
    const count = Number(item.count ?? item.topic_count);
    return [{ name, ...(Number.isInteger(count) && count >= 0 ? { topicCount: count } : {}) }];
  });
}

export function discourseUserOptions(
  value: unknown,
  avatarUrl: (template: unknown) => string | undefined
): DiscourseUserOption[] {
  return (Array.isArray(value) ? value : []).filter(isRecord).flatMap((user) => {
    const username = String(user.username || '').trim();
    if (!username) return [];
    const avatar = avatarUrl(user.avatar_template);
    return [
      {
        id: String(user.id || username),
        username,
        ...(String(user.name || '').trim() ? { displayName: String(user.name).trim() } : {}),
        ...(avatar ? { avatar } : {})
      }
    ];
  });
}

export function discourseStreamReplyWindow(
  stream: unknown[],
  {
    limit,
    order,
    position
  }: {
    limit: number;
    order: ReplyOrder;
    position: Exclude<ReplyWindowPosition, { kind: 'target' }>;
  }
): Omit<RepliesResponse, 'items'> & { postIds: unknown[] } {
  const pageSize = Math.max(1, Math.floor(limit));
  const totalCount = Math.max(0, stream.length - 1);
  if (totalCount === 0) {
    return {
      postIds: [],
      completeness: 'complete',
      currentPage: 1,
      currentOffset: 0,
      previousPage: null,
      previousOffset: null,
      hasMore: false,
      nextPage: null,
      nextOffset: null,
      totalCount
    };
  }
  const currentOffsetValue =
    position.kind === 'cursor'
      ? position.offset
      : order === 'newest'
        ? Math.floor((totalCount - 1) / pageSize) * pageSize
        : 0;
  if (
    typeof currentOffsetValue !== 'number' ||
    !Number.isSafeInteger(currentOffsetValue) ||
    currentOffsetValue < 0 ||
    currentOffsetValue >= totalCount
  ) {
    throw new Error('Discourse 回复游标已失效');
  }
  const currentOffset = currentOffsetValue;
  const resolvedPage = Math.floor(currentOffset / pageSize) + 1;
  if (position.kind === 'cursor' && position.page !== resolvedPage) {
    throw new Error('Discourse 回复游标与页码不一致');
  }
  const currentPage = resolvedPage;
  const endOffset = Math.min(totalCount, currentOffset + pageSize);
  const olderOffset = currentOffset > 0 ? Math.max(0, currentOffset - pageSize) : null;
  const newerOffset = endOffset < totalCount ? endOffset : null;
  const olderPage = olderOffset === null ? null : Math.max(1, currentPage - 1);
  const newerPage = newerOffset === null ? null : currentPage + 1;
  return {
    postIds: stream.slice(1 + currentOffset, 1 + endOffset),
    completeness: 'complete',
    currentPage,
    currentOffset,
    previousPage: order === 'oldest' ? olderPage : newerPage,
    previousOffset: order === 'oldest' ? olderOffset : newerOffset,
    hasMore: order === 'oldest' ? newerOffset !== null : olderOffset !== null,
    nextPage: order === 'oldest' ? newerPage : olderPage,
    nextOffset: order === 'oldest' ? newerOffset : olderOffset,
    totalCount
  };
}

function discourseWindowDisplaySubset<T>(items: T[], postIds: unknown[], idFor: (item: T) => unknown) {
  const ids = postIds.map(String);
  const requested = new Set(ids);
  const byId = new Map<string, T>();
  if (requested.size !== ids.length) throw new Error('Discourse 回复窗口不完整');
  for (const item of items) {
    const rawId = idFor(item);
    const id = rawId === undefined || rawId === null ? '' : String(rawId);
    if (!id) continue;
    if (!requested.has(id)) throw new Error('Discourse 回复窗口不完整');
    if (byId.has(id)) throw new Error('Discourse 回复窗口不完整');
    byId.set(id, item);
  }
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

function validatedDiscourseFetchedWindow<T>(items: T[], postIds: unknown[], idFor: (item: T) => unknown) {
  const ordered = discourseWindowDisplaySubset(items, postIds, idFor);
  if (postIds.length > 0 && ordered.length === 0) throw new Error('Discourse 回复窗口不完整');
  return ordered;
}

export function discourseRepliesInStreamOrder(items: Reply[], postIds: unknown[], order: ReplyOrder) {
  const ordered = discourseWindowDisplaySubset(items, postIds, (item) => item.commentId);
  return order === 'newest' ? ordered.reverse() : ordered;
}

export function discourseVisiblePostIds(posts: unknown[], postIds: unknown[]) {
  return validatedDiscourseFetchedWindow(posts, postIds, (post) => (isRecord(post) ? post.id : null))
    .filter((post) => isRecord(post) && !post.deleted_at)
    .map((post) => String((post as Record<string, unknown>).id));
}

export function assertDiscourseTopicIdentity(data: unknown, id: string) {
  if (isRecord(data) && data.id !== undefined && data.id !== null && String(data.id) !== String(id)) {
    throw new Error('Discourse 主题身份不一致');
  }
}

export function discourseReplyWindow(data: unknown, limit: number) {
  const postStream = isRecord(data) && isRecord(data.post_stream) ? data.post_stream : {};
  const stream = Array.isArray(postStream.stream) ? postStream.stream : [];
  const posts = (Array.isArray(postStream.posts) ? postStream.posts : []).filter(
    (post) => isRecord(post) && (positiveInteger(post.post_number) || 0) > 1
  );
  const positions = posts
    .map((post) => {
      if (!isRecord(post)) return -1;
      const id = post.id;
      const streamIndex = stream.findIndex((streamId) => String(streamId) === String(id));
      if (streamIndex < 0) throw new Error('Discourse 锚点回复流已变化');
      return streamIndex;
    })
    .filter((index) => index > 0)
    .sort((left, right) => left - right);
  const firstIndex = positions[0] ?? 1;
  const lastIndex = positions.at(-1) ?? firstIndex;
  const pageSize = Math.max(1, limit);
  const currentOffset = Math.max(0, firstIndex - 1);
  const nextOffset = Math.max(currentOffset, lastIndex);
  const previousOffset = currentOffset > 0 ? Math.max(0, currentOffset - pageSize) : null;
  const hasMore = stream.length - 1 > nextOffset;
  return {
    posts,
    completeness: 'complete' as const,
    currentPage: Math.floor(currentOffset / pageSize) + 1,
    currentOffset,
    previousPage: previousOffset === null ? null : Math.floor(previousOffset / pageSize) + 1,
    previousOffset,
    hasMore,
    nextPage: hasMore ? Math.floor(nextOffset / pageSize) + 1 : null,
    nextOffset: hasMore ? nextOffset : null,
    totalCount: Math.max(0, stream.length - 1)
  };
}

export type DiscoursePostFields = Pick<Reply, 'author' | 'createdAt' | 'commentId' | 'floor'> & {
  cookedHtml: string;
} & Partial<
    Pick<
      Reply,
      | 'likeCount'
      | 'liked'
      | 'canLike'
      | 'canEdit'
      | 'canDelete'
      | 'contentMarkdown'
      | 'bookmarkId'
      | 'bookmarked'
      | 'replyTarget'
      | 'acceptedAnswer'
      | 'wiki'
      | 'hidden'
      | 'folded'
      | 'systemAction'
      | 'actionCode'
      | 'reactionSummary'
    >
  >;

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
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

function tagNames(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((tag) => {
      if (typeof tag === 'string') {
        return tag.trim();
      }
      return isRecord(tag) ? String(tag.name || tag.slug || '').trim() : '';
    })
    .filter(Boolean);
}

function acceptedAnswerFloor(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.accepted_answers)) {
    return undefined;
  }
  return positiveNumber(value.accepted_answers.find(isRecord)?.post_number);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function likeAction(value: unknown) {
  return Array.isArray(value) ? value.find((item) => isRecord(item) && Number(item.id) === 2) : undefined;
}

function reactionSummary(value: unknown): ReactionSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const reactions = value.filter(isRecord).flatMap((item): ReactionSummary[] => {
    const id = String(item.id || '').trim();
    const count = positiveNumber(item.count);
    return id && count ? [{ id, count }] : [];
  });
  return reactions.length ? reactions : undefined;
}

export function discourseUsersById(value: unknown) {
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

export function discourseOriginalPoster(topic: Record<string, unknown>, users: Map<string, Record<string, unknown>>) {
  const posters = Array.isArray(topic.posters) ? topic.posters : [];
  const poster =
    posters.find((item) => isRecord(item) && /original poster/i.test(String(item.description || ''))) ||
    posters.find(isRecord);
  return isRecord(poster) ? users.get(String(poster.user_id)) : undefined;
}

export function discourseCategories(
  data: unknown,
  source: Source,
  options: { includeParentSlug?: boolean } = {}
): Category[] {
  if (!isRecord(data)) {
    return [];
  }
  const categories = Array.isArray(data.categories)
    ? data.categories
    : isRecord(data.category_list) && Array.isArray(data.category_list.categories)
      ? data.category_list.categories
      : [];
  const records = categories.filter(isRecord);
  const slugs = new Map(records.map((category) => [String(category.id), String(category.slug || '')]));
  return records.flatMap((category): Category[] => {
    const id = String(category.id ?? '').trim();
    const name = String(category.name || '').trim();
    const slug = String(category.slug || '').trim();
    if (!id || !name || id === '1' || slug.toLowerCase() === 'uncategorized' || name === '未分类') {
      return [];
    }
    const parentId = category.parent_category_id ? String(category.parent_category_id) : undefined;
    const topicCount = nonNegativeNumber(category.topic_count);
    return [
      {
        source,
        id,
        name,
        ...(slug ? { slug } : {}),
        ...(parentId
          ? {
              parentId,
              ...(options.includeParentSlug && slugs.get(parentId) ? { parentSlug: slugs.get(parentId) } : {})
            }
          : {}),
        ...(topicCount === undefined ? {} : { topicCount }),
        ...(category.read_restricted === true ? { readRestricted: true } : {})
      }
    ];
  });
}

export function discoursePolls(post: unknown, options: { includeType?: boolean } = {}): TopicPoll[] | undefined {
  if (!isRecord(post) || !Array.isArray(post.polls)) {
    return undefined;
  }
  const votesByPoll = isRecord(post.polls_votes) ? post.polls_votes : {};
  const postId = positiveNumber(post.id);
  const polls = post.polls.filter(isRecord).flatMap((poll): TopicPoll[] => {
    const name = String(poll.name || '').trim();
    const selectedIds = new Set(stringArray(name ? votesByPoll[name] : undefined));
    const pollOptions = (Array.isArray(poll.options) ? poll.options : [])
      .filter(isRecord)
      .flatMap((option): TopicPollOption[] => {
        const id = String(option.id || '').trim();
        const label = textContentFromHtml(String(option.html || option.label || '')).trim();
        if (!id || !label) {
          return [];
        }
        const count = nonNegativeNumber(option.votes);
        return [{ id, label, ...(count !== undefined ? { count } : {}), selected: selectedIds.has(id) }];
      });
    if (!pollOptions.length) {
      return [];
    }
    const type = String(poll.type || '').trim();
    const readonly = type === 'ranked_choice' || type === 'number';
    const participantCount = nonNegativeNumber(poll.voters);
    const min = positiveNumber(poll.min);
    const max = positiveNumber(poll.max);
    return [
      {
        id: String(poll.id || name || '').trim() || undefined,
        name: name || undefined,
        postId: postId ? String(postId) : undefined,
        ...((options.includeType && type) || readonly ? { type } : {}),
        title: textContentFromHtml(String(poll.title || '')).trim() || undefined,
        multiple: type === 'multiple',
        voted: selectedIds.size > 0,
        closed:
          String(poll.status || '')
            .trim()
            .toLowerCase() === 'closed' || Boolean(poll.close && Date.parse(String(poll.close)) <= Date.now()),
        public: typeof poll.public === 'boolean' ? poll.public : undefined,
        ...(readonly ? { readonly: true } : {}),
        ...(participantCount !== undefined ? { participantCount } : {}),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        options: pollOptions
      }
    ];
  });
  return polls.length ? polls : undefined;
}

export function discoursePostFields(
  raw: unknown,
  options: { allowUserDeletedPlaceholder?: boolean } = {}
): DiscoursePostFields | null {
  if (!isRecord(raw)) {
    return null;
  }
  const cookedHtml = typeof raw.cooked === 'string' ? raw.cooked : '';
  const userDeletedPlaceholder =
    raw.user_deleted === true && options.allowUserDeletedPlaceholder === true && !raw.deleted_at;
  if (raw.deleted_at || (raw.user_deleted === true && !userDeletedPlaceholder)) {
    return null;
  }
  const action = likeAction(raw.actions_summary);
  const liked = isRecord(action) ? Boolean(action.acted) : undefined;
  const canLike =
    raw.yours === true ? false : isRecord(action) && typeof action.can_act === 'boolean' ? action.can_act : undefined;
  const commentId = positiveInteger(raw.id);
  const floor = positiveInteger(raw.post_number);
  const author = String(raw.username || '').trim();
  const createdAt = toIsoString(raw.created_at);
  const actionCode = String(raw.action_code || '').trim();
  if (
    !commentId &&
    !floor &&
    !author &&
    !actionCode &&
    !userDeletedPlaceholder &&
    !hasRenderableHtmlContent(cookedHtml)
  ) {
    return null;
  }
  const likeCount = nonNegativeNumber(raw.like_count);
  const contentMarkdown = typeof raw.raw === 'string' ? raw.raw : '';
  const bookmarkId = positiveNumber(raw.bookmark_id);
  const replyToUser = isRecord(raw.reply_to_user) ? raw.reply_to_user : undefined;
  const replyTargetUsername = String(replyToUser?.username || '').trim();
  const replyTargetAuthor = String(replyToUser?.name || replyTargetUsername).trim();
  const replyTargetFloor = positiveInteger(raw.reply_to_post_number);
  const replyTarget =
    replyTargetFloor || replyTargetAuthor
      ? {
          ...(replyTargetFloor ? { floor: replyTargetFloor } : {}),
          ...(replyTargetAuthor
            ? {
                author: {
                  name: replyTargetAuthor,
                  ...(replyTargetUsername ? { username: replyTargetUsername } : {})
                }
              }
            : {})
        }
      : undefined;
  const postType = Number(raw.post_type);
  const isSystemAction = Number.isFinite(postType) && postType !== 1;
  const reactions = reactionSummary(raw.reactions);
  return {
    author,
    cookedHtml,
    createdAt,
    commentId,
    floor,
    ...(likeCount === undefined ? {} : { likeCount }),
    ...(liked === undefined ? {} : { liked }),
    ...(canLike === undefined ? {} : { canLike }),
    ...(raw.can_edit === true ? { canEdit: true } : {}),
    ...(typeof raw.can_delete === 'boolean' ? { canDelete: raw.can_delete } : {}),
    ...(contentMarkdown ? { contentMarkdown } : {}),
    ...(bookmarkId
      ? { bookmarkId, bookmarked: true }
      : typeof raw.bookmarked === 'boolean'
        ? { bookmarked: raw.bookmarked }
        : {}),
    ...(replyTarget ? { replyTarget } : {}),
    ...(raw.accepted_answer === true ? { acceptedAnswer: true } : {}),
    ...(raw.wiki === true ? { wiki: true } : {}),
    ...(raw.hidden === true ? { hidden: true } : {}),
    ...(raw.post_folding_status ? { folded: true } : {}),
    ...(isSystemAction ? { systemAction: true } : {}),
    ...(actionCode ? { actionCode } : {}),
    ...(reactions ? { reactionSummary: reactions } : {})
  };
}

export function discourseTopicFields(raw: unknown) {
  if (!isRecord(raw)) {
    return null;
  }
  const id = topicId(raw.id);
  const title = decodeHtml(raw.unicode_title || raw.title || '').trim();
  const createdAt = toIsoString(raw.created_at);
  const postCount = positiveInteger(raw.posts_count);
  if (!id || !title || !createdAt || !postCount) {
    return null;
  }
  const lastReplyAt = toIsoString(raw.bumped_at || raw.last_posted_at) || createdAt;
  const viewCount = nonNegativeNumber(raw.views);
  const categoryId = raw.category_id === undefined || raw.category_id === null ? undefined : String(raw.category_id);
  const tags = tagNames(raw.tags);
  const acceptedAnswerPostNumber = acceptedAnswerFloor(raw);
  const slowModeSeconds = positiveNumber(raw.slow_mode_seconds);
  return {
    id,
    title,
    categoryId,
    createdAt,
    lastReplyAt,
    replyCount: postCount - 1,
    ...(viewCount === undefined ? {} : { viewCount }),
    excerpt: textExcerpt(stripDiscourseCalloutMarkersFromExcerpt(raw.excerpt || '')),
    ...(tags.length ? { tags } : {}),
    ...(raw.closed === true ? { closed: true } : {}),
    ...(raw.archived === true ? { archived: true } : {}),
    ...(raw.pinned === true || raw.pinned_globally === true ? { pinned: true } : {}),
    ...(raw.has_accepted_answer === true || acceptedAnswerPostNumber ? { solved: true } : {}),
    ...(acceptedAnswerPostNumber ? { acceptedAnswerFloor: acceptedAnswerPostNumber } : {}),
    ...(slowModeSeconds ? { slowModeSeconds } : {})
  };
}
