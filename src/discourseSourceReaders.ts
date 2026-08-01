import {
  getLinuxDoCategories,
  getLinuxDoCurrentUserProfile,
  getLinuxDoEmojiUrls,
  getLinuxDoFeed,
  getLinuxDoReplies,
  getLinuxDoReply,
  getLinuxDoTopic,
  getLinuxDoUserProfile,
  searchLinuxDo,
  searchLinuxDoTags,
  searchLinuxDoUsers
} from '@/localLinuxdo';
import {
  getXiaoyinsiCategories,
  getXiaoyinsiCurrentUserProfile,
  getXiaoyinsiEmojiUrls,
  getXiaoyinsiFeed,
  getXiaoyinsiReplies,
  getXiaoyinsiReply,
  getXiaoyinsiTopic,
  getXiaoyinsiUserProfile,
  searchXiaoyinsi,
  searchXiaoyinsiTags,
  searchXiaoyinsiUsers,
  type XiaoyinsiApiCredentials
} from '@/localXiaoyinsi';
import type { Fetcher } from '@/platform/network/request';
import type { DiscourseEmojiUrlMap } from '@/discourseReactions';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import type {
  CategoriesResponse,
  DiscourseFeedFilter,
  DiscourseTagOption,
  DiscourseUserOption,
  FeedResponse,
  Reply,
  RepliesResponse,
  SearchResponse,
  TopicDetail,
  UserProfile
} from '@/domain/forum/models';

export interface DiscourseReadAuthMap {
  linuxdo: {
    authenticated?: boolean;
    userAgent?: string;
  };
  xiaoyinsi: XiaoyinsiApiCredentials;
}

export type DiscourseReadAuth = Partial<{
  [Site in DiscourseSource]: DiscourseReadAuthMap[Site];
}>;

type DiscourseReadOptions = {
  auth?: DiscourseReadAuth;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type DiscourseFeedReadOptions = DiscourseReadOptions & {
  category?: string;
  filter?: DiscourseFeedFilter;
  limit?: number;
  page?: number;
};

export type DiscourseTopicReadOptions = DiscourseReadOptions & { replyLimit?: number };

export type DiscourseRepliesReadOptions = DiscourseReadOptions & {
  limit?: number;
  offset?: number | null;
  page?: number;
};

export type DiscourseUserReadOptions = DiscourseReadOptions & {
  cursor?: string | null;
  cursorType?: 'topics' | 'replies';
};

export type DiscourseSearchReadOptions = DiscourseReadOptions & {
  authenticated?: boolean;
  limit?: number;
  page?: number;
};

export type DiscourseTagOptionReadOptions = DiscourseReadOptions & {
  categoryId?: string;
  limit?: number;
  query?: string;
  selectedTags?: string[];
};

export type DiscourseUserOptionReadOptions = DiscourseReadOptions & {
  categoryId?: string;
  limit?: number;
  term: string;
};

type DiscourseSourceReader = {
  getCategories: (options: DiscourseReadOptions) => Promise<CategoriesResponse>;
  getCurrentUserProfile: (options: DiscourseReadOptions) => Promise<UserProfile>;
  getEmojiUrls: (options: DiscourseReadOptions) => Promise<DiscourseEmojiUrlMap>;
  getFeed: (options: DiscourseFeedReadOptions) => Promise<FeedResponse>;
  getReplies: (id: string, options: DiscourseRepliesReadOptions) => Promise<RepliesResponse>;
  getReply: (id: string, floor: number, options: DiscourseReadOptions) => Promise<Reply>;
  getTopic: (id: string, options: DiscourseTopicReadOptions) => Promise<TopicDetail>;
  getUserProfile: (id: string, username: string, options: DiscourseUserReadOptions) => Promise<UserProfile>;
  searchTagOptions: (options: DiscourseTagOptionReadOptions) => Promise<DiscourseTagOption[]>;
  searchTopics: (query: string, options: DiscourseSearchReadOptions) => Promise<SearchResponse>;
  searchUserOptions: (options: DiscourseUserOptionReadOptions) => Promise<DiscourseUserOption[]>;
};

function withLinuxDoAuth<T extends DiscourseReadOptions>(
  options: T
): Omit<T, 'auth'> & {
  linuxDoAccess?: DiscourseReadAuthMap['linuxdo'];
} {
  const { auth, ...requestOptions } = options;
  return {
    ...requestOptions,
    ...(auth?.linuxdo ? { linuxDoAccess: auth.linuxdo } : {})
  };
}

function withXiaoyinsiAuth<T extends DiscourseReadOptions>(
  options: T
): Omit<T, 'auth'> & {
  credentials?: XiaoyinsiApiCredentials;
} {
  const { auth, ...requestOptions } = options;
  return {
    ...requestOptions,
    credentials: auth?.xiaoyinsi
  };
}

const discourseSourceReaders = {
  linuxdo: {
    getCategories: (options) => getLinuxDoCategories(withLinuxDoAuth(options)),
    getCurrentUserProfile: ({ auth, ...options }) => {
      const linuxDoAuth = auth?.linuxdo;
      return getLinuxDoCurrentUserProfile({
        ...options,
        linuxDoUserAgent: linuxDoAuth?.userAgent
      });
    },
    getEmojiUrls: (options) => getLinuxDoEmojiUrls(withLinuxDoAuth(options)),
    getFeed: ({ filter, ...options }) =>
      getLinuxDoFeed({
        ...withLinuxDoAuth(options),
        linuxDoFilter: filter
      }),
    getReplies: (id, options) => getLinuxDoReplies(id, withLinuxDoAuth(options)),
    getReply: (id, floor, options) => getLinuxDoReply(id, floor, withLinuxDoAuth(options)),
    getTopic: (id, options) => getLinuxDoTopic(id, withLinuxDoAuth(options)),
    getUserProfile: (id, username, options) => getLinuxDoUserProfile(id, username, withLinuxDoAuth(options)),
    searchTagOptions: (options) => searchLinuxDoTags(withLinuxDoAuth(options)),
    searchTopics: (query, options) => searchLinuxDo(query, withLinuxDoAuth(options)),
    searchUserOptions: (options) => searchLinuxDoUsers(withLinuxDoAuth(options))
  },
  xiaoyinsi: {
    getCategories: (options) => getXiaoyinsiCategories(withXiaoyinsiAuth(options)),
    getCurrentUserProfile: (options) => getXiaoyinsiCurrentUserProfile(withXiaoyinsiAuth(options)),
    getEmojiUrls: (options) => getXiaoyinsiEmojiUrls(withXiaoyinsiAuth(options)),
    getFeed: ({ filter, ...options }) =>
      getXiaoyinsiFeed({
        ...withXiaoyinsiAuth(options),
        feedFilter: filter
      }),
    getReplies: (id, options) => getXiaoyinsiReplies(id, withXiaoyinsiAuth(options)),
    getReply: (id, floor, options) => getXiaoyinsiReply(id, floor, withXiaoyinsiAuth(options)),
    getTopic: (id, options) => getXiaoyinsiTopic(id, withXiaoyinsiAuth(options)),
    getUserProfile: (id, username, options) => getXiaoyinsiUserProfile(id, username, withXiaoyinsiAuth(options)),
    searchTagOptions: (options) => searchXiaoyinsiTags(withXiaoyinsiAuth(options)),
    searchTopics: (query, options) => searchXiaoyinsi(query, withXiaoyinsiAuth(options)),
    searchUserOptions: (options) => searchXiaoyinsiUsers(withXiaoyinsiAuth(options))
  }
} satisfies Record<DiscourseSource, DiscourseSourceReader>;

export const discourseReaderSources = Object.keys(discourseSourceReaders) as DiscourseSource[];

export function getDiscourseSourceFeed(source: DiscourseSource, options: DiscourseFeedReadOptions) {
  return discourseSourceReaders[source].getFeed(options);
}

export function getDiscourseSourceCategories(source: DiscourseSource, options: DiscourseReadOptions) {
  return discourseSourceReaders[source].getCategories(options);
}

export function getDiscourseSourceTopic(source: DiscourseSource, id: string, options: DiscourseTopicReadOptions) {
  return discourseSourceReaders[source].getTopic(id, options);
}

export function getDiscourseSourceReplies(source: DiscourseSource, id: string, options: DiscourseRepliesReadOptions) {
  return discourseSourceReaders[source].getReplies(id, options);
}

export function getDiscourseSourceReply(
  source: DiscourseSource,
  id: string,
  floor: number,
  options: DiscourseReadOptions
) {
  return discourseSourceReaders[source].getReply(id, floor, options);
}

export function getDiscourseSourceUserProfile(
  source: DiscourseSource,
  id: string,
  username: string,
  options: DiscourseUserReadOptions
) {
  return discourseSourceReaders[source].getUserProfile(id, username, options);
}

export function getDiscourseSourceCurrentUserProfile(source: DiscourseSource, options: DiscourseReadOptions) {
  return discourseSourceReaders[source].getCurrentUserProfile(options);
}

export function getDiscourseSourceEmojiUrls(source: DiscourseSource, options: DiscourseReadOptions = {}) {
  return discourseSourceReaders[source].getEmojiUrls(options);
}

export function searchDiscourseSourceTopics(
  source: DiscourseSource,
  query: string,
  options: DiscourseSearchReadOptions
) {
  return discourseSourceReaders[source].searchTopics(query, options);
}

export function searchDiscourseSourceTagOptions(source: DiscourseSource, options: DiscourseTagOptionReadOptions) {
  return discourseSourceReaders[source].searchTagOptions(options);
}

export function searchDiscourseSourceUserOptions(source: DiscourseSource, options: DiscourseUserOptionReadOptions) {
  return discourseSourceReaders[source].searchUserOptions(options);
}
