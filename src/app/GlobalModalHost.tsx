import type { RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { ImagePreviewModal } from '../components/ImagePreviewModal';
import { LoginWebViewModal } from '../components/LoginWebViewModal';
import type { ImagePreviewList } from '../htmlImages';
import type { LoginNavigationRequest } from '../appTypes';
import { MemoizedLinuxDoVerifyModal } from './LinuxDoVerifyModal';
import type { SiteSessionViewModel } from '../siteSessionState';
import type { createStyles, ReaderTheme } from '../theme';
import type { NodeImageAuthDocument } from './useNodeImageAuthController';

export function GlobalModalHost({
  checking,
  credentialFillAttempt,
  credentialFillPending,
  closeImagePreview,
  handleLinuxDoMessage,
  handleLinuxDoNavigation,
  imagePreview,
  linuxDoCredentialSaved,
  linuxDoLoginFormMode,
  linuxDoSession,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewRef,
  loadingLinuxDoPage,
  loadingNodeImageAuthPage,
  mountLinuxDoWebView,
  nodeImageAuthDocument,
  nodeImageAuthError,
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
  linuxDoCredentialSaved: boolean;
  linuxDoLoginFormMode: boolean;
  linuxDoSession: SiteSessionViewModel;
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewRef: RefObject<WebView | null>;
  loadingLinuxDoPage: boolean;
  loadingNodeImageAuthPage: boolean;
  mountLinuxDoWebView: boolean;
  nodeImageAuthDocument: NodeImageAuthDocument | null;
  nodeImageAuthError: string;
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
        subtitle="优先复用 NodeImage 登录态，失效时自动连接"
        loading={!webViewBlockMessage && loadingNodeImageAuthPage}
        loadingText="正在打开 NodeImage..."
        error={webViewBlockMessage || nodeImageAuthError}
        styles={styles}
        theme={theme}
        onClose={closeNodeImageAuthPanel}
      >
        {showNodeImageAuthPanel && nodeImageAuthDocument && !webViewBlockMessage ? (
          <>
            <WebView
              key={nodeImageAuthDocument.key}
              ref={nodeImageAuthWebViewRef}
              source={{ uri: nodeImageAuthDocument.url }}
              injectedJavaScript={nodeImageAuthDocument.injectedJavaScript}
              javaScriptCanOpenWindowsAutomatically={false}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              onLoadStart={() => {
                setLoadingNodeImageAuthPage(true);
              }}
              onLoadEnd={() => {
                setLoadingNodeImageAuthPage(false);
              }}
              onMessage={handleNodeImageAuthMessage}
              onError={(event) => {
                setLoadingNodeImageAuthPage(false);
                setNodeImageAuthError(`NodeImage 页面加载失败：${event.nativeEvent.description || '请检查网络后关闭重试。'}`);
              }}
              renderError={() => <View style={styles.webViewErrorPlaceholder} />}
              onRenderProcessGone={() => {
                setLoadingNodeImageAuthPage(false);
                setNodeImageAuthError('NodeImage 授权页面已停止，请关闭后重试。');
              }}
              onShouldStartLoadWithRequest={handleNodeImageAuthNavigation}
            />
            <View
              testID="nodeimage-auth-touch-shield"
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="auto"
              style={StyleSheet.absoluteFillObject}
              onStartShouldSetResponder={() => true}
            />
          </>
        ) : null}
      </LoginWebViewModal>
      <ImagePreviewModal
        preview={imagePreview}
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
