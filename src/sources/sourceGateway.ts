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
import {
  searchLinuxDoSemantic as searchLinuxDoSemanticDirect,
  searchLinuxDoTags as searchLinuxDoTagsDirect,
  searchLinuxDoUsers as searchLinuxDoUsersDirect
} from '../localLinuxdo';
import {
  searchXiaoyinsiTags as searchXiaoyinsiTagsDirect,
  searchXiaoyinsiUsers as searchXiaoyinsiUsersDirect,
  type XiaoyinsiApiCredentials
} from '../localXiaoyinsi';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '../request';
import { sourceErrorFromUnknown } from '../sourceErrors';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticFields,
  type DiagnosticTrace
} from '../diagnostics';
import { sourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
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
  diagnosticTrace?: DiagnosticTrace;
};

type SourceGatewayDependencies = {
  clearYaohuoLoginState: (options?: { generation?: number }) => Promise<void>;
  fetcher: Fetcher;
  hasLinuxDoCredentialForSource: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<boolean>;
  loadNodeSeekCookieForSource: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<string | undefined>;
  loadXiaoyinsiCredentialsForSource?: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<XiaoyinsiApiCredentials | undefined>;
  nodeSeekUserAgent: () => string;
  refreshXiaoyinsiAuthorization?: () => Promise<boolean | null>;
};

type GetCategoriesOptions = NonNullable<Parameters<typeof getForumCategories>[0]>;
type GetReplyOptions = Parameters<typeof getForumReply>[0];
type ManagedReadKeys = 'fetcher' | 'nodeSeekCookie' | 'nodeSeekUserAgent' | 'yaohuoCookie' | 'xiaoyinsiCredentials';
type ManagedGetCategoriesOptions = Omit<GetCategoriesOptions, ManagedReadKeys>;
type ManagedGetFeedOptions = Omit<GetFeedOptions, ManagedReadKeys>;
type ManagedSearchTopicsOptions = Omit<SearchTopicsOptions, ManagedReadKeys>;
type ManagedGetTopicOptions = Omit<GetTopicOptions, ManagedReadKeys>;
type ManagedGetRepliesOptions = Omit<GetRepliesOptions, ManagedReadKeys>;
type ManagedGetReplyOptions = Omit<GetReplyOptions, ManagedReadKeys>;
type ManagedGetUserProfileOptions = Omit<GetUserProfileOptions, ManagedReadKeys>;
type ManagedTagOptionSearchOptions =
  | (Omit<NonNullable<Parameters<typeof searchLinuxDoTagsDirect>[0]>, 'fetcher'> & { source: 'linuxdo' })
  | (Omit<NonNullable<Parameters<typeof searchXiaoyinsiTagsDirect>[0]>, 'credentials' | 'fetcher'> & { source: 'xiaoyinsi' });
type ManagedUserOptionSearchOptions =
  | (Omit<NonNullable<Parameters<typeof searchLinuxDoUsersDirect>[0]>, 'fetcher'> & { source: 'linuxdo' })
  | (Omit<NonNullable<Parameters<typeof searchXiaoyinsiUsersDirect>[0]>, 'credentials' | 'fetcher'> & { source: 'xiaoyinsi' });
type ManagedSemanticTopicSearchOptions = Omit<NonNullable<Parameters<typeof searchLinuxDoSemanticDirect>[1]>, 'fetcher'> & { query: string; source: 'linuxdo' };
export type SourceGatewayReadContext = {
  isCurrent?: () => boolean;
  trace?: DiagnosticTrace;
};

function summarizeReadResult(result: unknown) {
  const value = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const errors = value.errors && typeof value.errors === 'object'
    ? Object.values(value.errors).filter(Boolean).length
    : 0;
  const summary: Record<string, string | number | boolean | null> = {
    resultPresent: result !== null && result !== undefined,
    partialErrorCount: errors
  };
  if (Array.isArray(result)) {
    summary.itemCount = result.length;
  }
  for (const [field, diagnosticField] of [
    ['items', 'itemCount'],
    ['replies', 'replyCount'],
    ['topics', 'topicCount']
  ] as const) {
    if (Array.isArray(value[field])) {
      summary[diagnosticField] = value[field].length;
    }
  }
  for (const field of ['hasMore', 'hasMoreTopics', 'hasMoreReplies'] as const) {
    if (typeof value[field] === 'boolean') {
      summary[field] = value[field];
    }
  }
  if ('nextPage' in value) {
    summary.hasNextPage = typeof value.nextPage === 'number';
  }
  if ('nextCursor' in value) {
    summary.hasNextCursor = typeof value.nextCursor === 'string' && Boolean(value.nextCursor);
  }
  if (typeof value.contentHtml === 'string') {
    summary.hasContent = Boolean(value.contentHtml.trim());
  }
  const adapterSummary = sourceDiagnosticSummary(result);
  if (adapterSummary) {
    Object.assign(summary, adapterSummary);
  }
  return summary satisfies DiagnosticFields;
}

export function createSourceGateway(dependencies: SourceGatewayDependencies) {
  const read = async <T>(source: FeedSource, operationName: string, operation: (credentials: {
    fetcher: Fetcher;
    nodeSeekCookie?: string;
    nodeSeekUserAgent?: string;
    yaohuoCookie?: string;
    xiaoyinsiCredentials?: XiaoyinsiApiCredentials;
  }) => Promise<T>, context?: SourceGatewayReadContext) => {
    const ownsTrace = !context?.trace;
    const trace = context?.trace || beginDiagnosticTrace('source', operationName, { source });
    let yaohuoGeneration: number | undefined;
    let hasXiaoyinsiCredentials = false;
    try {
      let hasLinuxDoCredential = false;
      let isLinuxDoCredentialKnown: boolean | undefined;
      let linuxDoCredentialReason: ReturnType<typeof normalizeDiagnosticReason> | undefined;
      if (source === 'linuxdo' || source === 'all') {
        isLinuxDoCredentialKnown = true;
        try {
          hasLinuxDoCredential = await dependencies.hasLinuxDoCredentialForSource(source, { diagnosticTrace: trace });
        } catch (error) {
          isLinuxDoCredentialKnown = false;
          linuxDoCredentialReason = normalizeDiagnosticReason(error);
        }
      }
      const nodeSeekCookie = source === 'nodeseek' || source === 'all'
        ? await dependencies.loadNodeSeekCookieForSource(source, { diagnosticTrace: trace })
        : undefined;
      const yaohuoCookie = source === 'yaohuo'
        ? await dependencies.loadYaohuoCookieForSource(source, {
          captureGeneration: (generation) => { yaohuoGeneration = generation; },
          diagnosticTrace: trace
        })
        : undefined;
      const xiaoyinsiCredentials = source === 'xiaoyinsi' || source === 'all'
        ? await dependencies.loadXiaoyinsiCredentialsForSource?.(source, { diagnosticTrace: trace })
        : undefined;
      hasXiaoyinsiCredentials = Boolean(xiaoyinsiCredentials);
      markDiagnosticStage(trace, 'credential', {
        source,
        hasCredential: Boolean(hasLinuxDoCredential || nodeSeekCookie?.trim() || yaohuoCookie?.trim() || xiaoyinsiCredentials),
        ...(isLinuxDoCredentialKnown !== undefined ? { isCredentialKnown: isLinuxDoCredentialKnown } : {}),
        ...(linuxDoCredentialReason ? { reason: linuxDoCredentialReason } : {})
      });
      markDiagnosticStage(trace, 'transport', { source, channel: 'direct', state: 'start' });
      const result = await operation({
        fetcher: withDiagnosticFetcher(trace, dependencies.fetcher),
        nodeSeekCookie,
        nodeSeekUserAgent: source === 'nodeseek' || source === 'all' ? dependencies.nodeSeekUserAgent() : undefined,
        yaohuoCookie,
        xiaoyinsiCredentials
      });
      const resultRecord = result && typeof result === 'object' ? result as Record<string, unknown> : {};
      const resultErrors = resultRecord.errors && typeof resultRecord.errors === 'object'
        ? resultRecord.errors as Record<string, unknown>
        : {};
      const xiaoyinsiResultError = resultErrors.xiaoyinsi && typeof resultErrors.xiaoyinsi === 'object'
        ? resultErrors.xiaoyinsi as { kind?: unknown }
        : null;
      if (
        hasXiaoyinsiCredentials
        && context?.isCurrent?.() !== false
        && (xiaoyinsiResultError?.kind === 'login-expired' || xiaoyinsiResultError?.kind === 'permission-denied')
      ) {
        await dependencies.refreshXiaoyinsiAuthorization?.().catch(() => false);
      }
      const summary = summarizeReadResult(result);
      markDiagnosticStage(trace, 'parse', { source, ...summary });
      const parseEmpty = summary.isParseEmpty === true;
      const degraded = parseEmpty
        || summary.hasDegradation === true
        || Number(summary.partialErrorCount || 0) > 0;
      if (ownsTrace) {
        finishDiagnosticTrace(
          trace,
          parseEmpty ? (Number(summary.validCount || 0) > 0 ? 'partial' : 'failure') : degraded ? 'partial' : 'success',
          { source, ...(parseEmpty ? { reason: 'parse_empty' } : {}) }
        );
      } else if (parseEmpty) {
        hintDiagnosticOutcome(trace, Number(summary.validCount || 0) > 0 ? 'partial' : 'failure', {
          source,
          reason: 'parse_empty'
        });
      } else if (degraded) {
        hintDiagnosticOutcome(trace, 'partial', { source });
      }
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === REQUEST_CANCELED_MESSAGE) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'canceled', { source, reason: 'canceled' });
        }
        throw error;
      }
      const sourceError = sourceErrorFromUnknown(source, error);
      if (source === 'yaohuo' && sourceError.kind === 'login-expired' && context?.isCurrent?.() !== false) {
        await dependencies.clearYaohuoLoginState({ generation: yaohuoGeneration });
      }
      if (
        source === 'xiaoyinsi'
        && hasXiaoyinsiCredentials
        && context?.isCurrent?.() !== false
        && (sourceError.kind === 'login-expired' || sourceError.kind === 'permission-denied')
      ) {
        await dependencies.refreshXiaoyinsiAuthorization?.().catch(() => false);
      }
      if (ownsTrace) {
        const reason = normalizeDiagnosticReason(error);
        finishDiagnosticTrace(
          trace,
          reason === 'login_required' || reason === 'verification_required' || reason === 'permission_denied'
            ? 'blocked'
            : 'failure',
          { source, reason }
        );
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
      return read(source, 'getCategories', (credentials) => getForumCategories({
        ...options,
        ...credentials
      }), context);
    },
    getFeed(options: ManagedGetFeedOptions, context?: SourceGatewayReadContext) {
      return read(options.source, 'getFeed', (credentials) => getFeed({
        ...options,
        ...credentials
      }), context);
    },
    searchTopics(options: ManagedSearchTopicsOptions, context?: SourceGatewayReadContext) {
      return read(options.source, 'searchTopics', (credentials) => searchTopics({
        ...options,
        ...credentials
      }), context);
    },
    searchTagOptions(request: ManagedTagOptionSearchOptions, context?: SourceGatewayReadContext) {
      const { source, ...options } = request;
      return source === 'xiaoyinsi'
        ? read(source, 'searchTagOptions', ({ fetcher, xiaoyinsiCredentials }) => searchXiaoyinsiTagsDirect({
          ...options,
          credentials: xiaoyinsiCredentials,
          fetcher
        }), context)
        : read(source, 'searchTagOptions', ({ fetcher }) => searchLinuxDoTagsDirect({
          ...options,
          fetcher
        }), context);
    },
    searchUserOptions(request: ManagedUserOptionSearchOptions, context?: SourceGatewayReadContext) {
      const { source, ...options } = request;
      return source === 'xiaoyinsi'
        ? read(source, 'searchUserOptions', ({ fetcher, xiaoyinsiCredentials }) => searchXiaoyinsiUsersDirect({
          ...options,
          credentials: xiaoyinsiCredentials,
          fetcher
        }), context)
        : read(source, 'searchUserOptions', ({ fetcher }) => searchLinuxDoUsersDirect({
          ...options,
          fetcher
        }), context);
    },
    searchSemanticTopics({ query, source, ...options }: ManagedSemanticTopicSearchOptions, context?: SourceGatewayReadContext) {
      return read(source, 'searchSemanticTopics', ({ fetcher }) => searchLinuxDoSemanticDirect(query, {
        ...options,
        fetcher
      }), context);
    },
    getTopic(options: ManagedGetTopicOptions, context?: SourceGatewayReadContext) {
      return read(options.source, 'getTopic', (credentials) => getTopic({
        ...options,
        ...credentials
      }), context);
    },
    getReplies(options: ManagedGetRepliesOptions, context?: SourceGatewayReadContext) {
      return read(options.source, 'getReplies', (credentials) => getReplies({
        ...options,
        ...credentials
      }), context);
    },
    getReply(options: ManagedGetReplyOptions, context?: SourceGatewayReadContext) {
      return read(options.source, 'getReply', (credentials) => getForumReply({
        ...options,
        ...credentials
      }), context);
    },
    getUserProfile(options: ManagedGetUserProfileOptions, context?: SourceGatewayReadContext) {
      return read(options.source, 'getUserProfile', (credentials) => getUserProfile({
        ...options,
        ...credentials
      }), context);
    }
  };
}

export type SourceGateway = ReturnType<typeof createSourceGateway>;
