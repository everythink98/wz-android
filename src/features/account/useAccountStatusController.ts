import { useCallback, useMemo, useRef, useState } from 'react';
import { isCancelledError, useQuery, type QueryFunctionContext } from '@tanstack/react-query';
import { errorMessage, isCanceledRequest } from '@/platform/network/errors';
import {
  createSiteSessionViewModel,
  siteSessionIdentityKey,
  type AccountStatusObservation,
  type SiteSessionState,
  type SiteSessionViewModel,
  type SiteSessionViewModels
} from '@/domain/session/siteSessionState';
import type { Fetcher } from '@/platform/network/request';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { readAccountStatus } from '@/sources/accountRead';
import type { XiaoyinsiAuthorizationReadResult } from '@/domain/session/accountCenter';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import {
  readManagedCookieHeader as readManagedCookieHeaderFromNative,
  type ManagedCookieReadResult
} from '@/platform/network/managedCookies';
import { cancelForumSourceQueries, removeUnconfirmedForumSourceQueries } from './sessionQueryOwnership';
import { sessionSources, type SessionSource } from '@/domain/forum/sourceCatalog';
import type { SourceErrorInfo } from '@/domain/forum/models';
import type { AccountReconcileResult } from '@/domain/session/sessionContracts';

type RefreshAccountStatusOptions = { silent?: boolean };
type StatusSource = SessionSource;
export type AccountIdentityRuntimeUpdate = {
  identityKey?: string;
  pending: boolean;
};
export type AccountIdentityCheck = {
  checking: boolean;
  pending: boolean;
  error?: SourceErrorInfo;
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

function accountStatusViewModel(
  base: SiteSessionViewModel,
  data: AccountStatusObservation | undefined,
  error: unknown,
  identityCheck?: AccountIdentityCheck
) {
  const ownsVisibleWorkflow =
    identityCheck?.pending === true &&
    (base.status === 'verification-required' || base.status === 'verifying' || base.status === 'authorizing');
  const remote = !ownsVisibleWorkflow && data?.session ? createSiteSessionViewModel(data.session) : base;
  const withQueryError =
    error && !isCanceledStatusQuery(error) ? { ...remote, lastError: errorMessage(error) } : remote;
  return identityCheck?.pending
    ? {
        ...withQueryError,
        canWrite: false,
        identityTrust: 'pending' as const,
        summaryLabel: '登录状态待确认',
        ...(identityCheck.error ? { lastError: identityCheck.error.message } : {})
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
  onAccountIdentityRuntimeChanged: (source: StatusSource, update: AccountIdentityRuntimeUpdate) => void;
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
  const [identityChecks, setIdentityChecks] = useState<Record<StatusSource, AccountIdentityCheck>>(
    () =>
      Object.fromEntries(sessionSources.map((source) => [source, { checking: false, pending: true }])) as Record<
        StatusSource,
        AccountIdentityCheck
      >
  );
  const activeIdentityReconciliationsRef = useRef(0);
  const [identityReconciliationPending, setIdentityReconciliationPending] = useState(true);
  const identityPendingRef = useRef<Record<StatusSource, boolean>>(
    Object.fromEntries(sessionSources.map((source) => [source, true])) as Record<StatusSource, boolean>
  );
  const statusQueryDefinitions = useMemo(() => {
    const definition = (source: StatusSource) => ({
      enabled: false,
      queryKey: forumQueryKeys.accountStatus({ sessionEpochs, source }),
      queryFn: ({ signal }: QueryFunctionContext) =>
        readAccountStatus(source, {
          fetcher,
          linuxDoUserAgent: linuxDoUserAgentRef.current,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          readManagedCookieHeader,
          readXiaoyinsiAuthorization,
          signal
        })
    });
    return {
      linuxdo: definition('linuxdo'),
      nodeseek: definition('nodeseek'),
      xiaoyinsi: definition('xiaoyinsi'),
      yaohuo: definition('yaohuo')
    };
  }, [
    fetcher,
    linuxDoUserAgentRef,
    nodeSeekUserAgentRef,
    readManagedCookieHeader,
    readXiaoyinsiAuthorization,
    sessionEpochs
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
    nodeseek: accountStatusViewModel(
      sessionViewModels.nodeseek,
      nodeSeekStatus.data,
      nodeSeekStatus.error,
      identityChecks.nodeseek
    ),
    linuxdo: accountStatusViewModel(
      sessionViewModels.linuxdo,
      linuxDoStatus.data,
      linuxDoStatus.error,
      identityChecks.linuxdo
    ),
    yaohuo: accountStatusViewModel(
      sessionViewModels.yaohuo,
      yaohuoStatus.data,
      yaohuoStatus.error,
      identityChecks.yaohuo
    ),
    xiaoyinsi: accountStatusViewModel(
      sessionViewModels.xiaoyinsi,
      xiaoyinsiStatus.data,
      xiaoyinsiStatus.error,
      identityChecks.xiaoyinsi
    )
  };

  const probeGenerationRef = useRef<Record<StatusSource, number>>({
    linuxdo: 0,
    nodeseek: 0,
    xiaoyinsi: 0,
    yaohuo: 0
  });
  const activeProbeRef = useRef<
    Partial<
      Record<
        StatusSource,
        {
          generation: number;
          promise: Promise<AccountReconcileResult>;
          queryKey: readonly unknown[];
          surfaceGeneration: number;
        }
      >
    >
  >({});
  const beginAccountIdentityCheck = useCallback(
    (source: StatusSource, surfaceGeneration?: number) => {
      if (!identityPendingRef.current[source]) void cancelForumSourceQueries(source);
      identityPendingRef.current[source] = true;
      if (surfaceGeneration !== undefined) {
        const activeProbe = activeProbeRef.current[source];
        if (activeProbe && activeProbe.surfaceGeneration < surfaceGeneration) {
          probeGenerationRef.current[source] = Math.max(probeGenerationRef.current[source] + 1, surfaceGeneration);
          void appQueryClient.cancelQueries({ queryKey: activeProbe.queryKey, exact: true });
        } else {
          probeGenerationRef.current[source] = Math.max(probeGenerationRef.current[source], surfaceGeneration);
        }
      }
      setIdentityChecks((current) => ({
        ...current,
        [source]: { checking: true, pending: true }
      }));
      onAccountIdentityRuntimeChanged(source, { pending: true });
    },
    [onAccountIdentityRuntimeChanged]
  );
  const reconcileAccountStatus = useCallback(
    (source: StatusSource, options: { surfaceGeneration?: number } = {}): Promise<AccountReconcileResult> => {
      const requestedSurfaceGeneration = options.surfaceGeneration || 0;
      const activeProbe = activeProbeRef.current[source];
      if (activeProbe && requestedSurfaceGeneration <= activeProbe.surfaceGeneration) return activeProbe.promise;
      if (activeProbe) void appQueryClient.cancelQueries({ queryKey: activeProbe.queryKey, exact: true });
      beginAccountIdentityCheck(source);
      const generation =
        options.surfaceGeneration === undefined
          ? probeGenerationRef.current[source] + 1
          : Math.max(probeGenerationRef.current[source] + 1, options.surfaceGeneration);
      probeGenerationRef.current[source] = generation;
      const probeQueryKey = forumQueryKeys.accountStatusProbe({ sessionEpochs, generation, source });
      const promise = (async (): Promise<AccountReconcileResult> => {
        try {
          const nextData = await appQueryClient.fetchQuery({
            queryKey: probeQueryKey,
            queryFn: statusQueryDefinitions[source].queryFn,
            staleTime: 0
          });
          if (probeGenerationRef.current[source] !== generation || !nextData.session) return { status: 'stale' };
          const canonicalQueryKey = statusQueryDefinitions[source].queryKey;
          const previousData = appQueryClient.getQueryData<AccountStatusObservation>(canonicalQueryKey);
          const previousSession =
            previousData?.session ||
            (sessionViewModels[source].identityTrust === 'confirmed' ? sessionViewModels[source] : undefined);
          const previousIdentity = previousSession ? siteSessionIdentityKey(previousSession) : undefined;
          const nextIdentity = siteSessionIdentityKey(nextData.session);
          if (previousIdentity && previousIdentity !== nextIdentity) {
            onAccountStatusChanged(source, probeQueryKey, nextData.session);
            identityPendingRef.current[source] = false;
            onAccountIdentityRuntimeChanged(source, { identityKey: nextIdentity, pending: false });
            setIdentityChecks((current) => ({
              ...current,
              [source]: { checking: false, pending: false }
            }));
            return {
              status: nextIdentity.endsWith(':anonymous') ? ('anonymous' as const) : ('changed' as const),
              session: nextData.session,
              partial: nextData.failed
            };
          }
          if (!previousIdentity) removeUnconfirmedForumSourceQueries(source);
          appQueryClient.setQueryData(canonicalQueryKey, nextData);
          identityPendingRef.current[source] = false;
          onAccountIdentityRuntimeChanged(source, { identityKey: nextIdentity, pending: false });
          setIdentityChecks((current) => ({
            ...current,
            [source]: { checking: false, pending: false }
          }));
          return { status: 'same', session: nextData.session, partial: nextData.failed };
        } catch (error) {
          if (probeGenerationRef.current[source] !== generation) return { status: 'stale' };
          if (isCanceledStatusQuery(error)) {
            setIdentityChecks((current) => ({
              ...current,
              [source]: { checking: false, pending: true }
            }));
            return { status: 'stale' };
          }
          const message = errorMessage(error);
          const errorInfo = sourceErrorFromUnknown(source, error);
          setIdentityChecks((current) => ({
            ...current,
            [source]: { checking: false, pending: true, error: errorInfo }
          }));
          return { status: 'unknown', error: message, errorInfo };
        } finally {
          if (activeProbeRef.current[source]?.generation === generation) delete activeProbeRef.current[source];
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
    },
    [
      beginAccountIdentityCheck,
      onAccountIdentityRuntimeChanged,
      onAccountStatusChanged,
      sessionEpochs,
      sessionViewModels,
      statusQueryDefinitions
    ]
  );
  const statusBusy =
    Object.values(statusQueries).some((query) => query.fetchStatus === 'fetching') ||
    Object.values(identityChecks).some((identityCheck) => identityCheck.checking);
  const refreshAccountStatus = useCallback(
    async (options: RefreshAccountStatusOptions = {}) => {
      activeIdentityReconciliationsRef.current += 1;
      setIdentityReconciliationPending(true);
      try {
        const results = await Promise.all(
          Object.values(STATUS_DESCRIPTORS).map(async (descriptor) => ({
            descriptor,
            result: await reconcileAccountStatus(descriptor.source)
          }))
        );
        if (options.silent) return;
        const failedSites = results.flatMap(({ descriptor, result }) =>
          result.status === 'unknown' || ('partial' in result && result.partial) ? [descriptor.label] : []
        );
        notify(failedSites.length ? `账号状态部分刷新失败：${failedSites.join('、')}` : '账号状态已刷新');
      } finally {
        activeIdentityReconciliationsRef.current -= 1;
        if (activeIdentityReconciliationsRef.current === 0) setIdentityReconciliationPending(false);
      }
    },
    [notify, reconcileAccountStatus]
  );

  return {
    accountIdentityChecks: identityChecks,
    accountSessionViewModels,
    beginAccountIdentityCheck,
    identityReconciliationPending,
    reconcileAccountStatus,
    refreshAccountStatus,
    statusBusy
  };
}
