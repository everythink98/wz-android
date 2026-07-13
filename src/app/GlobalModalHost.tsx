import type { RefObject } from 'react';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import { ImagePreviewModal } from '../components/ImagePreviewModal';
import type { ImagePreviewList } from '../htmlImages';
import type { LoginNavigationRequest } from '../appTypes';
import { MemoizedLinuxDoVerifyModal } from './LinuxDoVerifyModal';
import type { SiteSessionViewModel } from '../siteSessionState';
import type { createStyles, ReaderTheme } from '../theme';
import { NodeImageAuthModal } from './NodeImageAuthModal';
import type { NodeImageAuthModalController } from './useNodeImageAuthController';

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
  linuxDoWebViewProbeScript,
  linuxDoWebViewRef,
  linuxDoWebViewUserAgent,
  loadingLinuxDoPage,
  mountLinuxDoWebView,
  nodeImageAuth,
  nodeSeekMediaCookieHeader,
  nodeSeekMediaUserAgent,
  nodeSeekWebViewUserAgent,
  resetLinuxDoWebView,
  checkLinuxDoCookie,
  clearLinuxDoCookie,
  handleNodeImageAuthNavigation,
  handleCredentialLoginFormMessage,
  setLinuxDoWebViewErrorForSession,
  setLoadingLinuxDoPageForSession,
  showLinuxDoPanel,
  showNextImage,
  showPreviousImage,
  savePreviewImage,
  selectPreviewImage,
  changeLinuxDoPanel,
  requestLinuxDoCredentialFill,
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
  linuxDoWebViewProbeScript: string;
  linuxDoWebViewRef: RefObject<WebView | null>;
  linuxDoWebViewUserAgent: string;
  loadingLinuxDoPage: boolean;
  mountLinuxDoWebView: boolean;
  nodeImageAuth: NodeImageAuthModalController;
  nodeSeekMediaCookieHeader: string;
  nodeSeekMediaUserAgent: string;
  nodeSeekWebViewUserAgent: string;
  resetLinuxDoWebView: () => void;
  checkLinuxDoCookie: () => void;
  clearLinuxDoCookie: () => void;
  handleNodeImageAuthNavigation: (request: LoginNavigationRequest) => boolean;
  handleCredentialLoginFormMessage: (event: WebViewMessageEvent) => boolean;
  setLinuxDoWebViewErrorForSession: (value: string, webViewKey?: number, credentialAttempt?: number) => void;
  setLoadingLinuxDoPageForSession: (value: boolean, webViewKey?: number) => void;
  showLinuxDoPanel: boolean;
  showNextImage: () => void;
  showPreviousImage: () => void;
  savePreviewImage: () => void;
  selectPreviewImage: (index: number) => void;
  changeLinuxDoPanel: (value: boolean) => void;
  requestLinuxDoCredentialFill: () => void;
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
        linuxDoWebViewProbeScript={linuxDoWebViewProbeScript}
        linuxDoWebViewRef={linuxDoWebViewRef}
        linuxDoWebViewUserAgent={linuxDoWebViewUserAgent}
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
      <NodeImageAuthModal
        controller={nodeImageAuth}
        handleNavigation={handleNodeImageAuthNavigation}
        styles={styles}
        theme={theme}
        userAgent={nodeSeekWebViewUserAgent}
        webViewBlockMessage={webViewBlockMessage}
      />
      <ImagePreviewModal
        nodeSeekCookieHeader={nodeSeekMediaCookieHeader}
        nodeSeekUserAgent={nodeSeekMediaUserAgent}
        preview={imagePreview}
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
