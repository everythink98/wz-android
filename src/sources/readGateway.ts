import { getCategories as getForumCategories, getFeed as getForumFeed } from './feedRead';
import {
  getReply as getForumReply,
  getReplies as getForumReplies,
  getTopic as getForumTopic,
  getUserProfile as getForumUserProfile
} from './sourceRead';
import { searchTopics as searchForumTopics } from './searchRead';
import {
  getYaohuoFeedDirect,
  getYaohuoRepliesDirect,
  getYaohuoTopicDirect,
  searchYaohuoDirect
} from '@/sources/yaohuo/reader';
import { searchLinuxDoSemantic as searchLinuxDoSemanticDirect } from '@/sources/linuxdo/search';
import { resolveNodeSeekUser as resolveNodeSeekUserDirect } from '@/sources/nodeseek/reader';
import {
  getLinuxDoLevelProfile as getLocalLinuxDoLevelProfile,
  type LinuxDoLevelProfile
} from '@/sources/linuxdo/level';
import {
  getXiaoyinsiLevelProfile as getLocalXiaoyinsiLevelProfile,
  type XiaoyinsiLevelProfile
} from '@/sources/xiaoyinsi/account';
import type { XiaoyinsiApiCredentials } from '@/sources/xiaoyinsi/credentials';
import type { XiaoyinsiOptions } from '@/sources/xiaoyinsi/reader';
import {
  getDiscourseSourceEmojiUrls,
  searchDiscourseSourceTagOptions,
  searchDiscourseSourceUserOptions,
  type DiscourseReadAuth,
  type DiscourseTagOptionReadOptions,
  type DiscourseUserOptionReadOptions
} from './discourseRead';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import { sourceErrorFromUnknown } from './sourceErrors';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  hintDiagnosticOutcome,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import {
  normalizeDiagnosticReason,
  type DiagnosticFields,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import { sourceDiagnosticSummary } from './diagnostics';
import type { FeedSource, Source, SourceErrors, Topic } from '@/domain/forum/models';
import {
  isSessionSource,
  sessionSources,
  type DiscourseSource,
  type SessionSource
} from '@/domain/forum/sourceCatalog';

export { getCurrentUserProfile } from './sourceRead';
export { getLinuxDoLevelProfile, type LinuxDoLevelProfile } from '@/sources/linuxdo/level';
export type { XiaoyinsiLevelProfile } from '@/sources/xiaoyinsi/account';
export { checkYaohuoLoginDirect as checkYaohuoLogin } from '@/sources/yaohuo/reader';

type GetFeedOptions = Parameters<typeof getForumFeed>[0];

export function getFeed(options: GetFeedOptions) {
  if (options.source !== 'yaohuo') {
    return getForumFeed(options);
  }
  return getYaohuoFeedDirect({
    category: options.category,
    page: options.page,
    limit: options.limit,
    yaohuoFetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

type SearchTopicsOptions = Parameters<typeof searchForumTopics>[0];

export function searchTopics(options: SearchTopicsOptions) {
  if (options.source !== 'yaohuo') {
    return searchForumTopics(options);
  }
  return searchYaohuoDirect({
    query: options.query,
    page: options.page,
    limit: options.limit,
    category: options.filter?.source === 'yaohuo' ? options.filter.category : undefined,
    yaohuoFetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

type GetTopicOptions = Parameters<typeof getForumTopic>[0] & { topic?: Topic };

export function getTopic(options: GetTopicOptions) {
  if (options.source !== 'yaohuo') {
    return getForumTopic(options);
  }
  if (!options.topic) {
    throw new Error('妖火详情需要主题上下文');
  }
  return getYaohuoTopicDirect({
    topic: options.topic,
    yaohuoFetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

type GetRepliesOptions = Parameters<typeof getForumReplies>[0] & {
  categoryId?: string;
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
    targetFloor: options.targetReply?.floor,
    yaohuoFetcher: options.fetcher,
    signal: options.signal,
    timeoutMs: options.timeoutMs
  });
}

type GetUserProfileOptions = Parameters<typeof getForumUserProfile>[0];

export async function getUserProfile(options: GetUserProfileOptions) {
  return getForumUserProfile(options);
}

type ReadGatewayCredentialLoadOptions = {
  captureGeneration?: (generation: number) => void;
  diagnosticTrace?: DiagnosticTrace;
};

type ReadGatewayDependencies = {
  currentSessionEpoch?: (source: SessionSource) => number;
  currentXiaoyinsiCredentialGeneration?: () => number;
  fetcher: Fetcher;
  isSourceAuthenticated?: (source: SessionSource) => boolean;
  isSourceReadBlocked?: (source: SessionSource) => boolean;
  linuxDoUserAgent?: () => string;
  loadXiaoyinsiCredentialsForSource?: (
    source: FeedSource,
    options?: ReadGatewayCredentialLoadOptions
  ) => Promise<XiaoyinsiApiCredentials | undefined>;
  nodeSeekUserAgent: () => string;
  refreshXiaoyinsiAuthorization?: (trace?: DiagnosticTrace) => Promise<boolean | null>;
};

type GetCategoriesOptions = NonNullable<Parameters<typeof getForumCategories>[0]>;
type GetReplyOptions = Parameters<typeof getForumReply>[0];
type ManagedReadKeys =
  | 'discourseAuth'
  | 'fetcher'
  | 'linuxDoAuthenticated'
  | 'nodeSeekAuthenticated'
  | 'nodeSeekUserAgent'
  | 'unavailableSources';
type ManagedGetCategoriesOptions = Omit<GetCategoriesOptions, ManagedReadKeys>;
type ManagedGetFeedOptions = Omit<GetFeedOptions, ManagedReadKeys>;
type ManagedSearchTopicsOptions = Omit<SearchTopicsOptions, ManagedReadKeys>;
type ManagedGetTopicOptions = Omit<GetTopicOptions, ManagedReadKeys>;
type ManagedGetRepliesOptions = Omit<GetRepliesOptions, ManagedReadKeys>;
type ManagedGetReplyOptions = Omit<GetReplyOptions, ManagedReadKeys>;
type ManagedGetUserProfileOptions = Omit<GetUserProfileOptions, ManagedReadKeys>;
type ManagedResolveNodeSeekUserOptions = {
  signal?: AbortSignal;
  username: string;
};
type ManagedGetEmojiUrlsOptions = Omit<
  NonNullable<Parameters<typeof getDiscourseSourceEmojiUrls>[1]>,
  'auth' | 'fetcher'
> & { source: DiscourseSource };
type ManagedTagOptionSearchOptions = Omit<DiscourseTagOptionReadOptions, 'auth' | 'fetcher'> & {
  source: DiscourseSource;
};
type ManagedUserOptionSearchOptions = Omit<DiscourseUserOptionReadOptions, 'auth' | 'fetcher'> & {
  source: DiscourseSource;
};
type ManagedSemanticTopicSearchOptions = Omit<
  NonNullable<Parameters<typeof searchLinuxDoSemanticDirect>[1]>,
  'fetcher' | 'linuxDoAccess'
> & { query: string; source: 'linuxdo' };
type ManagedLinuxDoLevelProfileOptions = Omit<
  Parameters<typeof getLocalLinuxDoLevelProfile>[0],
  'fetcher' | 'userAgent'
> & {
  source: 'linuxdo';
};
type ManagedLevelProfileOptions = Omit<XiaoyinsiOptions, 'credentials' | 'fetcher'> & {
  source: 'xiaoyinsi';
};
export type ReadGatewayReadContext = {
  identityBarriers?: readonly SessionSource[];
  trace?: DiagnosticTrace;
};

function summarizeReadResult(result: unknown) {
  const value = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const errors =
    value.errors && typeof value.errors === 'object' ? Object.values(value.errors).filter(Boolean).length : 0;
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

export function createReadGateway<Dependencies extends ReadGatewayDependencies>(dependencies: Dependencies) {
  const read = async <T>(
    source: FeedSource,
    operationName: string,
    operation: (credentials: {
      discourseAuth?: DiscourseReadAuth;
      fetcher: Fetcher;
      linuxDoAuthenticated?: boolean;
      nodeSeekAuthenticated?: boolean;
      nodeSeekUserAgent?: string;
      unavailableSources?: readonly Source[];
    }) => Promise<T>,
    context?: ReadGatewayReadContext
  ) => {
    const ownsTrace = !context?.trace;
    const trace = context?.trace || beginDiagnosticTrace('source', operationName, { source });
    const identitySources: readonly SessionSource[] =
      source === 'all' ? sessionSources : isSessionSource(source) ? [source] : [];
    const sessionEpochs = Object.fromEntries(
      identitySources.map((identitySource) => [identitySource, dependencies.currentSessionEpoch?.(identitySource)])
    ) as Partial<Record<SessionSource, number | undefined>>;
    let xiaoyinsiGeneration: number | undefined;
    let hasXiaoyinsiCredentials = false;
    const credentialGenerationsAreCurrent = () =>
      identitySources.every(
        (identitySource) =>
          sessionEpochs[identitySource] === undefined ||
          dependencies.currentSessionEpoch?.(identitySource) === sessionEpochs[identitySource]
      ) &&
      (xiaoyinsiGeneration === undefined ||
        !dependencies.currentXiaoyinsiCredentialGeneration ||
        dependencies.currentXiaoyinsiCredentialGeneration() === xiaoyinsiGeneration);
    const readIsCurrent = credentialGenerationsAreCurrent;
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
      const blockedIdentitySources = identitySources.filter(
        (identitySource) =>
          dependencies.isSourceReadBlocked?.(identitySource) === true ||
          context?.identityBarriers?.includes(identitySource)
      );
      const linuxDoAuthenticated =
        (source === 'linuxdo' || source === 'all') &&
        dependencies.isSourceAuthenticated?.('linuxdo') === true &&
        !blockedIdentitySources.includes('linuxdo');
      const nodeSeekAuthenticated =
        (source === 'nodeseek' || source === 'all') &&
        dependencies.isSourceAuthenticated?.('nodeseek') === true &&
        !blockedIdentitySources.includes('nodeseek');
      if (source !== 'all' && blockedIdentitySources.length) {
        throw new Error('登录状态待确认；已暂停该站的新请求');
      }
      const xiaoyinsiCredentials =
        (source === 'xiaoyinsi' || source === 'all') && !blockedIdentitySources.includes('xiaoyinsi')
          ? await loadCredential('xiaoyinsi', async () =>
              dependencies.loadXiaoyinsiCredentialsForSource?.(source, {
                captureGeneration: (generation) => {
                  xiaoyinsiGeneration = generation;
                },
                diagnosticTrace: trace
              })
            )
          : undefined;
      const discourseAuth: DiscourseReadAuth | undefined =
        source === 'linuxdo' || source === 'all' || xiaoyinsiCredentials
          ? {
              ...(source === 'linuxdo' || source === 'all'
                ? {
                    linuxdo: {
                      authenticated: linuxDoAuthenticated,
                      userAgent: dependencies.linuxDoUserAgent?.()
                    }
                  }
                : {}),
              ...(xiaoyinsiCredentials ? { xiaoyinsi: xiaoyinsiCredentials } : {})
            }
          : undefined;
      const unavailableSources =
        source === 'all'
          ? [...new Set([...(Object.keys(credentialErrors) as Source[]), ...blockedIdentitySources])]
          : [];
      hasXiaoyinsiCredentials = Boolean(xiaoyinsiCredentials);
      if (!readIsCurrent()) {
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      markDiagnosticStage(trace, 'credential', {
        source,
        hasCredential: Boolean(
          linuxDoAuthenticated ||
          nodeSeekAuthenticated ||
          ((source === 'yaohuo' || source === 'all') && dependencies.isSourceAuthenticated?.('yaohuo') === true) ||
          xiaoyinsiCredentials
        ),
        isCredentialKnown: blockedIdentitySources.length === 0
      });
      markDiagnosticStage(trace, 'transport', { source, channel: 'direct', state: 'start' });
      const result = await operation({
        discourseAuth,
        fetcher: withDiagnosticFetcher(trace, dependencies.fetcher),
        linuxDoAuthenticated,
        nodeSeekAuthenticated,
        nodeSeekUserAgent: source === 'nodeseek' || source === 'all' ? dependencies.nodeSeekUserAgent() : undefined,
        ...(unavailableSources.length ? { unavailableSources } : {})
      });
      if (!readIsCurrent()) {
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      if (
        source === 'all' &&
        result &&
        typeof result === 'object' &&
        !Array.isArray(result) &&
        unavailableSources.length
      ) {
        const aggregateResult = result as { errors?: SourceErrors; items?: unknown[] };
        if (Array.isArray(aggregateResult.items)) {
          const unavailableSourceSet = new Set(unavailableSources);
          aggregateResult.items = aggregateResult.items.filter(
            (item) =>
              !item ||
              typeof item !== 'object' ||
              Array.isArray(item) ||
              !unavailableSourceSet.has((item as { source?: Source }).source as Source)
          );
        }
        const aggregateErrors = { ...aggregateResult.errors };
        blockedIdentitySources.forEach((blockedSource) => {
          delete aggregateErrors[blockedSource];
        });
        aggregateResult.errors = { ...aggregateErrors, ...credentialErrors };
      }
      const resultRecord = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const resultErrors =
        resultRecord.errors && typeof resultRecord.errors === 'object'
          ? (resultRecord.errors as Record<string, unknown>)
          : {};
      const xiaoyinsiResultError =
        resultErrors.xiaoyinsi && typeof resultErrors.xiaoyinsi === 'object'
          ? (resultErrors.xiaoyinsi as { kind?: unknown })
          : null;
      if (
        hasXiaoyinsiCredentials &&
        credentialGenerationsAreCurrent() &&
        (xiaoyinsiResultError?.kind === 'login-expired' || xiaoyinsiResultError?.kind === 'permission-denied')
      ) {
        await dependencies.refreshXiaoyinsiAuthorization?.(trace).catch(() => false);
        if (!readIsCurrent()) {
          throw new Error(REQUEST_CANCELED_MESSAGE);
        }
      }
      const summary = summarizeReadResult(result);
      markDiagnosticStage(trace, 'parse', { source, ...summary });
      const parseEmpty = summary.isParseEmpty === true;
      const degraded = parseEmpty || summary.hasDegradation === true || Number(summary.partialErrorCount || 0) > 0;
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
      if (!readIsCurrent()) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source, reason: 'superseded' });
        }
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      if (
        source === 'xiaoyinsi' &&
        hasXiaoyinsiCredentials &&
        credentialGenerationsAreCurrent() &&
        (sourceError.kind === 'login-expired' || sourceError.kind === 'permission-denied')
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
      return (
        dependencies.isSourceAuthenticated?.('yaohuo') === true && dependencies.isSourceReadBlocked?.('yaohuo') !== true
      );
    },
    getCategories(options: ManagedGetCategoriesOptions = {}, context?: ReadGatewayReadContext) {
      const source = options.source || 'all';
      return read(
        source,
        'getCategories',
        (credentials) =>
          getForumCategories({
            ...options,
            ...credentials
          }),
        context
      );
    },
    getFeed(options: ManagedGetFeedOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getFeed',
        (credentials) =>
          getFeed({
            ...options,
            ...credentials
          }),
        context
      );
    },
    getEmojiUrls({ source, ...options }: ManagedGetEmojiUrlsOptions, context?: ReadGatewayReadContext) {
      return read(
        source,
        'getEmojiUrls',
        ({ discourseAuth, fetcher }) =>
          getDiscourseSourceEmojiUrls(source, {
            ...options,
            auth: discourseAuth,
            fetcher
          }),
        context
      );
    },
    searchTopics(options: ManagedSearchTopicsOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'searchTopics',
        (credentials) =>
          searchTopics({
            ...options,
            ...credentials
          }),
        context
      );
    },
    searchTagOptions(request: ManagedTagOptionSearchOptions, context?: ReadGatewayReadContext) {
      const { source, ...options } = request;
      return read(
        source,
        'searchTagOptions',
        ({ discourseAuth, fetcher }) =>
          searchDiscourseSourceTagOptions(source, {
            ...options,
            auth: discourseAuth,
            fetcher
          }),
        context
      );
    },
    searchUserOptions(request: ManagedUserOptionSearchOptions, context?: ReadGatewayReadContext) {
      const { source, ...options } = request;
      return read(
        source,
        'searchUserOptions',
        ({ discourseAuth, fetcher }) =>
          searchDiscourseSourceUserOptions(source, {
            ...options,
            auth: discourseAuth,
            fetcher
          }),
        context
      );
    },
    searchSemanticTopics(
      { query, source, ...options }: ManagedSemanticTopicSearchOptions,
      context?: ReadGatewayReadContext
    ) {
      return read(
        source,
        'searchSemanticTopics',
        ({ discourseAuth, fetcher }) =>
          searchLinuxDoSemanticDirect(query, {
            ...options,
            fetcher,
            linuxDoAccess: discourseAuth?.linuxdo
          }),
        context
      );
    },
    getLinuxDoLevelProfile(
      { source, ...options }: ManagedLinuxDoLevelProfileOptions,
      context?: ReadGatewayReadContext
    ): Promise<LinuxDoLevelProfile> {
      return read(
        source,
        'getLevelProfile',
        ({ discourseAuth, fetcher }) => {
          if (discourseAuth?.linuxdo?.authenticated !== true) {
            throw Object.assign(new Error('请先完成 linux.do 登录 / 验证。'), {
              source: 'linuxdo' as const,
              loginRequired: true
            });
          }
          return getLocalLinuxDoLevelProfile({
            ...options,
            userAgent: discourseAuth.linuxdo.userAgent,
            fetcher
          });
        },
        context
      );
    },
    getTopic(options: ManagedGetTopicOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getTopic',
        (credentials) =>
          getTopic({
            ...options,
            ...credentials
          }),
        context
      );
    },
    getReplies(options: ManagedGetRepliesOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getReplies',
        (credentials) =>
          getReplies({
            ...options,
            ...credentials
          }),
        context
      );
    },
    getReply(options: ManagedGetReplyOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getReply',
        (credentials) =>
          getForumReply({
            ...options,
            ...credentials
          }),
        context
      );
    },
    getUserProfile(options: ManagedGetUserProfileOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getUserProfile',
        (credentials) =>
          getUserProfile({
            ...options,
            ...credentials
          }),
        context
      );
    },
    resolveNodeSeekUser(options: ManagedResolveNodeSeekUserOptions, context?: ReadGatewayReadContext) {
      return read(
        'nodeseek',
        'resolveUser',
        ({ fetcher, nodeSeekAuthenticated, nodeSeekUserAgent }) =>
          resolveNodeSeekUserDirect(options.username, {
            authenticated: nodeSeekAuthenticated,
            fetcher,
            nodeSeekUserAgent,
            signal: options.signal
          }),
        context
      );
    },
    getLevelProfile(
      { source, ...options }: ManagedLevelProfileOptions,
      context?: ReadGatewayReadContext
    ): Promise<XiaoyinsiLevelProfile> {
      return read(
        source,
        'getLevelProfile',
        ({ discourseAuth, fetcher }) => {
          const credentials = discourseAuth?.xiaoyinsi;
          if (!credentials) {
            throw Object.assign(new Error('请先授权小隐寺'), {
              source: 'xiaoyinsi' as const,
              loginRequired: true
            });
          }
          return getLocalXiaoyinsiLevelProfile({ ...options, credentials, fetcher });
        },
        context
      );
    }
  };
}

export type ReadGateway = ReturnType<typeof createReadGateway>;
