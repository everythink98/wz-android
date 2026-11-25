import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react-native';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { linuxDoCreditAuthScript } from '@/platform/network/linuxDoCreditAuthScript';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import type { AccountHostStyles } from '../accountHostStyles';
import type { useLinuxDoCreditAuthController } from '../useLinuxDoCreditAuthController';
import { useWebViewLoadDeadline } from './useWebViewLoadDeadline';

const CREDIT_HOME_URL = 'https://credit.linux.do/home';
const CREDIT_NAVIGATION_ORIGINS = [
  'https://credit.linux.do',
  'https://connect.linux.do',
  'https://linux.do',
  'https://challenges.cloudflare.com'
];

function creditDocumentUrl(rawUrl?: string) {
  if (!rawUrl) return '';
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return rawUrl.split('#', 1)[0];
  }
}

function creditNavigationAllowed({ url: value }: LoginNavigationRequest) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && !url.username && !url.password && CREDIT_NAVIGATION_ORIGINS.includes(url.origin)
    );
  } catch {
    return false;
  }
}

type CreditDocumentRecord = {
  url: string;
  phase: 'loading' | 'settled' | 'failed';
  progress: 'awaiting-start' | 'started' | 'finished-before-start' | 'finished';
  error?: string;
};

type DeferredHttpError = {
  url: string;
  statusCode: number;
};

type CreditWebViewDocumentState = {
  kind: 'document';
  key: number;
  sourceUri: string;
  current: CreditDocumentRecord | null;
  pending: string | null;
  retiredUnsettledUrls: Set<string>;
  rejectedNavigationUrls: Set<string>;
  deferredHttpError: DeferredHttpError | null;
};

type CreditWebViewPage = CreditWebViewDocumentState | { kind: 'reopen'; key: number; error: string };

function createCreditWebViewDocumentState(key: number, sourceUri = CREDIT_HOME_URL): CreditWebViewDocumentState {
  return {
    kind: 'document',
    key,
    sourceUri,
    current: null,
    pending: creditDocumentUrl(sourceUri),
    retiredUnsettledUrls: new Set(),
    rejectedNavigationUrls: new Set(),
    deferredHttpError: null
  };
}

function hasMainFrameStarted(document: CreditDocumentRecord) {
  return document.progress === 'started' || document.progress === 'finished';
}

function hasLoadEnded(document: CreditDocumentRecord) {
  return document.progress === 'finished-before-start' || document.progress === 'finished';
}

function retireDocument(doc: CreditWebViewDocumentState) {
  if (doc.current && !hasLoadEnded(doc.current)) doc.retiredUnsettledUrls.add(doc.current.url);
}

function retirePending(doc: CreditWebViewDocumentState) {
  if (doc.pending) doc.retiredUnsettledUrls.add(doc.pending);
}

function projectCreditPage(page: CreditWebViewPage) {
  const { kind, key } = page;
  if (kind === 'reopen') return { kind, key, loading: false, error: page.error };
  return {
    kind,
    key,
    sourceUri: page.sourceUri,
    loading: !page.current || page.current.phase === 'loading',
    error: page.current?.error ?? ''
  };
}

function failDocument(document: CreditDocumentRecord, description: string) {
  document.phase = 'failed';
  document.error = `LDC 页面加载失败：${description || '请检查网络后重试。'}`;
}

type CreditAuthModalProps = {
  panel: ReturnType<typeof useLinuxDoCreditAuthController>['panel'];
  styles: AccountHostStyles;
  webViewBlockMessage: string;
};

export function LinuxDoCreditAuthModal({ panel, styles, webViewBlockMessage }: CreditAuthModalProps) {
  const { document, failSilent } = panel;
  useEffect(() => {
    if (document?.mode === 'silent' && webViewBlockMessage) failSilent(document.generation);
  }, [document, failSilent, webViewBlockMessage]);
  if (document?.mode === 'silent') {
    return webViewBlockMessage ? null : (
      <View
        pointerEvents="none"
        style={styles.hiddenBrowserWebViewHost}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <WebView
          testID="linuxdo-credit-silent-webview"
          style={styles.hiddenBrowserWebView}
          containerStyle={styles.hiddenBrowserWebView}
          ref={panel.webViewRef}
          source={{ uri: CREDIT_HOME_URL }}
          userAgent={document.userAgent}
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          androidNavigationAllowedOrigins={CREDIT_NAVIGATION_ORIGINS}
          injectedJavaScript={linuxDoCreditAuthScript(document.nonce)}
          onShouldStartLoadWithRequest={creditNavigationAllowed}
          onMainFrameLoadStart={({ nativeEvent }) => {
            if (creditNavigationAllowed(nativeEvent)) return;
            panel.webViewRef.current?.stopLoading();
            failSilent(document.generation);
          }}
          onMessage={panel.handleMessage}
          onError={() => failSilent(document.generation)}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 400 && event.nativeEvent.statusCode !== 403)
              failSilent(document.generation);
          }}
          onRenderProcessGone={() => failSilent(document.generation)}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
        />
      </View>
    );
  }
  return (
    <ManualCreditAuthModal
      key={`${panel.generation}:${Boolean(webViewBlockMessage)}`}
      panel={panel}
      styles={styles}
      webViewBlockMessage={webViewBlockMessage}
    />
  );
}

function ManualCreditAuthModal({ panel, styles, webViewBlockMessage }: CreditAuthModalProps) {
  const [snapshot, setSnapshot] = useState(() => projectCreditPage(createCreditWebViewDocumentState(0)));
  const activePage = useRef<CreditWebViewPage>(null);
  if (!activePage.current) activePage.current = createCreditWebViewDocumentState(0);
  const mounted = panel.visible && Boolean(panel.document) && !webViewBlockMessage;
  const active = useCommittedRef(mounted);
  useLayoutEffect(
    () => () => {
      active.current = false;
    },
    [active]
  );
  const currentPage = () => {
    const page = activePage.current;
    return active.current && page?.key === snapshot.key ? page : null;
  };
  const currentDocument = () => {
    const page = currentPage();
    return page?.kind === 'document' ? page : null;
  };
  const updateDeadline = useWebViewLoadDeadline({
    enabled: mounted && snapshot.kind === 'document',
    loading: snapshot.loading,
    webViewKey: snapshot.key,
    onTimeout: (key) => {
      if (activePage.current?.key !== key) return;
      const next = {
        kind: 'reopen' as const,
        key: key + 1,
        error: 'LDC 页面打开超时：请检查网络后重新打开。'
      };
      activePage.current = next;
      setSnapshot(projectCreditPage(next));
    }
  });
  const publishPage = (page: CreditWebViewPage) => {
    const next = projectCreditPage(page);
    updateDeadline(next.key, next.loading);
    setSnapshot(next);
  };
  const refresh = () => {
    const page = currentPage();
    if (!page) return;
    const candidate = page.kind === 'document' ? page.current?.url || page.pending || page.sourceUri : CREDIT_HOME_URL;
    const reloadUrl = creditNavigationAllowed({ url: candidate }) ? candidate : CREDIT_HOME_URL;
    if (page.kind === 'reopen' || !page.current || !hasLoadEnded(page.current)) {
      // Android gives us the URL on finish, so an in-flight reload needs a new WebView owner.
      updateDeadline(page.key, false);
      const next = createCreditWebViewDocumentState(page.key + 1, reloadUrl);
      activePage.current = next;
      publishPage(next);
      return;
    }
    retireDocument(page);
    retirePending(page);
    page.current = null;
    page.pending = reloadUrl;
    page.deferredHttpError = null;
    publishPage(page);
    panel.webViewRef.current?.reload();
  };

  return (
    <LoginWebViewModal
      visible={panel.visible}
      title="连接 LDC"
      subtitle="请在官网完成登录或授权，完成后返回刷新"
      loading={mounted ? snapshot.loading : !webViewBlockMessage && panel.preparing}
      loadingText="正在打开 LDC…"
      error={webViewBlockMessage || panel.error || snapshot.error}
      onClose={() => panel.close()}
      primaryAction={
        <LoginWebViewAction icon={Check} primary label="完成并刷新" onPress={() => panel.close('success')} />
      }
      refreshAction={
        <LoginWebViewAction
          icon={RefreshCw}
          label="刷新页面"
          displayLabel=""
          disabled={Boolean(webViewBlockMessage) || panel.preparing}
          onPress={panel.document ? refresh : panel.retry}
        />
      }
    >
      {mounted && panel.document && snapshot.kind === 'document' ? (
        <WebView
          key={snapshot.key}
          testID="linuxdo-credit-webview"
          style={styles.webView}
          ref={panel.webViewRef}
          source={{ uri: snapshot.sourceUri }}
          userAgent={panel.document.userAgent}
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          androidNavigationAllowedOrigins={CREDIT_NAVIGATION_ORIGINS}
          onShouldStartLoadWithRequest={(request) => {
            const doc = currentDocument();
            if (!doc) return false;
            if (!creditNavigationAllowed(request)) {
              doc.rejectedNavigationUrls.add(request.url);
              return false;
            }
            if (request.isTopFrame === true) {
              const nextUrl = creditDocumentUrl(request.url);
              if (doc.pending !== nextUrl) retirePending(doc);
              doc.pending = nextUrl;
              doc.deferredHttpError = null;
            }
            return true;
          }}
          onMainFrameLoadStart={(event) => {
            const doc = currentDocument();
            if (!doc) return;
            if (!creditNavigationAllowed(event.nativeEvent)) {
              panel.webViewRef.current?.stopLoading();
              retireDocument(doc);
              retirePending(doc);
              const current: CreditDocumentRecord = {
                url: doc.current?.url || doc.sourceUri,
                phase: 'failed',
                progress: 'started'
              };
              failDocument(current, '无法在应用内确认此验证页面，请重试或打开官网。');
              doc.current = current;
              doc.pending = null;
              publishPage(doc);
              return;
            }
            const nextUrl = creditDocumentUrl(event.nativeEvent.url);
            // Real Android Chromium fires onReceivedHttpError (and error-page onReceivedError) before commit-time onPageStarted.
            // Consume that late commit-time start for the same pre-start failed document without clearing its error banner.
            if (
              doc.current &&
              doc.current.phase === 'failed' &&
              !hasMainFrameStarted(doc.current) &&
              !doc.pending &&
              (!nextUrl || doc.current.url === nextUrl)
            ) {
              doc.current.progress = hasLoadEnded(doc.current) ? 'finished' : 'started';
              doc.deferredHttpError = null;
              return;
            }
            const matchedDeferredHttpError =
              nextUrl && doc.deferredHttpError && doc.deferredHttpError.url === nextUrl ? doc.deferredHttpError : null;
            doc.deferredHttpError = null;
            retireDocument(doc);
            if (doc.pending !== nextUrl) retirePending(doc);
            const url = nextUrl || doc.pending || doc.current?.url || doc.sourceUri;
            doc.current = { url, phase: 'loading', progress: 'started' };
            doc.pending = null;
            if (matchedDeferredHttpError) {
              failDocument(doc.current, `HTTP ${matchedDeferredHttpError.statusCode}`);
            }
            publishPage(doc);
          }}
          // Android onLoadStart is backed by doUpdateVisitedHistory and must not advance main-frame state or clear errors.
          onLoadStart={() => undefined}
          onLoadEnd={(event) => {
            const doc = currentDocument();
            if (!doc) return;
            const eventUrl = creditDocumentUrl(event.nativeEvent.url);
            const failed = 'code' in event.nativeEvent;
            const matchesCurrent = Boolean(doc.current && (!eventUrl || eventUrl === doc.current.url));
            const matchesPending = Boolean(doc.pending && (!eventUrl || eventUrl === doc.pending));
            const deferred = doc.deferredHttpError;
            if (!failed && deferred && eventUrl === deferred.url && (!doc.pending || matchesPending)) {
              if (!matchesCurrent) retireDocument(doc);
              doc.current = {
                url: eventUrl,
                phase: 'failed',
                progress:
                  matchesCurrent && doc.current && hasMainFrameStarted(doc.current)
                    ? 'finished'
                    : 'finished-before-start'
              };
              doc.pending = null;
              doc.deferredHttpError = null;
              failDocument(doc.current, `HTTP ${deferred.statusCode}`);
              publishPage(doc);
              return;
            }
            if (matchesCurrent && doc.current) {
              doc.current.progress = hasMainFrameStarted(doc.current) ? 'finished' : 'finished-before-start';
              if (failed) doc.current.phase = 'failed';
              else if (doc.current.phase !== 'failed') doc.current.phase = 'settled';
              publishPage(doc);
              return;
            }
            if (matchesPending && doc.pending) {
              if (failed || !doc.current) {
                retireDocument(doc);
                doc.current = {
                  url: eventUrl || doc.pending,
                  phase: failed ? 'failed' : 'settled',
                  progress: 'finished-before-start'
                };
                doc.pending = null;
                doc.deferredHttpError = null;
                publishPage(doc);
              }
              return;
            }
            if (
              !failed &&
              !doc.pending &&
              doc.current?.phase === 'loading' &&
              !doc.retiredUnsettledUrls.has(eventUrl) &&
              creditNavigationAllowed(event.nativeEvent)
            ) {
              retireDocument(doc);
              doc.current = {
                url: eventUrl,
                phase: 'settled',
                progress: 'finished-before-start'
              };
              publishPage(doc);
            }
          }}
          onError={(event) => {
            const doc = currentDocument();
            if (!doc) {
              event.preventDefault?.();
              return;
            }
            const eventUrl = creditDocumentUrl(event.nativeEvent.url);
            const matchesPending = Boolean(doc.pending && eventUrl === doc.pending);
            const matchesCurrent = Boolean(doc.current && (!eventUrl || eventUrl === doc.current.url));
            // A main-frame POST may reuse a historical URL without a shouldStart callback.
            const retiredCancellation =
              doc.retiredUnsettledUrls.has(eventUrl) && event.nativeEvent.description === 'net::ERR_ABORTED';
            if (
              eventUrl &&
              !matchesPending &&
              !matchesCurrent &&
              (retiredCancellation || doc.rejectedNavigationUrls.has(event.nativeEvent.url))
            ) {
              event.preventDefault?.();
              return;
            }
            doc.deferredHttpError = null;
            if (matchesPending && doc.pending) {
              retireDocument(doc);
              doc.current = {
                url: eventUrl,
                phase: 'failed',
                progress: 'awaiting-start'
              };
              doc.pending = null;
            } else if (matchesCurrent && doc.current) {
              if (!eventUrl) doc.pending = null;
              if (hasLoadEnded(doc.current)) doc.current.progress = 'finished-before-start';
            } else {
              retireDocument(doc);
              if (doc.pending !== eventUrl) retirePending(doc);
              doc.current = {
                url: eventUrl || doc.pending || doc.sourceUri,
                phase: 'failed',
                progress: 'awaiting-start'
              };
              doc.pending = null;
            }
            failDocument(doc.current, event.nativeEvent.description);
            publishPage(doc);
          }}
          onHttpError={(event) => {
            const doc = currentDocument();
            const { statusCode, url } = event.nativeEvent;
            if (!doc || statusCode < 400 || !creditNavigationAllowed(event.nativeEvent)) return;
            const eventUrl = creditDocumentUrl(url);
            const matchesPending = Boolean(doc.pending && eventUrl === doc.pending);
            const matchesCurrent = Boolean(doc.current && eventUrl === doc.current.url);
            // Android onHttpError lacks headers/body, so let the visible LDC homepage render its own 403 challenge or refusal.
            if (eventUrl === CREDIT_HOME_URL && statusCode === 403) {
              if (matchesPending && doc.pending) {
                if (doc.current && doc.current.url !== eventUrl) retireDocument(doc);
                doc.current = { url: eventUrl, phase: 'loading', progress: 'awaiting-start' };
                doc.pending = null;
              }
              doc.deferredHttpError = null;
              publishPage(doc);
              return;
            }
            if (matchesPending && doc.pending) {
              retireDocument(doc);
              doc.current = { url: eventUrl, phase: 'failed', progress: 'awaiting-start' };
              doc.pending = null;
              doc.deferredHttpError = null;
              failDocument(doc.current, `HTTP ${statusCode}`);
              publishPage(doc);
              return;
            }
            if (matchesCurrent && doc.current && !hasLoadEnded(doc.current) && !doc.pending) {
              doc.deferredHttpError = null;
              failDocument(doc.current, `HTTP ${statusCode}`);
              publishPage(doc);
              return;
            }
            doc.deferredHttpError = { url: eventUrl, statusCode };
          }}
          onRenderProcessGone={() => {
            const doc = currentDocument();
            if (!doc) return;
            updateDeadline(doc.key, false);
            const next = { kind: 'reopen' as const, key: doc.key + 1, error: 'LDC 登录页面已停止，请刷新页面重试。' };
            activePage.current = next;
            setSnapshot(projectCreditPage(next));
          }}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
        />
      ) : null}
    </LoginWebViewModal>
  );
}
