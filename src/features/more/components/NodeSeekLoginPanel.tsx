import { type RefObject, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { CheckCircle, Image as ImageIcon } from 'lucide-react-native';
import type { MoreScreenStyles } from '../styles';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { NODESEEK_URL } from '@/domain/forum/sourceUrls';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { AppButton, MenuButton } from '@/ui/controls/AppControls';
import { LoginWebViewModal } from '@/ui/navigation/LoginWebViewModal';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from '@/platform/network/loginWebViewScripts';
import { LOGIN_FORM_ADAPTERS } from '@/domain/session/loginFormAdapters';

const LOGIN_WEBVIEW_LOADING_TIMEOUT_MS = 12000;

export function NodeSeekLoginPanel({
  accountExpanded,
  checking,
  credentialAttempt,
  credentialFillPending,
  credentialSaved,
  nodeSeekSession,
  nodeImageApiKeyBusy,
  nodeImageApiKeySaved,
  loginFormMode,
  loadingLoginPage,
  showLoginPanel,
  styles,
  theme,
  webViewRef,
  webViewBlockMessage,
  onCheckIn,
  onCheckLogin,
  onAuthorizeNodeImageApiKey,
  onSaveNodeImageApiKey,
  onClearNodeImageApiKey,
  onClearLogin,
  onHandleLoginMessage,
  onLoginFormMessage,
  onRequestCredentialFill,
  onWebViewState,
  handleNodeSeekLoginNavigation,
  onSetLoadingLoginPage,
  onShowLoginPanelChange
}: {
  accountExpanded: boolean;
  checking: boolean;
  credentialAttempt: number;
  credentialFillPending: boolean;
  credentialSaved: boolean;
  nodeSeekSession: SiteSessionViewModel;
  nodeImageApiKeyBusy: boolean;
  nodeImageApiKeySaved: boolean;
  loginFormMode: boolean;
  loadingLoginPage: boolean;
  showLoginPanel: boolean;
  styles: MoreScreenStyles;
  theme: ReaderTheme;
  webViewRef: RefObject<WebView | null>;
  webViewBlockMessage: string;
  onCheckIn: () => void;
  onCheckLogin: () => void;
  onAuthorizeNodeImageApiKey: () => void;
  onSaveNodeImageApiKey: (value: string) => void;
  onClearNodeImageApiKey: () => void;
  onClearLogin: () => void;
  onHandleLoginMessage: (event: WebViewMessageEvent) => void;
  onLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  onRequestCredentialFill: () => void;
  onWebViewState: (state: 'start' | 'ready' | 'error' | 'renderer-gone' | 'timeout', attempt?: number) => void;
  handleNodeSeekLoginNavigation: (request: LoginNavigationRequest) => boolean;
  onSetLoadingLoginPage: (value: boolean) => void;
  onShowLoginPanelChange: (value: boolean) => void;
}) {
  const [webViewError, setWebViewError] = useState('');
  const [webViewKey, setWebViewKey] = useState(0);
  const [webViewNeedsRemount, setWebViewNeedsRemount] = useState(false);
  const [webViewSettledForReplay, setWebViewSettledForReplay] = useState(false);
  const [showNodeImagePanel, setShowNodeImagePanel] = useState(false);
  const [showManualNodeImageKey, setShowManualNodeImageKey] = useState(false);
  const [nodeImageApiKeyDraft, setNodeImageApiKeyDraft] = useState('');

  useEffect(() => {
    if (!showLoginPanel) {
      setWebViewError('');
      setWebViewNeedsRemount(false);
      setWebViewSettledForReplay(false);
    }
  }, [showLoginPanel]);

  useEffect(() => {
    if (!showLoginPanel || !loadingLoginPage || webViewBlockMessage) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      setWebViewSettledForReplay(true);
      setWebViewNeedsRemount(true);
      onWebViewState('timeout', credentialAttempt);
      onSetLoadingLoginPage(false);
      setWebViewError('NodeSeek 页面打开超时：请检查模拟器网络后刷新页面。');
    }, LOGIN_WEBVIEW_LOADING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [
    credentialAttempt,
    loadingLoginPage,
    onSetLoadingLoginPage,
    onWebViewState,
    showLoginPanel,
    webViewBlockMessage,
    webViewRef
  ]);

  useEffect(() => {
    if (showLoginPanel && loginFormMode && !loadingLoginPage && credentialAttempt > 0) {
      webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.nodeseek.probeScript(credentialAttempt));
    }
  }, [credentialAttempt, loadingLoginPage, loginFormMode, showLoginPanel, webViewRef]);

  const refreshWebView = () => {
    setWebViewError('');
    setWebViewSettledForReplay(false);
    onSetLoadingLoginPage(true);
    if (webViewNeedsRemount) {
      setWebViewNeedsRemount(false);
      setWebViewKey((current) => current + 1);
      return;
    }
    webViewRef.current?.reload();
  };

  return (
    <>
      {nodeSeekSession.canWrite ? (
        <MenuButton
          nested
          icon={CheckCircle}
          label="NodeSeek 签到"
          value="使用本机登录 Cookie"
          styles={styles}
          theme={theme}
          onPress={onCheckIn}
        />
      ) : null}
      <MenuButton
        nested
        icon={ImageIcon}
        label="NodeImage API Key"
        value={nodeImageApiKeySaved ? '已保存，NodeSeek 图片上传可用' : '未保存，NodeSeek 图片上传不可用'}
        expanded={showNodeImagePanel}
        styles={styles}
        theme={theme}
        onPress={() => setShowNodeImagePanel((value) => !value)}
      />
      {showNodeImagePanel ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>优先复用 NodeImage 登录态；明确失效时才连接 NodeSeek。手动粘贴只作备用。</Text>
          <View style={styles.actions}>
            <AppButton
              label="获取 / 恢复授权"
              styles={styles}
              disabled={nodeImageApiKeyBusy}
              onPress={onAuthorizeNodeImageApiKey}
            />
            <AppButton
              label="清除 Key"
              variant="ghost"
              styles={styles}
              disabled={nodeImageApiKeyBusy || !nodeImageApiKeySaved}
              onPress={onClearNodeImageApiKey}
            />
            <AppButton
              label={showManualNodeImageKey ? '收起手动备用' : '手动粘贴备用'}
              variant="ghost"
              styles={styles}
              onPress={() => setShowManualNodeImageKey((value) => !value)}
            />
          </View>
          {showManualNodeImageKey ? (
            <>
              <TextInput
                accessibilityLabel="NodeImage API Key 输入"
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="NodeImage API Key"
                placeholderTextColor={theme.muted}
                secureTextEntry
                style={styles.input}
                value={nodeImageApiKeyDraft}
                onChangeText={setNodeImageApiKeyDraft}
              />
              <View style={styles.actions}>
                <AppButton
                  label={nodeImageApiKeyBusy ? '保存中' : '保存 Key'}
                  styles={styles}
                  disabled={nodeImageApiKeyBusy || !nodeImageApiKeyDraft.trim()}
                  onPress={() => {
                    onSaveNodeImageApiKey(nodeImageApiKeyDraft);
                    setNodeImageApiKeyDraft('');
                  }}
                />
              </View>
            </>
          ) : null}
        </View>
      ) : null}
      <LoginWebViewModal
        visible={showLoginPanel}
        title="NodeSeek 登录 / 验证"
        subtitle={nodeSeekSession.summaryLabel}
        loading={!webViewBlockMessage && loadingLoginPage}
        loadingText="正在打开 NodeSeek..."
        error={webViewBlockMessage || webViewError}
        styles={styles}
        theme={theme}
        onClose={() => onShowLoginPanelChange(false)}
        actions={
          <View style={styles.actions}>
            {credentialSaved ? (
              <AppButton
                label="填入已保存登录信息"
                styles={styles}
                disabled={credentialFillPending}
                onPress={onRequestCredentialFill}
              />
            ) : null}
            <AppButton
              testID={webViewSettledForReplay || webViewBlockMessage ? 'nodeseek-login-webview-settled' : undefined}
              label={checking ? '检测中' : '检测登录'}
              styles={styles}
              disabled={checking}
              onPress={onCheckLogin}
            />
            <AppButton label="清除登录" variant="danger" styles={styles} onPress={onClearLogin} />
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={refreshWebView} />
          </View>
        }
      >
        {showLoginPanel && accountExpanded && !webViewBlockMessage && !webViewNeedsRemount ? (
          <WebView
            key={`nodeseek-login-${webViewKey}`}
            ref={webViewRef}
            source={{ uri: loginFormMode ? LOGIN_FORM_ADAPTERS.nodeseek.loginUrl : NODESEEK_URL }}
            javaScriptCanOpenWindowsAutomatically={false}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            injectedJavaScript={NODESEEK_LOGIN_PROBE_SCRIPT}
            onLoadEnd={(event) => {
              onSetLoadingLoginPage(false);
              setWebViewSettledForReplay(true);
              if ('code' in event.nativeEvent) {
                return;
              }
              onWebViewState('ready', credentialAttempt);
              setWebViewError('');
              webViewRef.current?.injectJavaScript(NODESEEK_LOGIN_PROBE_SCRIPT);
              if (loginFormMode) {
                webViewRef.current?.injectJavaScript(LOGIN_FORM_ADAPTERS.nodeseek.probeScript(credentialAttempt));
              }
            }}
            onLoadStart={() => {
              onWebViewState('start', credentialAttempt);
              setWebViewError('');
              setWebViewNeedsRemount(false);
              setWebViewSettledForReplay(false);
              onSetLoadingLoginPage(true);
            }}
            onMessage={(event) => {
              if (!onLoginFormMessage(event)) {
                onHandleLoginMessage(event);
              }
            }}
            onError={(event) => {
              onWebViewState('error', credentialAttempt);
              onSetLoadingLoginPage(false);
              setWebViewSettledForReplay(true);
              setWebViewError(
                `NodeSeek 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`
              );
            }}
            renderError={() => <View style={styles.webViewErrorPlaceholder} />}
            onRenderProcessGone={() => {
              onWebViewState('renderer-gone', credentialAttempt);
              onSetLoadingLoginPage(false);
              setWebViewSettledForReplay(true);
              setWebViewNeedsRemount(true);
              setWebViewError('NodeSeek 登录页面已停止，请刷新页面重试。');
            }}
            onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}
          />
        ) : null}
      </LoginWebViewModal>
    </>
  );
}
