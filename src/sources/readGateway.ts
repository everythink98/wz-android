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
import {
  RequestCanceledError,
  REQUEST_CANCELED_MESSAGE,
  RequestTimeoutError,
  rejectUnauthorizedResponse,
  type Fetcher
} from '@/platform/network/request';
import {
  browserFetchIntentFromInit,
  withBrowserFetchIntent,
  type BrowserFetchIntent
} from '@/platform/network/browserFetchIntent';
import { recoverReadNetworkRuntime } from '@/platform/network/networkProxy';
import { getReadNetworkRuntimeSnapshot } from '@/platform/network/readNetworkRuntime';
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
import { copySourceDiagnosticSummary, sourceDiagnosticSummary } from './diagnostics';
import { runForumSourceReadAttempt, withForumSourceReadEligibility } from './forumSourceReadAttempt';
import type { FeedSource, Source, SourceErrors, Topic } from '@/domain/forum/models';
import {
  prepareRepliesContent,
  prepareReplyContent,
  prepareTopicContent,
  type PreparedRepliesResponse,
  type PreparedReply,
  type PreparedTopicDetail
} from '@/domain/forum/topicContentSplit';
import { resolveForumReadPlan, type ForumReadOperation, type ForumReadPlan } from '@/domain/forum/readPlan';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';
import { isSessionSource, sourceValues, type DiscourseSource, type SessionSource } from '@/domain/forum/sourceCatalog';

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

export async function getTopic(options: GetTopicOptions, trace?: DiagnosticTrace): Promise<PreparedTopicDetail> {
  const detail =
    options.source !== 'yaohuo'
      ? await getForumTopic({ ...options, diagnosticTrace: trace })
      : options.topic
        ? await getYaohuoTopicDirect({
            topic: options.topic,
            yaohuoFetcher: options.fetcher,
            signal: options.signal,
            timeoutMs: options.timeoutMs
          })
        : (() => {
            throw new Error('妖火详情需要主题上下文');
          })();
  const sourcePreparedAndTraced = options.source === 'nodeseek' && Boolean(detail.preparedContent);
  if (trace && !sourcePreparedAndTraced) {
    markDiagnosticStage(trace, 'parse', { source: options.source, state: 'source-parsed' });
  }
  const preparedDetail = prepareTopicContent(detail);
  if (trace && !sourcePreparedAndTraced) {
    markDiagnosticStage(trace, 'parse', {
      source: options.source,
      state: 'content-plan-ready',
      plannedRowCount: preparedDetail.preparedContent.contentPlan.rows.length,
      networkMediaCount: preparedDetail.preparedContent.contentPlan.previewImages.length
    });
  }
  const prepared = preparedDetail === detail ? preparedDetail : copySourceDiagnosticSummary(preparedDetail, detail);
  const result: PreparedTopicDetail = prepared.replyCompleteness
    ? prepared
    : copySourceDiagnosticSummary({ ...prepared, replyCompleteness: 'partial' }, prepared);
  return result;
}

type GetRepliesOptions = Parameters<typeof getForumReplies>[0] & {
  categoryId?: string;
};

export async function getReplies(
  options: GetRepliesOptions,
  trace?: DiagnosticTrace
): Promise<PreparedRepliesResponse> {
  const response =
    options.source !== 'yaohuo'
      ? await getForumReplies(options)
      : await getYaohuoRepliesDirect({
          id: options.id,
          categoryId: options.categoryId,
          order: options.order,
          position: options.position,
          limit: options.limit,
          replyCount: options.replyCount,
          yaohuoFetcher: options.fetcher,
          signal: options.signal,
          timeoutMs: options.timeoutMs
        });
  if (trace) markDiagnosticStage(trace, 'parse', { source: options.source, state: 'source-parsed' });
  const preparedResponse = prepareRepliesContent(response, options.source);
  if (trace) markDiagnosticStage(trace, 'parse', { source: options.source, state: 'content-plan-ready' });
  const prepared =
    preparedResponse === response ? preparedResponse : copySourceDiagnosticSummary(preparedResponse, response);
  const result: PreparedRepliesResponse = prepared.completeness
    ? prepared
    : copySourceDiagnosticSummary({ ...prepared, completeness: 'partial' }, prepared);
  return result;
}

export async function getReply(
  options: Parameters<typeof getForumReply>[0],
  trace?: DiagnosticTrace
): Promise<PreparedReply> {
  const reply = await getForumReply(options);
  if (trace) markDiagnosticStage(trace, 'parse', { source: options.source, state: 'source-parsed' });
  const prepared = prepareReplyContent(reply, options.source, 'quoted-reply');
  if (trace) markDiagnosticStage(trace, 'parse', { source: options.source, state: 'content-plan-ready' });
  const result: PreparedReply = prepared === reply ? prepared : copySourceDiagnosticSummary(prepared, reply);
  return result;
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
  anonymousFetcher: Fetcher;
  currentXiaoyinsiCredentialGeneration?: () => number;
  fetcher: Fetcher;
  getEnabledSources?: () => readonly Source[];
  linuxDoUserAgent?: () => string;
  loadXiaoyinsiCredentialsForSource?: (
    source: FeedSource,
    options?: ReadGatewayCredentialLoadOptions
  ) => Promise<XiaoyinsiApiCredentials | undefined>;
  nodeSeekUserAgent: () => string;
  onSessionExpired?: (source: SessionSource, requestSessionEpoch: number) => void;
  readSessionRuntimeSnapshot: (source: SessionSource) => SessionRuntimeSnapshot;
};

type GetCategoriesOptions = NonNullable<Parameters<typeof getForumCategories>[0]>;
type GetReplyOptions = Parameters<typeof getForumReply>[0];
type ManagedReadKeys =
  | 'diagnosticTrace'
  | 'discourseAuth'
  | 'fetcher'
  | 'fetcherForSource'
  | 'linuxDoAuthenticated'
  | 'nodeSeekAuthenticated'
  | 'nodeSeekUserAgent'
  | 'includedSources'
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
  includedSources?: readonly Source[];
  readPlanScope?: string;
  readPlanScopes?: readonly (readonly [Source, string])[];
  trace?: DiagnosticTrace;
};

function normalizeEnabledSources(sources?: readonly Source[]) {
  const enabled = new Set(sources || sourceValues);
  return sourceValues.filter((source) => enabled.has(source));
}

function sameEnabledSources(left: readonly Source[], right: readonly Source[]) {
  return left.length === right.length && left.every((source, index) => source === right[index]);
}

const browserFetchOwnerByReadOperation: Record<ForumReadOperation, BrowserFetchIntent['owner']> = {
  categories: 'feed',
  emoji: 'topic',
  feed: 'feed',
  level: 'user',
  replies: 'topic',
  reply: 'topic',
  search: 'search',
  'search-tags': 'search',
  'search-users': 'search',
  'semantic-search': 'search',
  topic: 'topic',
  'user-profile': 'user',
  'user-resolution': 'user'
};

type ReadAttempt = {
  contentRequestStarted: boolean;
  replayable: boolean;
};

function withManagedReadIntent(fetcher: Fetcher, operation: ForumReadOperation, attempt: ReadAttempt): Fetcher {
  const defaultIntent: BrowserFetchIntent = {
    owner: browserFetchOwnerByReadOperation[operation],
    priority: 'foreground'
  };
  return (input, init) => {
    const method = String(init?.method || 'GET').toUpperCase();
    const existingIntent = browserFetchIntentFromInit(init);
    const intent = existingIntent || defaultIntent;
    if ((method !== 'GET' && method !== 'HEAD') || intent.owner === 'write' || intent.priority !== 'foreground') {
      attempt.replayable = false;
    } else {
      attempt.contentRequestStarted = true;
    }
    return fetcher(input, existingIntent ? init : withBrowserFetchIntent(init || {}, defaultIntent));
  };
}

function sourceUsesDirectTimeoutRecovery(
  source: FeedSource
): source is Extract<Source, 'v2ex' | 'yaohuo' | 'xiaoyinsi'> {
  return source === 'v2ex' || source === 'yaohuo' || source === 'xiaoyinsi';
}

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
  if (typeof value.currentPage === 'number') {
    summary.resolvedPage = value.currentPage;
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

function blockedReadError(source: Source, plan: Extract<ForumReadPlan, { state: 'blocked' }>) {
  const message =
    plan.reason === 'source-disabled'
      ? '内容源已停用'
      : plan.reason === 'identity-pending'
        ? '登录状态暂时无法确认'
        : plan.reason === 'identity-unavailable'
          ? '登录状态核对失败，请重试'
          : plan.reason === 'login-required'
            ? '请先登录该内容源'
            : '该内容源不支持此读取';
  return Object.assign(new Error(message), {
    kind: plan.reason === 'login-required' ? ('login-required' as const) : ('ordinary' as const),
    ...(plan.reason === 'login-required' ? { loginRequired: true } : {}),
    reason: plan.reason,
    retryable: plan.reason === 'identity-pending' || plan.reason === 'identity-unavailable',
    source
  });
}

export function createReadGateway<Dependencies extends ReadGatewayDependencies>(dependencies: Dependencies) {
  const authenticatedFetcher = rejectUnauthorizedResponse(dependencies.fetcher);
  const currentEnabledSources = () => normalizeEnabledSources(dependencies.getEnabledSources?.());
  const readSessionSnapshot = (source: SessionSource) => dependencies.readSessionRuntimeSnapshot(source);
  const getReadPlan = (source: Source, operation: ForumReadOperation) =>
    resolveForumReadPlan(
      source,
      operation,
      currentEnabledSources().includes(source),
      isSessionSource(source) ? readSessionSnapshot(source) : undefined
    );
  const read = async <T>(
    source: FeedSource,
    operationName: string,
    readOperation: ForumReadOperation,
    operation: (credentials: {
      discourseAuth?: DiscourseReadAuth;
      fetcher: Fetcher;
      fetcherForSource?: (source: Source) => Fetcher;
      linuxDoAuthenticated?: boolean;
      nodeSeekAuthenticated?: boolean;
      nodeSeekUserAgent?: string;
      trace: DiagnosticTrace;
      unavailableSources?: readonly Source[];
    }) => Promise<T>,
    context?: ReadGatewayReadContext,
    signal?: AbortSignal,
    intentFields: DiagnosticFields = {}
  ) => {
    const ownsTrace = !context?.trace;
    const trace = context?.trace || beginDiagnosticTrace('source', operationName, { source, ...intentFields });
    if (context?.trace && Object.keys(intentFields).length) {
      markDiagnosticStage(trace, 'guard', { source, ...intentFields });
    }
    const enabledSnapshot = currentEnabledSources();
    const includedSources =
      source === 'all' ? normalizeEnabledSources(context?.includedSources || enabledSnapshot) : [];
    if (
      source === 'all' &&
      dependencies.getEnabledSources &&
      context?.includedSources &&
      !sameEnabledSources(enabledSnapshot, includedSources)
    ) {
      if (ownsTrace) {
        finishDiagnosticTrace(trace, 'stale', { reason: 'superseded', source });
      }
      throw new Error(REQUEST_CANCELED_MESSAGE);
    }
    const enabledSourcesAreCurrent = () =>
      !dependencies.getEnabledSources ||
      (source === 'all'
        ? sameEnabledSources(currentEnabledSources(), includedSources)
        : currentEnabledSources().includes(source));
    const planSources = source === 'all' ? includedSources : [source];
    const sessionSnapshots = new Map(
      planSources.flatMap((planSource) =>
        isSessionSource(planSource) ? ([[planSource, readSessionSnapshot(planSource)]] as const) : []
      )
    );
    const planSnapshot = new Map(
      planSources.map((planSource) => [
        planSource,
        resolveForumReadPlan(
          planSource,
          readOperation,
          enabledSnapshot.includes(planSource),
          isSessionSource(planSource) ? sessionSnapshots.get(planSource) : undefined
        )
      ])
    );
    const expectedPlanScopes = new Map(context?.readPlanScopes || []);
    const directPlan = source === 'all' ? undefined : planSnapshot.get(source);
    if (
      (source !== 'all' && context?.readPlanScope && directPlan?.cacheScope !== context.readPlanScope) ||
      (source === 'all' &&
        expectedPlanScopes.size > 0 &&
        planSources.some(
          (planSource) => expectedPlanScopes.get(planSource) !== planSnapshot.get(planSource)?.cacheScope
        ))
    ) {
      if (ownsTrace) finishDiagnosticTrace(trace, 'stale', { reason: 'superseded', source });
      throw new Error(REQUEST_CANCELED_MESSAGE);
    }
    if (source !== 'all' && directPlan?.state === 'blocked') {
      const error = blockedReadError(source, directPlan);
      if (ownsTrace) finishDiagnosticTrace(trace, 'blocked', { reason: normalizeDiagnosticReason(error), source });
      throw error;
    }
    let xiaoyinsiGeneration: number | undefined;
    const credentialGenerationsAreCurrent = () =>
      xiaoyinsiGeneration === undefined ||
      !dependencies.currentXiaoyinsiCredentialGeneration ||
      dependencies.currentXiaoyinsiCredentialGeneration() === xiaoyinsiGeneration;
    const readPlansAreCurrent = () =>
      planSources.every(
        (planSource) => getReadPlan(planSource, readOperation).cacheScope === planSnapshot.get(planSource)?.cacheScope
      );
    const readIsCurrent = () =>
      credentialGenerationsAreCurrent() && enabledSourcesAreCurrent() && readPlansAreCurrent();
    const recoveryCommitIsEligible = () => readIsCurrent() && signal?.aborted !== true;
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
      const planFor = (planSource: Source) => planSnapshot.get(planSource);
      const unavailablePlanSources = planSources.filter((planSource) => planFor(planSource)?.state === 'blocked');
      const linuxDoPlan = planFor('linuxdo');
      const nodeSeekPlan = planFor('nodeseek');
      const yaohuoPlan = planFor('yaohuo');
      const xiaoyinsiPlan = planFor('xiaoyinsi');
      const linuxDoAuthenticated = linuxDoPlan?.state === 'ready' && linuxDoPlan.lane === 'authenticated';
      const nodeSeekAuthenticated = nodeSeekPlan?.state === 'ready' && nodeSeekPlan.lane === 'authenticated';
      const xiaoyinsiCredentials =
        xiaoyinsiPlan?.state === 'ready' && xiaoyinsiPlan.lane === 'authenticated'
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
        linuxDoPlan?.state === 'ready' || xiaoyinsiCredentials
          ? {
              ...(linuxDoPlan?.state === 'ready'
                ? {
                    linuxdo: {
                      authenticated: linuxDoAuthenticated,
                      categoryCacheScope: linuxDoPlan.cacheScope,
                      userAgent: dependencies.linuxDoUserAgent?.()
                    }
                  }
                : {}),
              ...(xiaoyinsiCredentials
                ? {
                    xiaoyinsi: {
                      ...xiaoyinsiCredentials,
                      ...(xiaoyinsiGeneration === undefined ? {} : { generation: xiaoyinsiGeneration })
                    }
                  }
                : {})
            }
          : undefined;
      const unavailableSources =
        source === 'all'
          ? [...new Set([...(Object.keys(credentialErrors) as Source[]), ...unavailablePlanSources])]
          : [];
      if (!readIsCurrent()) {
        throw new Error(REQUEST_CANCELED_MESSAGE);
      }
      const anonymousFetcher: Fetcher = (input, init) =>
        dependencies.anonymousFetcher(input, { ...init, credentials: 'omit' });
      const localFetcher: Fetcher = async () => {
        throw new Error('本地读取不得发起网络请求');
      };
      const sourcePlanFetcher = (planSource: Source): Fetcher => {
        const plan = planFor(planSource);
        if (!plan || plan.state === 'blocked' || plan.transport === 'none') return localFetcher;
        return plan.transport === 'native-no-cookie' ? anonymousFetcher : authenticatedFetcher;
      };
      const operationFetcher = source === 'all' ? localFetcher : sourcePlanFetcher(source);
      markDiagnosticStage(trace, 'credential', {
        source,
        hasCredential: Boolean(
          linuxDoAuthenticated ||
          nodeSeekAuthenticated ||
          (yaohuoPlan?.state === 'ready' && yaohuoPlan.lane === 'authenticated') ||
          xiaoyinsiCredentials
        ),
        isCredentialKnown: unavailablePlanSources.length === 0
      });
      markDiagnosticStage(trace, 'transport', { source, channel: 'direct', state: 'start' });
      const ownFetcher = (fetcher: Fetcher, attempt: ReadAttempt) =>
        withForumSourceReadEligibility(
          withManagedReadIntent(withDiagnosticFetcher(trace, fetcher), readOperation, attempt),
          recoveryCommitIsEligible
        );
      const runOperation = (fetcher: Fetcher, attempt: ReadAttempt) =>
        operation({
          discourseAuth,
          fetcher: ownFetcher(fetcher, attempt),
          ...(source === 'all'
            ? { fetcherForSource: (planSource: Source) => ownFetcher(sourcePlanFetcher(planSource), attempt) }
            : {}),
          linuxDoAuthenticated,
          nodeSeekAuthenticated,
          nodeSeekUserAgent: nodeSeekPlan?.state === 'ready' ? dependencies.nodeSeekUserAgent() : undefined,
          trace,
          ...(source === 'all' ? { includedSources } : {}),
          ...(unavailableSources.length ? { unavailableSources } : {})
        });
      const runReadAttempt = (attempt: ReadAttempt) =>
        source === 'linuxdo' || source === 'nodeseek'
          ? runForumSourceReadAttempt(
              source,
              operationFetcher,
              (fetcher) => runOperation(fetcher, attempt),
              recoveryCommitIsEligible
            )
          : runOperation(operationFetcher, attempt);
      const expectedGeneration = getReadNetworkRuntimeSnapshot().generation;
      const firstAttempt: ReadAttempt = { contentRequestStarted: false, replayable: true };
      let result: T;
      try {
        result = await runReadAttempt(firstAttempt);
      } catch (error) {
        const runtimeAfterFailure = getReadNetworkRuntimeSnapshot();
        const retryAfterRotation =
          source !== 'all' &&
          runtimeAfterFailure.generation > expectedGeneration &&
          runtimeAfterFailure.triggerSource === source &&
          firstAttempt.contentRequestStarted &&
          firstAttempt.replayable &&
          recoveryCommitIsEligible();
        const recoverAfterTimeout =
          !retryAfterRotation &&
          error instanceof RequestTimeoutError &&
          sourceUsesDirectTimeoutRecovery(source) &&
          firstAttempt.contentRequestStarted &&
          firstAttempt.replayable &&
          recoveryCommitIsEligible();
        if (!retryAfterRotation && !recoverAfterTimeout) {
          throw error;
        }
        if (recoverAfterTimeout) {
          const recoveryTrace = beginDiagnosticTrace('network', 'rotate-read-runtime', {
            source,
            generation: expectedGeneration,
            reason: 'timeout'
          });
          try {
            await recoverReadNetworkRuntime(source, expectedGeneration, { trace: recoveryTrace });
          } catch {
            if (getReadNetworkRuntimeSnapshot().generation <= expectedGeneration) {
              throw error;
            }
          }
        }
        if (!recoveryCommitIsEligible()) {
          throw new RequestCanceledError();
        }
        const generation = getReadNetworkRuntimeSnapshot().generation;
        markDiagnosticStage(trace, 'transport', {
          source,
          channel: 'direct',
          state: 'retry',
          reason: recoverAfterTimeout ? 'timeout' : 'runtime_rotation',
          retryCount: 1,
          generation
        });
        result = await runReadAttempt({ contentRequestStarted: false, replayable: true });
      }
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
        unavailablePlanSources.forEach((blockedSource) => {
          delete aggregateErrors[blockedSource];
        });
        aggregateResult.errors = { ...aggregateErrors, ...credentialErrors };
      }
      const resultRecord = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const resultErrors =
        resultRecord.errors && typeof resultRecord.errors === 'object'
          ? (resultRecord.errors as Record<string, unknown>)
          : {};
      for (const planSource of planSources) {
        if (!isSessionSource(planSource)) continue;
        const error = resultErrors[planSource];
        const session = sessionSnapshots.get(planSource);
        const plan = planSnapshot.get(planSource);
        if (
          error &&
          typeof error === 'object' &&
          (error as { reason?: unknown }).reason === 'http-401' &&
          session?.authenticated &&
          session.identityTrust === 'confirmed' &&
          plan?.state === 'ready' &&
          plan.lane === 'authenticated'
        ) {
          dependencies.onSessionExpired?.(planSource, session.sessionEpoch);
        }
      }
      if (!readIsCurrent()) throw new Error(REQUEST_CANCELED_MESSAGE);
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
      if (source !== 'all' && isSessionSource(source) && sourceError.reason === 'http-401') {
        const session = sessionSnapshots.get(source);
        const plan = planSnapshot.get(source);
        if (
          session?.authenticated &&
          session.identityTrust === 'confirmed' &&
          plan?.state === 'ready' &&
          plan.lane === 'authenticated'
        ) {
          dependencies.onSessionExpired?.(source, session.sessionEpoch);
        }
      }
      if (!readIsCurrent()) {
        if (ownsTrace) {
          finishDiagnosticTrace(trace, 'stale', { source, reason: 'superseded' });
        }
        throw new Error(REQUEST_CANCELED_MESSAGE);
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
    getReadPlan,
    async hasYaohuoCredential() {
      const plan = getReadPlan('yaohuo', 'feed');
      return plan.state === 'ready' && plan.lane === 'authenticated';
    },
    getCategories(options: ManagedGetCategoriesOptions = {}, context?: ReadGatewayReadContext) {
      const source = options.source || 'all';
      return read(
        source,
        'getCategories',
        'categories',
        (credentials) =>
          getForumCategories({
            ...options,
            ...credentials
          }),
        context,
        options.signal
      );
    },
    getFeed(options: ManagedGetFeedOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getFeed',
        'feed',
        ({ trace, ...credentials }) =>
          getFeed({
            ...options,
            ...credentials,
            diagnosticTrace: trace
          }),
        context,
        options.signal
      );
    },
    getEmojiUrls({ source, ...options }: ManagedGetEmojiUrlsOptions, context?: ReadGatewayReadContext) {
      return read(
        source,
        'getEmojiUrls',
        'emoji',
        ({ discourseAuth, fetcher }) =>
          getDiscourseSourceEmojiUrls(source, {
            ...options,
            auth: discourseAuth,
            fetcher
          }),
        context,
        options.signal
      );
    },
    searchTopics(options: ManagedSearchTopicsOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'searchTopics',
        'search',
        (credentials) =>
          searchTopics({
            ...options,
            ...credentials
          }),
        context,
        options.signal
      );
    },
    searchTagOptions(request: ManagedTagOptionSearchOptions, context?: ReadGatewayReadContext) {
      const { source, ...options } = request;
      return read(
        source,
        'searchTagOptions',
        'search-tags',
        ({ discourseAuth, fetcher }) =>
          searchDiscourseSourceTagOptions(source, {
            ...options,
            auth: discourseAuth,
            fetcher
          }),
        context,
        options.signal
      );
    },
    searchUserOptions(request: ManagedUserOptionSearchOptions, context?: ReadGatewayReadContext) {
      const { source, ...options } = request;
      return read(
        source,
        'searchUserOptions',
        'search-users',
        ({ discourseAuth, fetcher }) =>
          searchDiscourseSourceUserOptions(source, {
            ...options,
            auth: discourseAuth,
            fetcher
          }),
        context,
        options.signal
      );
    },
    searchSemanticTopics(
      { query, source, ...options }: ManagedSemanticTopicSearchOptions,
      context?: ReadGatewayReadContext
    ) {
      return read(
        source,
        'searchSemanticTopics',
        'semantic-search',
        ({ discourseAuth, fetcher }) =>
          searchLinuxDoSemanticDirect(query, {
            ...options,
            fetcher,
            linuxDoAccess: discourseAuth?.linuxdo
          }),
        context,
        options.signal
      );
    },
    getLinuxDoLevelProfile(
      { source, ...options }: ManagedLinuxDoLevelProfileOptions,
      context?: ReadGatewayReadContext
    ): Promise<LinuxDoLevelProfile> {
      return read(
        source,
        'getLevelProfile',
        'level',
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
        context,
        options.signal
      );
    },
    getTopic(options: ManagedGetTopicOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getTopic',
        'topic',
        ({ trace, ...credentials }) =>
          getTopic(
            {
              ...options,
              ...credentials
            },
            trace
          ),
        context,
        options.signal
      );
    },
    getReplies(options: ManagedGetRepliesOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getReplies',
        'replies',
        ({ trace, ...credentials }) =>
          getReplies(
            {
              ...options,
              ...credentials
            },
            trace
          ),
        context,
        options.signal,
        { replyOrder: options.order, positionKind: options.position.kind }
      );
    },
    getReply(options: ManagedGetReplyOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getReply',
        'reply',
        ({ trace, ...credentials }) =>
          getReply(
            {
              ...options,
              ...credentials
            },
            trace
          ),
        context,
        options.signal
      );
    },
    getUserProfile(options: ManagedGetUserProfileOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getUserProfile',
        'user-profile',
        (credentials) =>
          getUserProfile({
            ...options,
            ...credentials
          }),
        context,
        options.signal
      );
    },
    resolveNodeSeekUser(options: ManagedResolveNodeSeekUserOptions, context?: ReadGatewayReadContext) {
      return read(
        'nodeseek',
        'resolveUser',
        'user-resolution',
        ({ fetcher, nodeSeekAuthenticated, nodeSeekUserAgent }) =>
          resolveNodeSeekUserDirect(options.username, {
            authenticated: nodeSeekAuthenticated,
            fetcher,
            nodeSeekUserAgent,
            signal: options.signal
          }),
        context,
        options.signal
      );
    },
    getLevelProfile(
      { source, ...options }: ManagedLevelProfileOptions,
      context?: ReadGatewayReadContext
    ): Promise<XiaoyinsiLevelProfile> {
      return read(
        source,
        'getLevelProfile',
        'level',
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
        context,
        options.signal
      );
    }
  };
}

export type ReadGateway = ReturnType<typeof createReadGateway>;
