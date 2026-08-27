export type TopicActionCapability =
  'reply' | 'like' | 'bookmark' | 'edit' | 'delete' | 'vote' | 'manage-poll' | 'upload' | 'pay';

export const sourceCatalog = {
  v2ex: {
    aggregateFeed: true,
    aggregateSearch: true,
    baseUrl: 'https://www.v2ex.com',
    label: 'V2EX',
    family: 'v2ex',
    feedFilter: 'v2ex',
    managedSession: false,
    notifications: false,
    searchFilter: 'v2ex',
    topicActions: [],
    searchOrder: 1,
    sortOrder: 3
  },
  linuxdo: {
    aggregateFeed: true,
    aggregateSearch: true,
    baseUrl: 'https://linux.do',
    label: 'linux.do',
    family: 'discourse',
    feedFilter: 'discourse',
    managedSession: true,
    notifications: true,
    searchFilter: 'discourse',
    topicActions: ['reply', 'like', 'bookmark', 'edit', 'delete', 'vote', 'upload'],
    searchOrder: 2,
    sortOrder: 2
  },
  nodeseek: {
    aggregateFeed: true,
    aggregateSearch: true,
    baseUrl: 'https://www.nodeseek.com',
    label: 'NodeSeek',
    family: 'nodeseek',
    feedFilter: 'nodeseek',
    managedSession: true,
    notifications: true,
    searchFilter: 'nodeseek',
    topicActions: ['reply', 'like', 'bookmark', 'edit', 'vote', 'manage-poll', 'upload', 'pay'],
    searchOrder: 3,
    sortOrder: 1
  },
  yaohuo: {
    aggregateFeed: true,
    aggregateSearch: true,
    baseUrl: 'https://www.yaohuo.me',
    label: '妖火',
    family: 'yaohuo',
    feedFilter: 'none',
    managedSession: true,
    notifications: true,
    searchFilter: 'yaohuo',
    topicActions: ['reply', 'bookmark', 'delete', 'vote', 'upload'],
    searchOrder: 4,
    sortOrder: 4
  }
} as const;

const nodeSeekRootHost = new URL(sourceCatalog.nodeseek.baseUrl).hostname.toLowerCase().replace(/^www\./, '');

export type Source = keyof typeof sourceCatalog;
export type DiscourseSource = {
  [Site in Source]: (typeof sourceCatalog)[Site]['family'] extends 'discourse' ? Site : never;
}[Source];
export type FeedFilterSource = {
  [Site in Source]: (typeof sourceCatalog)[Site]['feedFilter'] extends 'none' ? never : Site;
}[Source];
export type SessionSource = {
  [Site in Source]: (typeof sourceCatalog)[Site]['managedSession'] extends true ? Site : never;
}[Source];
export type NotificationSource = {
  [Site in Source]: (typeof sourceCatalog)[Site]['notifications'] extends true ? Site : never;
}[Source];

export const sourceValues = (Object.keys(sourceCatalog) as Source[]).sort(
  (left, right) => sourceCatalog[left].sortOrder - sourceCatalog[right].sortOrder
);

export const aggregateFeedSources = sourceValues.filter((source) => sourceCatalog[source].aggregateFeed);

export const aggregateSearchSources = sourceValues
  .filter((source) => sourceCatalog[source].aggregateSearch)
  .sort((left, right) => sourceCatalog[left].searchOrder - sourceCatalog[right].searchOrder);

export const sessionSources = sourceValues.filter(
  (source): source is SessionSource => sourceCatalog[source].managedSession
);

export const notificationSources = sourceValues.filter(
  (source): source is NotificationSource => sourceCatalog[source].notifications
);

export function isDiscourseSource(source: Source | null | undefined): source is DiscourseSource {
  return Boolean(source && sourceCatalog[source].family === 'discourse');
}

export function isFeedFilterSource(source: Source | null | undefined): source is FeedFilterSource {
  return Boolean(source && sourceCatalog[source].feedFilter !== 'none');
}

export function isSessionSource(source: Source | null | undefined): source is SessionSource {
  return Boolean(source && sourceCatalog[source].managedSession);
}

export function isNotificationSource(source: Source | null | undefined): source is NotificationSource {
  return Boolean(source && sourceCatalog[source].notifications);
}

export function isNodeSeekHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === nodeSeekRootHost || host.endsWith(`.${nodeSeekRootHost}`);
}

export function sourceSupportsTopicAction(source: Source | null | undefined, action: TopicActionCapability) {
  return Boolean(source && (sourceCatalog[source].topicActions as readonly TopicActionCapability[]).includes(action));
}
