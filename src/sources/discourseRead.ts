import {
  getLinuxDoCategories,
  getLinuxDoEmojiUrls,
  getLinuxDoFeed,
  getLinuxDoReplies,
  getLinuxDoReply,
  getLinuxDoTopic
} from '@/sources/linuxdo/reader';
import { getLinuxDoCurrentUserProfile, getLinuxDoUserProfile } from '@/sources/linuxdo/account';
import { searchLinuxDo, searchLinuxDoTags, searchLinuxDoUsers } from '@/sources/linuxdo/search';
import type { Fetcher } from '@/platform/network/request';
import type { DiscourseFeedFilter, ReplyOrder, ReplyWindowPosition } from '@/domain/forum/models';

export type DiscourseReadAuth = {
  authenticated?: boolean;
  categoryCacheScope?: string;
  userAgent?: string;
};

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

export type DiscourseTopicReadOptions = DiscourseReadOptions & { replyLimit?: number; trackVisit?: boolean };

export type DiscourseRepliesReadOptions = DiscourseReadOptions & {
  limit?: number;
  order: ReplyOrder;
  position: ReplyWindowPosition;
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

function withLinuxDoAuth<T extends DiscourseReadOptions>(options: T) {
  const { auth, ...requestOptions } = options;
  return {
    ...requestOptions,
    ...(auth?.categoryCacheScope ? { categoryCacheScope: auth.categoryCacheScope } : {}),
    ...(auth
      ? {
          linuxDoAccess: {
            authenticated: auth.authenticated,
            userAgent: auth.userAgent
          }
        }
      : {})
  };
}

export function getDiscourseFeed({ filter, ...options }: DiscourseFeedReadOptions) {
  return getLinuxDoFeed({
    ...withLinuxDoAuth(options),
    linuxDoFilter: filter
  });
}

export function getDiscourseCategories(options: DiscourseReadOptions) {
  return getLinuxDoCategories(withLinuxDoAuth(options));
}

export function getDiscourseTopic(id: string, options: DiscourseTopicReadOptions) {
  return getLinuxDoTopic(id, withLinuxDoAuth(options));
}

export function getDiscourseReplies(id: string, options: DiscourseRepliesReadOptions) {
  return getLinuxDoReplies(id, withLinuxDoAuth(options));
}

export function getDiscourseReply(id: string, floor: number, options: DiscourseReadOptions) {
  return getLinuxDoReply(id, floor, withLinuxDoAuth(options));
}

export function getDiscourseUserProfile(id: string, username: string, options: DiscourseUserReadOptions) {
  return getLinuxDoUserProfile(id, username, withLinuxDoAuth(options));
}

export function getDiscourseCurrentUserProfile({ auth, ...options }: DiscourseReadOptions) {
  return getLinuxDoCurrentUserProfile({
    ...options,
    linuxDoUserAgent: auth?.userAgent
  });
}

export function getDiscourseEmojiUrls(options: DiscourseReadOptions = {}) {
  return getLinuxDoEmojiUrls(withLinuxDoAuth(options));
}

export function searchDiscourseTopics(query: string, options: DiscourseSearchReadOptions) {
  return searchLinuxDo(query, withLinuxDoAuth(options));
}

export function searchDiscourseTagOptions(options: DiscourseTagOptionReadOptions) {
  return searchLinuxDoTags(withLinuxDoAuth(options));
}

export function searchDiscourseUserOptions(options: DiscourseUserOptionReadOptions) {
  return searchLinuxDoUsers(withLinuxDoAuth(options));
}
