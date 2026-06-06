import { memo, type RefObject, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { LINUXDO_URL } from '../appUrls';
import type { LoginNavigationRequest } from '../appTypes';
import { AppButton } from '../components/AppControls';
import { LoginWebViewModal } from '../components/LoginWebViewModal';
import { LINUXDO_WEBVIEW_PROBE_SCRIPT } from '../loginWebViewScripts';
import type { SiteSessionViewModel } from '../siteSessionState';
import { createStyles, type ReaderTheme } from '../theme';

const LINUXDO_VERIFY_URL = LINUXDO_URL + '/latest';
const LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS = 12000;

export function LinuxDoVerifyModal({
  checking,
  linuxDoSession,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewRef,
  linuxDoWebViewUserAgent,
  mountLinuxDoWebView,
  loadingLinuxDoPage,
  showLinuxDoPanel,
  styles,
  theme,
  onCheckLinuxDoCookie,
  onClearLinuxDoCookie,
  handleLinuxDoNavigation,
  onHandleLinuxDoMessage,
  onResetLinuxDoWebView,
  onSetLinuxDoWebViewError,
  onSetLoadingLinuxDoPage,
  onShowLinuxDoPanelChange
}: {
  checking: boolean;
  linuxDoSession: SiteSessionViewModel;
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewRef: RefObject<WebView | null>;
  linuxDoWebViewUserAgent: string;
  mountLinuxDoWebView: boolean;
  loadingLinuxDoPage: boolean;
  showLinuxDoPanel: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onCheckLinuxDoCookie: () => void;
  onClearLinuxDoCookie: () => void;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  onHandleLinuxDoMessage: (event: WebViewMessageEvent, webViewKey?: number) => void;
  onResetLinuxDoWebView: () => void;
  onSetLinuxDoWebViewError: (value: string, webViewKey?: number) => void;
  onSetLoadingLinuxDoPage: (value: boolean, webViewKey?: number) => void;
  onShowLinuxDoPanelChange: (value: boolean) => void;
}) {
  const linuxDoWebViewReadyRef = useRef(false);
  const markLinuxDoPageReady = () => {
    linuxDoWebViewReadyRef.current = true;
    onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);
  };

  useEffect(() => {
    linuxDoWebViewReadyRef.current = false;
  }, [linuxDoWebViewKey, showLinuxDoPanel]);

  useEffect(() => {
    if (!showLinuxDoPanel || !loadingLinuxDoPage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);
      onSetLinuxDoWebViewError('linux.do 页面打开超时：请检查模拟器网络后刷新页面。', linuxDoWebViewKey);
    }, LINUXDO_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [linuxDoWebViewKey, loadingLinuxDoPage, onSetLinuxDoWebViewError, onSetLoadingLinuxDoPage, showLinuxDoPanel]);
  return (
    <LoginWebViewModal
      visible={showLinuxDoPanel}
      title="linux.do 登录 / 验证"
      subtitle={linuxDoSession.summaryLabel === '匿名可用' ? '匿名可用，登录后内容更完整' : linuxDoSession.summaryLabel}
      loading={loadingLinuxDoPage}
      loadingText="正在打开 linux.do..."
      error={linuxDoWebViewError}
      styles={styles}
      theme={theme}
      onClose={() => onShowLinuxDoPanelChange(false)}
      actions={(
        <View style={styles.actions}>
          <AppButton label={checking ? '检测中' : '检测状态'} styles={styles} disabled={checking} onPress={onCheckLinuxDoCookie} />
          <AppButton label="清除登录" variant="danger" styles={styles} onPress={onClearLinuxDoCookie} />
          <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={onResetLinuxDoWebView} />
        </View>
      )}
    >
      {showLinuxDoPanel && mountLinuxDoWebView ? (
        <WebView
          key={linuxDoWebViewKey}
          ref={linuxDoWebViewRef}
          source={{ uri: LINUXDO_VERIFY_URL }}
          androidLayerType="software"
          javaScriptEnabled
          domStorageEnabled
          cacheEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          userAgent={linuxDoWebViewUserAgent}
          injectedJavaScript={LINUXDO_WEBVIEW_PROBE_SCRIPT}
          onLoadProgress={(event) => {
            if (event.nativeEvent.progress >= 0.8) {
              markLinuxDoPageReady();
            }
          }}
          onLoadEnd={(event) => {
            markLinuxDoPageReady();
            if (!('code' in event.nativeEvent)) {
              onSetLinuxDoWebViewError('', linuxDoWebViewKey);
            }
            linuxDoWebViewRef.current?.injectJavaScript(LINUXDO_WEBVIEW_PROBE_SCRIPT);
          }}
          onLoadStart={() => {
            onSetLinuxDoWebViewError('', linuxDoWebViewKey);
            if (!linuxDoWebViewReadyRef.current) {
              onSetLoadingLinuxDoPage(true, linuxDoWebViewKey);
            }
          }}
          onMessage={(event) => onHandleLinuxDoMessage(event, linuxDoWebViewKey)}
          onError={(event) => {
            onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);
            onSetLinuxDoWebViewError(`linux.do 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`, linuxDoWebViewKey);
          }}
          renderError={() => <View style={styles.webViewErrorPlaceholder} />}
          onRenderProcessGone={() => {
            onSetLoadingLinuxDoPage(false, linuxDoWebViewKey);
            onSetLinuxDoWebViewError('linux.do 验证页面已停止，请刷新页面重试。', linuxDoWebViewKey);
          }}
          onShouldStartLoadWithRequest={handleLinuxDoNavigation}
        />
      ) : null}
    </LoginWebViewModal>
  );
}

export const MemoizedLinuxDoVerifyModal = memo(LinuxDoVerifyModal);
