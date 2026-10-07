import { getCategories as getForumCategories, getFeed as getForumFeed } from './feedRead';
import {
  getReply as getForumReply,
  getReplies as getForumReplies,
  getTopic as getForumTopic,
  getUserDetails as getForumUserDetails,
  getUserTopics as getForumUserTopics,
  getUserReplies as getForumUserReplies
} from './sourceRead';
import { searchTopics as searchForumTopics } from './searchRead';
import {
  searchLinuxDoSemantic as searchLinuxDoSemanticDirect,
  searchLinuxDoTags,
  searchLinuxDoUsers
} from '@/sources/linuxdo/search';
import { resolveNodeSeekUser as resolveNodeSeekUserDirect } from '@/sources/nodeseek/reader';
import {
  getNodeSeekAccountOverview as getNodeSeekAccountOverviewDirect,
  getNodeSeekAttendanceBoard as getNodeSeekAttendanceBoardDirect,
  getNodeSeekCredits as getNodeSeekCreditsDirect,
  getNodeSeekStardustCredits as getNodeSeekStardustCreditsDirect
} from '@/sources/nodeseek/accountData';
import { getYaohuoAccountOverview as getYaohuoAccountOverviewDirect } from '@/sources/yaohuo/accountData';
import {
  getLinuxDoLevelProfile as getLocalLinuxDoLevelProfile,
  type LinuxDoLevelProfile
} from '@/sources/linuxdo/level';
import { getLinuxDoEmojiUrls, type LinuxDoOptions, type LinuxDoReadAuth } from '@/sources/linuxdo/reader';
import {
  RequestCanceledError,
  REQUEST_CANCELED_MESSAGE,
  RequestTimeoutError,
  rejectUnauthorizedResponse,
  withRequestBeforeSend,
  type Fetcher
} from '@/platform/network/request';
import {
  browserFetchIntentFromInit,
  FORUM_READ_COOKIE_POLICY_HEADER,
  withBrowserFetchIntent,
  type BrowserFetchIntent
} from '@/platform/network/browserFetchIntent';
import { recoverReadNetworkRuntime } from '@/platform/network/networkProxy';
import { getReadNetworkRuntimeSnapshot } from '@/platform/network/readNetworkRuntime';
import { errorRequiresAccountRecheck, sourceErrorFromUnknown } from './sourceErrors';
import type { RequestAccountRecheck } from '@/domain/session/sessionContracts';
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
  type DiagnosticOperation,
  type DiagnosticTrace
} from '@/platform/diagnostics/diagnosticPolicy';
import { copySourceDiagnosticSummary, sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { runForumSourceReadAttempt, withForumSourceReadEligibility } from './forumSourceReadAttempt';
import type { FeedResponse, FeedSource, Source, SourceErrors, DiscourseTopicReading } from '@/domain/forum/models';
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

import type { DiscourseReadingRuntime } from '@/platform/query/discourseReadingRuntime';
import { getLinuxDoReadingBatch, getLinuxDoTopicReading } from '@/sources/linuxdo/reading';
import { loadLinuxDoTopicCreationContext } from '@/sources/linuxdo/topicCreation';
import { loadLinuxDoTopicEditContext } from '@/sources/linuxdo/topicEditing';
import { loadNodeSeekTopicEditContext } from '@/sources/nodeseek/topicEditing';
import { loadYaohuoTopicEditContext } from '@/sources/yaohuo/topicEditing';
import type { TopicCreationSource } from '@/domain/forum/topicComposer';

export { getCurrentUserIdentity } from './sourceRead';
export { getLinuxDoLevelProfile, type LinuxDoLevelProfile } from '@/sources/linuxdo/level';
export { checkYaohuoLoginDirect as checkYaohuoLogin } from '@/sources/yaohuo/reader';

type GetFeedOptions = Parameters<typeof getForumFeed>[0];

type SearchTopicsOptions = Parameters<typeof searchForumTopics>[0];

type GetTopicOptions = Parameters<typeof getForumTopic>[0];

export async function getTopic(options: GetTopicOptions, trace?: DiagnosticTrace): Promise<PreparedTopicDetail> {
  const detail = await getForumTopic({ ...options, diagnosticTrace: trace });
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
  isPrivateMessage?: boolean;
};

export async function getReplies(
  options: GetRepliesOptions,
  trace?: DiagnosticTrace
): Promise<PreparedRepliesResponse> {
  const response = await getForumReplies(options);
  if (trace) markDiagnosticStage(trace, 'parse', { source: options.source, state: 'source-parsed' });
  const preparedResponse = prepareRepliesContent(response, options.source, options.id);
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

export { getUserDetails, getUserTopics, getUserReplies } from './sourceRead';

type ReadGatewayDependencies = {
  reading?: DiscourseReadingRuntime;
  anonymousFetcher: Fetcher;
  fetcher: Fetcher;
  getEnabledSources?: () => readonly Source[];
  linuxDoUserAgent?: () => string;
  nodeSeekUserAgent: () => string;
  onSessionExpired?: (source: SessionSource, requestSessionEpoch: number) => void;
  requestAccountRecheck?: RequestAccountRecheck;
  readSessionRuntimeSnapshot: (source: SessionSource) => SessionRuntimeSnapshot;
};

type GetCategoriesOptions = NonNullable<Parameters<typeof getForumCategories>[0]>;
type GetReplyOptions = Parameters<typeof getForumReply>[0];
type ManagedReadKeys =
  | 'diagnosticTrace'
  | 'discourseAuth'
  | 'fetcher'
  | 'fetcherForSource'
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
type ManagedUserDetailsOptions = Omit<Parameters<typeof getForumUserDetails>[0], ManagedReadKeys>;
type ManagedUserActivityOptions = Omit<Parameters<typeof getForumUserTopics>[0], ManagedReadKeys>;
type ManagedResolveNodeSeekUserOptions = {
  signal?: AbortSignal;
  username: string;
};
type ManagedAccountDataOptions = {
  userId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};
type ManagedGetEmojiUrlsOptions = Pick<LinuxDoOptions, 'signal' | 'timeoutMs'> & {
  source: DiscourseSource;
};
type ManagedTagOptionSearchOptions = Pick<
  NonNullable<Parameters<typeof searchLinuxDoTags>[0]>,
  'categoryId' | 'limit' | 'query' | 'selectedTags'
> &
  ManagedGetEmojiUrlsOptions;
type ManagedUserOptionSearchOptions = Pick<Parameters<typeof searchLinuxDoUsers>[0], 'categoryId' | 'limit' | 'term'> &
  ManagedGetEmojiUrlsOptions;
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
  'account-data': 'user',
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
  'topic-creation-context': 'topic',
  'topic-edit-context': 'topic',
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

function sourceUsesDirectTimeoutRecovery(source: FeedSource): source is Extract<Source, 'v2ex' | 'yaohuo'> {
  return source === 'v2ex' || source === 'yaohuo';
}

function summarizeReadResult(result: unknown) {
  const value = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const errors =
    value.errors && typeof value.errors === 'object' ? Object.values(value.errors).filter(Boolean).length : 0;
  const summary: { -readonly [Key in keyof DiagnosticFields]: DiagnosticFields[Key] } = {
    hasResult: result !== null && result !== undefined,
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
    operationName: DiagnosticOperation,
    readOperation: ForumReadOperation,
    operation: (credentials: {
      discourseAuth?: LinuxDoReadAuth;
      fetcher: Fetcher;
      fetcherForSource?: (source: Source) => Fetcher;
      nodeSeekAuthenticated?: boolean;
      nodeSeekUserAgent?: string;
      trace: DiagnosticTrace;
      unavailableSources?: readonly Source[];
    }) => Promise<T>,
    context?: ReadGatewayReadContext,
    signal?: AbortSignal,
    intentFields: DiagnosticFields = {},
    onBeforeSessionChange?: (result: T) => void
  ) => {
    const readingRequest = dependencies.reading?.startRequest();
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
    const readPlansAreCurrent = () =>
      planSources.every(
        (planSource) => getReadPlan(planSource, readOperation).cacheScope === planSnapshot.get(planSource)?.cacheScope
      );
    const readIsCurrent = () =>
      enabledSourcesAreCurrent() &&
      readPlansAreCurrent() &&
      (readOperation !== 'account-data' ||
        planSources.every(
          (planSource) =>
            isSessionSource(planSource) &&
            readSessionSnapshot(planSource).identityKey === sessionSnapshots.get(planSource)?.identityKey
        ));
    const recoveryCommitIsEligible = () => readIsCurrent() && signal?.aborted !== true;
    try {
      const planFor = (planSource: Source) => planSnapshot.get(planSource);
      const unavailablePlanSources = planSources.filter((planSource) => planFor(planSource)?.state === 'blocked');
      const linuxDoPlan = planFor('linuxdo');
      const nodeSeekPlan = planFor('nodeseek');
      const yaohuoPlan = planFor('yaohuo');
      const linuxDoAuthenticated = linuxDoPlan?.state === 'ready' && linuxDoPlan.lane === 'authenticated';
      const nodeSeekAuthenticated = nodeSeekPlan?.state === 'ready' && nodeSeekPlan.lane === 'authenticated';
      const discourseAuth: LinuxDoReadAuth | undefined =
        linuxDoPlan?.state === 'ready'
          ? {
              authenticated: linuxDoAuthenticated,
              categoryCacheScope: linuxDoPlan.cacheScope,
              userAgent: dependencies.linuxDoUserAgent?.()
            }
          : undefined;
      const unavailableSources = source === 'all' ? unavailablePlanSources : [];
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
        if (plan.transport === 'native-clearance-only') {
          return (input, init) => {
            const headers = new Headers(init?.headers);
            headers.delete('Cookie');
            headers.set(FORUM_READ_COOKIE_POLICY_HEADER, 'clearance-only');
            return anonymousFetcher(input, { ...init, headers });
          };
        }
        return plan.transport === 'native-no-cookie' ? anonymousFetcher : authenticatedFetcher;
      };
      const operationFetcher = source === 'all' ? localFetcher : sourcePlanFetcher(source);
      markDiagnosticStage(trace, 'credential', {
        source,
        hasCredential: Boolean(
          linuxDoAuthenticated ||
          nodeSeekAuthenticated ||
          (yaohuoPlan?.state === 'ready' && yaohuoPlan.lane === 'authenticated')
        ),
        isCredentialKnown: unavailablePlanSources.length === 0
      });
      markDiagnosticStage(trace, 'transport', { source, channel: 'direct', state: 'start' });
      const ownFetcher = (fetcher: Fetcher, attempt: ReadAttempt) =>
        withForumSourceReadEligibility(
          withManagedReadIntent(
            withDiagnosticFetcher(
              trace,
              readOperation === 'account-data'
                ? withRequestBeforeSend(fetcher, () => {
                    if (!recoveryCommitIsEligible()) throw new RequestCanceledError();
                  })
                : fetcher
            ),
            readOperation,
            attempt
          ),
          recoveryCommitIsEligible
        );
      const runOperation = (fetcher: Fetcher, attempt: ReadAttempt) =>
        operation({
          discourseAuth,
          fetcher: ownFetcher(fetcher, attempt),
          ...(source === 'all'
            ? { fetcherForSource: (planSource: Source) => ownFetcher(sourcePlanFetcher(planSource), attempt) }
            : {}),
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
        const recoveryEligible = recoveryCommitIsEligible();
        const retryAfterRotation =
          source !== 'all' &&
          runtimeAfterFailure.generation > expectedGeneration &&
          runtimeAfterFailure.triggerSource === source &&
          firstAttempt.contentRequestStarted &&
          firstAttempt.replayable &&
          recoveryEligible;
        const recoverAfterTimeout =
          !retryAfterRotation &&
          error instanceof RequestTimeoutError &&
          sourceUsesDirectTimeoutRecovery(source) &&
          firstAttempt.contentRequestStarted &&
          firstAttempt.replayable &&
          recoveryEligible;
        markDiagnosticStage(trace, 'guard', {
          source,
          state: retryAfterRotation || recoverAfterTimeout ? 'recovery-qualified' : 'recovery-skipped',
          recoveryDecision:
            retryAfterRotation || recoverAfterTimeout ? 'commit' : recoveryEligible ? 'rejected' : 'ineligible',
          reason: normalizeDiagnosticReason(error),
          previousGeneration: expectedGeneration,
          generation: runtimeAfterFailure.generation,
          hasContentRequest: firstAttempt.contentRequestStarted,
          isReplayable: firstAttempt.replayable,
          isEligible: recoveryEligible
        });
        if (!retryAfterRotation && !recoverAfterTimeout) {
          throw error;
        }
        if (recoverAfterTimeout) {
          const recoveryTrace = beginDiagnosticTrace('network', 'rotate-read-runtime', {
            source,
            parentTraceId: trace.traceId,
            generation: expectedGeneration,
            reason: 'timeout'
          });
          try {
            await recoverReadNetworkRuntime(source, expectedGeneration, { trace: recoveryTrace });
          } catch (recoveryError) {
            markDiagnosticStage(trace, 'guard', {
              source,
              state: 'recovery-failed',
              recoveryDecision: 'failed',
              reason: normalizeDiagnosticReason(recoveryError),
              generation: getReadNetworkRuntimeSnapshot().generation
            });
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
        aggregateResult.errors = aggregateErrors;
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
          ((error as { reason?: unknown }).reason === 'http-401' ||
            (planSource === 'linuxdo' && errorRequiresAccountRecheck(error))) &&
          session?.authenticated &&
          session.identityTrust === 'confirmed' &&
          plan?.state === 'ready' &&
          plan.lane === 'authenticated'
        ) {
          // Preserve readable siblings before the account event cancels the aggregate Query.
          if (!signal?.aborted) onBeforeSessionChange?.(result);
          onBeforeSessionChange = undefined;
          if (errorRequiresAccountRecheck(error)) {
            dependencies.requestAccountRecheck?.(planSource, session.sessionEpoch, trace.traceId);
          } else {
            dependencies.onSessionExpired?.(planSource, session.sessionEpoch);
          }
        }
      }
      if (!readIsCurrent()) throw new Error(REQUEST_CANCELED_MESSAGE);
      if (readingRequest && dependencies.reading && linuxDoAuthenticated) {
        const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
        const candidates: unknown[] = Array.isArray(result)
          ? result
          : [
              result,
              ...(Array.isArray(record.items) ? record.items : []),
              ...(Array.isArray(record.topics) ? record.topics : [])
            ];
        const missing: string[] = [];
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== 'object') continue;
          const value = candidate as {
            source?: string;
            id?: string;
            topicId?: string;
            reading?: DiscourseTopicReading;
            isPrivateMessage?: boolean;
          };
          if (value.isPrivateMessage) continue;
          if (value.reading) dependencies.reading.observe(value.reading, readingRequest);
          else if (value.topicId && /^\d+$/.test(value.topicId))
            dependencies.reading.observe(value as DiscourseTopicReading, readingRequest);
          if (
            value.source === 'linuxdo' &&
            value.id &&
            /^\d+$/.test(value.id) &&
            value.reading?.lastReadPostNumber === undefined
          )
            missing.push(value.id);
        }
        if (missing.length && ['feed', 'search', 'semantic-search', 'user-profile'].includes(readOperation)) {
          void getReadingBatch(missing, signal).catch(() => undefined);
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
      if (signal?.aborted && !(error instanceof RequestTimeoutError)) error = new RequestCanceledError();
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
      const recheckAccount =
        source === 'linuxdo' &&
        (errorRequiresAccountRecheck(sourceError) ||
          (['topic-creation-context', 'topic-edit-context'].includes(readOperation) &&
            sourceError.kind !== 'verification-required' &&
            error instanceof Error &&
            'status' in error &&
            error.status === 400));
      if (source !== 'all' && isSessionSource(source) && (sourceError.reason === 'http-401' || recheckAccount)) {
        const session = sessionSnapshots.get(source);
        const plan = planSnapshot.get(source);
        if (
          session?.authenticated &&
          session.identityTrust === 'confirmed' &&
          plan?.state === 'ready' &&
          plan.lane === 'authenticated'
        ) {
          if (recheckAccount) {
            dependencies.requestAccountRecheck?.(source, session.sessionEpoch, trace.traceId);
          } else {
            dependencies.onSessionExpired?.(source, session.sessionEpoch);
          }
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

  const readAccountData = <T>(
    source: 'nodeseek' | 'yaohuo',
    options: ManagedAccountDataOptions,
    operation: (credentials: { fetcher: Fetcher; nodeSeekUserAgent?: string }) => Promise<T>,
    context?: ReadGatewayReadContext
  ) =>
    read(
      source,
      'getUserProfile',
      'account-data',
      (credentials) => {
        if (readSessionSnapshot(source).identityKey !== `${source}:${options.userId}`) {
          throw new RequestCanceledError();
        }
        return operation(credentials);
      },
      context,
      options.signal
    );

  const readingFetches = new Map<string, Promise<DiscourseTopicReading | undefined>>();
  const getReadingBatch = async (ids: readonly string[], signal?: AbortSignal) => {
    const scope = dependencies.reading?.scope();
    const plan = getReadPlan('linuxdo', 'feed');
    if (!scope || plan.state !== 'ready' || plan.lane !== 'authenticated') return [];
    const unique = [...new Set(ids)].filter((id) => /^\d+$/.test(id));
    const fresh = unique.filter((id) => !readingFetches.has(`${scope}:${id}`));
    if (fresh.length) {
      const request = read(
        'linuxdo',
        'reading-state',
        'feed',
        ({ fetcher, discourseAuth }) =>
          getLinuxDoReadingBatch(fresh, { signal, fetcher, linuxDoAccess: discourseAuth }),
        undefined,
        signal
      );
      fresh.forEach((id) => {
        const key = `${scope}:${id}`;
        const item = request.then((snapshots) => snapshots.find((snapshot) => snapshot.topicId === id));
        readingFetches.set(key, item);
        void item
          .finally(() => {
            if (readingFetches.get(key) === item) readingFetches.delete(key);
          })
          .catch(() => undefined);
      });
    }
    const snapshots = await Promise.all(unique.map((id) => readingFetches.get(`${scope}:${id}`)));
    return snapshots.filter((snapshot): snapshot is DiscourseTopicReading => Boolean(snapshot));
  };

  return {
    reading: dependencies.reading,
    getNodeSeekAccountOverview(options: ManagedAccountDataOptions, context?: ReadGatewayReadContext) {
      return readAccountData(
        'nodeseek',
        options,
        (credentials) => getNodeSeekAccountOverviewDirect({ ...options, ...credentials }),
        context
      );
    },
    getNodeSeekAttendanceBoard(options: ManagedAccountDataOptions, context?: ReadGatewayReadContext) {
      return readAccountData(
        'nodeseek',
        options,
        (credentials) => getNodeSeekAttendanceBoardDirect({ ...options, ...credentials }),
        context
      );
    },
    getNodeSeekCredits(options: ManagedAccountDataOptions & { page?: number }, context?: ReadGatewayReadContext) {
      return readAccountData(
        'nodeseek',
        options,
        (credentials) => getNodeSeekCreditsDirect({ ...options, ...credentials }),
        context
      );
    },
    getNodeSeekStardustCredits(
      options: ManagedAccountDataOptions & { beforeId?: number },
      context?: ReadGatewayReadContext
    ) {
      return readAccountData(
        'nodeseek',
        options,
        (credentials) => getNodeSeekStardustCreditsDirect({ ...options, ...credentials }),
        context
      );
    },
    getYaohuoAccountOverview(options: ManagedAccountDataOptions, context?: ReadGatewayReadContext) {
      return readAccountData(
        'yaohuo',
        options,
        (credentials) => getYaohuoAccountOverviewDirect({ ...options, ...credentials }),
        context
      );
    },
    getTopicReading(id: string, options: { signal?: AbortSignal; trackVisit?: boolean } = {}) {
      return read(
        'linuxdo',
        'getTopic',
        'topic',
        ({ fetcher, discourseAuth }) =>
          getLinuxDoTopicReading(id, { ...options, fetcher, linuxDoAccess: discourseAuth }),
        undefined,
        options.signal
      );
    },
    getReadingBatch,
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
    getFeed(
      options: ManagedGetFeedOptions,
      context?: ReadGatewayReadContext & { onBeforeSessionChange?: (response: FeedResponse) => void }
    ) {
      return read(
        options.source,
        'getFeed',
        'feed',
        ({ trace, ...credentials }) =>
          getForumFeed({
            ...options,
            ...credentials,
            diagnosticTrace: trace
          }),
        context,
        options.signal,
        {},
        context?.onBeforeSessionChange
      );
    },
    getEmojiUrls({ source, ...options }: ManagedGetEmojiUrlsOptions, context?: ReadGatewayReadContext) {
      return read(
        source,
        'getEmojiUrls',
        'emoji',
        ({ discourseAuth, fetcher }) =>
          getLinuxDoEmojiUrls({
            ...options,
            linuxDoAccess: discourseAuth,
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
          searchForumTopics({
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
          searchLinuxDoTags({
            ...options,
            linuxDoAccess: discourseAuth,
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
          searchLinuxDoUsers({
            ...options,
            linuxDoAccess: discourseAuth,
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
            linuxDoAccess: discourseAuth
          }),
        context,
        options.signal
      );
    },
    getLinuxDoTopicCreationContext(
      options: { source: 'linuxdo'; signal?: AbortSignal },
      context?: ReadGatewayReadContext
    ) {
      return read(
        options.source,
        'getTopicCreationContext',
        'topic-creation-context',
        ({ discourseAuth, fetcher }) =>
          loadLinuxDoTopicCreationContext({
            fetcher,
            userAgent: discourseAuth?.userAgent || '',
            signal: options.signal
          }),
        context,
        options.signal
      );
    },
    getTopicEditContext(
      options: {
        source: TopicCreationSource;
        topicId: string;
        identityKey: string;
        userAgent: string;
        signal?: AbortSignal;
      },
      context?: ReadGatewayReadContext
    ) {
      return read(
        options.source,
        'getTopicEditContext',
        'topic-edit-context',
        ({ fetcher }) => {
          const input = { ...options, fetcher };
          return options.source === 'linuxdo'
            ? loadLinuxDoTopicEditContext(input)
            : options.source === 'nodeseek'
              ? loadNodeSeekTopicEditContext(input)
              : loadYaohuoTopicEditContext(input);
        },
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
          if (discourseAuth?.authenticated !== true) {
            throw Object.assign(new Error('请先完成 linux.do 登录 / 验证。'), {
              source: 'linuxdo' as const,
              loginRequired: true
            });
          }
          return getLocalLinuxDoLevelProfile({
            ...options,
            userAgent: discourseAuth.userAgent,
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
        async ({ trace, ...credentials }) => {
          const result = await getReplies(
            {
              ...options,
              ...credentials
            },
            trace
          );
          if (options.isPrivateMessage || result.isPrivateMessage)
            return { ...result, isPrivateMessage: true, reading: undefined };
          return options.source === 'linuxdo'
            ? {
                ...result,
                reading: {
                  ...result.reading,
                  topicId: options.id,
                  readPostNumbers: [
                    ...new Set([
                      ...(result.reading?.readPostNumbers || []),
                      ...result.items.flatMap((reply) => (reply.serverRead && reply.floor ? [reply.floor] : []))
                    ])
                  ]
                }
              }
            : result;
        },
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
    getUserDetails(options: ManagedUserDetailsOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getUserProfile',
        'user-profile',
        (credentials) => getForumUserDetails({ ...options, ...credentials }),
        context,
        options.signal
      );
    },
    getUserTopics(options: ManagedUserActivityOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getUserProfile',
        'user-profile',
        (credentials) => getForumUserTopics({ ...options, ...credentials }),
        context,
        options.signal
      );
    },
    getUserReplies(options: ManagedUserActivityOptions, context?: ReadGatewayReadContext) {
      return read(
        options.source,
        'getUserProfile',
        'user-profile',
        (credentials) => getForumUserReplies({ ...options, ...credentials }),
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
    }
  };
}

export type ReadGateway = ReturnType<typeof createReadGateway>;
