import { useMemo, type RefObject } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { ImagePreviewModal } from '../components/ImagePreviewModal';
import { AppButton } from '../components/AppControls';
import { LoginWebViewModal } from '../components/LoginWebViewModal';
import type { ImagePreviewList } from '../htmlImages';
import type { LoginNavigationRequest } from '../appTypes';
import { MemoizedLinuxDoVerifyModal } from './LinuxDoVerifyModal';
import type { SiteSessionViewModel } from '../siteSessionState';
import type { createStyles, ReaderTheme } from '../theme';
import { nodeImageApiKeyProbeScript, type NodeImageAuthPayload } from '../loginWebViewScripts';

export function GlobalModalHost({
  checking,
  credentialFillAttempt,
  credentialFillPending,
  closeImagePreview,
  handleLinuxDoMessage,
  handleLinuxDoNavigation,
  imagePreview,
  mediaSessionIdentity,
  linuxDoCredentialSaved,
  linuxDoLoginFormMode,
  linuxDoSession,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewRef,
  loadingLinuxDoPage,
  loadingNodeImageAuthPage,
  mountLinuxDoWebView,
  nodeImageAuthError,
  nodeImageAuthPayload,
  nodeImageAuthUrl,
  nodeImageAuthWebViewRef,
  nodeSeekMediaUserAgent,
  resetLinuxDoWebView,
  checkLinuxDoCookie,
  clearLinuxDoCookie,
  handleNodeImageAuthMessage,
  handleNodeImageAuthNavigation,
  handleCredentialLoginFormMessage,
  setLinuxDoWebViewErrorForSession,
  setLoadingLinuxDoPageForSession,
  setLoadingNodeImageAuthPage,
  setNodeImageAuthError,
  showNodeImageAuthPanel,
  showLinuxDoPanel,
  showNextImage,
  showPreviousImage,
  savePreviewImage,
  selectPreviewImage,
  changeLinuxDoPanel,
  requestLinuxDoCredentialFill,
  closeNodeImageAuthPanel,
  styles,
  theme,
  webViewBlockMessage
}: {
  checking: boolean;
  credentialFillAttempt: number;
  credentialFillPending: boolean;
  closeImagePreview: () => void;
  handleLinuxDoMessage: (event: WebViewMessageEvent, webViewKey?: number) => void;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  imagePreview: ImagePreviewList | null;
  mediaSessionIdentity: string;
  linuxDoCredentialSaved: boolean;
  linuxDoLoginFormMode: boolean;
  linuxDoSession: SiteSessionViewModel;
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewRef: RefObject<WebView | null>;
  loadingLinuxDoPage: boolean;
  loadingNodeImageAuthPage: boolean;
  mountLinuxDoWebView: boolean;
  nodeImageAuthError: string;
  nodeImageAuthPayload: NodeImageAuthPayload | null;
  nodeImageAuthUrl: string;
  nodeImageAuthWebViewRef: RefObject<WebView | null>;
  nodeSeekMediaUserAgent?: string;
  resetLinuxDoWebView: () => void;
  checkLinuxDoCookie: () => void;
  clearLinuxDoCookie: () => void;
  handleNodeImageAuthMessage: (event: WebViewMessageEvent) => void;
  handleNodeImageAuthNavigation: (request: LoginNavigationRequest) => boolean;
  handleCredentialLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  setLinuxDoWebViewErrorForSession: (value: string, webViewKey?: number, credentialAttempt?: number) => void;
  setLoadingLinuxDoPageForSession: (value: boolean, webViewKey?: number) => void;
  setLoadingNodeImageAuthPage: (value: boolean) => void;
  setNodeImageAuthError: (value: string) => void;
  showNodeImageAuthPanel: boolean;
  showLinuxDoPanel: boolean;
  showNextImage: () => void;
  showPreviousImage: () => void;
  savePreviewImage: () => void;
  selectPreviewImage: (index: number) => void;
  changeLinuxDoPanel: (value: boolean) => void;
  requestLinuxDoCredentialFill: () => void;
  closeNodeImageAuthPanel: () => void;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  webViewBlockMessage: string;
}) {
  const nodeImageProbeScript = useMemo(() => (
    nodeImageApiKeyProbeScript(nodeImageAuthPayload)
  ), [nodeImageAuthPayload]);

  return (
    <>
      <MemoizedLinuxDoVerifyModal
        checking={checking}
        credentialAttempt={credentialFillAttempt}
        credentialFillPending={credentialFillPending}
        credentialSaved={linuxDoCredentialSaved}
        loginFormMode={linuxDoLoginFormMode}
        linuxDoSession={linuxDoSession}
        linuxDoWebViewError={linuxDoWebViewError}
        linuxDoWebViewKey={linuxDoWebViewKey}
        linuxDoWebViewRef={linuxDoWebViewRef}
        mountLinuxDoWebView={mountLinuxDoWebView}
        loadingLinuxDoPage={loadingLinuxDoPage}
        showLinuxDoPanel={showLinuxDoPanel}
        webViewBlockMessage={webViewBlockMessage}
        styles={styles}
        theme={theme}
        onCheckLinuxDoCookie={checkLinuxDoCookie}
        onClearLinuxDoCookie={clearLinuxDoCookie}
        handleLinuxDoNavigation={handleLinuxDoNavigation}
        onHandleLinuxDoMessage={handleLinuxDoMessage}
        onLoginFormMessage={handleCredentialLoginFormMessage}
        onRequestCredentialFill={requestLinuxDoCredentialFill}
        onResetLinuxDoWebView={resetLinuxDoWebView}
        onSetLinuxDoWebViewError={setLinuxDoWebViewErrorForSession}
        onSetLoadingLinuxDoPage={setLoadingLinuxDoPageForSession}
        onShowLinuxDoPanelChange={changeLinuxDoPanel}
      />
      <LoginWebViewModal
        visible={showNodeImageAuthPanel}
        title="NodeImage 授权"
        subtitle="通过 NodeSeek 授权后自动保存 Key"
        loading={!webViewBlockMessage && loadingNodeImageAuthPage}
        loadingText="正在打开 NodeImage..."
        error={webViewBlockMessage || nodeImageAuthError}
        styles={styles}
        theme={theme}
        onClose={closeNodeImageAuthPanel}
        actions={(
          <View style={styles.actions}>
            <AppButton label="刷新页面" variant="ghost" styles={styles} onPress={() => nodeImageAuthWebViewRef.current?.reload()} />
          </View>
        )}
      >
        {showNodeImageAuthPanel && !webViewBlockMessage ? (
          <WebView
            ref={nodeImageAuthWebViewRef}
            source={{ uri: nodeImageAuthUrl }}
            javaScriptCanOpenWindowsAutomatically={false}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            setSupportMultipleWindows={false}
            injectedJavaScript={nodeImageProbeScript}
            onLoadStart={() => {
              setNodeImageAuthError('');
              setLoadingNodeImageAuthPage(true);
            }}
            onLoadEnd={(event) => {
              setLoadingNodeImageAuthPage(false);
              if ('code' in event.nativeEvent) {
                return;
              }
              nodeImageAuthWebViewRef.current?.injectJavaScript(nodeImageProbeScript);
            }}
            onMessage={handleNodeImageAuthMessage}
            onError={(event) => {
              setLoadingNodeImageAuthPage(false);
              setNodeImageAuthError(`NodeImage 页面加载失败：${event.nativeEvent.description || '请检查模拟器网络后刷新页面。'}`);
            }}
            renderError={() => <View style={styles.webViewErrorPlaceholder} />}
            onRenderProcessGone={() => {
              setLoadingNodeImageAuthPage(false);
              setNodeImageAuthError('NodeImage 授权页面已停止，请刷新页面重试。');
            }}
            onShouldStartLoadWithRequest={handleNodeImageAuthNavigation}
          />
        ) : null}
      </LoginWebViewModal>
      <ImagePreviewModal
        preview={imagePreview}
        mediaSessionIdentity={mediaSessionIdentity}
        nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
        styles={styles}
        theme={theme}
        onClose={closeImagePreview}
        onNext={showNextImage}
        onPrevious={showPreviousImage}
        onSave={savePreviewImage}
        onSelect={selectPreviewImage}
      />
    </>
  );
}
