import { useCallback, useMemo, useRef, useState } from 'react';
import { isCancelledError, useQuery, type QueryFunctionContext } from '@tanstack/react-query';
import { checkLinuxDoLoginAccess, checkYaohuoLogin, getCurrentUserProfile, getUserProfile } from '../sources/sourceGateway';
import { errorMessage, isCanceledRequest } from '../appUtils';
import { summarizeYaohuoCookieHeader } from '../yaohuoSession';
import { summarizeNodeSeekCookieHeader } from '../nodeseekSession';
import { summarizeLinuxDoCookieHeader } from '../linuxdoSession';
import {
  createSiteSessionStates,
  createSiteSessionViewModel,
  reduceSiteSessionState,
  type ScopedSiteSessionEvent,
  type SiteSessionState,
  type SiteSessionViewModel,
  type SiteSessionViewModels
} from '../siteSessionState';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '../request';
import { sourceErrorFromUnknown } from '../sourceErrors';
import type { XiaoyinsiAuthorizationReadResult } from './useXiaoyinsiAuthController';
import { isLinuxDoLoginCheckUnknown } from './accountStatusHelpers';
import { appQueryClient, forumQueryKeys, type ForumSessionEpochs } from './serverState';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticTrace
} from '../diagnostics';
import {
  readManagedCookieHeader as readManagedCookieHeaderFromNative,
  type ManagedCookieReadResult
} from '../managedCookies';
import {
  cancelForumSourceQueries,
  removeUnconfirmedForumSourceQueries
} from './sessionControllerHelpers';
import { sessionSources, type SessionSource } from '../sourceCatalog';

const NODESEEK_ACCOUNT_URL = 'https://www.nodeseek.com/';
const LINUXDO_ACCOUNT_URL = 'https://linux.do/session/current.json';
const YAOHUO_ACCOUNT_URL = 'https://www.yaohuo.me/wapindex.aspx?sid=-2';
type RefreshAccountStatusOptions = { silent?: boolean };
type StatusSource = SessionSource;
type StatusQueryData = {
  failed?: boolean;
  session?: SiteSessionState;
};
export type AccountReconcileResult =
  | { status: 'anonymous' | 'changed' | 'same'; session: SiteSessionState; partial?: boolean }
  | { status: 'stale' }
  | { status: 'unknown'; error: string };
export type AccountIdentityRuntimeUpdate = {
  identityKey?: string;
  pending: boolean;
};

const STATUS_DESCRIPTORS = {
  nodeseek: { source: 'nodeseek', label: 'NodeSeek' },
  linuxdo: { source: 'linuxdo', label: 'linux.do' },
  yaohuo: { source: 'yaohuo', label: '妖火' },
  xiaoyinsi: { source: 'xiaoyinsi', label: '小隐寺' }
} as const satisfies Record<StatusSource, { source: StatusSource; label: string }>;

function isCanceledStatusQuery(error: unknown) {
  return isCancelledError(error) || isCanceledRequest(error);
}

function canceledStatusQuery(): never {
  throw new Error(REQUEST_CANCELED_MESSAGE);
}

function managedCookieHeaderOrThrow(result: ManagedCookieReadResult) {
  if (result.status === 'ok') {
    return result.header;
  }
  throw new Error(result.status === 'unsupported'
    ? '当前安装包不支持读取 WebView Cookie'
    : result.message);
}

function sessionFromEvents(site: StatusSource, events: ScopedSiteSessionEvent[]) {
  return events.reduce<SiteSessionState>(
    (state, { site: _site, ...event }) => reduceSiteSessionState(state, event),
    createSiteSessionStates()[site]
  );
}

function accountStatusViewModel(
  base: SiteSessionViewModel,
  data: StatusQueryData | undefined,
  error: unknown,
  identityCheck?: { pending: boolean; error?: string }
) {
  const ownsVisibleWorkflow = identityCheck?.pending === true
    && (base.status === 'verification-required'
      || base.status === 'verifying'
      || base.status === 'authorizing');
  const remote = !ownsVisibleWorkflow && data?.session
    ? createSiteSessionViewModel(data.session)
    : base;
  const withQueryError = error && !isCanceledStatusQuery(error)
    ? { ...remote, lastError: errorMessage(error) }
    : remote;
  return identityCheck?.pending
    ? {
      ...withQueryError,
      canWrite: false,
      identityTrust: 'pending' as const,
      summaryLabel: '登录状态待确认',
      ...(identityCheck.error ? { lastError: identityCheck.error } : {})
    }
    : withQueryError;
}

export function useAccountStatusController({
  sessionEpochs,
  linuxDoUserAgentRef,
  fetcher,
  nodeSeekUserAgentRef,
  notify,
  onAccountIdentityRuntimeChanged,
  onAccountStatusChanged,
  readManagedCookieHeader = readManagedCookieHeaderFromNative,
  readXiaoyinsiAuthorization,
  sessionViewModels
}: {
  sessionEpochs: ForumSessionEpochs;
  linuxDoUserAgentRef: { current: string };
  fetcher: Fetcher;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  onAccountIdentityRuntimeChanged: (
    source: StatusSource,
    update: AccountIdentityRuntimeUpdate
  ) => void;
  onAccountStatusChanged: (
    source: StatusSource,
    recoveryQueryKey: readonly unknown[],
    session: SiteSessionState
  ) => void;
  readManagedCookieHeader?: (exactUrl: string) => Promise<ManagedCookieReadResult>;
  readXiaoyinsiAuthorization: (
    trace?: DiagnosticTrace,
    options?: { signal?: AbortSignal }
  ) => Promise<XiaoyinsiAuthorizationReadResult>;
  sessionViewModels: SiteSessionViewModels;
}) {
  const [identityChecks, setIdentityChecks] = useState<Record<StatusSource, {
    checking?: boolean;
    pending: boolean;
    error?: string;
  }>>(() => Object.fromEntries(sessionSources.map((source) => [source, { pending: true }])) as Record<StatusSource, {
    checking?: boolean;
    pending: boolean;
    error?: string;
  }>);
  const activeIdentityReconciliationsRef = useRef(0);
  const [identityReconciliationPending, setIdentityReconciliationPending] = useState(true);
  const identityPendingRef = useRef<Record<StatusSource, boolean>>(
    Object.fromEntries(sessionSources.map((source) => [source, true])) as Record<StatusSource, boolean>
  );
  const statusQueryDefinitions = useMemo(() => {
    const nodeSeekStatusQueryKey = forumQueryKeys.accountStatus({ sessionEpochs, source: 'nodeseek' });
    const linuxDoStatusQueryKey = forumQueryKeys.accountStatus({ sessionEpochs, source: 'linuxdo' });
    const yaohuoStatusQueryKey = forumQueryKeys.accountStatus({ sessionEpochs, source: 'yaohuo' });
    const xiaoyinsiStatusQueryKey = forumQueryKeys.accountStatus({ sessionEpochs, source: 'xiaoyinsi' });
    return {
    nodeseek: {
        enabled: false,
        queryKey: nodeSeekStatusQueryKey,
        queryFn: async ({ signal }: QueryFunctionContext): Promise<StatusQueryData> => {
          const trace = beginDiagnosticTrace('session', 'refresh', { source: 'nodeseek' });
          let cookieSummary: string[] = [];
          try {
            const diagnosticFetcher = withDiagnosticFetcher(trace, fetcher);
            const cookieRead = await readManagedCookieHeader(NODESEEK_ACCOUNT_URL);
            const cookieHeader = managedCookieHeaderOrThrow(cookieRead);
            if (signal.aborted) {
              finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
              return canceledStatusQuery();
            }
            const summary = summarizeNodeSeekCookieHeader(cookieHeader);
            cookieSummary = summary.names;
            markDiagnosticStage(trace, 'credential', {
              source: 'nodeseek',
              hasCredential: summary.count > 0
            });
            const currentUser = await getCurrentUserProfile({
                source: 'nodeseek',
                nodeSeekAuthenticated: true,
                fetcher: diagnosticFetcher,
                nodeSeekUserAgent: nodeSeekUserAgentRef.current,
                signal
              });
            if (signal.aborted) {
              finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
              return canceledStatusQuery();
            }
            const checkedAt = new Date().toISOString();
            finishDiagnosticTrace(trace, 'success', { source: 'nodeseek' });
            return {
              session: sessionFromEvents('nodeseek', [{
                site: 'nodeseek',
                type: 'cookie-loaded',
                cookieSummary: summary.names,
                hasVerification: summary.count > 0,
                loggedIn: Boolean(currentUser),
                currentUser,
                at: checkedAt
              }])
            };
          } catch (error) {
            const canceled = signal.aborted || isCanceledStatusQuery(error);
            const sourceError = canceled ? undefined : sourceErrorFromUnknown('nodeseek', error);
            if (sourceError?.kind === 'login-expired') {
              if (signal.aborted) {
                finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
                return canceledStatusQuery();
              }
              finishDiagnosticTrace(trace, 'success', {
                source: 'nodeseek',
                reason: 'expired'
              });
              return {
                session: sessionFromEvents('nodeseek', [{
                  site: 'nodeseek',
                  type: 'cookie-loaded',
                  cookieSummary,
                  hasVerification: cookieSummary.length > 0,
                  loggedIn: false,
                  currentUser: null,
                  at: new Date().toISOString()
                }])
              };
            }
            finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
              source: 'nodeseek',
              reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
            });
            throw error;
          }
        }
      },
    linuxdo: {
        enabled: false,
        queryKey: linuxDoStatusQueryKey,
        queryFn: async ({ signal }: QueryFunctionContext): Promise<StatusQueryData> => {
          const trace = beginDiagnosticTrace('session', 'refresh', { source: 'linuxdo' });
          try {
            const diagnosticFetcher = withDiagnosticFetcher(trace, fetcher);
            const cookieRead = await readManagedCookieHeader(LINUXDO_ACCOUNT_URL);
            const cookieHeader = managedCookieHeaderOrThrow(cookieRead);
            if (signal.aborted) {
              finishDiagnosticTrace(trace, 'stale', { source: 'linuxdo', reason: 'stale' });
              return canceledStatusQuery();
            }
            const cookieSummary = summarizeLinuxDoCookieHeader(cookieHeader);
            const userAgent = linuxDoUserAgentRef.current;
            markDiagnosticStage(trace, 'credential', {
              source: 'linuxdo',
              hasCredential: Boolean(cookieHeader)
            });
            const login = await checkLinuxDoLoginAccess({
              fetcher: diagnosticFetcher,
              userAgent,
              signal
            });
            if (isLinuxDoLoginCheckUnknown(login)) {
              throw new Error(login?.message || 'linux.do 状态暂时无法确认');
            }
            if (login?.loginRequired) {
              if (signal.aborted) {
                finishDiagnosticTrace(trace, 'stale', { source: 'linuxdo', reason: 'stale' });
                return canceledStatusQuery();
              }
              finishDiagnosticTrace(trace, 'success', { source: 'linuxdo' });
              return {
                session: sessionFromEvents('linuxdo', [{
                  site: 'linuxdo',
                  type: 'cookie-loaded',
                  cookieSummary: cookieSummary.names,
                  hasVerification: cookieSummary.hasClearance,
                  loggedIn: false,
                  currentUser: null,
                  at: new Date().toISOString()
                }])
              };
            }
            const currentUser = login?.currentUser;
            if (!currentUser) {
              throw new Error('linux.do 状态暂时无法确认');
            }
            if (signal.aborted) {
              finishDiagnosticTrace(trace, 'stale', { source: 'linuxdo', reason: 'stale' });
              return canceledStatusQuery();
            }
            finishDiagnosticTrace(trace, 'success', { source: 'linuxdo' });
            return {
              session: sessionFromEvents('linuxdo', [{
                site: 'linuxdo',
                type: 'cookie-loaded',
                cookieSummary: cookieSummary.names,
                hasVerification: cookieSummary.hasClearance,
                loggedIn: true,
                currentUser,
                at: new Date().toISOString()
              }])
            };
          } catch (error) {
            const canceled = signal.aborted || isCanceledStatusQuery(error);
            finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
              source: 'linuxdo',
              reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
            });
            throw error;
          }
        }
      },
    yaohuo: {
        enabled: false,
        queryKey: yaohuoStatusQueryKey,
        queryFn: async ({ signal }: QueryFunctionContext): Promise<StatusQueryData> => {
          const trace = beginDiagnosticTrace('session', 'refresh', { source: 'yaohuo' });
          try {
            const diagnosticFetcher = withDiagnosticFetcher(trace, fetcher);
            const cookieRead = await readManagedCookieHeader(YAOHUO_ACCOUNT_URL);
            const cookieHeader = managedCookieHeaderOrThrow(cookieRead);
            if (signal.aborted) {
              finishDiagnosticTrace(trace, 'stale', { source: 'yaohuo', reason: 'stale' });
              return canceledStatusQuery();
            }
            const cookieSummary = summarizeYaohuoCookieHeader(cookieHeader).names;
            markDiagnosticStage(trace, 'credential', {
              source: 'yaohuo',
              hasCredential: Boolean(cookieHeader)
            });
            const check = await checkYaohuoLogin({
              yaohuoFetcher: diagnosticFetcher,
              signal
            });
            const expired = 'reason' in check && check.reason === 'expired';
            if (!check.ok && !expired) {
              throw new Error(check.message || '妖火登录状态暂时无法确认。');
            }
            if (expired) {
              if (signal.aborted) {
                finishDiagnosticTrace(trace, 'stale', { source: 'yaohuo', reason: 'stale' });
                return canceledStatusQuery();
              }
              finishDiagnosticTrace(trace, 'success', { source: 'yaohuo' });
              return {
                session: sessionFromEvents('yaohuo', [{
                  site: 'yaohuo',
                  type: 'cookie-loaded',
                  cookieSummary,
                  hasVerification: false,
                  loggedIn: false,
                  currentUser: null,
                  at: new Date().toISOString()
                }])
              };
            }
            const verifiedUser = 'currentUser' in check ? check.currentUser : undefined;
            if (!verifiedUser) {
              throw new Error('妖火登录状态暂时无法确认。');
            }
            let currentUser = verifiedUser;
            let profileError: unknown;
            try {
              currentUser = await getUserProfile({
                source: 'yaohuo',
                id: verifiedUser.id,
                username: verifiedUser.username,
                fetcher: diagnosticFetcher,
                signal
              });
            } catch (error) {
              if (signal.aborted || isCanceledStatusQuery(error)) {
                throw error;
              }
              profileError = error;
            }
            if (signal.aborted) {
              finishDiagnosticTrace(trace, 'stale', { source: 'yaohuo', reason: 'stale' });
              return canceledStatusQuery();
            }
            finishDiagnosticTrace(trace, profileError ? 'partial' : 'success', {
              source: 'yaohuo',
              ...(profileError ? { reason: normalizeDiagnosticReason(profileError) } : {})
            });
            const events: ScopedSiteSessionEvent[] = [{
              site: 'yaohuo',
              type: 'cookie-loaded',
              cookieSummary,
              hasVerification: false,
              loggedIn: true,
              currentUser,
              at: new Date().toISOString()
            }];
            if (profileError) {
              events.push({
                site: 'yaohuo',
                type: 'check-failed',
                message: errorMessage(profileError)
              });
            }
            return {
              failed: Boolean(profileError),
              session: sessionFromEvents('yaohuo', events)
            };
          } catch (error) {
            const canceled = signal.aborted || isCanceledStatusQuery(error);
            finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
              source: 'yaohuo',
              reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
            });
            throw error;
          }
        }
      },
    xiaoyinsi: {
        enabled: false,
        queryKey: xiaoyinsiStatusQueryKey,
        queryFn: async ({ signal }: QueryFunctionContext): Promise<StatusQueryData> => {
          const trace = beginDiagnosticTrace('session', 'refresh', { source: 'xiaoyinsi' });
          try {
            const result = await readXiaoyinsiAuthorization(trace, { signal });
            if (!result.sessionEvent) {
              return canceledStatusQuery();
            }
            if (result.authenticated === null) {
              throw new Error(result.sessionEvent.type === 'check-failed'
                ? result.sessionEvent.message || '小隐寺状态暂时无法确认'
                : '小隐寺状态暂时无法确认');
            }
            finishDiagnosticTrace(trace, 'success', { source: 'xiaoyinsi' });
            const sessionEvent = result.authenticated === false
              ? {
                type: 'cookie-loaded' as const,
                loggedIn: false,
                currentUser: null,
                at: new Date().toISOString()
              }
              : result.sessionEvent;
            return {
              session: sessionFromEvents('xiaoyinsi', [{
                ...sessionEvent,
                site: 'xiaoyinsi'
              } as ScopedSiteSessionEvent])
            };
          } catch (error) {
            const canceled = signal.aborted || isCanceledStatusQuery(error);
            finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
              source: 'xiaoyinsi',
              reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
            });
            throw error;
          }
        }
      }
    };
  }, [
    fetcher,
    linuxDoUserAgentRef,
    nodeSeekUserAgentRef,
    readManagedCookieHeader,
    readXiaoyinsiAuthorization,
    sessionEpochs.linuxdo,
    sessionEpochs.nodeseek,
    sessionEpochs.xiaoyinsi,
    sessionEpochs.yaohuo
  ]);
  const nodeSeekStatus = useQuery(statusQueryDefinitions.nodeseek);
  const linuxDoStatus = useQuery(statusQueryDefinitions.linuxdo);
  const yaohuoStatus = useQuery(statusQueryDefinitions.yaohuo);
  const xiaoyinsiStatus = useQuery(statusQueryDefinitions.xiaoyinsi);
  const statusQueries = {
    linuxdo: linuxDoStatus,
    nodeseek: nodeSeekStatus,
    xiaoyinsi: xiaoyinsiStatus,
    yaohuo: yaohuoStatus
  };

  const accountSessionViewModels: SiteSessionViewModels = {
    nodeseek: accountStatusViewModel(sessionViewModels.nodeseek, nodeSeekStatus.data, nodeSeekStatus.error, identityChecks.nodeseek),
    linuxdo: accountStatusViewModel(sessionViewModels.linuxdo, linuxDoStatus.data, linuxDoStatus.error, identityChecks.linuxdo),
    yaohuo: accountStatusViewModel(sessionViewModels.yaohuo, yaohuoStatus.data, yaohuoStatus.error, identityChecks.yaohuo),
    xiaoyinsi: accountStatusViewModel(sessionViewModels.xiaoyinsi, xiaoyinsiStatus.data, xiaoyinsiStatus.error, identityChecks.xiaoyinsi)
  };

  const probeGenerationRef = useRef<Record<StatusSource, number>>({
    linuxdo: 0,
    nodeseek: 0,
    xiaoyinsi: 0,
    yaohuo: 0
  });
  const activeProbeRef = useRef<Partial<Record<StatusSource, {
    generation: number;
    promise: Promise<AccountReconcileResult>;
    queryKey: readonly unknown[];
    surfaceGeneration: number;
  }>>>({});
  const beginAccountIdentityCheck = useCallback((
    source: StatusSource,
    surfaceGeneration?: number
  ) => {
    if (!identityPendingRef.current[source]) {
      void cancelForumSourceQueries(source);
    }
    identityPendingRef.current[source] = true;
    if (surfaceGeneration !== undefined) {
      const activeProbe = activeProbeRef.current[source];
      if (activeProbe && activeProbe.surfaceGeneration < surfaceGeneration) {
        probeGenerationRef.current[source] = Math.max(
          probeGenerationRef.current[source] + 1,
          surfaceGeneration
        );
        void appQueryClient.cancelQueries({
          queryKey: activeProbe.queryKey,
          exact: true
        });
      } else {
        probeGenerationRef.current[source] = Math.max(
          probeGenerationRef.current[source],
          surfaceGeneration
        );
      }
    }
    setIdentityChecks((current) => ({
      ...current,
      [source]: { checking: true, pending: true }
    }));
    onAccountIdentityRuntimeChanged(source, { pending: true });
  }, [onAccountIdentityRuntimeChanged]);
  const reconcileAccountStatus = useCallback((
    source: StatusSource,
    options: { surfaceGeneration?: number } = {}
  ): Promise<AccountReconcileResult> => {
    const requestedSurfaceGeneration = options.surfaceGeneration || 0;
    const activeProbe = activeProbeRef.current[source];
    if (activeProbe && requestedSurfaceGeneration <= activeProbe.surfaceGeneration) {
      return activeProbe.promise;
    }
    if (activeProbe) {
      void appQueryClient.cancelQueries({ queryKey: activeProbe.queryKey, exact: true });
    }
    beginAccountIdentityCheck(source);
    const generation = options.surfaceGeneration === undefined
      ? probeGenerationRef.current[source] + 1
      : Math.max(probeGenerationRef.current[source] + 1, options.surfaceGeneration);
    probeGenerationRef.current[source] = generation;
    const probeQueryKey = forumQueryKeys.accountStatusProbe({
      sessionEpochs,
      generation,
      source
    });
    const promise = (async (): Promise<AccountReconcileResult> => {
      try {
      const nextData = await appQueryClient.fetchQuery({
        queryKey: probeQueryKey,
        queryFn: statusQueryDefinitions[source].queryFn,
        staleTime: 0
      });
      if (probeGenerationRef.current[source] !== generation || !nextData.session) {
        return { status: 'stale' as const };
      }
      const canonicalQueryKey = statusQueryDefinitions[source].queryKey;
      const previousData = appQueryClient.getQueryData<StatusQueryData>(canonicalQueryKey);
      const previousSession = previousData?.session || (
        sessionViewModels[source].identityTrust === 'confirmed' ? sessionViewModels[source] : undefined
      );
      const previousIdentity = previousSession ? accountIdentityKey(previousSession) : undefined;
      const nextIdentity = accountIdentityKey(nextData.session);
      if (previousIdentity && previousIdentity !== nextIdentity) {
        onAccountStatusChanged(source, probeQueryKey, nextData.session);
        identityPendingRef.current[source] = false;
        onAccountIdentityRuntimeChanged(source, {
          identityKey: nextIdentity,
          pending: false
        });
        setIdentityChecks((current) => ({
          ...current,
          [source]: { checking: false, pending: false }
        }));
        return {
          status: nextIdentity.endsWith(':anonymous') ? 'anonymous' as const : 'changed' as const,
          session: nextData.session,
          partial: nextData.failed
        };
      }
      if (!previousIdentity) {
        removeUnconfirmedForumSourceQueries(source);
      }
      appQueryClient.setQueryData(canonicalQueryKey, nextData);
      identityPendingRef.current[source] = false;
      onAccountIdentityRuntimeChanged(source, {
        identityKey: nextIdentity,
        pending: false
      });
      setIdentityChecks((current) => ({
        ...current,
        [source]: { checking: false, pending: false }
      }));
      return {
        status: 'same' as const,
        session: nextData.session,
        partial: nextData.failed
      };
      } catch (error) {
      if (probeGenerationRef.current[source] !== generation) {
        return { status: 'stale' as const };
      }
      if (isCanceledStatusQuery(error)) {
        setIdentityChecks((current) => ({
          ...current,
          [source]: { checking: false, pending: true }
        }));
        return { status: 'stale' as const };
      }
      const message = errorMessage(error);
      setIdentityChecks((current) => ({
        ...current,
        [source]: { checking: false, pending: true, error: message }
      }));
      return { status: 'unknown' as const, error: message };
      } finally {
        if (activeProbeRef.current[source]?.generation === generation) {
          delete activeProbeRef.current[source];
        }
        appQueryClient.removeQueries({ queryKey: probeQueryKey, exact: true });
      }
    })();
    activeProbeRef.current[source] = {
      generation,
      promise,
      queryKey: probeQueryKey,
      surfaceGeneration: requestedSurfaceGeneration
    };
    return promise;
  }, [
    beginAccountIdentityCheck,
    onAccountIdentityRuntimeChanged,
    onAccountStatusChanged,
    sessionEpochs,
    sessionViewModels,
    statusQueryDefinitions
  ]);
  const statusBusy = Object.values(statusQueries).some((query) => query.fetchStatus === 'fetching')
    || Object.values(identityChecks).some((identityCheck) => identityCheck.checking);
  const refreshAccountStatus = useCallback(async (options: RefreshAccountStatusOptions = {}) => {
    activeIdentityReconciliationsRef.current += 1;
    setIdentityReconciliationPending(true);
    try {
      const results = await Promise.all(
        Object.values(STATUS_DESCRIPTORS).map(async (descriptor) => ({
          descriptor,
          result: await reconcileAccountStatus(descriptor.source)
        }))
      );
      if (options.silent) {
        return;
      }
      const failedSites = results.flatMap(({ descriptor, result }) => (
        result.status === 'unknown' || ('partial' in result && result.partial)
          ? [descriptor.label]
          : []
      ));
      notify(failedSites.length ? `账号状态部分刷新失败：${failedSites.join('、')}` : '账号状态已刷新');
    } finally {
      activeIdentityReconciliationsRef.current -= 1;
      if (activeIdentityReconciliationsRef.current === 0) {
        setIdentityReconciliationPending(false);
      }
    }
  }, [notify, reconcileAccountStatus]);

  return {
    accountSessionViewModels,
    beginAccountIdentityCheck,
    identityReconciliationPending,
    reconcileAccountStatus,
    refreshAccountStatus,
    statusBusy
  };
}

function accountIdentityKey(session: Pick<SiteSessionState, 'currentUser' | 'site' | 'status'>) {
  if (session.status === 'logged-in' && session.currentUser?.id) {
    return `${session.site}:${session.currentUser.id}`;
  }
  return `${session.site}:anonymous`;
}
