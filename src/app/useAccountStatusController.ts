import { useCallback, useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { checkLinuxDoLoginAccess, checkYaohuoLogin, getCurrentUserProfile } from '../sources/sourceGateway';
import {
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  startAbortableRequest
} from '../appUtils';
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
import type { ScopedSiteSessionEvent } from '../siteSessionState';
import type { FeedSource, Source } from '../types';
import type { Fetcher } from '../request';
import type { CredentialClearOptions, CredentialLoadOptions } from './sessionControllerHelpers';
import { isLinuxDoLoginCheckUnknown } from './accountStatusHelpers';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticFields,
  type DiagnosticOutcome,
  type DiagnosticTrace
} from '../diagnostics';

const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';
type RefreshAccountStatusOptions = { silent?: boolean };

export function useAccountStatusController({
  clearYaohuoLoginState,
  currentNodeSeekCredentialGeneration,
  currentYaohuoCredentialGeneration,
  linuxDoWebViewCookieHeaderRef,
  linuxDoUserAgentRef,
  loadNodeSeekCookieForSource,
  fetcher,
  nodeSeekUserAgentRef,
  notify,
  refreshXiaoyinsiAuthorization,
  resetLinuxDoLevelState,
  saveNodeSeekCookieHeader,
  setLinuxDoWebViewCookieHeader,
  dispatchSiteSessionEvent
}: {
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<boolean>;
  currentNodeSeekCredentialGeneration: () => number;
  currentYaohuoCredentialGeneration: () => number;
  dispatchSiteSessionEvent: (event: ScopedSiteSessionEvent) => void;
  linuxDoWebViewCookieHeaderRef: { current: string };
  linuxDoUserAgentRef: { current: string };
  loadNodeSeekCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  fetcher: Fetcher;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  refreshXiaoyinsiAuthorization: () => Promise<boolean | null>;
  resetLinuxDoLevelState: () => void;
  saveNodeSeekCookieHeader: (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    options?: { generation?: number; userId?: number | null; diagnosticTrace?: DiagnosticTrace }
  ) => Promise<string>;
  setLinuxDoWebViewCookieHeader: (cookieHeader: string) => void;
}) {
  const statusAbortRef = useRef<AbortController | null>(null);
  const statusBusyRef = useRef(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const refreshAccountStatus = useCallback(async (options: RefreshAccountStatusOptions = {}) => {
    const trace = beginDiagnosticTrace('session', 'refresh', {
      mode: options.silent ? 'silent' : 'manual'
    });
    let traceFinished = false;
    const finishTrace = (outcome: DiagnosticOutcome, fields: DiagnosticFields = {}) => {
      if (traceFinished) {
        return;
      }
      traceFinished = true;
      finishDiagnosticTrace(trace, outcome, { source: 'all', ...fields });
    };
    if (statusBusyRef.current) {
      markDiagnosticStage(trace, 'guard', { state: 'busy' });
      finishTrace('blocked', { reason: 'busy' });
      return;
    }
    markDiagnosticStage(trace, 'guard', { state: 'ready' });
    statusBusyRef.current = true;
    const controller = startAbortableRequest(statusAbortRef);
    setStatusBusy(true);
    try {
      const diagnosticFetcher = withDiagnosticFetcher(trace, fetcher);
      const yaohuoGeneration = currentYaohuoCredentialGeneration();
      const linuxDoGeneration = currentLinuxDoAccessGeneration();
      let nodeSeekGeneration = currentNodeSeekCredentialGeneration();
      let nodeSeekCredentialUserId: number | null = null;
      const [yaohuoCredentialCheck, nodeSeekCredentialCheck, linuxDoCredentialCheck] = await Promise.allSettled([
        SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY),
        loadNodeSeekCookieForSource('nodeseek', {
          captureGeneration: (generation) => { nodeSeekGeneration = generation; },
          captureNodeSeekUserId: (userId) => { nodeSeekCredentialUserId = userId; },
          diagnosticTrace: trace
        }),
        loadLinuxDoAccess()
      ] as const);
      if (controller.signal.aborted) {
        finishTrace('canceled', { reason: 'canceled' });
        return;
      }
      const yaohuoCookie = yaohuoCredentialCheck.status === 'fulfilled' ? yaohuoCredentialCheck.value : null;
      const nodeSeekCookie = nodeSeekCredentialCheck.status === 'fulfilled' ? nodeSeekCredentialCheck.value : undefined;
      const nodeSeekSummary = summarizeNodeSeekCookies(parseNodeSeekDocumentCookie(nodeSeekCookie || ''));
      let linuxDoAccess = linuxDoCredentialCheck.status === 'fulfilled' ? linuxDoCredentialCheck.value : null;
      let access = linuxDoAccessSummary(linuxDoAccess);
      const nodeSeekCredentialCurrent = currentNodeSeekCredentialGeneration() === nodeSeekGeneration;
      const linuxDoCredentialCurrent = currentLinuxDoAccessGeneration() === linuxDoGeneration;
      const yaohuoCredentialCurrent = currentYaohuoCredentialGeneration() === yaohuoGeneration;
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        generation: nodeSeekGeneration ?? 0,
        hasCredential: nodeSeekSummary.count > 0,
        ...(nodeSeekCredentialCheck.status === 'rejected' ? {
          state: 'error' as const,
          reason: normalizeDiagnosticReason(nodeSeekCredentialCheck.reason)
        } : {})
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'linuxdo',
        generation: linuxDoGeneration,
        hasCredential: Boolean(linuxDoAccess?.cookieHeader),
        ...(linuxDoCredentialCheck.status === 'rejected' ? {
          state: 'error' as const,
          reason: normalizeDiagnosticReason(linuxDoCredentialCheck.reason)
        } : {})
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        generation: yaohuoGeneration,
        hasCredential: Boolean(yaohuoCookie),
        ...(yaohuoCredentialCheck.status === 'rejected' ? {
          state: 'error' as const,
          reason: normalizeDiagnosticReason(yaohuoCredentialCheck.reason)
        } : {})
      });
      const linuxDoLoginPromise = linuxDoCredentialCurrent && linuxDoAccess?.cookieHeader && access.loggedIn
        ? checkLinuxDoLoginAccess({
          cookieHeader: linuxDoAccess.cookieHeader,
          fetcher: diagnosticFetcher,
          userAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(undefined);
      const nodeSeekCurrentUserPromise = nodeSeekCredentialCurrent && nodeSeekSummary.loggedIn
        ? getCurrentUserProfile({
          source: 'nodeseek',
          fetcher: diagnosticFetcher,
          nodeSeekCookie,
          nodeSeekUserId: nodeSeekCredentialUserId,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(null);
      const linuxDoCurrentUserPromise = linuxDoCredentialCurrent && linuxDoAccess?.cookieHeader && access.loggedIn
        ? getCurrentUserProfile({
          source: 'linuxdo',
          fetcher: diagnosticFetcher,
          discourseAuth: {
            linuxdo: {
              cookieHeader: linuxDoAccess.cookieHeader,
              userAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current
            }
          },
          signal: controller.signal
        })
        : Promise.resolve(null);
      const yaohuoStatusPromise = yaohuoCredentialCurrent && yaohuoCookie
        ? checkYaohuoLogin({ yaohuoCookie, yaohuoFetcher: diagnosticFetcher, signal: controller.signal })
        : Promise.resolve({ ok: false, loginRequired: true, message: '未登录' });
      const yaohuoCurrentUserPromise = yaohuoCredentialCurrent && yaohuoCookie
        ? yaohuoStatusPromise.then((check) => {
          if (check.ok && !check.loginRequired && 'currentUser' in check && check.currentUser) {
            return check.currentUser;
          }
          if (!check.ok || check.loginRequired) {
            return null;
          }
          return getCurrentUserProfile({
            source: 'yaohuo',
            fetcher: diagnosticFetcher,
            yaohuoCookie,
            signal: controller.signal
          });
        })
        : Promise.resolve(null);
      const xiaoyinsiAuthorizationPromise = refreshXiaoyinsiAuthorization();
      markDiagnosticStage(trace, 'transport', {
        source: 'all',
        channel: 'direct',
        state: 'start',
        count: 6
      });
      const [yaohuoCheck, linuxDoLoginCheck, nodeSeekCurrentUserCheck, linuxDoCurrentUserCheck, yaohuoCurrentUserCheck, xiaoyinsiAuthorizationCheck] = await Promise.allSettled([
        yaohuoStatusPromise,
        linuxDoLoginPromise,
        nodeSeekCurrentUserPromise,
        linuxDoCurrentUserPromise,
        yaohuoCurrentUserPromise,
        xiaoyinsiAuthorizationPromise
      ] as const);
      if (controller.signal.aborted) {
        finishTrace('canceled', { reason: 'canceled' });
        return;
      }
      markDiagnosticStage(trace, 'transport', {
        source: 'all',
        channel: 'direct',
        state: 'finish',
        partialErrorCount: [
          yaohuoCheck,
          linuxDoLoginCheck,
          nodeSeekCurrentUserCheck,
          linuxDoCurrentUserCheck,
          yaohuoCurrentUserCheck,
          xiaoyinsiAuthorizationCheck
        ].filter((result) => result.status === 'rejected').length
      });
      let nodeSeekReadCurrent = currentNodeSeekCredentialGeneration() === nodeSeekGeneration;
      let linuxDoReadCurrent = currentLinuxDoAccessGeneration() === linuxDoGeneration;
      let yaohuoReadCurrent = currentYaohuoCredentialGeneration() === yaohuoGeneration;
      const failedSites: string[] = [
        ...(nodeSeekReadCurrent && nodeSeekCredentialCheck.status === 'rejected' ? ['NodeSeek'] : []),
        ...(linuxDoReadCurrent && linuxDoCredentialCheck.status === 'rejected' ? ['linux.do'] : []),
        ...(yaohuoReadCurrent && yaohuoCredentialCheck.status === 'rejected' ? ['妖火'] : [])
      ];
      let linuxDoCleanupError: unknown;
      let yaohuoCleanupError: unknown;
      const yaohuoOk = yaohuoCheck.status === 'fulfilled' && yaohuoCheck.value.ok && !yaohuoCheck.value.loginRequired;
      if (nodeSeekReadCurrent && nodeSeekSummary.loggedIn && nodeSeekCurrentUserCheck.status === 'rejected') {
        failedSites.push('NodeSeek');
      }
      if (yaohuoReadCurrent && yaohuoOk && yaohuoCurrentUserCheck.status === 'rejected') {
        failedSites.push('妖火');
      }
      const linuxDoLogin = linuxDoLoginCheck.status === 'fulfilled' ? linuxDoLoginCheck.value : undefined;
      if (linuxDoReadCurrent && linuxDoLoginCheck.status === 'rejected') {
        failedSites.push('linux.do');
      }
      if (linuxDoReadCurrent && isLinuxDoLoginCheckUnknown(linuxDoLogin)) {
        failedSites.push('linux.do');
      }
      if (linuxDoReadCurrent && access.loggedIn && !linuxDoLogin?.loginRequired && linuxDoCurrentUserCheck.status === 'rejected') {
        failedSites.push('linux.do');
      }
      if (linuxDoReadCurrent && linuxDoLogin?.loginRequired) {
        markDiagnosticStage(trace, 'credential', {
          source: 'linuxdo',
          generation: linuxDoGeneration,
          state: 'expired'
        });
        try {
          linuxDoAccess = await clearLinuxDoAccessForGeneration(linuxDoGeneration, linuxDoAccess?.cookieHeader);
        } catch (error) {
          linuxDoCleanupError = error;
          markDiagnosticStage(trace, 'persist', {
            source: 'linuxdo',
            generation: linuxDoGeneration,
            store: 'multi-store',
            state: 'partial',
            reason: normalizeDiagnosticReason(error)
          });
        }
        if (controller.signal.aborted) {
          finishTrace('canceled', { reason: 'canceled' });
          return;
        }
        access = linuxDoAccessSummary(linuxDoAccess);
        linuxDoReadCurrent = currentLinuxDoAccessGeneration() === linuxDoGeneration;
        if (linuxDoReadCurrent && !linuxDoCleanupError) {
          const cookieHeader = linuxDoAccess?.cookieHeader || '';
          linuxDoWebViewCookieHeaderRef.current = cookieHeader;
          setLinuxDoWebViewCookieHeader(cookieHeader);
        }
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          generation: linuxDoGeneration,
          hasCredential: Boolean(linuxDoAccess?.cookieHeader),
          state: linuxDoCleanupError ? 'partial' : 'applied'
        });
        if (linuxDoReadCurrent) {
          resetLinuxDoLevelState();
        }
      }
      const yaohuoExpired = yaohuoCheck.status === 'fulfilled' && 'reason' in yaohuoCheck.value && yaohuoCheck.value.reason === 'expired';
      if (yaohuoReadCurrent && yaohuoExpired) {
        markDiagnosticStage(trace, 'credential', {
          source: 'yaohuo',
          generation: yaohuoGeneration,
          state: 'expired'
        });
        try {
          await clearYaohuoLoginState({
            generation: yaohuoGeneration,
            expiredMessage: '妖火登录已失效'
          });
        } catch (error) {
          yaohuoCleanupError = error;
          markDiagnosticStage(trace, 'persist', {
            source: 'yaohuo',
            generation: yaohuoGeneration,
            store: 'multi-store',
            state: 'partial',
            reason: normalizeDiagnosticReason(error)
          });
        }
        if (controller.signal.aborted) {
          finishTrace('canceled', { reason: 'canceled' });
          return;
        }
        yaohuoReadCurrent = currentYaohuoCredentialGeneration() === yaohuoGeneration;
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          generation: yaohuoGeneration,
          hasCredential: Boolean(yaohuoCleanupError && yaohuoCookie),
          state: yaohuoCleanupError ? 'partial' : 'applied'
        });
      }
      const checkedAt = new Date().toISOString();
      const nodeSeekCurrentUser = nodeSeekCurrentUserCheck.status === 'fulfilled' ? nodeSeekCurrentUserCheck.value : null;
      const nodeSeekCredentialFailed = nodeSeekCredentialCheck.status === 'rejected';
      const nodeSeekIdentityFailed = nodeSeekSummary.loggedIn && nodeSeekCurrentUserCheck.status === 'rejected';
      let nodeSeekPersistenceError: unknown;
      const nodeSeekCurrentUserId = Number(nodeSeekCurrentUser?.id);
      if (nodeSeekReadCurrent && nodeSeekCookie && Number.isInteger(nodeSeekCurrentUserId) && nodeSeekCurrentUserId > 0) {
        markDiagnosticStage(trace, 'persist', {
          source: 'nodeseek',
          generation: nodeSeekGeneration,
          hasCurrentUser: true
        });
        try {
          await saveNodeSeekCookieHeader(parseNodeSeekDocumentCookie(nodeSeekCookie), {
            generation: nodeSeekGeneration,
            userId: nodeSeekCurrentUserId,
            diagnosticTrace: trace
          });
        } catch (error) {
          nodeSeekPersistenceError = error;
        }
        nodeSeekReadCurrent = currentNodeSeekCredentialGeneration() === nodeSeekGeneration;
      }
      if (!nodeSeekReadCurrent) {
        markDiagnosticStage(trace, 'apply', {
          source: 'nodeseek',
          generation: nodeSeekGeneration,
          state: 'stale'
        });
      } else if (nodeSeekPersistenceError) {
        failedSites.push('NodeSeek');
        markDiagnosticStage(trace, 'persist', {
          source: 'nodeseek',
          generation: nodeSeekGeneration,
          store: 'multi-store',
          state: 'partial',
          reason: normalizeDiagnosticReason(nodeSeekPersistenceError)
        });
        dispatchSiteSessionEvent({
          site: 'nodeseek',
          type: 'check-failed',
          message: 'NodeSeek 身份已确认，但凭据更新未保存，请重试刷新。',
          at: checkedAt
        });
      } else {
        const nodeSeekCheckFailed = nodeSeekCredentialFailed || nodeSeekIdentityFailed;
        markDiagnosticStage(trace, 'apply', {
          source: 'nodeseek',
          hasCredential: nodeSeekSummary.count > 0,
          hasCurrentUser: Boolean(nodeSeekCurrentUser),
          isLoggedIn: nodeSeekSummary.loggedIn,
          ...(nodeSeekCheckFailed ? { state: 'failed' as const } : {})
        });
        dispatchSiteSessionEvent(nodeSeekCheckFailed
          ? {
            site: 'nodeseek',
            type: 'check-failed',
            message: nodeSeekCredentialCheck.status === 'rejected'
              ? errorMessage(nodeSeekCredentialCheck.reason)
              : nodeSeekCurrentUserCheck.status === 'rejected'
                ? errorMessage(nodeSeekCurrentUserCheck.reason)
                : 'NodeSeek 状态暂时无法确认',
            at: checkedAt
          }
          : {
            site: 'nodeseek',
            type: 'cookie-loaded',
            cookieSummary: nodeSeekSummary.names,
            hasVerification: nodeSeekSummary.count > 0,
            loggedIn: nodeSeekSummary.loggedIn,
            currentUser: nodeSeekCurrentUser,
            at: checkedAt
          });
      }
      const yaohuoCredentialFailed = yaohuoCredentialCheck.status === 'rejected';
      const yaohuoIdentityFailed = yaohuoOk && yaohuoCurrentUserCheck.status === 'rejected';
      if (!yaohuoReadCurrent) {
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          generation: yaohuoGeneration,
          state: 'stale'
        });
      } else if (yaohuoCredentialFailed || yaohuoCheck.status === 'rejected' || yaohuoIdentityFailed) {
        failedSites.push('妖火');
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          hasCredential: Boolean(yaohuoCookie),
          hasCurrentUser: false,
          isLoggedIn: false,
          state: 'failed'
        });
        dispatchSiteSessionEvent({
          site: 'yaohuo',
          type: 'check-failed',
          message: yaohuoCredentialCheck.status === 'rejected'
            ? errorMessage(yaohuoCredentialCheck.reason)
            : yaohuoCheck.status === 'rejected'
              ? errorMessage(yaohuoCheck.reason)
              : yaohuoCurrentUserCheck.status === 'rejected'
                ? errorMessage(yaohuoCurrentUserCheck.reason)
                : '妖火身份暂时无法确认',
          at: checkedAt
        });
      } else {
        if (yaohuoCleanupError) {
          failedSites.push('妖火');
        }
        const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(yaohuoCookie || ''));
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          hasCredential: Boolean(yaohuoCookie),
          hasCurrentUser: yaohuoCurrentUserCheck.status === 'fulfilled' && Boolean(yaohuoCurrentUserCheck.value),
          isLoggedIn: yaohuoOk
        });
        dispatchSiteSessionEvent(yaohuoExpired
          ? {
            site: 'yaohuo',
            type: 'login-expired',
            message: yaohuoCleanupError ? '妖火登录已失效，本机 Cookie 清理未完成，请重试。' : '妖火登录已失效'
          }
          : {
            site: 'yaohuo',
            type: 'cookie-loaded',
            cookieSummary: yaohuoSummary.names,
            hasVerification: false,
            loggedIn: yaohuoOk,
            currentUser: yaohuoCurrentUserCheck.status === 'fulfilled' ? yaohuoCurrentUserCheck.value : null,
            at: checkedAt
          });
      }
      const linuxDoCredentialFailed = linuxDoCredentialCheck.status === 'rejected';
      const linuxDoIdentityFailed = access.loggedIn
        && Boolean(linuxDoLogin?.ok)
        && linuxDoCurrentUserCheck.status === 'rejected';
      if (!linuxDoReadCurrent) {
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          generation: linuxDoGeneration,
          state: 'stale'
        });
      } else if (linuxDoCredentialFailed || linuxDoLoginCheck.status === 'rejected' || isLinuxDoLoginCheckUnknown(linuxDoLogin) || linuxDoIdentityFailed) {
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          hasCredential: Boolean(linuxDoAccess?.cookieHeader),
          hasCurrentUser: false,
          isLoggedIn: false,
          state: 'failed'
        });
        dispatchSiteSessionEvent({
          site: 'linuxdo',
          type: 'check-failed',
          message: linuxDoCredentialCheck.status === 'rejected'
            ? errorMessage(linuxDoCredentialCheck.reason)
            : linuxDoLoginCheck.status === 'rejected'
              ? errorMessage(linuxDoLoginCheck.reason)
              : linuxDoIdentityFailed
                ? errorMessage(linuxDoCurrentUserCheck.reason)
                : linuxDoLogin?.message || 'linux.do 状态暂时无法确认',
          at: checkedAt
        });
      } else if (linuxDoLogin?.loginRequired) {
        if (linuxDoCleanupError) {
          failedSites.push('linux.do');
        }
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          hasCredential: Boolean(linuxDoAccess?.cookieHeader),
          hasCurrentUser: false,
          isLoggedIn: false,
          state: linuxDoCleanupError ? 'partial' : 'expired'
        });
        dispatchSiteSessionEvent({
          site: 'linuxdo',
          type: 'login-expired',
          message: linuxDoCleanupError
            ? 'linux.do 登录已失效，本机 Cookie 清理未完成，请重试。'
            : linuxDoLogin.message || 'linux.do 登录已失效'
        });
      } else {
        const hasLinuxDoLogin = access.loggedIn && Boolean(linuxDoLogin?.ok);
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          hasCredential: Boolean(linuxDoAccess?.cookieHeader),
          hasCurrentUser: linuxDoCurrentUserCheck.status === 'fulfilled' && Boolean(linuxDoCurrentUserCheck.value),
          isLoggedIn: hasLinuxDoLogin
        });
        dispatchSiteSessionEvent({
          site: 'linuxdo',
          type: 'cookie-loaded',
          cookieSummary: summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(linuxDoAccess?.cookieHeader || '')).names,
          hasVerification: access.hasClearance,
          loggedIn: hasLinuxDoLogin,
          currentUser: linuxDoCurrentUserCheck.status === 'fulfilled' ? linuxDoCurrentUserCheck.value : null,
          at: checkedAt
        });
      }
      if (xiaoyinsiAuthorizationCheck.status === 'rejected' || xiaoyinsiAuthorizationCheck.value === null) {
        failedSites.push('小隐寺');
      }
      const uniqueFailedSites = Array.from(new Set(failedSites));
      markDiagnosticStage(trace, 'apply', {
        source: 'all',
        state: 'status-updated',
        partialErrorCount: uniqueFailedSites.length
      });
      if (!options.silent) {
        notify(uniqueFailedSites.length ? `账号状态部分刷新失败：${uniqueFailedSites.join('、')}` : '账号状态已刷新');
      }
      finishTrace(uniqueFailedSites.length ? 'partial' : 'success', {
        partialErrorCount: uniqueFailedSites.length
      });
    } catch (error) {
      if (controller.signal.aborted || isCanceledRequest(error)) {
        finishTrace('canceled', { reason: 'canceled' });
      } else {
        finishTrace('failure', { reason: normalizeDiagnosticReason(error) });
      }
      if (!options.silent && !controller.signal.aborted && !isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
      if (!traceFinished) {
        finishTrace(controller.signal.aborted ? 'canceled' : 'failure', {
          reason: controller.signal.aborted ? 'canceled' : 'unknown'
        });
      }
      if (finishAbortableRequest(statusAbortRef, controller)) {
        statusBusyRef.current = false;
        setStatusBusy(false);
      }
    }
  }, [
    clearYaohuoLoginState,
    currentNodeSeekCredentialGeneration,
    currentYaohuoCredentialGeneration,
    dispatchSiteSessionEvent,
    fetcher,
    linuxDoWebViewCookieHeaderRef,
    linuxDoUserAgentRef,
    loadNodeSeekCookieForSource,
    nodeSeekUserAgentRef,
    notify,
    refreshXiaoyinsiAuthorization,
    resetLinuxDoLevelState,
    saveNodeSeekCookieHeader,
    setLinuxDoWebViewCookieHeader
  ]);

  const abortAccountStatusRequests = useCallback(() => {
    statusAbortRef.current?.abort();
  }, []);

  useEffect(() => abortAccountStatusRequests, [abortAccountStatusRequests]);

  return {
    abortAccountStatusRequests,
    refreshAccountStatus,
    statusBusy
  };
}
