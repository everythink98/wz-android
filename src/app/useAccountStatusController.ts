import { useCallback } from 'react';
import { isCancelledError, useQueries } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { checkLinuxDoLoginAccess, checkYaohuoLogin, getCurrentUserProfile } from '../sources/sourceGateway';
import { errorMessage, isCanceledRequest } from '../appUtils';
import { summarizeYaohuoCookies, yaohuoCookieMapFromHeader } from '../yaohuoCookies';
import { parseNodeSeekDocumentCookie, summarizeNodeSeekCookies } from '../nodeseekCookies';
import {
  clearLinuxDoAccessForGeneration,
  currentLinuxDoAccessGeneration,
  linuxDoAccessSummary,
  loadLinuxDoAccess,
  parseLinuxDoDocumentCookie,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import {
  createSiteSessionStates,
  createSiteSessionViewModel,
  reduceSiteSessionState,
  type ScopedSiteSessionEvent,
  type SiteSessionState,
  type SiteSessionViewModel,
  type SiteSessionViewModels
} from '../siteSessionState';
import type { FeedSource, Source } from '../types';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '../request';
import type { CredentialClearOptions, CredentialLoadOptions } from './sessionControllerHelpers';
import type { XiaoyinsiAuthorizationReadResult } from './useXiaoyinsiAuthController';
import { isLinuxDoLoginCheckUnknown } from './accountStatusHelpers';
import { appQueryClient, forumQueryKeys, type ForumCredentialScope } from './serverState';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticTrace
} from '../diagnostics';

const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';
type RefreshAccountStatusOptions = { silent?: boolean };
type StatusSource = 'linuxdo' | 'nodeseek' | 'xiaoyinsi' | 'yaohuo';
type StatusQueryData = {
  failed?: boolean;
  session?: SiteSessionState;
};

const STATUS_SOURCES = ['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi'] as const satisfies readonly StatusSource[];
const STATUS_LABELS: Record<StatusSource, string> = {
  linuxdo: 'linux.do',
  nodeseek: 'NodeSeek',
  xiaoyinsi: '小隐寺',
  yaohuo: '妖火'
};

function isCanceledStatusQuery(error: unknown) {
  return isCancelledError(error) || isCanceledRequest(error);
}

function canceledStatusQuery(): never {
  throw new Error(REQUEST_CANCELED_MESSAGE);
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
  error: unknown
) {
  const ownsVisibleWorkflow = base.status === 'verifying'
    || base.status === 'authorizing'
    || base.status === 'verification-required';
  const remote = !ownsVisibleWorkflow && data?.session
    ? createSiteSessionViewModel(data.session)
    : base;
  return error && !isCanceledStatusQuery(error)
    ? { ...remote, lastError: errorMessage(error) }
    : remote;
}

export function useAccountStatusController({
  clearYaohuoLoginState,
  credentialScope,
  currentNodeSeekCredentialGeneration,
  currentYaohuoCredentialGeneration,
  linuxDoWebViewCookieHeaderRef,
  linuxDoUserAgentRef,
  loadNodeSeekCookieForSource,
  fetcher,
  nodeSeekUserAgentRef,
  notify,
  onLinuxDoExpired,
  readXiaoyinsiAuthorization,
  resetLinuxDoLevelState,
  saveNodeSeekCookieHeader,
  sessionViewModels,
  setLinuxDoWebViewCookieHeader
}: {
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<boolean>;
  credentialScope: ForumCredentialScope;
  currentNodeSeekCredentialGeneration: () => number;
  currentYaohuoCredentialGeneration: () => number;
  linuxDoWebViewCookieHeaderRef: { current: string };
  linuxDoUserAgentRef: { current: string };
  loadNodeSeekCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  fetcher: Fetcher;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  onLinuxDoExpired: (message: string) => void;
  readXiaoyinsiAuthorization: (
    trace?: DiagnosticTrace,
    options?: { signal?: AbortSignal }
  ) => Promise<XiaoyinsiAuthorizationReadResult>;
  resetLinuxDoLevelState: () => void;
  sessionViewModels: SiteSessionViewModels;
  saveNodeSeekCookieHeader: (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    options?: { generation?: number; userId?: number | null; diagnosticTrace?: DiagnosticTrace }
  ) => Promise<string>;
  setLinuxDoWebViewCookieHeader: (cookieHeader: string) => void;
}) {
  const statusQueries = useQueries({
    queries: [
      {
        enabled: false,
        queryKey: forumQueryKeys.accountStatus({ credentialScope, source: 'nodeseek' }),
        queryFn: async ({ signal }): Promise<StatusQueryData> => {
          const trace = beginDiagnosticTrace('session', 'refresh', { source: 'nodeseek' });
          let generation = currentNodeSeekCredentialGeneration();
          let nodeSeekCredentialUserId: number | null = null;
          try {
            const diagnosticFetcher = withDiagnosticFetcher(trace, fetcher);
            const cookieHeader = await loadNodeSeekCookieForSource('nodeseek', {
              captureGeneration: (nextGeneration) => { generation = nextGeneration; },
              captureNodeSeekUserId: (nextUserId) => { nodeSeekCredentialUserId = nextUserId; },
              diagnosticTrace: trace
            });
            if (signal.aborted || currentNodeSeekCredentialGeneration() !== generation) {
              finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
              return canceledStatusQuery();
            }
            const summary = summarizeNodeSeekCookies(parseNodeSeekDocumentCookie(cookieHeader || ''));
            markDiagnosticStage(trace, 'credential', {
              source: 'nodeseek',
              generation,
              hasCredential: summary.count > 0
            });
            const currentUser = summary.loggedIn
              ? await getCurrentUserProfile({
                source: 'nodeseek',
                fetcher: diagnosticFetcher,
                nodeSeekCookie: cookieHeader,
                nodeSeekUserId: nodeSeekCredentialUserId,
                nodeSeekUserAgent: nodeSeekUserAgentRef.current,
                signal
              })
              : null;
            if (signal.aborted || currentNodeSeekCredentialGeneration() !== generation) {
              finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
              return canceledStatusQuery();
            }
            const currentUserId = Number(currentUser?.id);
            let persistenceError: unknown;
            if (cookieHeader && Number.isInteger(currentUserId) && currentUserId > 0) {
              try {
                await saveNodeSeekCookieHeader(parseNodeSeekDocumentCookie(cookieHeader), {
                  generation,
                  userId: currentUserId,
                  diagnosticTrace: trace
                });
              } catch (error) {
                persistenceError = error;
              }
            }
            if (signal.aborted || currentNodeSeekCredentialGeneration() !== generation) {
              finishDiagnosticTrace(trace, 'stale', { source: 'nodeseek', reason: 'stale' });
              return canceledStatusQuery();
            }
            const checkedAt = new Date().toISOString();
            finishDiagnosticTrace(trace, persistenceError ? 'partial' : 'success', {
              source: 'nodeseek',
              ...(persistenceError ? { reason: normalizeDiagnosticReason(persistenceError) } : {})
            });
            return {
              failed: Boolean(persistenceError),
              session: sessionFromEvents('nodeseek', [{
                site: 'nodeseek',
                type: 'cookie-loaded',
                cookieSummary: summary.names,
                hasVerification: summary.count > 0,
                loggedIn: summary.loggedIn,
                currentUser,
                at: checkedAt
              }, ...(persistenceError ? [{
                site: 'nodeseek' as const,
                type: 'check-failed' as const,
                message: errorMessage(persistenceError),
                at: checkedAt
              }] : [])])
            };
          } catch (error) {
            const canceled = signal.aborted || isCanceledStatusQuery(error);
            finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
              source: 'nodeseek',
              reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
            });
            throw error;
          }
        }
      },
      {
        enabled: false,
        queryKey: forumQueryKeys.accountStatus({ credentialScope, source: 'linuxdo' }),
        queryFn: async ({ signal }): Promise<StatusQueryData> => {
          const trace = beginDiagnosticTrace('session', 'refresh', { source: 'linuxdo' });
          const generation = currentLinuxDoAccessGeneration();
          try {
            const diagnosticFetcher = withDiagnosticFetcher(trace, fetcher);
            let access = await loadLinuxDoAccess();
            if (signal.aborted || currentLinuxDoAccessGeneration() !== generation) {
              finishDiagnosticTrace(trace, 'stale', { source: 'linuxdo', reason: 'stale' });
              return canceledStatusQuery();
            }
            let summary = linuxDoAccessSummary(access);
            const cookieHeader = access?.cookieHeader || '';
            const userAgent = access?.userAgent || linuxDoUserAgentRef.current;
            markDiagnosticStage(trace, 'credential', {
              source: 'linuxdo',
              generation,
              hasCredential: Boolean(cookieHeader)
            });
            if (!cookieHeader || !summary.loggedIn) {
              finishDiagnosticTrace(trace, 'success', { source: 'linuxdo' });
              return {
                session: sessionFromEvents('linuxdo', [{
                  site: 'linuxdo',
                  type: 'cookie-loaded',
                  cookieSummary: summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(cookieHeader)).names,
                  hasVerification: summary.hasClearance,
                  loggedIn: false,
                  currentUser: null,
                  at: new Date().toISOString()
                }])
              };
            }
            const login = await checkLinuxDoLoginAccess({
              cookieHeader,
              fetcher: diagnosticFetcher,
              userAgent,
              signal
            });
            if (isLinuxDoLoginCheckUnknown(login)) {
              throw new Error(login?.message || 'linux.do 状态暂时无法确认');
            }
            if (login?.loginRequired) {
              let cleanupError: unknown;
              try {
                access = await clearLinuxDoAccessForGeneration(generation, cookieHeader);
              } catch (error) {
                cleanupError = error;
              }
              if (signal.aborted || currentLinuxDoAccessGeneration() !== generation) {
                finishDiagnosticTrace(trace, 'stale', { source: 'linuxdo', reason: 'stale' });
                return canceledStatusQuery();
              }
              summary = linuxDoAccessSummary(access);
              if (!cleanupError) {
                const nextCookieHeader = access?.cookieHeader || '';
                linuxDoWebViewCookieHeaderRef.current = nextCookieHeader;
                setLinuxDoWebViewCookieHeader(nextCookieHeader);
              }
              resetLinuxDoLevelState();
              const expiryMessage = cleanupError
                ? 'linux.do 登录已失效，本机 Cookie 清理未完成，请重试。'
                : login.message || 'linux.do 登录已失效';
              onLinuxDoExpired(expiryMessage);
              finishDiagnosticTrace(trace, cleanupError ? 'partial' : 'success', {
                source: 'linuxdo',
                ...(cleanupError ? { reason: normalizeDiagnosticReason(cleanupError) } : {})
              });
              return {
                failed: Boolean(cleanupError),
                session: sessionFromEvents('linuxdo', [{
                  site: 'linuxdo',
                  type: 'login-expired',
                  message: expiryMessage
                }])
              };
            }
            const currentUser = await getCurrentUserProfile({
              source: 'linuxdo',
              fetcher: diagnosticFetcher,
              discourseAuth: { linuxdo: { cookieHeader, userAgent } },
              signal
            });
            if (signal.aborted || currentLinuxDoAccessGeneration() !== generation) {
              finishDiagnosticTrace(trace, 'stale', { source: 'linuxdo', reason: 'stale' });
              return canceledStatusQuery();
            }
            finishDiagnosticTrace(trace, 'success', { source: 'linuxdo' });
            return {
              session: sessionFromEvents('linuxdo', [{
                site: 'linuxdo',
                type: 'cookie-loaded',
                cookieSummary: summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(cookieHeader)).names,
                hasVerification: summary.hasClearance,
                loggedIn: Boolean(login?.ok),
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
      {
        enabled: false,
        queryKey: forumQueryKeys.accountStatus({ credentialScope, source: 'yaohuo' }),
        queryFn: async ({ signal }): Promise<StatusQueryData> => {
          const trace = beginDiagnosticTrace('session', 'refresh', { source: 'yaohuo' });
          const generation = currentYaohuoCredentialGeneration();
          try {
            const diagnosticFetcher = withDiagnosticFetcher(trace, fetcher);
            const cookieHeader = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
            if (signal.aborted || currentYaohuoCredentialGeneration() !== generation) {
              finishDiagnosticTrace(trace, 'stale', { source: 'yaohuo', reason: 'stale' });
              return canceledStatusQuery();
            }
            const cookieSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(cookieHeader || '')).names;
            markDiagnosticStage(trace, 'credential', {
              source: 'yaohuo',
              generation,
              hasCredential: Boolean(cookieHeader)
            });
            if (!cookieHeader) {
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
            const check = await checkYaohuoLogin({
              yaohuoCookie: cookieHeader,
              yaohuoFetcher: diagnosticFetcher,
              signal
            });
            const expired = 'reason' in check && check.reason === 'expired';
            if (expired) {
              let cleanupError: unknown;
              try {
                await clearYaohuoLoginState({
                  generation,
                  expiredMessage: '妖火登录已失效'
                });
              } catch (error) {
                cleanupError = error;
              }
              if (signal.aborted || currentYaohuoCredentialGeneration() !== generation) {
                finishDiagnosticTrace(trace, 'stale', { source: 'yaohuo', reason: 'stale' });
                return canceledStatusQuery();
              }
              finishDiagnosticTrace(trace, cleanupError ? 'partial' : 'success', {
                source: 'yaohuo',
                ...(cleanupError ? { reason: normalizeDiagnosticReason(cleanupError) } : {})
              });
              return {
                failed: Boolean(cleanupError),
                session: sessionFromEvents('yaohuo', [{
                  site: 'yaohuo',
                  type: 'login-expired',
                  message: cleanupError ? '妖火登录已失效，本机 Cookie 清理未完成，请重试。' : '妖火登录已失效'
                }])
              };
            }
            const loggedIn = check.ok && !check.loginRequired;
            const currentUser = loggedIn
              ? ('currentUser' in check && check.currentUser
                ? check.currentUser
                : await getCurrentUserProfile({
                  source: 'yaohuo',
                  fetcher: diagnosticFetcher,
                  yaohuoCookie: cookieHeader,
                  signal
                }))
              : null;
            if (signal.aborted || currentYaohuoCredentialGeneration() !== generation) {
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
                loggedIn,
                currentUser,
                at: new Date().toISOString()
              }])
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
      {
        enabled: false,
        queryKey: forumQueryKeys.accountStatus({ credentialScope, source: 'xiaoyinsi' }),
        queryFn: async ({ signal }): Promise<StatusQueryData> => {
          const trace = beginDiagnosticTrace('session', 'refresh', { source: 'xiaoyinsi' });
          try {
            const result = await readXiaoyinsiAuthorization(trace, { signal });
            if (!result.sessionEvent) {
              return canceledStatusQuery();
            }
            const failed = result.authenticated === null;
            finishDiagnosticTrace(trace, failed ? 'failure' : 'success', {
              source: 'xiaoyinsi',
              ...(failed ? { reason: 'refresh_failed' } : {})
            });
            return {
              failed,
              session: sessionFromEvents('xiaoyinsi', [{
                ...result.sessionEvent,
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
    ]
  });

  const [nodeSeekStatus, linuxDoStatus, yaohuoStatus, xiaoyinsiStatus] = statusQueries;

  const accountSessionViewModels: SiteSessionViewModels = {
    nodeseek: accountStatusViewModel(sessionViewModels.nodeseek, nodeSeekStatus.data, nodeSeekStatus.error),
    linuxdo: accountStatusViewModel(sessionViewModels.linuxdo, linuxDoStatus.data, linuxDoStatus.error),
    yaohuo: accountStatusViewModel(sessionViewModels.yaohuo, yaohuoStatus.data, yaohuoStatus.error),
    xiaoyinsi: accountStatusViewModel(sessionViewModels.xiaoyinsi, xiaoyinsiStatus.data, xiaoyinsiStatus.error)
  };

  const statusBusy = statusQueries.some((query) => query.fetchStatus === 'fetching');
  const refreshAccountStatus = useCallback(async (options: RefreshAccountStatusOptions = {}) => {
    if (appQueryClient.isFetching({
      predicate: (query) => query.queryKey[0] === 'forum' && query.queryKey[2] === 'account-status'
    })) {
      return;
    }
    const results = await Promise.all(statusQueries.map((query) => query.refetch({ cancelRefetch: false })));
    if (options.silent) {
      return;
    }
    const failedSites = results.flatMap((result, index) => {
      const failed = Boolean(result.error && !isCanceledStatusQuery(result.error)) || Boolean(result.data?.failed);
      return failed ? [STATUS_LABELS[STATUS_SOURCES[index]]] : [];
    });
    notify(failedSites.length ? `账号状态部分刷新失败：${failedSites.join('、')}` : '账号状态已刷新');
  }, [notify, statusQueries]);

  return {
    accountSessionViewModels,
    refreshAccountStatus,
    statusBusy
  };
}
