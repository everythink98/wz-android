import { memo, type RefObject, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { LINUXDO_URL } from '@/domain/forum/sourceUrls';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { ArrowLeft, KeyRound, LogOut, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { LoginWebViewAction, LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import { LINUXDO_WEBVIEW_PROBE_SCRIPT } from '@/platform/network/loginWebViewScripts';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import type { AccountHostStyles } from '../accountHostStyles';

const LINUXDO_VERIFY_URL = LINUXDO_URL + '/latest';
const LINUXDO_CHALLENGE_URL = LINUXDO_URL + '/challenge';
const LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS = 12000;

export function LinuxDoVerifyModal({
  recoveryPanel,
  onRetryRecovery = () => undefined,
  checking,
  credentialAttempt,
  credentialFillPending,
  credentialSaved,
  loginFormMode,
  linuxDoSession,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewRef,
  mountLinuxDoWebView,
  loadingLinuxDoPage,
  showLinuxDoPanel,
  styles,
  webViewBlockMessage,
  onCheckLinuxDoCookie,
  onClearLinuxDoCookie,
  handleLinuxDoNavigation,
  onHandleLinuxDoMessage,
  onLoginFormMessage,
  onRequestCredentialFill,
  onResetLinuxDoWebView,
  onSetLinuxDoWebViewError,
  onSetLoadingLinuxDoPage,
  onShowLinuxDoPanelChange
}: {
  recoveryPanel?: import('../useVerificationController').LinuxDoRecoveryPanel;
  onRetryRecovery?: () => void;
  checking: boolean;
  credentialAttempt: number;
  credentialFillPending: boolean;
  credentialSaved: boolean;
  loginFormMode: boolean;
  linuxDoSession: SiteSessionViewModel;
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewRef: RefObject<WebView | null>;
  mountLinuxDoWebView: boolean;
  loadingLinuxDoPage: boolean;
  showLinuxDoPanel: boolean;
  styles: AccountHostStyles;
  webViewBlockMessage: string;
  onCheckLinuxDoCookie: () => void;
  onClearLinuxDoCookie: () => void;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLinuxDoMessage: (event: WebViewMessageEvent, webViewKey?: number) => void;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onRequestCredentialFill: () => void;
  onResetLinuxDoWebView: () => void;
  onSetLinuxDoWebViewError: (value: string, webViewKey?: number, credentialAttempt?: number) => void;
  onSetLoadingLinuxDoPage: (value: boolean, webViewKey?: number) => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
}) {
  const linuxDoWebViewReadyRef = useRef(false);
  const [webViewNeedsRemount, setWebViewNeedsRemount] = useState(false);
  const [challengeEnded, setChallengeEnded] = useState(false);
  const documentKeyRef = useRef(linuxDoWebViewKey);
  const httpErrorRef = useRef(false);
  const documentUrlRef = useRef('');
  const recovery = recoveryPanel && recoveryPanel.phase !== 'idle' ? recoveryPanel : undefined;
  const web = !recovery || recovery.phase === 'web';
  const blocked = recovery?.results.some((result) => result.outcome === 'verification-required');
  const canRetry = recovery?.results.some(
    (result) => result.outcome === 'pending' || result.outcome === 'verification-required'
  );
  const markLinuxDoPageReady = () => {
    linuxDoWebViewReadyRef.current = true;
    onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);
  };

  useEffect(() => {
    linuxDoWebViewReadyRef.current = false;
    documentKeyRef.current = linuxDoWebViewKey;
    setChallengeEnded(false);
    httpErrorRef.current = false;
    documentUrlRef.current = '';
    setWebViewNeedsRemount(false);
  }, [linuxDoWebViewKey, showLinuxDoPanel]);

  useEffect(() => {
    if (!showLinuxDoPanel || !loadingLinuxDoPage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      setWebViewNeedsRemount(true);
      onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);
      onSetLinuxDoWebViewError(
        'linux.do 页面打开超时：请检查模拟器网络后刷新页面。',
        linuxDoWebViewKey,
        credentialAttempt
      );
    }, LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [
    credentialAttempt,
    linuxDoWebViewKey,
    loadingLinuxDoPage,
    onSetLinuxDoWebViewError,
    onSetLoadingLinuxDoPage,
    showLinuxDoPanel
  ]);
  return (
    <LoginWebViewModal
      visible={showLinuxDoPanel}
      title={recovery ? 'linux.do 请求恢复' : 'linux.do 登录 / 验证'}
      subtitle={
        recovery
          ? recovery.results.some((result) => result.kind === 'page')
            ? '恢复页面读取'
            : '恢复阅读记录同步'
          : linuxDoSession.summaryLabel === '匿名可用'
            ? '匿名可用，登录后内容更完整'
            : linuxDoSession.summaryLabel
      }
      loading={web && !webViewBlockMessage && loadingLinuxDoPage}
      loadingText="正在打开 linux.do..."
      error={web ? webViewBlockMessage || linuxDoWebViewError : ''}
      onClose={() => onShowLinuxDoPanelChange(false)}
      actions={
        <View style={styles.actions}>
          {web ? (
            <LoginWebViewAction
              icon={ShieldCheck}
              primary
              label={checking ? '检测中' : '检测状态'}
              disabled={checking}
              onPress={() => {
                onCheckLinuxDoCookie();
              }}
            />
          ) : null}
          {!recovery && credentialSaved ? (
            <LoginWebViewAction
              icon={KeyRound}
              label="填入已保存登录信息"
              displayLabel="填入"
              disabled={credentialFillPending || !mountLinuxDoWebView}
              onPress={onRequestCredentialFill}
            />
          ) : null}
          {web ? (
            <LoginWebViewAction icon={RefreshCw} label="刷新页面" displayLabel="" onPress={onResetLinuxDoWebView} />
          ) : null}
          {!recovery ? (
            <LoginWebViewAction
              icon={LogOut}
              label="清除登录"

              danger
              onPress={onClearLinuxDoCookie}
            />
          ) : null}
          {recovery?.phase === 'result' && canRetry ? (
            <LoginWebViewAction icon={ShieldCheck} primary label="重新验证" onPress={onRetryRecovery} />
          ) : null}
          {recovery ? (
            <LoginWebViewAction icon={ArrowLeft} label="返回原页面" onPress={() => onShowLinuxDoPanelChange(false)} />
          ) : null}
        </View>
      }
    >
      {recovery?.phase === 'checking' || (!recovery && checking) ? (
        <View style={styles.recoveryMessage} accessibilityLiveRegion="polite">
          <Text style={styles.meta}>
            {recovery ? '正在检测原请求是否恢复，可以随时返回。' : '正在确认登录状态，可以随时返回。'}
          </Text>
        </View>
      ) : recovery?.phase === 'result' ? (
        <View style={styles.recoveryMessage} accessibilityLiveRegion="polite">
          {blocked ? <Text style={styles.meta}>请求仍被站点拦截，尚未恢复。</Text> : null}
          {recovery.results.map((result, index) => (
            <Text key={index} style={styles.meta}>
              {result.kind === 'page' ? '页面' : '阅读记录'}：
              {result.outcome === 'completed'
                ? result.kind === 'page'
                  ? '已恢复'
                  : '已同步'
                : result.error ||
                  (result.outcome === 'verification-required'
                    ? '仍被站点拦截'
                    : result.outcome === 'stale'
                      ? '已过期或失效，本次未恢复'
                      : result.outcome === 'pending'
                        ? '等待检测'
                        : '恢复失败，请返回原页面重试')}
            </Text>
          ))}
        </View>
      ) : recovery ? (
        <Text style={[styles.meta, styles.recoveryMessage]}>
          网页没有显示验证码也可以检测；是否恢复以原请求的结果为准。
        </Text>
      ) : null}
      {web && showLinuxDoPanel && mountLinuxDoWebView && !webViewBlockMessage && !webViewNeedsRemount ? (
        <WebView
          key={linuxDoWebViewKey}
          ref={linuxDoWebViewRef}
          source={{
            uri: loginFormMode
              ? LOGIN_FORM_ADAPTERS.linuxdo.loginUrl
              : recovery?.dedicated
                ? LINUXDO_CHALLENGE_URL
                : LINUXDO_VERIFY_URL
          }}
          style={challengeEnded ? styles.endedChallengeWebView : styles.flex}
          androidLayerType="software"
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          domStorageEnabled
          cacheEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          injectedJavaScript={LINUXDO_WEBVIEW_PROBE_SCRIPT}
          onLoadProgress={(event) => {
            if (event.nativeEvent.progress >= 0.8) {
              markLinuxDoPageReady();
            }
          }}
          onLoadEnd={(event) => {
            if (documentKeyRef.current !== linuxDoWebViewKey) return;
            markLinuxDoPageReady();
            if (!httpErrorRef.current && !('code' in event.nativeEvent)) {
              onSetLinuxDoWebViewError('', linuxDoWebViewKey, credentialAttempt);
            }
            linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
            if (loginFormMode) {
              linuxDoWebViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.linuxdo.probeScript(credentialAttempt));
            }
          }}
          onLoadStart={(event) => {
            if (documentKeyRef.current !== linuxDoWebViewKey) return;
            documentUrlRef.current = event?.nativeEvent.url || '';
            httpErrorRef.current = false;
            setChallengeEnded(false);
            linuxDoWebViewReadyRef.current = false;
            setWebViewNeedsRemount(false);
            onSetLinuxDoWebViewError('', linuxDoWebViewKey, credentialAttempt);
            onSetLoadingLinuxDoPage(true, linuxDoWebViewKey);
          }}
          onMessage={(event) => {
            if (!onLoginFormMessage(event)) {
              onHandleLinuxDoMessage(event, linuxDoWebViewKey);
            }
          }}
          onError={(event) => {
            onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);
            onSetLinuxDoWebViewError(
              `linux.do 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`,
              linuxDoWebViewKey,
              credentialAttempt
            );
          }}
          onHttpError={(event) => {
            if (documentKeyRef.current !== linuxDoWebViewKey) return;
            const { statusCode, url } = event.nativeEvent;
            if (documentUrlRef.current && documentUrlRef.current !== url) return;
            httpErrorRef.current = true;
            // Android WebView emits this event only for the current main document.
            if (recovery?.dedicated && url === LINUXDO_CHALLENGE_URL && statusCode === 404) {
              setChallengeEnded(true);
              markLinuxDoPageReady();
            } else {
              onSetLinuxDoWebViewError(`linux.do 页面返回 HTTP ${statusCode}，请刷新或返回。`, linuxDoWebViewKey);
              markLinuxDoPageReady();
            }
          }}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
          onRenderProcessGone={() => {
            setWebViewNeedsRemount(true);
            onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);
            onSetLinuxDoWebViewError('linux.do 验证页面已停止，请刷新页面重试。', linuxDoWebViewKey, credentialAttempt);
          }}
          onShouldStartLoadWithRequest={handleLinuxDoNavigation}
        />
      ) : null}
      {web && challengeEnded ? (
        <View style={styles.challengeEnded}>
          <Text style={styles.meta}>验证页面已结束，请检测原请求是否恢复。</Text>
        </View>
      ) : null}
    </LoginWebViewModal>
  );
}

export const MemoizedLinuxDoVerifyModal = memo(LinuxDoVerifyModal);
