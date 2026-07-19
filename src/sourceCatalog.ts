export type TopicActionCapability =
  | 'reply'
  | 'like'
  | 'bookmark'
  | 'edit'
  | 'delete'
  | 'vote'
  | 'upload';

export const sourceCatalog = {
  v2ex: {
    aggregateFeed: true,
    aggregateSearch: true,
    baseUrl: 'https://www.v2ex.com',
    label: 'V2EX',
    family: 'v2ex',
    feedFilter: 'v2ex',
    searchFilter: 'v2ex',
    topicActions: [],
    replyPermission: 'session',
    sortOrder: 3
  },
  linuxdo: {
    aggregateFeed: true,
    aggregateSearch: true,
    baseUrl: 'https://linux.do',
    label: 'linux.do',
    family: 'discourse',
    feedFilter: 'discourse',
    searchFilter: 'discourse',
    topicActions: ['reply', 'like', 'bookmark', 'edit', 'delete', 'vote', 'upload'],
    replyPermission: 'session',
    sortOrder: 2
  },
  nodeseek: {
    aggregateFeed: true,
    aggregateSearch: true,
    baseUrl: 'https://www.nodeseek.com',
    label: 'NodeSeek',
    family: 'nodeseek',
    feedFilter: 'nodeseek',
    searchFilter: 'nodeseek',
    topicActions: ['reply', 'like', 'bookmark', 'edit', 'delete', 'vote', 'upload'],
    replyPermission: 'session',
    sortOrder: 1
  },
  yaohuo: {
    aggregateFeed: true,
    aggregateSearch: true,
    baseUrl: 'https://www.yaohuo.me',
    label: '妖火',
    family: 'yaohuo',
    feedFilter: 'none',
    searchFilter: 'yaohuo',
    topicActions: ['reply', 'bookmark', 'delete', 'vote', 'upload'],
    replyPermission: 'session',
    sortOrder: 4
  },
  xiaoyinsi: {
    aggregateFeed: true,
    aggregateSearch: true,
    baseUrl: 'https://forum.xiaoyinsi.com',
    label: '小隐寺',
    family: 'discourse',
    feedFilter: 'discourse',
    searchFilter: 'discourse',
    topicActions: ['reply', 'like', 'bookmark', 'edit', 'delete', 'vote', 'upload'],
    replyPermission: 'topic',
    sortOrder: 5
  }
} as const;

export type Source = keyof typeof sourceCatalog;
export type SourceFamily = typeof sourceCatalog[Source]['family'];
export type DiscourseSource = {
  [Site in Source]: typeof sourceCatalog[Site]['family'] extends 'discourse' ? Site : never
}[Source];
export type FeedFilterSource = {
  [Site in Source]: typeof sourceCatalog[Site]['feedFilter'] extends 'none' ? never : Site
}[Source];
export type SessionSource = {
  [Site in Source]: typeof sourceCatalog[Site]['topicActions']['length'] extends 0 ? never : Site
}[Source];

export const sourceValues = (Object.keys(sourceCatalog) as Source[])
  .sort((left, right) => sourceCatalog[left].sortOrder - sourceCatalog[right].sortOrder);

export const aggregateFeedSources = sourceValues
  .filter((source) => sourceCatalog[source].aggregateFeed);

export const aggregateSearchSources = sourceValues
  .filter((source) => sourceCatalog[source].aggregateSearch);

export const sessionSources = sourceValues
  .filter((source): source is SessionSource => sourceCatalog[source].topicActions.length > 0);

export function isDiscourseSource(source: Source | null | undefined): source is DiscourseSource {
  return Boolean(source && sourceCatalog[source].family === 'discourse');
}

export function isFeedFilterSource(source: Source | null | undefined): source is FeedFilterSource {
  return Boolean(source && sourceCatalog[source].feedFilter !== 'none');
}

export function isSessionSource(source: Source | null | undefined): source is SessionSource {
  return Boolean(source && sourceCatalog[source].topicActions.length > 0);
}

export function sourceSupportsTopicAction(
  source: Source | null | undefined,
  action: TopicActionCapability
) {
  return Boolean(source && (sourceCatalog[source].topicActions as readonly TopicActionCapability[]).includes(action));
}

export function sourceUsesTopicCreatePermission(source: Source | null | undefined) {
  return Boolean(source && sourceCatalog[source].replyPermission === 'topic');
}
