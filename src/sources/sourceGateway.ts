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
import { REQUEST_CANCELED_MESSAGE, REQUEST_SUPERSEDED_MESSAGE, type Fetcher } from '../request';
import { isSilentRequestInterruption, isSupersededRequest } from '../appUtils';
import { sourceErrorFromUnknown } from '../sourceErrors';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticFields,
  type DiagnosticReason,
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
  clearYaohuoLoginState: (options?: { generation?: number; isCurrent?: () => boolean }) => Promise<boolean | void>;
  fetcher: Fetcher;
  isYaohuoCredentialSuppressed?: () => boolean;
  loadNodeSeekCookieForSource: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<string | undefined>;
  nodeSeekUserAgent: () => string;
};

type NodeSeekReadCredentials = {
  nodeSeekCookie?: string;
  nodeSeekUserAgent?: string;
  timeoutMs?: number;
};

type GetCategoriesOptions = NonNullable<Parameters<typeof getForumCategories>[0]>;
type GetReplyOptions = Parameters<typeof getForumReply>[0];
type ManagedReadKeys = 'fetcher' | 'nodeSeekCookie' | 'nodeSeekCredentials' | 'nodeSeekUserAgent' | 'yaohuoCookie';
type ManagedGetCategoriesOptions = Omit<GetCategoriesOptions, ManagedReadKeys>;
type ManagedGetFeedOptions = Omit<GetFeedOptions, ManagedReadKeys>;
type ManagedSearchTopicsOptions = Omit<SearchTopicsOptions, ManagedReadKeys>;
type ManagedGetTopicOptions = Omit<GetTopicOptions, ManagedReadKeys>;
type ManagedGetRepliesOptions = Omit<GetRepliesOptions, ManagedReadKeys>;
type ManagedGetReplyOptions = Omit<GetReplyOptions, 'fetcher'>;
type ManagedGetUserProfileOptions = Omit<GetUserProfileOptions, 'fetcher' | 'nodeSeekCookie' | 'nodeSeekUserAgent' | 'yaohuoCookie'>;
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

function diagnosticReasonForSourceError(kind: ReturnType<typeof sourceErrorFromUnknown>['kind'], error: unknown): DiagnosticReason {
  if (kind === 'login-required' || kind === 'login-expired') return 'login_required';
  if (kind === 'verification-required') return 'verification_required';
  if (kind === 'permission-denied') return 'permission_denied';
  return normalizeDiagnosticReason(error);
}

export function createSourceGateway(dependencies: SourceGatewayDependencies) {
  const read = async <T>(source: FeedSource, operationName: string, operation: (credentials: {
    fetcher: Fetcher;
    nodeSeekCookie?: string;
    nodeSeekCredentials?: Promise<NodeSeekReadCredentials>;
    nodeSeekUserAgent?: string;
    timeoutMs?: number;
    yaohuoCookie?: string;
  }) => Promise<T>, context?: SourceGatewayReadContext) => {
    const ownsTrace = !context?.trace;
    const trace = context?.trace || beginDiagnosticTrace('source', operationName, { source });
    let yaohuoGeneration: number | undefined;
    try {
      const nodeSeekCredentials = source === 'all'
        ? dependencies.loadNodeSeekCookieForSource(source, { diagnosticTrace: trace }).then((nodeSeekCookie) => ({
          nodeSeekCookie,
          nodeSeekUserAgent: dependencies.nodeSeekUserAgent(),
          timeoutMs: 0
        }))
        : undefined;
      const nodeSeekCookie = source === 'nodeseek'
        ? await dependencies.loadNodeSeekCookieForSource(source, { diagnosticTrace: trace })
        : undefined;
      const yaohuoSuppressedBeforeLoad = source === 'yaohuo'
        && dependencies.isYaohuoCredentialSuppressed?.() === true;
      const loadedYaohuoCookie = source === 'yaohuo' && !yaohuoSuppressedBeforeLoad
        ? await dependencies.loadYaohuoCookieForSource(source, {
          captureGeneration: (generation) => { yaohuoGeneration = generation; },
          diagnosticTrace: trace
        })
        : undefined;
      const yaohuoSuppressed = source === 'yaohuo'
        && dependencies.isYaohuoCredentialSuppressed?.() === true;
      const yaohuoCookie = yaohuoSuppressed ? undefined : loadedYaohuoCookie;
      markDiagnosticStage(trace, 'credential', {
        source,
        ...(source === 'all'
          ? { state: 'load' }
          : yaohuoSuppressed
          ? { state: 'disabled' }
          : { hasCredential: Boolean(nodeSeekCookie?.trim() || yaohuoCookie?.trim()) })
      });
      markDiagnosticStage(trace, 'transport', { source, channel: 'direct', state: 'start' });
      const diagnosticFetcher = withDiagnosticFetcher(trace, dependencies.fetcher);
      const fetcher: Fetcher = source === 'yaohuo' && !yaohuoCookie?.trim()
        ? (input, init) => diagnosticFetcher(input, { ...init, credentials: 'omit' })
        : diagnosticFetcher;
      const result = await operation({
        fetcher,
        nodeSeekCookie,
        nodeSeekCredentials,
        nodeSeekUserAgent: source === 'nodeseek' ? dependencies.nodeSeekUserAgent() : undefined,
        ...(source === 'nodeseek' ? { timeoutMs: 0 } : {}),
        yaohuoCookie
      });
      if (source === 'yaohuo'
        && yaohuoSuppressed !== (dependencies.isYaohuoCredentialSuppressed?.() === true)) {
        throw new Error(REQUEST_CANCELED_MESSAGE);
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
      if (isSilentRequestInterruption(error)) {
        if (ownsTrace) {
          const superseded = isSupersededRequest(error);
          finishDiagnosticTrace(trace, superseded ? 'stale' : 'canceled', {
            source,
            reason: superseded ? 'superseded' : 'canceled'
          });
        }
        throw error;
      }
      const sourceError = sourceErrorFromUnknown(source, error);
      if (source === 'yaohuo'
        && sourceError.kind === 'login-expired'
        && context?.isCurrent?.() !== false
        && dependencies.isYaohuoCredentialSuppressed?.() !== true) {
        try {
          const cleared = await dependencies.clearYaohuoLoginState({
            generation: yaohuoGeneration,
            isCurrent: () => context?.isCurrent?.() !== false
              && dependencies.isYaohuoCredentialSuppressed?.() !== true
          });
          if (cleared === false) {
            throw new Error(REQUEST_SUPERSEDED_MESSAGE);
          }
        } catch (cleanupError) {
          if (isSilentRequestInterruption(cleanupError)) {
            if (ownsTrace) {
              const superseded = isSupersededRequest(cleanupError);
              finishDiagnosticTrace(trace, superseded ? 'stale' : 'canceled', {
                source: 'yaohuo',
                reason: superseded ? 'superseded' : 'canceled'
              });
            }
            throw cleanupError;
          }
          markDiagnosticStage(trace, 'credential', { source: 'yaohuo', state: 'error', reason: 'storage_error' });
        }
      }
      if (ownsTrace) {
        const reason = diagnosticReasonForSourceError(sourceError.kind, error);
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
      if (dependencies.isYaohuoCredentialSuppressed?.() === true) {
        return false;
      }
      const cookie = await dependencies.loadYaohuoCookieForSource('yaohuo');
      return dependencies.isYaohuoCredentialSuppressed?.() === true
        ? false
        : Boolean(cookie?.trim());
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
      return read(options.source, 'getReply', ({ fetcher }) => getForumReply({
        ...options,
        fetcher
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
