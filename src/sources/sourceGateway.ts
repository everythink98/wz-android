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
  searchLinuxDoSemantic as searchLinuxDoSemanticDirect
} from '../localLinuxdo';
import {
  getXiaoyinsiLevelProfile as getLocalXiaoyinsiLevelProfile,
  type XiaoyinsiApiCredentials,
  type XiaoyinsiLevelProfile,
  type XiaoyinsiOptions
} from '../localXiaoyinsi';
import {
  searchDiscourseSourceTagOptions,
  searchDiscourseSourceUserOptions,
  type DiscourseReadAuth,
  type DiscourseTagOptionReadOptions,
  type DiscourseUserOptionReadOptions
} from '../discourseSourceReaders';
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
import type { FeedSource, Source, SourceErrors, Topic } from '../types';
import type { DiscourseSource } from '../sourceCatalog';

export { getCurrentUserProfile } from '../forumApi';
export {
  checkLinuxDoLoginAccess
} from '../linuxdoActionClient';
export {
  getLinuxDoLevelProfile,
  type LinuxDoLevelProfile
} from '../linuxdoLevel';
export type { XiaoyinsiLevelProfile } from '../localXiaoyinsi';
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
  clearYaohuoLoginState: (options?: { generation?: number; expiredMessage?: string }) => Promise<boolean>;
  currentLinuxDoCredentialGeneration?: () => number;
  currentNodeSeekCredentialGeneration?: () => number;
  currentYaohuoCredentialGeneration?: () => number;
  currentXiaoyinsiCredentialGeneration?: () => number;
  fetcher: Fetcher;
  hasLinuxDoCredentialForSource: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<boolean>;
  loadNodeSeekCookieForSource: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<string | undefined>;
  loadXiaoyinsiCredentialsForSource?: (source: FeedSource, options?: SourceGatewayCredentialLoadOptions) => Promise<XiaoyinsiApiCredentials | undefined>;
  nodeSeekUserAgent: () => string;
  refreshXiaoyinsiAuthorization?: (trace?: DiagnosticTrace) => Promise<boolean | null>;
};

type GetCategoriesOptions = NonNullable<Parameters<typeof getForumCategories>[0]>;
type GetReplyOptions = Parameters<typeof getForumReply>[0];
type ManagedReadKeys = 'discourseAuth' | 'fetcher' | 'nodeSeekCookie' | 'nodeSeekUserAgent' | 'unavailableSources' | 'yaohuoCookie';
type ManagedGetCategoriesOptions = Omit<GetCategoriesOptions, ManagedReadKeys>;
type ManagedGetFeedOptions = Omit<GetFeedOptions, ManagedReadKeys>;
type ManagedSearchTopicsOptions = Omit<SearchTopicsOptions, ManagedReadKeys>;
type ManagedGetTopicOptions = Omit<GetTopicOptions, ManagedReadKeys>;
type ManagedGetRepliesOptions = Omit<GetRepliesOptions, ManagedReadKeys>;
type ManagedGetReplyOptions = Omit<GetReplyOptions, ManagedReadKeys>;
type ManagedGetUserProfileOptions = Omit<GetUserProfileOptions, ManagedReadKeys>;
type ManagedTagOptionSearchOptions = Omit<DiscourseTagOptionReadOptions, 'auth' | 'fetcher'> & { source: DiscourseSource };
type ManagedUserOptionSearchOptions = Omit<DiscourseUserOptionReadOptions, 'auth' | 'fetcher'> & { source: DiscourseSource };
type ManagedSemanticTopicSearchOptions = Omit<NonNullable<Parameters<typeof searchLinuxDoSemanticDirect>[1]>, 'fetcher'> & { query: string; source: 'linuxdo' };
type ManagedLevelProfileOptions = Omit<XiaoyinsiOptions, 'credentials' | 'fetcher'> & {
  source: 'xiaoyinsi';
};
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
    discourseAuth?: DiscourseReadAuth;
    fetcher: Fetcher;
    nodeSeekCookie?: string;
    nodeSeekUserAgent?: string;
    unavailableSources?: readonly Source[];
    yaohuoCookie?: string;
  }) => Promise<T>, context?: SourceGatewayReadContext) => {
    const ownsTrace = !context?.trace;
    const trace = context?.trace || beginDiagnosticTrace('source', operationName, { source });
    let linuxDoGeneration: number | undefined;
    let nodeSeekGeneration: number | undefined;
    let yaohuoGeneration: number | undefined;
    let xiaoyinsiGeneration: number | undefined;
    let hasXiaoyinsiCredentials = false;
    const credentialGenerationsAreCurrent = () => (
      (linuxDoGeneration === undefined
        || !dependencies.currentLinuxDoCredentialGeneration
        || dependencies.currentLinuxDoCredentialGeneration() === linuxDoGeneration)
      && (nodeSeekGeneration === undefined
        || !dependencies.currentNodeSeekCredentialGeneration
        || dependencies.currentNodeSeekCredentialGeneration() === nodeSeekGeneration)
      && (yaohuoGeneration === undefined
        || !dependencies.currentYaohuoCredentialGeneration
        || dependencies.currentYaohuoCredentialGeneration() === yaohuoGeneration)
      && (xiaoyinsiGeneration === undefined
        || !dependencies.currentXiaoyinsiCredentialGeneration
        || dependencies.currentXiaoyinsiCredentialGeneration() === xiaoyinsiGeneration)
    );
    const readIsCurrent = () => context?.isCurrent?.() !== false && credentialGenerationsAreCurrent();
    const credentialErrors: SourceErrors = {};
    const loadCredential = async <T>(credentialSource: FeedSource, loader: () => Promise<T>) => {
      try {
        return await loader();
      } catch (error) {
        if (source !== 'all') {
          throw error;
        }
        credentialErrors[credentialSource] = sourceErrorFromUnknown(credentialSource, error);
        markDiagnosticStage(trace, 'credential', {
          source: credentialSource,
          state: 'error',
          reason: normalizeDiagnosticReason(error)
        });
        return undefined;
      }
    };
    try {
      let hasLinuxDoCredential = false;
      let isLinuxDoCredentialKnown: boolean | undefined;
      let linuxDoCredentialReason: ReturnType<typeof normalizeDiagnosticReason> | undefined;
      if (source === 'linuxdo' || source === 'all') {
        isLinuxDoCredentialKnown = true;
        try {
          hasLinuxDoCredential = await dependencies.hasLinuxDoCredentialForSource(source, {
            captureGeneration: (generation) => { linuxDoGeneration = generation; },
            diagnosticTrace: trace
          });
        } catch (error) {
          isLinuxDoCredentialKnown = false;
          linuxDoCredentialReason = normalizeDiagnosticReason(error);
          if (source !== 'all') {
            throw error;
          }
          credentialErrors.linuxdo = sourceErrorFromUnknown('linuxdo', error);
          markDiagnosticStage(trace, 'credential', {
            source: 'linuxdo',
            state: 'error',
            reason: linuxDoCredentialReason
          });
        }
      }
      const nodeSeekCookie = source === 'nodeseek' || source === 'all'
        ? await loadCredential('nodeseek', () => dependencies.loadNodeSeekCookieForSource(source, {
          captureGeneration: (generation) => { nodeSeekGeneration = generation; },
          diagnosticTrace: trace
        }))
        : undefined;
      const yaohuoCookie = source === 'yaohuo' || source === 'all'
        ? await loadCredential('yaohuo', () => dependencies.loadYaohuoCookieForSource(source, {
          captureGeneration: (generation) => { yaohuoGeneration = generation; },
          diagnosticTrace: trace
        }))
        : undefined;
      const xiaoyinsiCredentials = source === 'xiaoyinsi' || source === 'all'
        ? await loadCredential('xiaoyinsi', async () => dependencies.loadXiaoyinsiCredentialsForSource?.(source, {
          captureGeneration: (generation) => { xiaoyinsiGeneration = generation; },
          diagnosticTrace: trace
        }))
        : undefined;
      const discourseAuth: DiscourseReadAuth | undefined = xiaoyinsiCredentials
        ? { xiaoyinsi: xiaoyinsiCredentials }
        : undefined;
      const unavailableSources = source === 'all'
        ? Object.keys(credentialErrors) as Source[]
        : [];
      hasXiaoyinsiCredentials = Boolean(xiaoyinsiCredentials);
      if (!readIsCurrent()) {
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      markDiagnosticStage(trace, 'credential', {
        source,
        hasCredential: Boolean(hasLinuxDoCredential || nodeSeekCookie?.trim() || yaohuoCookie?.trim() || xiaoyinsiCredentials),
        ...(isLinuxDoCredentialKnown !== undefined ? { isCredentialKnown: isLinuxDoCredentialKnown } : {}),
        ...(linuxDoCredentialReason ? { reason: linuxDoCredentialReason } : {})
      });
      markDiagnosticStage(trace, 'transport', { source, channel: 'direct', state: 'start' });
      const result = await operation({
        discourseAuth,
        fetcher: withDiagnosticFetcher(trace, dependencies.fetcher),
        nodeSeekCookie,
        nodeSeekUserAgent: source === 'nodeseek' || source === 'all' ? dependencies.nodeSeekUserAgent() : undefined,
        ...(unavailableSources.length ? { unavailableSources } : {}),
        yaohuoCookie
      });
      if (!readIsCurrent()) {
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      if (source === 'all' && result && typeof result === 'object' && !Array.isArray(result) && Object.keys(credentialErrors).length) {
        const aggregateResult = result as { errors?: SourceErrors; items?: unknown[] };
        if (Array.isArray(aggregateResult.items)) {
          const unavailableSourceSet = new Set(unavailableSources);
          aggregateResult.items = aggregateResult.items.filter((item) => (
            !item
            || typeof item !== 'object'
            || Array.isArray(item)
            || !unavailableSourceSet.has((item as { source?: Source }).source as Source)
          ));
        }
        aggregateResult.errors = { ...aggregateResult.errors, ...credentialErrors };
      }
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
        await dependencies.refreshXiaoyinsiAuthorization?.(trace).catch(() => false);
        if (!readIsCurrent()) {
          throw new Error(REQUEST_CANCELED_MESSAGE);
        }
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
          const stale = !readIsCurrent();
          finishDiagnosticTrace(trace, stale ? 'stale' : 'canceled', {
            source,
            reason: stale ? 'superseded' : 'canceled'
          });
        }
        throw error;
      }
      if (!readIsCurrent()) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source, reason: 'superseded' });
        }
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      const sourceError = sourceErrorFromUnknown(source, error);
      let credentialCleanupSuperseded = false;
      if (source === 'yaohuo' && sourceError.kind === 'login-expired' && context?.isCurrent?.() !== false) {
        try {
          const cleared = await dependencies.clearYaohuoLoginState({
            generation: yaohuoGeneration,
            expiredMessage: sourceError.message
          });
          credentialCleanupSuperseded = !cleared;
        } catch (cleanupError) {
          markDiagnosticStage(trace, 'persist', {
            source: 'yaohuo',
            store: 'multi-store',
            state: 'partial',
            reason: normalizeDiagnosticReason(cleanupError)
          });
        }
      }
      if (credentialCleanupSuperseded || !readIsCurrent()) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source, reason: 'superseded' });
        }
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      if (
        source === 'xiaoyinsi'
        && hasXiaoyinsiCredentials
        && context?.isCurrent?.() !== false
        && (sourceError.kind === 'login-expired' || sourceError.kind === 'permission-denied')
      ) {
        await dependencies.refreshXiaoyinsiAuthorization?.(trace).catch(() => false);
        if (!readIsCurrent()) {
          if (ownsTrace) {
            finishDiagnosticTrace(trace, 'stale', { source, reason: 'superseded' });
          }
          throw new Error(REQUEST_CANCELED_MESSAGE);
        }
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
      return read(source, 'searchTagOptions', ({ discourseAuth, fetcher }) => searchDiscourseSourceTagOptions(source, {
          ...options,
          auth: discourseAuth,
          fetcher
        }), context);
    },
    searchUserOptions(request: ManagedUserOptionSearchOptions, context?: SourceGatewayReadContext) {
      const { source, ...options } = request;
      return read(source, 'searchUserOptions', ({ discourseAuth, fetcher }) => searchDiscourseSourceUserOptions(source, {
          ...options,
          auth: discourseAuth,
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
    },
    getLevelProfile({ source, ...options }: ManagedLevelProfileOptions, context?: SourceGatewayReadContext): Promise<XiaoyinsiLevelProfile> {
      return read(source, 'getLevelProfile', ({ discourseAuth, fetcher }) => {
        const credentials = discourseAuth?.xiaoyinsi;
        if (!credentials) {
          throw Object.assign(new Error('请先授权小隐寺'), {
            source: 'xiaoyinsi' as const,
            loginRequired: true
          });
        }
        return getLocalXiaoyinsiLevelProfile({ ...options, credentials, fetcher });
      }, context);
    }
  };
}

export type SourceGateway = ReturnType<typeof createSourceGateway>;
