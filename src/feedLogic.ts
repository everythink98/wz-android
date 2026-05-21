import { categoryKey, topicKey, type ReaderData } from './readerData';
import type { Category, FeedResponse, FeedSource, Reply, SearchResponse, Topic } from './types';
import { dateTime, errorMessage, isCanceledRequest } from './appUtils';

export { dateTime } from './appUtils';
export type ReadingFilter = 'all' | 'unread' | 'read' | 'favorite' | 'subscribed' | 'active' | 'hot';
export type SearchSort = 'relevance' | 'time' | 'reply' | 'view';
export type LibraryTab = 'favorites' | 'history';

export function applyFeedFilter(items: Topic[], data: ReaderData, filter: ReadingFilter) {
  const visible = items.filter((topic) => {
    const text = topicText(topic);
    const category = topic.category ? `${topic.source}:${topic.category.replace(/^#/, '')}`.toLowerCase() : '';
    return !includesAnyKeyword(text, data.settings.blockedKeywords)
      && !data.settings.blockedUsers.some((user) => topic.author?.toLowerCase() === user.toLowerCase())
      && !data.settings.blockedCategories.some((blocked) => blocked.toLowerCase() === category);
  });

  if (filter === 'unread') {
    return visible.filter((topic) => !data.history[topicKey(topic)]);
  }
  if (filter === 'read') {
    return visible.filter((topic) => Boolean(data.history[topicKey(topic)]));
  }
  if (filter === 'favorite') {
    return visible.filter((topic) => Boolean(data.favorites[topicKey(topic)]));
  }
  if (filter === 'subscribed') {
    return visible.filter((topic) => topic.category && Object.values(data.subscriptions).some((subscription) => (
      subscription.source === topic.source
      && [subscription.id, subscription.name].includes(topic.category!.replace(/^#/, ''))
    )));
  }
  if (filter === 'active') {
    return [...visible].sort((left, right) => dateTime(right.lastReplyAt || right.createdAt) - dateTime(left.lastReplyAt || left.createdAt));
  }
  if (filter === 'hot') {
    return [...visible].sort((left, right) => (right.replyCount + (right.viewCount || 0) / 100) - (left.replyCount + (left.viewCount || 0) / 100));
  }
  return visible;
}

export function searchLocal(data: ReaderData, query: string, source: FeedSource) {
  const records = [
    ...Object.values(data.favorites),
    ...Object.values(data.history)
  ];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  return records
    .filter((record) => {
      const topic = record.topic;
      const key = topicKey(topic);
      if (seen.has(key) || (source !== 'all' && topic.source !== source)) {
        return false;
      }
      const text = `${topic.title} ${topic.excerpt || ''} ${topic.author || ''} ${topic.category || ''} ${record.tags?.join(' ') || ''} ${record.note || ''}`.toLowerCase();
      const matched = terms.every((term) => text.includes(term));
      if (matched) {
        seen.add(key);
      }
      return matched;
    })
    .map((record) => record.topic);
}

export function sortTopics(items: Topic[], sort: SearchSort) {
  if (sort === 'reply') {
    return [...items].sort((left, right) => right.replyCount - left.replyCount);
  }
  if (sort === 'view') {
    return [...items].sort((left, right) => (right.viewCount || 0) - (left.viewCount || 0));
  }
  if (sort === 'time') {
    return [...items].sort((left, right) => dateTime(right.lastReplyAt || right.createdAt) - dateTime(left.lastReplyAt || left.createdAt));
  }
  return items;
}

export function sortTopicsByActivity(items: Topic[]) {
  return [...items].sort((left, right) => dateTime(right.lastReplyAt || right.createdAt) - dateTime(left.lastReplyAt || left.createdAt));
}

export function mergeTopics(current: Topic[], incoming: Topic[]) {
  const seen = new Set(current.map((topic) => topicKey(topic)));
  const next = [...current];
  for (const topic of incoming) {
    const key = topicKey(topic);
    if (!seen.has(key)) {
      seen.add(key);
      next.push(topic);
    }
  }
  return next;
}

export function mergeFeedResponses(base: FeedResponse, extra: FeedResponse): FeedResponse {
  return {
    ...base,
    items: sortTopicsByActivity(mergeTopics(base.items, extra.items)),
    errors: {
      ...(base.errors || {}),
      ...(extra.errors || {})
    },
    hasMore: Boolean(base.hasMore || extra.hasMore),
    nextPage: base.nextPage ?? extra.nextPage ?? null,
    nextCursor: base.nextCursor ?? undefined
  };
}

export function mergeSearchResponses(base: SearchResponse, extra: SearchResponse): SearchResponse {
  return {
    items: sortTopicsByActivity(mergeTopics(base.items, extra.items)),
    errors: {
      ...(base.errors || {}),
      ...(extra.errors || {})
    }
  };
}

export function mergeSettledFeedResponses(
  base: PromiseSettledResult<FeedResponse>,
  extra: PromiseSettledResult<FeedResponse>
): FeedResponse {
  if (base.status === 'rejected' && isCanceledRequest(base.reason)) {
    throw base.reason;
  }
  if (extra.status === 'rejected' && isCanceledRequest(extra.reason)) {
    throw extra.reason;
  }
  if (base.status === 'rejected' && extra.status === 'rejected') {
    throw base.reason;
  }
  const baseData = base.status === 'fulfilled'
    ? base.value
    : { items: [], errors: { all: errorMessage(base.reason) } };
  const extraData = extra.status === 'fulfilled'
    ? extra.value
    : { items: [], errors: { yaohuo: errorMessage(extra.reason) } };
  return mergeFeedResponses(baseData, extraData);
}

export function mergeSettledSearchResponses(
  base: PromiseSettledResult<SearchResponse>,
  extra: PromiseSettledResult<SearchResponse>
): SearchResponse {
  if (base.status === 'rejected' && isCanceledRequest(base.reason)) {
    throw base.reason;
  }
  if (extra.status === 'rejected' && isCanceledRequest(extra.reason)) {
    throw extra.reason;
  }
  if (base.status === 'rejected' && extra.status === 'rejected') {
    throw base.reason;
  }
  const baseData = base.status === 'fulfilled'
    ? base.value
    : { items: [], errors: { all: errorMessage(base.reason) } };
  const extraData = extra.status === 'fulfilled'
    ? extra.value
    : { items: [], errors: { yaohuo: errorMessage(extra.reason) } };
  return mergeSearchResponses(baseData, extraData);
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

export function mergeReplies(current: Reply[], incoming: Reply[]) {
  const seen = new Set(current.map((reply) => replyKey(reply)));
  const next = [...current];
  for (const reply of incoming) {
    const key = replyKey(reply);
    if (!seen.has(key)) {
      seen.add(key);
      next.push(reply);
    }
  }
  return next;
}

export function recordsToTopics(records: Record<string, { topic: Topic; savedAt: string }>) {
  return Object.values(records)
    .sort((left, right) => dateTime(right.savedAt) - dateTime(left.savedAt))
    .map((record) => record.topic);
}

export function removeRecord(data: ReaderData, section: LibraryTab, topic: Topic) {
  const key = topicKey(topic);
  const next = { ...data[section] };
  delete next[key];
  return {
    ...data,
    [section]: next,
    deletedRecords: {
      ...data.deletedRecords,
      [section]: {
        ...data.deletedRecords[section],
        [key]: new Date().toISOString()
      }
    }
  };
}

export function topicText(topic: Topic) {
  return `${topic.title} ${topic.excerpt || ''} ${topic.author || ''} ${topic.category || ''}`.toLowerCase();
}

export function includesAnyKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}
