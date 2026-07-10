import {
  getCategories as getForumCategories,
  getFeed as getForumFeed,
  getReply as getForumReply,
  getReplies as getForumReplies,
  getTopic as getForumTopic,
  getUserProfile as getForumUserProfile,
  searchTopics as searchForumTopics
} from '../forumApi';
import {
  getYaohuoFeedDirect,
  getYaohuoRepliesDirect,
  getYaohuoTopicDirect,
  searchYaohuoDirect
} from '../yaohuoApi';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '../request';
import { sourceErrorFromUnknown } from '../sourceErrors';
import type { FeedSource, Topic } from '../types';

export { getCurrentUserProfile } from '../forumApi';
export {
  checkLinuxDoLoginAccess
} from '../linuxdoActionClient';
export {
  getLinuxDoLevelProfile,
  type LinuxDoLevelProfile
} from '../linuxdoLevel';
export {
  checkYaohuoLoginDirect as checkYaohuoLogin
} from '../yaohuoApi';

type GetFeedOptions = Parameters<typeof getForumFeed>[0] & {
  yaohuoCookie?: string;
};

export function getFeed(options: GetFeedOptions) {
  if (options.source !== 'yaohuo') {
    return getForumFeed(options);
  }
  return getYaohuoFeedDirect({
    yaohuoCookie: options.yaohuoCookie,
    category: options.category,
    page: options.page,
    limit: options.limit,
    yaohuoFetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

type SearchTopicsOptions = Parameters<typeof searchForumTopics>[0] & {
  yaohuoCookie?: string;
};

export function searchTopics(options: SearchTopicsOptions) {
  if (options.source !== 'yaohuo') {
    return searchForumTopics(options);
  }
  return searchYaohuoDirect({
    query: options.query,
    page: options.page,
    limit: options.limit,
    category: options.filter?.source === 'yaohuo' ? options.filter.category : undefined,
    yaohuoCookie: options.yaohuoCookie,
    yaohuoFetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

type GetTopicOptions = Parameters<typeof getForumTopic>[0] & {
  topic?: Topic;
  yaohuoCookie?: string;
};

export function getTopic(options: GetTopicOptions) {
  if (options.source !== 'yaohuo') {
    return getForumTopic(options);
  }
  if (!options.topic) {
    throw new Error('妖火详情需要主题上下文');
  }
  return getYaohuoTopicDirect({
    topic: options.topic,
    yaohuoCookie: options.yaohuoCookie,
    yaohuoFetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

type GetRepliesOptions = Parameters<typeof getForumReplies>[0] & {
  categoryId?: string;
  yaohuoCookie?: string;
};

export function getReplies(options: GetRepliesOptions) {
  if (options.source !== 'yaohuo') {
    return getForumReplies(options);
  }
  return getYaohuoRepliesDirect({
    id: options.id,
    categoryId: options.categoryId,
    page: options.page,
    limit: options.limit,
    yaohuoCookie: options.yaohuoCookie,
    yaohuoFetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

type GetUserProfileOptions = Parameters<typeof getForumUserProfile>[0];

export async function getUserProfile(options: GetUserProfileOptions) {
  if (options.source === 'yaohuo' && !options.yaohuoCookie?.trim()) {
    throw Object.assign(new Error('请先登录妖火'), {
      source: 'yaohuo' as const,
      loginRequired: true,
      reason: 'missing_cookie' as const
    });
  }
  return getForumUserProfile(options);
}

type SourceGatewayCredentialLoadOptions = {
  captureGeneration?: (generation: number) => void;
};

type SourceGatewayDependencies = {
  clearYaohuoLoginState: (options?: { generation?: number }) => Promise<void>;
  fetcher: Fetcher;
  loadNodeSeekCookieForSource: (source: FeedSource) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<string | undefined>;
  nodeSeekUserAgent: () => string;
};

type GetCategoriesOptions = NonNullable<Parameters<typeof getForumCategories>[0]>;
type GetReplyOptions = Parameters<typeof getForumReply>[0];
type ManagedReadKeys = 'fetcher' | 'nodeSeekCookie' | 'nodeSeekUserAgent' | 'yaohuoCookie';
type ManagedGetCategoriesOptions = Omit<GetCategoriesOptions, ManagedReadKeys>;
type ManagedGetFeedOptions = Omit<GetFeedOptions, ManagedReadKeys>;
type ManagedSearchTopicsOptions = Omit<SearchTopicsOptions, ManagedReadKeys>;
type ManagedGetTopicOptions = Omit<GetTopicOptions, ManagedReadKeys>;
type ManagedGetRepliesOptions = Omit<GetRepliesOptions, ManagedReadKeys>;
type ManagedGetReplyOptions = Omit<GetReplyOptions, 'fetcher'>;
type ManagedGetUserProfileOptions = Omit<GetUserProfileOptions, 'fetcher' | 'nodeSeekCookie' | 'nodeSeekUserAgent' | 'yaohuoCookie'>;
type SourceGatewayReadContext = { isCurrent?: () => boolean };

export function createSourceGateway(dependencies: SourceGatewayDependencies) {
  const read = async <T>(source: FeedSource, operation: (credentials: {
    nodeSeekCookie?: string;
    nodeSeekUserAgent?: string;
    yaohuoCookie?: string;
  }) => Promise<T>, context?: SourceGatewayReadContext) => {
    let yaohuoGeneration: number | undefined;
    const nodeSeekCookie = source === 'nodeseek' || source === 'all'
      ? await dependencies.loadNodeSeekCookieForSource(source)
      : undefined;
    const yaohuoCookie = source === 'yaohuo'
      ? await dependencies.loadYaohuoCookieForSource(source, {
        captureGeneration: (generation) => { yaohuoGeneration = generation; }
      })
      : undefined;
    try {
      return await operation({
        nodeSeekCookie,
        nodeSeekUserAgent: source === 'nodeseek' || source === 'all' ? dependencies.nodeSeekUserAgent() : undefined,
        yaohuoCookie
      });
    } catch (error) {
      if (error instanceof Error && error.message === REQUEST_CANCELED_MESSAGE) {
        throw error;
      }
      const sourceError = sourceErrorFromUnknown(source, error);
      if (source === 'yaohuo' && sourceError.kind === 'login-expired' && context?.isCurrent?.() !== false) {
        await dependencies.clearYaohuoLoginState({ generation: yaohuoGeneration });
      }
      throw Object.assign(error instanceof Error ? error : new Error(sourceError.message), sourceError);
    }
  };

  return {
    async hasYaohuoCredential() {
      return Boolean((await dependencies.loadYaohuoCookieForSource('yaohuo'))?.trim());
    },
    getCategories(options: ManagedGetCategoriesOptions = {}, context?: SourceGatewayReadContext) {
      const source = options.source || 'all';
      return read(source, (credentials) => getForumCategories({
        ...options,
        ...credentials,
        fetcher: dependencies.fetcher
      }), context);
    },
    getFeed(options: ManagedGetFeedOptions, context?: SourceGatewayReadContext) {
      return read(options.source, (credentials) => getFeed({
        ...options,
        ...credentials,
        fetcher: dependencies.fetcher
      }), context);
    },
    searchTopics(options: ManagedSearchTopicsOptions, context?: SourceGatewayReadContext) {
      return read(options.source, (credentials) => searchTopics({
        ...options,
        ...credentials,
        fetcher: dependencies.fetcher
      }), context);
    },
    getTopic(options: ManagedGetTopicOptions, context?: SourceGatewayReadContext) {
      return read(options.source, (credentials) => getTopic({
        ...options,
        ...credentials,
        fetcher: dependencies.fetcher
      }), context);
    },
    getReplies(options: ManagedGetRepliesOptions, context?: SourceGatewayReadContext) {
      return read(options.source, (credentials) => getReplies({
        ...options,
        ...credentials,
        fetcher: dependencies.fetcher
      }), context);
    },
    getReply(options: ManagedGetReplyOptions, context?: SourceGatewayReadContext) {
      return read(options.source, () => getForumReply({
        ...options,
        fetcher: dependencies.fetcher
      }), context);
    },
    getUserProfile(options: ManagedGetUserProfileOptions, context?: SourceGatewayReadContext) {
      return read(options.source, (credentials) => getUserProfile({
          ...options,
          ...credentials,
          fetcher: dependencies.fetcher,
        }), context);
    }
  };
}

export type SourceGateway = ReturnType<typeof createSourceGateway>;
