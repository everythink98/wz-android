import { categoryKey, topicKey, type ReaderData } from '@/domain/reader/readerData';
import type { Category, FeedResponse, FeedSource, Reply, SourceFeedFilter, Topic } from './models';
import { accessRequirementLevelValue, accessRequirementSpecificity, dateTime, sourceLabel } from './presentation';
import { sourceCatalog } from './sourceCatalog';

export type ReadingFilter = 'all' | 'unread' | 'read' | 'favorite';
export type SearchSort = 'relevance' | 'time';
export type LibraryTab = 'favorites' | 'users' | 'history';

export interface SearchExpression {
  include: string[];
  exclude: string[];
}

export function parseSearchExpression(query: string): SearchExpression {
  const include: string[] = [];
  const exclude: string[] = [];
  for (const part of query.trim().split(/\s+/).filter(Boolean)) {
    if (part.startsWith('-') && part.length > 1) {
      exclude.push(part.slice(1).toLowerCase());
    } else {
      include.push(part);
    }
  }
  return { include, exclude };
}

export function searchExpressionText(topic: Topic) {
  return `${topic.title} ${topic.excerpt || ''} ${topic.author || ''} ${topic.category || ''}`;
}

export function positiveSearchQuery(query: string) {
  const expression = parseSearchExpression(query);
  return expression.exclude.length ? expression.include.join(' ') : query;
}

export function applyFeedFilter(items: Topic[], data: ReaderData, filter: ReadingFilter) {
  if (filter === 'unread') {
    return items.filter((topic) => !data.history[topicKey(topic)]);
  }
  if (filter === 'read') {
    return items.filter((topic) => Boolean(data.history[topicKey(topic)]));
  }
  if (filter === 'favorite') {
    return items.filter((topic) => Boolean(data.favorites[topicKey(topic)]));
  }
  return items;
}

export function feedRequestKey(source: FeedSource, category = '', feedFilter?: SourceFeedFilter) {
  const base = `${source}:${category.trim()}`;
  return feedFilter && source !== 'all' && sourceCatalog[source].feedFilter !== 'none' ? `${base}:${feedFilter}` : base;
}

export function shouldReuseFeedStateForRequest(
  state: { items: Topic[]; loadingMore?: boolean; refreshing?: boolean; requestKey?: string },
  requestKey: string
) {
  return Boolean(state.items.length && state.requestKey === requestKey && !state.refreshing && !state.loadingMore);
}

export function sortTopicsByCreatedAt(items: Topic[]) {
  return [...items].sort((left, right) => dateTime(right.createdAt) - dateTime(left.createdAt));
}

function sortTopicsByActivity(items: Topic[]) {
  return [...items].sort(
    (left, right) => dateTime(right.lastReplyAt || right.createdAt) - dateTime(left.lastReplyAt || left.createdAt)
  );
}

function shouldUseIncomingAccessRequirement(current: Topic['accessRequirement'], incoming: Topic['accessRequirement']) {
  if (!incoming) {
    return false;
  }
  if (!current) {
    return true;
  }
  const currentSpecificity = accessRequirementSpecificity(current);
  const incomingSpecificity = accessRequirementSpecificity(incoming);
  if (incomingSpecificity > currentSpecificity) {
    return true;
  }
  if (incomingSpecificity < currentSpecificity) {
    return false;
  }
  if (current.type === 'level' && incoming.type === 'level') {
    const currentLevel = accessRequirementLevelValue(current);
    const incomingLevel = accessRequirementLevelValue(incoming);
    if (currentLevel !== incomingLevel) {
      if (!currentLevel) {
        return Boolean(incomingLevel);
      }
      if (!incomingLevel) {
        return false;
      }
      return incomingLevel > currentLevel;
    }
  }
  return current.label !== incoming.label || current.detail !== incoming.detail;
}

export function mergeTopics(current: Topic[], incoming: Topic[]) {
  const seen = new Set(current.map((topic) => topicKey(topic)));
  const seenExternalUrls = new Map<string, Topic>();
  for (const topic of current) {
    const urlKey = duplicateExternalUrlKey(topic);
    if (urlKey) {
      seenExternalUrls.set(urlKey, topic);
    }
  }
  const next = [...current];
  for (const topic of incoming) {
    const key = topicKey(topic);
    if (!seen.has(key)) {
      const urlKey = duplicateExternalUrlKey(topic);
      const existing = urlKey ? seenExternalUrls.get(urlKey) : undefined;
      if (existing && existing.source !== topic.source) {
        const updated = {
          ...existing,
          duplicateSources: Array.from(new Set([...(existing.duplicateSources || []), sourceLabel(topic.source)]))
        };
        seenExternalUrls.set(urlKey, updated);
        const index = next.indexOf(existing);
        if (index >= 0) {
          next[index] = updated;
        }
        seen.add(key);
        continue;
      }
      seen.add(key);
      if (urlKey) {
        seenExternalUrls.set(urlKey, topic);
      }
      next.push(topic);
    } else if (topic.accessRequirement) {
      const index = next.findIndex((item) => topicKey(item) === key);
      if (index >= 0 && shouldUseIncomingAccessRequirement(next[index].accessRequirement, topic.accessRequirement)) {
        next[index] = {
          ...next[index],
          accessRequirement: topic.accessRequirement
        };
      }
    }
  }
  return next;
}
function duplicateExternalUrlKey(topic: Topic) {
  const key = topic.url.trim().toLowerCase();
  if (!key || key.includes('/topic/') || key.includes('/t/')) {
    return '';
  }
  return key;
}

export function balanceTopicsBySource(items: Topic[]) {
  const order: Topic['source'][] = [];
  const buckets = new Map<Topic['source'], Topic[]>();
  for (const item of items) {
    const bucket = buckets.get(item.source);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(item.source, [item]);
      order.push(item.source);
    }
  }
  const balanced: Topic[] = [];
  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (const source of order) {
      const next = buckets.get(source)?.shift();
      if (next) {
        balanced.push(next);
        hasMore = true;
      }
    }
  }
  return balanced;
}

export function mergeFeedResponses(base: FeedResponse, extra: FeedResponse): FeedResponse {
  return {
    ...base,
    items: balanceTopicsBySource(sortTopicsByActivity(mergeTopics(base.items, extra.items))),
    errors: {
      ...(base.errors || {}),
      ...(extra.errors || {})
    },
    hasMore: Boolean(base.hasMore || extra.hasMore),
    nextPage: base.nextPage ?? extra.nextPage ?? null,
    nextCursor: base.nextCursor ?? extra.nextCursor ?? undefined
  };
}

export function nextFeedPageState(
  previous: { items: Topic[]; page: number; hasMore: boolean; nextCursor?: string },
  response: FeedResponse,
  { requestedPage, reset }: { requestedPage: number; reset: boolean }
) {
  const items = reset ? response.items : mergeTopics(previous.items, response.items);
  const failedLoadMore = !reset && Boolean(Object.keys(response.errors || {}).length);
  if (failedLoadMore) {
    return {
      items,
      page: previous.page,
      nextCursor: previous.nextCursor,
      hasMore: previous.hasMore
    };
  }
  const nextPage = response.nextPage ?? null;
  const nextCursor = response.nextCursor ?? undefined;
  const pageAdvanced = typeof nextPage === 'number' && nextPage > requestedPage;
  const cursorAdvanced = Boolean(nextCursor && (reset || nextCursor !== previous.nextCursor));
  return {
    items,
    page: pageAdvanced ? nextPage - 1 : requestedPage,
    nextCursor: cursorAdvanced || nextCursor === undefined ? nextCursor : previous.nextCursor,
    hasMore: Boolean(response.hasMore && (pageAdvanced || cursorAdvanced))
  };
}

export function mergeCategories(base: Category[], extra: Category[]) {
  const seen = new Set<string>();
  return [...base, ...extra].filter((category) => {
    const key = categoryKey(category);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function replyKey(reply: Reply) {
  if (typeof reply.commentId === 'number') {
    return `comment:${reply.commentId}`;
  }
  if (typeof reply.floor === 'number') {
    return `floor:${reply.floor}`;
  }
  return `body:${reply.author}:${reply.createdAt}:${reply.contentHtml.slice(0, 80)}`;
}

export type ReplyIdentity = Pick<Reply, 'commentId' | 'floor' | 'deletePath'>;

export function isSameReply(reply: Reply, target?: ReplyIdentity | null) {
  if (!target) {
    return false;
  }
  if (typeof target.commentId === 'number' && reply.commentId === target.commentId) {
    return true;
  }
  if (target.deletePath && reply.deletePath && reply.deletePath === target.deletePath) {
    return true;
  }
  return typeof target.floor === 'number' && reply.floor === target.floor;
}

export function removeReply(replies: Reply[], target?: ReplyIdentity | null) {
  return target ? replies.filter((reply) => !isSameReply(reply, target)) : replies;
}

export function mergeReplies(current: Reply[], incoming: Reply[]) {
  const next = [...current];
  const indexes = new Map<string, number>();
  next.forEach((reply, index) => {
    indexes.set(replyKey(reply), index);
  });
  for (const reply of incoming) {
    const key = replyKey(reply);
    const index = indexes.get(key);
    if (index === undefined) {
      indexes.set(key, next.length);
      next.push(reply);
    } else {
      next[index] = reply;
    }
  }
  return next;
}
