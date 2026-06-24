import type { RefObject } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { ImagePreviewModal } from '../components/ImagePreviewModal';
import type { ImagePreviewList } from '../htmlImages';
import type { LoginNavigationRequest } from '../appTypes';
import { MemoizedLinuxDoVerifyModal } from './LinuxDoVerifyModal';
import type { SiteSessionViewModel } from '../siteSessionState';
import type { createStyles, ReaderTheme } from '../theme';

export function GlobalModalHost({
  checking,
  closeImagePreview,
  handleLinuxDoMessage,
  handleLinuxDoNavigation,
  imagePreview,
  linuxDoSession,
  linuxDoWebViewError,
  linuxDoWebViewKey,
  linuxDoWebViewRef,
  linuxDoWebViewUserAgent,
  loadingLinuxDoPage,
  mountLinuxDoWebView,
  resetLinuxDoWebView,
  checkLinuxDoCookie,
  clearLinuxDoCookie,
  setLinuxDoWebViewErrorForSession,
  setLoadingLinuxDoPageForSession,
  showLinuxDoPanel,
  showNextImage,
  showPreviousImage,
  savePreviewImage,
  selectPreviewImage,
  changeLinuxDoPanel,
  styles,
  theme
}: {
  checking: boolean;
  closeImagePreview: () => void;
  handleLinuxDoMessage: (event: WebViewMessageEvent, webViewKey?: number) => void;
  handleLinuxDoNavigation: (request: LoginNavigationRequest) => boolean;
  imagePreview: ImagePreviewList | null;
  linuxDoSession: SiteSessionViewModel;
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewRef: RefObject<WebView | null>;
  linuxDoWebViewUserAgent: string;
  loadingLinuxDoPage: boolean;
  mountLinuxDoWebView: boolean;
  resetLinuxDoWebView: () => void;
  checkLinuxDoCookie: () => void;
  clearLinuxDoCookie: () => void;
  setLinuxDoWebViewErrorForSession: (value: string, webViewKey?: number) => void;
  setLoadingLinuxDoPageForSession: (value: boolean, webViewKey?: number) => void;
  showLinuxDoPanel: boolean;
  showNextImage: () => void;
  showPreviousImage: () => void;
  savePreviewImage: () => void;
  selectPreviewImage: (index: number) => void;
  changeLinuxDoPanel: (value: boolean) => void;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
}) {
  return (
    <>
      <MemoizedLinuxDoVerifyModal
        checking={checking}
        linuxDoSession={linuxDoSession}
        linuxDoWebViewError={linuxDoWebViewError}
        linuxDoWebViewKey={linuxDoWebViewKey}
        linuxDoWebViewRef={linuxDoWebViewRef}
        linuxDoWebViewUserAgent={linuxDoWebViewUserAgent}
        mountLinuxDoWebView={mountLinuxDoWebView}
        loadingLinuxDoPage={loadingLinuxDoPage}
        showLinuxDoPanel={showLinuxDoPanel}
        styles={styles}
        theme={theme}
        onCheckLinuxDoCookie={checkLinuxDoCookie}
        onClearLinuxDoCookie={clearLinuxDoCookie}
        handleLinuxDoNavigation={handleLinuxDoNavigation}
        onHandleLinuxDoMessage={handleLinuxDoMessage}
        onResetLinuxDoWebView={resetLinuxDoWebView}
        onSetLinuxDoWebViewError={setLinuxDoWebViewErrorForSession}
        onSetLoadingLinuxDoPage={setLoadingLinuxDoPageForSession}
        onShowLinuxDoPanelChange={changeLinuxDoPanel}
      />
      <ImagePreviewModal
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
