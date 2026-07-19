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
  currentYaohuoCredentialGeneration,
  linuxDoUserAgentRef,
  loadNodeSeekCookieForSource,
  fetcher,
  nodeSeekUserAgentRef,
  notify,
  refreshXiaoyinsiAuthorization,
  resetLinuxDoLevelState,
  saveNodeSeekCookieHeader,
  dispatchSiteSessionEvent
}: {
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<void>;
  currentYaohuoCredentialGeneration: () => number;
  dispatchSiteSessionEvent: (event: ScopedSiteSessionEvent) => void;
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
      const yaohuoCookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
      let nodeSeekGeneration: number | undefined;
      let nodeSeekCredentialUserId: number | null = null;
      const nodeSeekCookie = await loadNodeSeekCookieForSource('nodeseek', {
        captureGeneration: (generation) => { nodeSeekGeneration = generation; },
        captureNodeSeekUserId: (userId) => { nodeSeekCredentialUserId = userId; },
        diagnosticTrace: trace
      });
      const nodeSeekSummary = summarizeNodeSeekCookies(parseNodeSeekDocumentCookie(nodeSeekCookie || ''));
      let linuxDoAccess = await loadLinuxDoAccess();
      let access = linuxDoAccessSummary(linuxDoAccess);
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        generation: nodeSeekGeneration ?? 0,
        hasCredential: nodeSeekSummary.count > 0
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'linuxdo',
        generation: linuxDoGeneration,
        hasCredential: Boolean(linuxDoAccess?.cookieHeader)
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        generation: yaohuoGeneration,
        hasCredential: Boolean(yaohuoCookie)
      });
      const linuxDoLoginPromise = linuxDoAccess?.cookieHeader && access.loggedIn
        ? checkLinuxDoLoginAccess({
          cookieHeader: linuxDoAccess.cookieHeader,
          fetcher: diagnosticFetcher,
          userAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(undefined);
      const nodeSeekCurrentUserPromise = nodeSeekSummary.loggedIn
        ? getCurrentUserProfile({
          source: 'nodeseek',
          fetcher: diagnosticFetcher,
          nodeSeekCookie,
          nodeSeekUserId: nodeSeekCredentialUserId,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(null);
      const linuxDoCurrentUserPromise = linuxDoAccess?.cookieHeader && access.loggedIn
        ? getCurrentUserProfile({
          source: 'linuxdo',
          fetcher: diagnosticFetcher,
          linuxDoCookie: linuxDoAccess.cookieHeader,
          linuxDoUserAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(null);
      const yaohuoStatusPromise = yaohuoCookie
        ? checkYaohuoLogin({ yaohuoCookie, yaohuoFetcher: diagnosticFetcher, signal: controller.signal })
        : Promise.resolve({ ok: false, loginRequired: true, message: '未登录' });
      const yaohuoCurrentUserPromise = yaohuoCookie
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
      const failedSites: string[] = [];
      const yaohuoOk = yaohuoCheck.status === 'fulfilled' && yaohuoCheck.value.ok && !yaohuoCheck.value.loginRequired;
      if (nodeSeekSummary.loggedIn && nodeSeekCurrentUserCheck.status === 'rejected') {
        failedSites.push('NodeSeek');
      }
      if (yaohuoOk && yaohuoCurrentUserCheck.status === 'rejected') {
        failedSites.push('妖火');
      }
      const linuxDoLogin = linuxDoLoginCheck.status === 'fulfilled' ? linuxDoLoginCheck.value : undefined;
      if (linuxDoLoginCheck.status === 'rejected') {
        failedSites.push('linux.do');
      }
      if (isLinuxDoLoginCheckUnknown(linuxDoLogin)) {
        failedSites.push('linux.do');
      }
      if (access.loggedIn && !linuxDoLogin?.loginRequired && linuxDoCurrentUserCheck.status === 'rejected') {
        failedSites.push('linux.do');
      }
      if (linuxDoLogin?.loginRequired) {
        markDiagnosticStage(trace, 'credential', {
          source: 'linuxdo',
          generation: linuxDoGeneration,
          state: 'expired'
        });
        linuxDoAccess = await clearLinuxDoAccessForGeneration(linuxDoGeneration, linuxDoAccess?.cookieHeader);
        if (controller.signal.aborted) {
          finishTrace('canceled', { reason: 'canceled' });
          return;
        }
        access = linuxDoAccessSummary(linuxDoAccess);
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          generation: linuxDoGeneration,
          hasCredential: Boolean(linuxDoAccess?.cookieHeader),
          state: 'applied'
        });
        resetLinuxDoLevelState();
      }
      const yaohuoExpired = yaohuoCheck.status === 'fulfilled' && 'reason' in yaohuoCheck.value && yaohuoCheck.value.reason === 'expired';
      if (yaohuoExpired) {
        markDiagnosticStage(trace, 'credential', {
          source: 'yaohuo',
          generation: yaohuoGeneration,
          state: 'expired'
        });
        await clearYaohuoLoginState({ generation: yaohuoGeneration });
        if (controller.signal.aborted) {
          finishTrace('canceled', { reason: 'canceled' });
          return;
        }
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          generation: yaohuoGeneration,
          hasCredential: false,
          state: 'applied'
        });
      }
      const checkedAt = new Date().toISOString();
      const nodeSeekCurrentUser = nodeSeekCurrentUserCheck.status === 'fulfilled' ? nodeSeekCurrentUserCheck.value : null;
      markDiagnosticStage(trace, 'apply', {
        source: 'nodeseek',
        hasCredential: nodeSeekSummary.count > 0,
        hasCurrentUser: Boolean(nodeSeekCurrentUser),
        isLoggedIn: nodeSeekSummary.loggedIn
      });
      dispatchSiteSessionEvent({
        site: 'nodeseek',
        type: 'cookie-loaded',
        cookieSummary: nodeSeekSummary.names,
        hasVerification: nodeSeekSummary.count > 0,
        loggedIn: nodeSeekSummary.loggedIn,
        currentUser: nodeSeekCurrentUser,
        at: checkedAt
      });
      const nodeSeekCurrentUserId = Number(nodeSeekCurrentUser?.id);
      if (nodeSeekCookie && Number.isInteger(nodeSeekCurrentUserId) && nodeSeekCurrentUserId > 0) {
        markDiagnosticStage(trace, 'persist', {
          source: 'nodeseek',
          generation: nodeSeekGeneration ?? 0,
          hasCurrentUser: true
        });
        await saveNodeSeekCookieHeader(parseNodeSeekDocumentCookie(nodeSeekCookie), {
          generation: nodeSeekGeneration,
          userId: nodeSeekCurrentUserId,
          diagnosticTrace: trace
        });
      }
      if (yaohuoCheck.status === 'rejected') {
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
          message: errorMessage(yaohuoCheck.reason),
          at: checkedAt
        });
      } else {
        const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(yaohuoCookie || ''));
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          hasCredential: Boolean(yaohuoCookie),
          hasCurrentUser: yaohuoCurrentUserCheck.status === 'fulfilled' && Boolean(yaohuoCurrentUserCheck.value),
          isLoggedIn: yaohuoOk
        });
        dispatchSiteSessionEvent(yaohuoExpired
          ? { site: 'yaohuo', type: 'login-expired', message: '妖火登录已失效' }
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
      if (linuxDoLoginCheck.status === 'rejected' || isLinuxDoLoginCheckUnknown(linuxDoLogin)) {
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
          message: linuxDoLoginCheck.status === 'rejected'
            ? errorMessage(linuxDoLoginCheck.reason)
            : linuxDoLogin?.message || 'linux.do 状态暂时无法确认',
          at: checkedAt
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
    currentYaohuoCredentialGeneration,
    dispatchSiteSessionEvent,
    fetcher,
    linuxDoUserAgentRef,
    loadNodeSeekCookieForSource,
    nodeSeekUserAgentRef,
    notify,
    refreshXiaoyinsiAuthorization,
    resetLinuxDoLevelState,
    saveNodeSeekCookieHeader
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
