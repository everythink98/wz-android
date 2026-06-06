import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import CookieManager from '@react-native-cookies/cookies';
import * as SecureStore from 'expo-secure-store';
import { type WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  mergeNodeSeekCookies,
  parseNodeSeekDocumentCookie,
  sanitizeNodeSeekUserAgent,
  summarizeNodeSeekCookies
} from '../nodeseekCookies';
import { readNodeSeekCookiesFromWebView } from '../nodeseekCookieBridge';
import {
  buildYaohuoCookieHeader,
  canStoreYaohuoCookieHeader,
  mergeYaohuoCookies,
  summarizeYaohuoCookies,
  type YaohuoNativeCookie
} from '../yaohuoCookies';
import {
  clearLinuxDoAccess,
  linuxDoAccessSummary,
  loadLinuxDoAccess,
  parseLinuxDoDocumentCookie,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import { YAOHUO_URL } from '../appUrls';
import {
  errorMessage,
  isLinuxDoCloudflareError,
  isYaohuoLoginExpiredError,
  isYaohuoLoginRequiredError
} from '../appUtils';
import { checkYaohuoLoginDirect } from '../yaohuoApi';
import { getLinuxDoLevelProfile, type LinuxDoLevelProfile } from '../linuxdoLevel';
import type { Fetcher } from '../request';
import type { SiteSessionEvent } from '../siteSessionState';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from '../loginWebViewScripts';

const YAOHUO_COOKIE_URLS = [YAOHUO_URL, 'https://www.yaohuo.me', 'http://yaohuo.me', 'http://www.yaohuo.me'];
const YAOHUO_COOKIE_STORAGE_KEY = 'yaohuo-cookie-header';

type Ref<T> = MutableRefObject<T>;

export function useAccountController({
  checkingRequestIdRef,
  clearNodeSeekLoginState,
  clearYaohuoLoginState,
  forumFetchWithWebViewFallback,
  linuxDoLevelRequestIdRef,
  linuxDoWebViewUserAgentRef,
  nodeSeekLoginPanelRequestRef,
  nodeSeekWebViewCookieHeaderRef,
  nodeSeekWebViewUserAgentRef,
  notify,
  resetLinuxDoLevelState,
  resetLinuxDoWebView,
  saveNodeSeekCookieHeader,
  setChecking,
  setLinuxDoLevelBusy,
  setLinuxDoLevelError,
  setLinuxDoLevelProfile,
  setNodeSeekWebViewUserAgent,
  setWebLoginUserId,
  showLinuxDoPanelRef,
  showLinuxDoVerification,
  showLoginPanelRef,
  updateLinuxDoSession,
  updateNodeSeekSession,
  updateYaohuoSession,
  webLoginDetectedRef,
  webViewRef,
  yaohuoWebViewRef
}: {
  checkingRequestIdRef: Ref<number>;
  clearNodeSeekLoginState: () => Promise<void>;
  clearYaohuoLoginState: () => Promise<void>;
  forumFetchWithWebViewFallback: Fetcher;
  linuxDoLevelRequestIdRef: Ref<number>;
  linuxDoWebViewUserAgentRef: Ref<string>;
  nodeSeekLoginPanelRequestRef: Ref<number>;
  nodeSeekWebViewCookieHeaderRef: Ref<string>;
  nodeSeekWebViewUserAgentRef: Ref<string>;
  notify: (message: string) => void;
  resetLinuxDoLevelState: () => void;
  resetLinuxDoWebView: () => void;
  saveNodeSeekCookieHeader: (
    cookies: Record<string, { name?: string; value?: string; domain?: string }>,
    options?: { verifiedByPage?: boolean; isCurrent?: () => boolean }
  ) => Promise<string>;
  setChecking: Dispatch<SetStateAction<boolean>>;
  setLinuxDoLevelBusy: Dispatch<SetStateAction<boolean>>;
  setLinuxDoLevelError: Dispatch<SetStateAction<string>>;
  setLinuxDoLevelProfile: Dispatch<SetStateAction<LinuxDoLevelProfile | null>>;
  setNodeSeekWebViewUserAgent: Dispatch<SetStateAction<string>>;
  setWebLoginUserId: Dispatch<SetStateAction<number | null>>;
  showLinuxDoPanelRef: Ref<boolean>;
  showLinuxDoVerification: (message?: string) => void;
  showLoginPanelRef: Ref<boolean>;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
  updateNodeSeekSession: (event: SiteSessionEvent) => void;
  updateYaohuoSession: (event: SiteSessionEvent) => void;
  webLoginDetectedRef: Ref<boolean>;
  webViewRef: Ref<WebView | null>;
  yaohuoWebViewRef: Ref<WebView | null>;
}) {
  const handleLoginMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        loggedIn?: boolean;
        userId?: number | null;
        userAgent?: string;
        cookie?: string;
      };
      if (data.type === 'nodeseek-login' && typeof data.userAgent === 'string') {
        const userAgent = sanitizeNodeSeekUserAgent(data.userAgent);
        if (userAgent) {
          nodeSeekWebViewUserAgentRef.current = userAgent;
          setNodeSeekWebViewUserAgent(userAgent);
        }
      }
      if (data.type === 'nodeseek-login' && typeof data.cookie === 'string') {
        nodeSeekWebViewCookieHeaderRef.current = data.cookie;
      }
      if (data.type === 'nodeseek-login' && data.loggedIn && Number.isInteger(data.userId)) {
        webLoginDetectedRef.current = true;
        setWebLoginUserId(data.userId || null);
      } else if (data.type === 'nodeseek-login' && data.loggedIn === false) {
        webLoginDetectedRef.current = false;
        updateNodeSeekSession({ type: 'login-expired', message: 'NodeSeek 登录已失效' });
        setWebLoginUserId(null);
      }
    } catch {
      // Ignore unrelated messages from the page.
    }
  }, [
    nodeSeekWebViewCookieHeaderRef,
    nodeSeekWebViewUserAgentRef,
    setNodeSeekWebViewUserAgent,
    setWebLoginUserId,
    updateNodeSeekSession,
    webLoginDetectedRef
  ]);

  const probeLoginPage = useCallback(async () => {
    webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }, [webViewRef]);

  const readCurrentNodeSeekCookies = useCallback(async () => {
    await probeLoginPage();
    await CookieManager.flush();
    const nativeCookies = await readNodeSeekCookiesFromWebView();
    const nodeSeekDocumentCookieHeader = nodeSeekWebViewCookieHeaderRef.current;
    return mergeNodeSeekCookies(nativeCookies, parseNodeSeekDocumentCookie(nodeSeekDocumentCookieHeader));
  }, [nodeSeekWebViewCookieHeaderRef, probeLoginPage]);

  const rememberCurrentNodeSeekCookies = useCallback(async ({ silent = false, isCurrent = () => true }: { silent?: boolean; isCurrent?: () => boolean } = {}) => {
    const cookies = await readCurrentNodeSeekCookies();
    if (!isCurrent()) {
      return false;
    }
    const summary = summarizeNodeSeekCookies(cookies);
    const cookieHeader = await saveNodeSeekCookieHeader(cookies, { verifiedByPage: webLoginDetectedRef.current, isCurrent });
    if (cookieHeader) {
      if (!isCurrent()) {
        return false;
      }
      if (!silent) {
        notify(summary.loggedIn ? '已检测到 NodeSeek 登录 Cookie，已保存在本机。' : '已检测到 NodeSeek 验证信息，已保存在本机。');
      }
      return true;
    }
    if (!isCurrent()) {
      return false;
    }
    if (!silent) {
      notify('没有检测到明确的 NodeSeek Cookie。请完成验证或登录后再试。');
    }
    return false;
  }, [notify, readCurrentNodeSeekCookies, saveNodeSeekCookieHeader, webLoginDetectedRef]);

  const checkLogin = useCallback(async () => {
    const requestId = ++checkingRequestIdRef.current;
    setChecking(true);
    try {
      await rememberCurrentNodeSeekCookies({ isCurrent: () => requestId === checkingRequestIdRef.current && showLoginPanelRef.current });
    } catch (error) {
      if (requestId === checkingRequestIdRef.current) {
        notify(errorMessage(error));
      }
    } finally {
      if (requestId === checkingRequestIdRef.current) {
        setChecking(false);
      }
    }
  }, [checkingRequestIdRef, notify, rememberCurrentNodeSeekCookies, setChecking, showLoginPanelRef]);

  const rememberVisibleNodeSeekCookies = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const requestId = nodeSeekLoginPanelRequestRef.current;
    return rememberCurrentNodeSeekCookies({
      silent,
      isCurrent: () => showLoginPanelRef.current && nodeSeekLoginPanelRequestRef.current === requestId
    });
  }, [nodeSeekLoginPanelRequestRef, rememberCurrentNodeSeekCookies, showLoginPanelRef]);

  const checkYaohuoCookie = useCallback(async () => {
    const requestId = ++checkingRequestIdRef.current;
    setChecking(true);
    try {
      await CookieManager.flush();
      const cookieMaps = await Promise.all(YAOHUO_COOKIE_URLS.map(async (url) => CookieManager.get(url)));
      if (requestId !== checkingRequestIdRef.current) {
        return;
      }
      const typedCookies = mergeYaohuoCookies(...cookieMaps as Array<Record<string, YaohuoNativeCookie>>);
      const summary = summarizeYaohuoCookies(typedCookies);
      const cookieHeader = buildYaohuoCookieHeader(typedCookies);
      if (!summary.loggedIn || !canStoreYaohuoCookieHeader(typedCookies) || !cookieHeader) {
        updateYaohuoSession({
          type: summary.names.length ? 'verification-required' : 'cleared',
          ...(summary.names.length ? { message: '没有检测到明确的妖火登录 Cookie。' } : {})
        });
        notify('没有检测到明确的妖火登录 Cookie。请确认已经登录后再试。');
        return;
      }
      const yaohuoLoginCheck = await checkYaohuoLoginDirect({ yaohuoCookie: cookieHeader });
      if (requestId !== checkingRequestIdRef.current) {
        return;
      }
      if (yaohuoLoginCheck.loginRequired || !yaohuoLoginCheck.ok) {
        if (yaohuoLoginCheck.reason === 'expired') {
          updateYaohuoSession({ type: 'login-expired', message: yaohuoLoginCheck.message || '妖火登录已失效，请重新登录。' });
          await clearYaohuoLoginState();
          if (requestId !== checkingRequestIdRef.current) {
            return;
          }
        } else {
          updateYaohuoSession({ type: 'verification-required', message: yaohuoLoginCheck.message || '妖火需要完成访问验证' });
        }
        notify(yaohuoLoginCheck.message || '妖火登录已失效，请重新登录。');
        return;
      }
      await SecureStore.setItemAsync(YAOHUO_COOKIE_STORAGE_KEY, cookieHeader);
      if (requestId !== checkingRequestIdRef.current) {
        return;
      }
      updateYaohuoSession({
        type: 'login-detected',
        cookieSummary: summary.names,
        at: new Date().toISOString()
      });
      notify('已检测到妖火登录 Cookie，已保存在本机。');
    } catch (error) {
      if (requestId !== checkingRequestIdRef.current) {
        return;
      }
      if (isYaohuoLoginRequiredError(error)) {
        if (isYaohuoLoginExpiredError(error)) {
          await clearYaohuoLoginState();
          if (requestId !== checkingRequestIdRef.current) {
            return;
          }
          notify('妖火登录已失效，请重新登录。');
        } else {
          notify(errorMessage(error));
        }
        return;
      }
      notify(errorMessage(error));
    } finally {
      if (requestId === checkingRequestIdRef.current) {
        setChecking(false);
      }
    }
  }, [checkingRequestIdRef, clearYaohuoLoginState, notify, setChecking, updateYaohuoSession]);

  const clearLogin = useCallback(async () => {
    await clearNodeSeekLoginState();
    notify('已清除本机保存的 NodeSeek Cookie。');
  }, [clearNodeSeekLoginState, notify]);

  const clearYaohuoLogin = useCallback(async () => {
    await clearYaohuoLoginState();
    yaohuoWebViewRef.current?.reload();
    notify('已清除本机保存的妖火 Cookie。');
  }, [clearYaohuoLoginState, notify, yaohuoWebViewRef]);

  const clearLinuxDoCookie = useCallback(async () => {
    const access = await clearLinuxDoAccess();
    const summary = linuxDoAccessSummary(access);
    const cookieSummary = summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(access?.cookieHeader || '')).names;
    updateLinuxDoSession(summary.hasClearance
      ? { type: 'verification-succeeded', cookieSummary, loggedIn: false, at: new Date().toISOString() }
      : { type: 'cleared' });
    resetLinuxDoLevelState();
    resetLinuxDoWebView();
    notify(summary.hasClearance ? '已清除 linux.do 登录信息，保留访问验证。' : '已清除本机保存的 linux.do 登录信息。');
  }, [notify, resetLinuxDoLevelState, resetLinuxDoWebView, updateLinuxDoSession]);

  const refreshLinuxDoLevel = useCallback(async () => {
    const requestId = ++linuxDoLevelRequestIdRef.current;
    setLinuxDoLevelBusy(true);
    setLinuxDoLevelError('');
    try {
      const access = await loadLinuxDoAccess();
      if (!access?.cookieHeader || !linuxDoAccessSummary(access).loggedIn) {
        setLinuxDoLevelProfile(null);
        setLinuxDoLevelError('请先完成 linux.do 登录 / 验证。');
        return;
      }
      const profile = await getLinuxDoLevelProfile({
        cookieHeader: access.cookieHeader,
        userAgent: access.userAgent || linuxDoWebViewUserAgentRef.current,
        fetcher: forumFetchWithWebViewFallback
      });
      if (requestId !== linuxDoLevelRequestIdRef.current) {
        return;
      }
      setLinuxDoLevelProfile(profile);
      notify('linux.do 等级已更新。');
    } catch (error) {
      if (requestId !== linuxDoLevelRequestIdRef.current) {
        return;
      }
      if (isLinuxDoCloudflareError(error)) {
        setLinuxDoLevelProfile(null);
        setLinuxDoLevelError('linux.do 等级读取需要完成 Cloudflare 验证');
        if (showLinuxDoPanelRef.current) {
          showLinuxDoVerification('linux.do 等级读取需要完成 Cloudflare 验证');
        } else {
          showLinuxDoVerification('linux.do 等级读取需要完成 Cloudflare 验证');
        }
        return;
      }
      setLinuxDoLevelError(errorMessage(error));
    } finally {
      if (requestId === linuxDoLevelRequestIdRef.current) {
        setLinuxDoLevelBusy(false);
      }
    }
  }, [
    forumFetchWithWebViewFallback,
    linuxDoLevelRequestIdRef,
    linuxDoWebViewUserAgentRef,
    notify,
    setLinuxDoLevelBusy,
    setLinuxDoLevelError,
    setLinuxDoLevelProfile,
    showLinuxDoPanelRef,
    showLinuxDoVerification
  ]);

  return {
    checkLogin,
    checkYaohuoCookie,
    clearLinuxDoCookie,
    clearLogin,
    clearYaohuoLogin,
    handleLoginMessage,
    rememberVisibleNodeSeekCookies,
    refreshLinuxDoLevel
  };
}
