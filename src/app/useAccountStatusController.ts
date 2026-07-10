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
  resetLinuxDoLevelState: () => void;
  saveNodeSeekCookieHeader: (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    options?: { generation?: number; userId?: number | null }
  ) => Promise<string>;
}) {
  const statusAbortRef = useRef<AbortController | null>(null);
  const statusBusyRef = useRef(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const refreshAccountStatus = useCallback(async (options: RefreshAccountStatusOptions = {}) => {
    if (statusBusyRef.current) {
      return;
    }
    statusBusyRef.current = true;
    const controller = startAbortableRequest(statusAbortRef);
    setStatusBusy(true);
    try {
      const yaohuoGeneration = currentYaohuoCredentialGeneration();
      const linuxDoGeneration = currentLinuxDoAccessGeneration();
      const yaohuoCookie = await SecureStore.getItemAsync(YAOHUO_COOKIE_STORAGE_KEY);
      let nodeSeekGeneration: number | undefined;
      let nodeSeekCredentialUserId: number | null = null;
      const nodeSeekCookie = await loadNodeSeekCookieForSource('nodeseek', {
        captureGeneration: (generation) => { nodeSeekGeneration = generation; },
        captureNodeSeekUserId: (userId) => { nodeSeekCredentialUserId = userId; }
      });
      const nodeSeekSummary = summarizeNodeSeekCookies(parseNodeSeekDocumentCookie(nodeSeekCookie || ''));
      let linuxDoAccess = await loadLinuxDoAccess();
      let access = linuxDoAccessSummary(linuxDoAccess);
      const linuxDoLoginPromise = linuxDoAccess?.cookieHeader && access.loggedIn
        ? checkLinuxDoLoginAccess({
          cookieHeader: linuxDoAccess.cookieHeader,
          fetcher,
          userAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(undefined);
      const nodeSeekCurrentUserPromise = nodeSeekSummary.loggedIn
        ? getCurrentUserProfile({
          source: 'nodeseek',
          fetcher,
          nodeSeekCookie,
          nodeSeekUserId: nodeSeekCredentialUserId,
          nodeSeekUserAgent: nodeSeekUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(null);
      const linuxDoCurrentUserPromise = linuxDoAccess?.cookieHeader && access.loggedIn
        ? getCurrentUserProfile({
          source: 'linuxdo',
          fetcher,
          linuxDoCookie: linuxDoAccess.cookieHeader,
          linuxDoUserAgent: linuxDoAccess.userAgent || linuxDoUserAgentRef.current,
          signal: controller.signal
        })
        : Promise.resolve(null);
      const yaohuoStatusPromise = yaohuoCookie
        ? checkYaohuoLogin({ yaohuoCookie, yaohuoFetcher: fetcher, signal: controller.signal })
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
            fetcher,
            yaohuoCookie,
            signal: controller.signal
          });
        })
        : Promise.resolve(null);
      const [yaohuoCheck, linuxDoLoginCheck, nodeSeekCurrentUserCheck, linuxDoCurrentUserCheck, yaohuoCurrentUserCheck] = await Promise.allSettled([
        yaohuoStatusPromise,
        linuxDoLoginPromise,
        nodeSeekCurrentUserPromise,
        linuxDoCurrentUserPromise,
        yaohuoCurrentUserPromise
      ] as const);
      if (controller.signal.aborted) {
        return;
      }
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
        linuxDoAccess = await clearLinuxDoAccessForGeneration(linuxDoGeneration, linuxDoAccess?.cookieHeader);
        if (controller.signal.aborted) {
          return;
        }
        access = linuxDoAccessSummary(linuxDoAccess);
        resetLinuxDoLevelState();
      }
      const yaohuoExpired = yaohuoCheck.status === 'fulfilled' && 'reason' in yaohuoCheck.value && yaohuoCheck.value.reason === 'expired';
      if (yaohuoExpired) {
        await clearYaohuoLoginState({ generation: yaohuoGeneration });
        if (controller.signal.aborted) {
          return;
        }
      }
      const checkedAt = new Date().toISOString();
      const nodeSeekCurrentUser = nodeSeekCurrentUserCheck.status === 'fulfilled' ? nodeSeekCurrentUserCheck.value : null;
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
        await saveNodeSeekCookieHeader(parseNodeSeekDocumentCookie(nodeSeekCookie), {
          generation: nodeSeekGeneration,
          userId: nodeSeekCurrentUserId
        });
      }
      if (yaohuoCheck.status === 'rejected') {
        failedSites.push('妖火');
        dispatchSiteSessionEvent({
          site: 'yaohuo',
          type: 'check-failed',
          message: errorMessage(yaohuoCheck.reason),
          at: checkedAt
        });
      } else {
        const yaohuoSummary = summarizeYaohuoCookies(yaohuoCookieMapFromHeader(yaohuoCookie || ''));
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
      if (!options.silent) {
        notify(uniqueFailedSites.length ? `账号状态部分刷新失败：${uniqueFailedSites.join('、')}` : '账号状态已刷新');
      }
    } catch (error) {
      if (!options.silent && !controller.signal.aborted && !isCanceledRequest(error)) {
        notify(errorMessage(error));
      }
    } finally {
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
