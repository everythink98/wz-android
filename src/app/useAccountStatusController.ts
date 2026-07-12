import { useCallback, useEffect, useRef, useState } from 'react';
import { checkLinuxDoLoginAccess, checkYaohuoLogin, getCurrentUserProfile } from '../sources/sourceGateway';
import {
  errorMessage,
  finishAbortableRequest,
  isCanceledRequest,
  isSupersededRequest,
  startAbortableRequest
} from '../appUtils';
import { summarizeYaohuoCookies, yaohuoCookieMapFromHeader } from '../yaohuoCookies';
import { parseNodeSeekDocumentCookie, summarizeNodeSeekCookies } from '../nodeseekCookies';
import { sourceErrorFromUnknown } from '../sourceErrors';
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

type RefreshAccountStatusOptions = { silent?: boolean };

export function useAccountStatusController({
  clearNodeSeekLoginCookiesOnly,
  clearYaohuoLoginState,
  currentNodeSeekCredentialGeneration,
  currentYaohuoCredentialGeneration,
  linuxDoUserAgentRef,
  loadNodeSeekCookieForSource,
  loadYaohuoCookieForSource,
  fetcher,
  nodeSeekUserAgentRef,
  notify,
  resetLinuxDoLevelState,
  saveNodeSeekCookieHeader,
  dispatchSiteSessionEvent,
  yaohuoCredentialSuppressed = false,
  yaohuoCredentialSuppressedRef
}: {
  clearNodeSeekLoginCookiesOnly: (options?: CredentialClearOptions) => Promise<{ hasCredential: boolean } | void>;
  clearYaohuoLoginState: (options?: CredentialClearOptions) => Promise<boolean | void>;
  currentNodeSeekCredentialGeneration: () => number;
  currentYaohuoCredentialGeneration: () => number;
  dispatchSiteSessionEvent: (event: ScopedSiteSessionEvent) => void;
  linuxDoUserAgentRef: { current: string };
  loadNodeSeekCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  loadYaohuoCookieForSource: (source: FeedSource | Source, options?: CredentialLoadOptions) => Promise<string | undefined>;
  fetcher: Fetcher;
  nodeSeekUserAgentRef: { current: string };
  notify: (message: string) => void;
  resetLinuxDoLevelState: () => void;
  saveNodeSeekCookieHeader: (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    options?: { generation?: number; userId?: number | null; diagnosticTrace?: DiagnosticTrace }
  ) => Promise<string>;
  yaohuoCredentialSuppressed?: boolean;
  yaohuoCredentialSuppressedRef: { current: boolean };
}) {
  const statusAbortRef = useRef<AbortController | null>(null);
  const statusBusyRef = useRef(false);
  const previousYaohuoCredentialSuppressedRef = useRef(yaohuoCredentialSuppressed);
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
      const yaohuoSuppressedAtStart = yaohuoCredentialSuppressedRef.current;
      const yaohuoGeneration = currentYaohuoCredentialGeneration();
      const linuxDoGeneration = currentLinuxDoAccessGeneration();
      let nodeSeekGeneration: number | undefined = currentNodeSeekCredentialGeneration();
      let nodeSeekCredentialUserId: number | null = null;
      const [yaohuoCredential, nodeSeekCredential, linuxDoCredential] = await Promise.allSettled([
        yaohuoSuppressedAtStart
          ? Promise.resolve(undefined)
          : loadYaohuoCookieForSource('yaohuo', { diagnosticTrace: trace }),
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
      const isNodeSeekRefreshCurrent = () => nodeSeekGeneration === currentNodeSeekCredentialGeneration();
      const isLinuxDoRefreshCurrent = () => linuxDoGeneration === currentLinuxDoAccessGeneration();
      const isYaohuoRefreshCurrent = () => yaohuoGeneration === currentYaohuoCredentialGeneration()
        && yaohuoSuppressedAtStart === yaohuoCredentialSuppressedRef.current;
      const isYaohuoRequestCurrent = () => !controller.signal.aborted
        && yaohuoSuppressedAtStart === yaohuoCredentialSuppressedRef.current;
      const nodeSeekCredentialCurrent = isNodeSeekRefreshCurrent();
      const linuxDoCredentialCurrent = isLinuxDoRefreshCurrent();
      const yaohuoCredentialCurrent = isYaohuoRefreshCurrent();
      const yaohuoCookie = yaohuoCredentialCurrent && !yaohuoSuppressedAtStart && yaohuoCredential.status === 'fulfilled'
        ? yaohuoCredential.value
        : null;
      const nodeSeekCookie = nodeSeekCredentialCurrent && nodeSeekCredential.status === 'fulfilled'
        ? nodeSeekCredential.value
        : undefined;
      const nodeSeekSummary = nodeSeekCredentialCurrent && nodeSeekCredential.status === 'fulfilled'
        ? summarizeNodeSeekCookies(parseNodeSeekDocumentCookie(nodeSeekCookie || ''))
        : { count: 0, loggedIn: false, names: [] };
      let linuxDoAccess = linuxDoCredentialCurrent && linuxDoCredential.status === 'fulfilled'
        ? linuxDoCredential.value
        : null;
      let access = linuxDoAccessSummary(linuxDoAccess);
      markDiagnosticStage(trace, 'credential', {
        source: 'nodeseek',
        generation: nodeSeekGeneration ?? 0,
        ...(nodeSeekCredential.status === 'rejected'
          ? { state: 'error', reason: 'storage_error' }
          : { hasCredential: nodeSeekSummary.count > 0 })
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'linuxdo',
        generation: linuxDoGeneration,
        ...(linuxDoCredential.status === 'rejected'
          ? { state: 'error', reason: 'storage_error' }
          : { hasCredential: Boolean(linuxDoAccess?.cookieHeader) })
      });
      markDiagnosticStage(trace, 'credential', {
        source: 'yaohuo',
        generation: yaohuoGeneration,
        ...(yaohuoSuppressedAtStart
          ? { state: 'disabled' }
          : yaohuoCredential.status === 'rejected'
          ? { state: 'error', reason: 'storage_error' }
          : { hasCredential: Boolean(yaohuoCookie) })
      });
      const linuxDoLoginPromise = !linuxDoCredentialCurrent
        ? Promise.resolve(undefined)
        : linuxDoCredential.status === 'rejected'
        ? Promise.reject(linuxDoCredential.reason)
        : linuxDoAccess?.cookieHeader && access.loggedIn
        ? checkLinuxDoLoginAccess({
          cookieHeader: linuxDoAccess.cookieHeader,
          fetcher: diagnosticFetcher,
          userAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(undefined);
      const nodeSeekCurrentUserPromise = !nodeSeekCredentialCurrent
        ? Promise.resolve(null)
        : nodeSeekCredential.status === 'rejected'
        ? Promise.reject(nodeSeekCredential.reason)
        : nodeSeekSummary.loggedIn
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
      const yaohuoStatusPromise = !yaohuoCredentialCurrent
        ? Promise.resolve({ ok: false, loginRequired: true, message: '未登录' })
        : !yaohuoSuppressedAtStart && yaohuoCredential.status === 'rejected'
        ? Promise.reject(yaohuoCredential.reason)
        : !yaohuoSuppressedAtStart && yaohuoCookie
        ? checkYaohuoLogin({ yaohuoCookie, yaohuoFetcher: diagnosticFetcher, signal: controller.signal })
        : Promise.resolve({ ok: false, loginRequired: true, message: '未登录' });
      const yaohuoCurrentUserPromise = yaohuoCredentialCurrent
        && !yaohuoSuppressedAtStart
        && yaohuoCredential.status === 'fulfilled'
        && yaohuoCookie
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
      markDiagnosticStage(trace, 'transport', {
        source: 'all',
        channel: 'direct',
        state: 'start',
        count: 5
      });
      const [yaohuoCheck, linuxDoLoginCheck, nodeSeekCurrentUserCheck, linuxDoCurrentUserCheck, yaohuoCurrentUserCheck] = await Promise.allSettled([
        yaohuoStatusPromise,
        linuxDoLoginPromise,
        nodeSeekCurrentUserPromise,
        linuxDoCurrentUserPromise,
        yaohuoCurrentUserPromise
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
          yaohuoCurrentUserCheck
        ].filter((result) => result.status === 'rejected').length
      });
      const nodeSeekSuperseded = nodeSeekCurrentUserCheck.status === 'rejected'
        && isSupersededRequest(nodeSeekCurrentUserCheck.reason);
      const linuxDoLoginSuperseded = linuxDoLoginCheck.status === 'rejected'
        && isSupersededRequest(linuxDoLoginCheck.reason);
      const linuxDoCurrentUserSuperseded = linuxDoCurrentUserCheck.status === 'rejected'
        && isSupersededRequest(linuxDoCurrentUserCheck.reason);
      const yaohuoSuperseded = (yaohuoCheck.status === 'rejected' && isSupersededRequest(yaohuoCheck.reason))
        || (yaohuoCurrentUserCheck.status === 'rejected' && isSupersededRequest(yaohuoCurrentUserCheck.reason));
      const failedSites: string[] = [];
      let staleResultCount = 0;
      const nodeSeekExpired = nodeSeekSummary.loggedIn
        && nodeSeekCurrentUserCheck.status === 'rejected'
        && !nodeSeekSuperseded
        && sourceErrorFromUnknown('nodeseek', nodeSeekCurrentUserCheck.reason).kind === 'login-expired';
      const yaohuoOk = yaohuoCheck.status === 'fulfilled' && yaohuoCheck.value.ok && !yaohuoCheck.value.loginRequired;
      const linuxDoLogin = linuxDoLoginCheck.status === 'fulfilled' ? linuxDoLoginCheck.value : undefined;
      const linuxDoSuperseded = linuxDoLoginSuperseded
        || (!linuxDoLogin?.loginRequired && linuxDoCurrentUserSuperseded);
      let linuxDoCleanupApplied = false;
      let linuxDoCleanupGeneration: number | undefined;
      if (linuxDoLogin?.loginRequired && isLinuxDoRefreshCurrent()) {
        markDiagnosticStage(trace, 'credential', {
          source: 'linuxdo',
          generation: linuxDoGeneration,
          state: 'expired'
        });
        try {
          const cleanup = clearLinuxDoAccessForGeneration(linuxDoGeneration, linuxDoAccess?.cookieHeader);
          linuxDoCleanupGeneration = currentLinuxDoAccessGeneration();
          linuxDoAccess = await cleanup;
          linuxDoCleanupApplied = linuxDoCleanupGeneration === currentLinuxDoAccessGeneration();
        } catch (error) {
          const cleanupSuperseded = isSupersededRequest(error);
          markDiagnosticStage(trace, 'credential', cleanupSuperseded
            ? {
              source: 'linuxdo',
              generation: linuxDoGeneration,
              state: 'cleanup-skipped',
              reason: 'superseded'
            }
            : {
              source: 'linuxdo',
              generation: linuxDoGeneration,
              state: 'error',
              reason: 'storage_error'
            });
        }
        if (controller.signal.aborted) {
          finishTrace('canceled', { reason: 'canceled' });
          return;
        }
        access = linuxDoAccessSummary(linuxDoAccess);
        if (linuxDoCleanupApplied) {
          markDiagnosticStage(trace, 'apply', {
            source: 'linuxdo',
            generation: linuxDoCleanupGeneration ?? linuxDoGeneration,
            hasCredential: Boolean(linuxDoAccess?.cookieHeader),
            state: 'applied'
          });
        }
      }
      let nodeSeekCleanupApplied = false;
      let nodeSeekCleanupGeneration: number | undefined;
      let nodeSeekHasCredentialAfterCleanup = false;
      if (nodeSeekExpired && isNodeSeekRefreshCurrent()) {
        markDiagnosticStage(trace, 'credential', {
          source: 'nodeseek',
          generation: nodeSeekGeneration ?? 0,
          state: 'expired'
        });
        try {
          const cleanup = clearNodeSeekLoginCookiesOnly({ generation: nodeSeekGeneration });
          nodeSeekCleanupGeneration = currentNodeSeekCredentialGeneration();
          const result = await cleanup;
          nodeSeekCleanupApplied = result !== undefined
            && nodeSeekCleanupGeneration === currentNodeSeekCredentialGeneration();
          nodeSeekHasCredentialAfterCleanup = Boolean(result && 'hasCredential' in result && result.hasCredential);
          if (nodeSeekCleanupApplied) {
            markDiagnosticStage(trace, 'apply', {
              source: 'nodeseek',
              generation: nodeSeekCleanupGeneration,
              hasCredential: nodeSeekHasCredentialAfterCleanup,
              state: 'applied'
            });
          }
        } catch {
          markDiagnosticStage(trace, 'credential', {
            source: 'nodeseek',
            generation: nodeSeekGeneration ?? 0,
            state: 'error',
            reason: 'storage_error'
          });
        }
        if (controller.signal.aborted) {
          finishTrace('canceled', { reason: 'canceled' });
          return;
        }
      }
      const yaohuoExpired = !yaohuoSuppressedAtStart
        && yaohuoCheck.status === 'fulfilled'
        && 'reason' in yaohuoCheck.value
        && yaohuoCheck.value.reason === 'expired';
      const yaohuoVerificationRequired = !yaohuoSuppressedAtStart && (yaohuoCheck.status === 'fulfilled'
        ? 'reason' in yaohuoCheck.value && yaohuoCheck.value.reason === 'verification'
        : normalizeDiagnosticReason(yaohuoCheck.reason) === 'verification_required');
      let yaohuoCleanupApplied = false;
      let yaohuoCleanupFailed = false;
      let yaohuoCleanupGeneration: number | undefined;
      if (yaohuoExpired && isYaohuoRefreshCurrent()) {
        markDiagnosticStage(trace, 'credential', {
          source: 'yaohuo',
          generation: yaohuoGeneration,
          state: 'expired'
        });
        try {
          const cleanup = clearYaohuoLoginState({
            generation: yaohuoGeneration,
            isCurrent: isYaohuoRequestCurrent
          });
          yaohuoCleanupGeneration = currentYaohuoCredentialGeneration();
          const cleared = await cleanup;
          yaohuoCleanupApplied = cleared !== false
            && yaohuoCleanupGeneration === currentYaohuoCredentialGeneration()
            && isYaohuoRequestCurrent();
        } catch {
          yaohuoCleanupFailed = true;
          markDiagnosticStage(trace, 'credential', {
            source: 'yaohuo',
            generation: yaohuoGeneration,
            state: 'error',
            reason: 'storage_error'
          });
        }
        if (controller.signal.aborted) {
          finishTrace('canceled', { reason: 'canceled' });
          return;
        }
        if (yaohuoCleanupApplied) {
          markDiagnosticStage(trace, 'apply', {
            source: 'yaohuo',
            generation: yaohuoCleanupGeneration ?? yaohuoGeneration,
            hasCredential: false,
            state: 'applied'
          });
        }
      }
      const isLinuxDoResultCurrent = () => linuxDoCleanupGeneration === undefined
        ? isLinuxDoRefreshCurrent()
        : linuxDoCleanupGeneration === currentLinuxDoAccessGeneration();
      const isNodeSeekResultCurrent = () => nodeSeekCleanupGeneration === undefined
        ? isNodeSeekRefreshCurrent()
        : nodeSeekCleanupGeneration === currentNodeSeekCredentialGeneration();
      const isYaohuoResultCurrent = () => yaohuoCleanupGeneration === undefined
        ? isYaohuoRefreshCurrent()
        : (yaohuoCleanupApplied || yaohuoCleanupFailed)
          && yaohuoCleanupGeneration === currentYaohuoCredentialGeneration()
          && isYaohuoRequestCurrent();
      const checkedAt = new Date().toISOString();
      const nodeSeekCurrentUser = nodeSeekCurrentUserCheck.status === 'fulfilled' ? nodeSeekCurrentUserCheck.value : null;
      let nodeSeekPersistFailed = false;
      if (nodeSeekSuperseded) {
        staleResultCount += 1;
        markDiagnosticStage(trace, 'apply', {
          source: 'nodeseek',
          generation: nodeSeekGeneration ?? 0,
          state: 'refresh-stale'
        });
      } else if (nodeSeekExpired && isNodeSeekResultCurrent()) {
        markDiagnosticStage(trace, 'apply', {
          source: 'nodeseek',
          hasCredential: nodeSeekCleanupApplied ? nodeSeekHasCredentialAfterCleanup : nodeSeekSummary.count > 0,
          hasCurrentUser: false,
          isLoggedIn: false,
          state: 'expired'
        });
      } else if (!isNodeSeekResultCurrent()) {
        staleResultCount += 1;
        markDiagnosticStage(trace, 'apply', {
          source: 'nodeseek',
          generation: nodeSeekGeneration ?? 0,
          state: 'refresh-stale'
        });
      } else if (nodeSeekExpired) {
        markDiagnosticStage(trace, 'apply', {
          source: 'nodeseek',
          hasCredential: nodeSeekSummary.count > 0,
          hasCurrentUser: false,
          isLoggedIn: false,
          state: 'expired'
        });
      } else if (nodeSeekCredential.status === 'rejected') {
        failedSites.push('NodeSeek');
        markDiagnosticStage(trace, 'apply', {
          source: 'nodeseek',
          hasCredential: false,
          hasCurrentUser: false,
          isLoggedIn: false,
          state: 'failed'
        });
        dispatchSiteSessionEvent({
          site: 'nodeseek',
          type: 'check-failed',
          message: 'NodeSeek 登录状态读取失败',
          at: checkedAt
        });
      } else if (nodeSeekCurrentUserCheck.status === 'rejected') {
        failedSites.push('NodeSeek');
        markDiagnosticStage(trace, 'apply', {
          source: 'nodeseek',
          hasCredential: nodeSeekSummary.count > 0,
          hasCurrentUser: false,
          isLoggedIn: nodeSeekSummary.loggedIn,
          state: 'failed'
        });
        dispatchSiteSessionEvent({
          site: 'nodeseek',
          type: 'check-failed',
          message: errorMessage(nodeSeekCurrentUserCheck.reason),
          at: checkedAt
        });
      } else {
        const nodeSeekCurrentUserId = Number(nodeSeekCurrentUser?.id);
        if (nodeSeekCookie && Number.isInteger(nodeSeekCurrentUserId) && nodeSeekCurrentUserId > 0) {
          markDiagnosticStage(trace, 'persist', {
            source: 'nodeseek',
            generation: nodeSeekGeneration ?? 0,
            hasCurrentUser: true
          });
          try {
            await saveNodeSeekCookieHeader(parseNodeSeekDocumentCookie(nodeSeekCookie), {
              generation: nodeSeekGeneration,
              userId: nodeSeekCurrentUserId,
              diagnosticTrace: trace
            });
          } catch {
            nodeSeekPersistFailed = true;
            markDiagnosticStage(trace, 'persist', {
              source: 'nodeseek',
              generation: nodeSeekGeneration ?? 0,
              state: 'error',
              reason: 'storage_error'
            });
          }
          if (controller.signal.aborted) {
            finishTrace('canceled', { reason: 'canceled' });
            return;
          }
          if (!isNodeSeekResultCurrent()) {
            staleResultCount += 1;
            markDiagnosticStage(trace, 'apply', {
              source: 'nodeseek',
              generation: nodeSeekGeneration ?? 0,
              state: 'refresh-stale'
            });
          }
        }
        if (isNodeSeekResultCurrent()) {
          if (nodeSeekPersistFailed) {
            failedSites.push('NodeSeek');
          }
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
        }
      }
      if (yaohuoSuperseded) {
        staleResultCount += 1;
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          generation: yaohuoGeneration,
          state: 'refresh-stale'
        });
      } else if (yaohuoExpired && isYaohuoResultCurrent()) {
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          hasCredential: yaohuoCleanupApplied ? false : Boolean(yaohuoCookie),
          hasCurrentUser: false,
          isLoggedIn: false,
          state: 'expired'
        });
        dispatchSiteSessionEvent({ site: 'yaohuo', type: 'login-expired', message: '妖火登录已失效' });
      } else if (!isYaohuoResultCurrent()) {
        staleResultCount += 1;
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          generation: yaohuoGeneration,
          state: 'refresh-stale'
        });
      } else if (yaohuoSuppressedAtStart) {
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          hasCredential: false,
          hasCurrentUser: false,
          isLoggedIn: false,
          state: 'disabled'
        });
      } else if (yaohuoVerificationRequired) {
        const message = yaohuoCheck.status === 'rejected'
          ? errorMessage(yaohuoCheck.reason)
          : 'message' in yaohuoCheck.value
            ? String(yaohuoCheck.value.message || '妖火需要完成访问验证')
            : '妖火需要完成访问验证';
        markDiagnosticStage(trace, 'apply', {
          source: 'yaohuo',
          hasCredential: Boolean(yaohuoCookie),
          hasCurrentUser: false,
          isLoggedIn: false,
          state: 'blocked'
        });
        dispatchSiteSessionEvent({
          site: 'yaohuo',
          type: 'verification-required',
          message
        });
      } else if (yaohuoCheck.status === 'rejected') {
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
          message: yaohuoCredential.status === 'rejected'
            ? '妖火登录状态读取失败'
            : errorMessage(yaohuoCheck.reason),
          at: checkedAt
        });
      } else {
        const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(yaohuoCookie || ''));
        if (yaohuoOk && yaohuoCurrentUserCheck.status === 'rejected') {
          failedSites.push('妖火');
        }
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
      if (linuxDoSuperseded) {
        staleResultCount += 1;
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          generation: linuxDoGeneration,
          state: 'refresh-stale'
        });
      } else if (linuxDoLogin?.loginRequired && isLinuxDoResultCurrent()) {
        resetLinuxDoLevelState();
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          hasCredential: Boolean(linuxDoAccess?.cookieHeader),
          hasCurrentUser: false,
          isLoggedIn: false,
          state: 'blocked'
        });
        dispatchSiteSessionEvent({
          site: 'linuxdo',
          type: 'login-expired',
          message: linuxDoLogin.message || 'linux.do 登录已失效'
        });
      } else if (!isLinuxDoResultCurrent()) {
        staleResultCount += 1;
        markDiagnosticStage(trace, 'apply', {
          source: 'linuxdo',
          generation: linuxDoGeneration,
          state: 'refresh-stale'
        });
      } else if (linuxDoLoginCheck.status === 'rejected' || isLinuxDoLoginCheckUnknown(linuxDoLogin)) {
        failedSites.push('linux.do');
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
          message: linuxDoCredential.status === 'rejected'
            ? 'linux.do 登录状态读取失败'
            : linuxDoLoginCheck.status === 'rejected'
            ? errorMessage(linuxDoLoginCheck.reason)
            : linuxDoLogin?.message || 'linux.do 状态暂时无法确认',
          at: checkedAt
        });
      } else {
        if (access.loggedIn && !linuxDoLogin?.loginRequired && linuxDoCurrentUserCheck.status === 'rejected') {
          failedSites.push('linux.do');
        }
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
      const uniqueFailedSites = Array.from(new Set(failedSites));
      markDiagnosticStage(trace, 'apply', {
        source: 'all',
        state: 'status-updated',
        partialErrorCount: uniqueFailedSites.length,
        staleCount: staleResultCount
      });
      if (!options.silent) {
        notify(uniqueFailedSites.length
          ? `账号状态部分刷新失败：${uniqueFailedSites.join('、')}`
          : staleResultCount
            ? '账号状态部分刷新未完成，请稍后再试'
            : '账号状态已刷新');
      }
      finishTrace(uniqueFailedSites.length || staleResultCount ? 'partial' : 'success', {
        partialErrorCount: uniqueFailedSites.length,
        staleCount: staleResultCount,
        ...(staleResultCount ? { reason: 'superseded' } : {})
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
    clearNodeSeekLoginCookiesOnly,
    clearYaohuoLoginState,
    currentNodeSeekCredentialGeneration,
    currentYaohuoCredentialGeneration,
    dispatchSiteSessionEvent,
    fetcher,
    linuxDoUserAgentRef,
    loadNodeSeekCookieForSource,
    loadYaohuoCookieForSource,
    nodeSeekUserAgentRef,
    notify,
    resetLinuxDoLevelState,
    saveNodeSeekCookieHeader,
    yaohuoCredentialSuppressedRef
  ]);

  useEffect(() => {
    if (previousYaohuoCredentialSuppressedRef.current === yaohuoCredentialSuppressed) {
      return;
    }
    previousYaohuoCredentialSuppressedRef.current = yaohuoCredentialSuppressed;
    statusAbortRef.current?.abort();
  }, [yaohuoCredentialSuppressed]);

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
