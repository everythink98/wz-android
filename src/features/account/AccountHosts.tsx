import type { RefObject } from 'react';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AccountHost } from './AccountHost';
import { HiddenBrowserHost } from './HiddenBrowserHost';
import { createAccountHostStyles } from './accountHostStyles';
import { NodeSeekLoginHost } from './components/NodeSeekLoginHost';
import { YaohuoLoginHost } from './components/YaohuoLoginHost';
import type { useAccountController } from './useAccountController';
import type { useAccountCredentialController } from './useAccountCredentialController';
import type { useAccountStatusController } from './useAccountStatusController';
import type { useNodeImageAuthController } from './useNodeImageAuthController';
import type { useSessionController } from './useSessionController';
import type { useVerificationController } from './useVerificationController';

type AccountHostsView = {
  checking: boolean;
  checkNodeSeekLoginAndRetry: () => unknown;
  changeNodeSeekLoginPanel: (visible: boolean) => void;
  changeYaohuoLoginPanel: (visible: boolean) => void;
  handleLinuxDoBrowserFetchMessage: (event: WebViewMessageEvent) => void;
  handleNodeSeekBrowserFetchMessage: (event: WebViewMessageEvent) => void;
  linuxDoBrowserWebViewRef: RefObject<WebView | null>;
  linuxDoWebViewError: string;
  linuxDoWebViewKey: number;
  linuxDoWebViewRef: RefObject<WebView | null>;
  linuxDoWebViewUserAgent: string;
  loadingLinuxDoPage: boolean;
  loadingLoginPage: boolean;
  loadingYaohuoLoginPage: boolean;
  mountLinuxDoWebView: boolean;
  nodeSeekBrowserWebViewRef: RefObject<WebView | null>;
  nodeSeekWebViewUserAgent: string;
  setLoadingLoginPage: (value: boolean) => void;
  setLoadingYaohuoLoginPage: (value: boolean) => void;
  showLinuxDoPanel: boolean;
  showLoginPanel: boolean;
  showYaohuoLoginPanel: boolean;
  webViewRef: RefObject<WebView | null>;
  yaohuoLoginPrompt: string;
  yaohuoWebViewRef: RefObject<WebView | null>;
};

export type AccountHostsProps = {
  account: ReturnType<typeof useAccountController>;
  blockedMessage: string;
  credentials: ReturnType<typeof useAccountCredentialController>;
  loginNavigation: Record<
    'linuxdo' | 'nodeimage' | 'nodeseek' | 'yaohuo',
    (request: LoginNavigationRequest) => boolean
  >;
  nodeImage: ReturnType<typeof useNodeImageAuthController>;
  session: ReturnType<typeof useSessionController>;
  status: ReturnType<typeof useAccountStatusController>;
  verification: ReturnType<typeof useVerificationController>;
  view: AccountHostsView;
};

export function AccountHosts({
  account,
  blockedMessage,
  credentials,
  loginNavigation,
  nodeImage,
  session,
  status,
  verification,
  view
}: AccountHostsProps) {
  const { styles } = useReaderThemeStyles(createAccountHostStyles);
  const accountSessionViewModels = status.accountSessionViewModels;

  return (
    <>
      <HiddenBrowserHost
        blockedMessage={blockedMessage}
        failLinuxDoBrowserFetchById={session.failLinuxDoBrowserFetchById}
        failNodeSeekBrowserFetchById={session.failNodeSeekBrowserFetchById}
        handleLinuxDoBrowserFetchMessage={view.handleLinuxDoBrowserFetchMessage}
        handleNodeSeekBrowserFetchMessage={view.handleNodeSeekBrowserFetchMessage}
        linuxDoBrowserWebViewRef={view.linuxDoBrowserWebViewRef}
        nodeSeekBrowserWebViewRef={view.nodeSeekBrowserWebViewRef}
        state={{
          linuxDo: {
            request: session.hiddenBrowserFetchRequests.linuxDo,
            userAgent: view.linuxDoWebViewUserAgent
          },
          nodeSeek: {
            request: session.hiddenBrowserFetchRequests.nodeSeek,
            userAgent: view.nodeSeekWebViewUserAgent
          }
        }}
        styles={styles}
        onLinuxDoHttpErrorStatus={session.markLinuxDoBrowserFetchHttpError}
        onNodeSeekHttpErrorStatus={session.markNodeSeekBrowserFetchHttpError}
      />
      <AccountHost
        checking={view.checking}
        credentialFillAttempt={
          credentials.credentialFillAttempt?.site === 'linuxdo' ? credentials.credentialFillAttempt.attempt : 0
        }
        credentialFillPending={credentials.pendingCredentialFillSite === 'linuxdo'}
        checkLinuxDoCookie={verification.checkLinuxDoCookie}
        clearLinuxDoCookie={() => {
          void account.clearLinuxDoCookie();
        }}
        handleLinuxDoMessage={verification.handleLinuxDoMessage}
        handleLinuxDoNavigation={loginNavigation.linuxdo}
        handleCredentialLoginFormMessage={credentials.handleCredentialLoginFormMessage}
        handleNodeImageAuthMessage={nodeImage.panel.handleMessage}
        handleNodeImageAuthNavigation={loginNavigation.nodeimage}
        linuxDoCredentialSaved={credentials.credentialSummaries.linuxdo.hasCredential}
        linuxDoLoginFormMode={credentials.credentialLoginSite === 'linuxdo'}
        linuxDoSession={accountSessionViewModels.linuxdo}
        linuxDoWebViewError={view.linuxDoWebViewError}
        linuxDoWebViewKey={view.linuxDoWebViewKey}
        linuxDoWebViewRef={view.linuxDoWebViewRef}
        loadingLinuxDoPage={view.loadingLinuxDoPage}
        loadingNodeImageAuthPage={nodeImage.panel.loading}
        mountLinuxDoWebView={view.mountLinuxDoWebView}
        nodeImageAuthDocument={nodeImage.panel.document}
        nodeImageAuthError={nodeImage.panel.error}
        nodeImageAuthWebViewRef={nodeImage.panel.webViewRef}
        resetLinuxDoWebView={verification.resetLinuxDoWebView}
        setLinuxDoWebViewErrorForSession={verification.setLinuxDoWebViewErrorForSession}
        setLoadingLinuxDoPageForSession={verification.setLoadingLinuxDoPageForSession}
        setLoadingNodeImageAuthPage={nodeImage.panel.setLoading}
        setNodeImageAuthError={nodeImage.panel.fail}
        showLinuxDoPanel={view.showLinuxDoPanel}
        showNodeImageAuthPanel={nodeImage.panel.visible}
        styles={styles}
        webViewBlockMessage={blockedMessage}
        changeLinuxDoPanel={verification.changeLinuxDoPanel}
        requestLinuxDoCredentialFill={() => credentials.openAccountLogin('linuxdo', true)}
        closeNodeImageAuthPanel={nodeImage.panel.close}
      />
      <NodeSeekLoginHost
        checking={view.checking}
        credentialAttempt={
          credentials.credentialFillAttempt?.site === 'nodeseek' ? credentials.credentialFillAttempt.attempt : 0
        }
        credentialFillPending={credentials.pendingCredentialFillSite === 'nodeseek'}
        credentialSaved={credentials.credentialSummaries.nodeseek.hasCredential}
        loginFormMode={credentials.credentialLoginSite === 'nodeseek'}
        loading={view.loadingLoginPage}
        session={accountSessionViewModels.nodeseek}
        styles={styles}
        visible={view.showLoginPanel}
        webViewBlockMessage={blockedMessage}
        webViewRef={view.webViewRef}
        onCheck={() => {
          void view.checkNodeSeekLoginAndRetry();
        }}
        onClear={() => {
          void account.clearLogin();
        }}
        onClose={() => view.changeNodeSeekLoginPanel(false)}
        onHandleMessage={account.handleLoginMessage}
        onLoginFormMessage={credentials.handleCredentialLoginFormMessage}
        onNavigation={loginNavigation.nodeseek}
        onRequestCredentialFill={() => credentials.openAccountLogin('nodeseek', true)}
        onSetLoading={view.setLoadingLoginPage}
        onWebViewState={account.recordNodeSeekLoginWebViewState}
      />
      <YaohuoLoginHost
        checking={view.checking}
        credentialAttempt={
          credentials.credentialFillAttempt?.site === 'yaohuo' ? credentials.credentialFillAttempt.attempt : 0
        }
        credentialFillPending={credentials.pendingCredentialFillSite === 'yaohuo'}
        credentialSaved={credentials.credentialSummaries.yaohuo.hasCredential}
        loginFormMode={credentials.credentialLoginSite === 'yaohuo'}
        loading={view.loadingYaohuoLoginPage}
        prompt={view.yaohuoLoginPrompt}
        session={accountSessionViewModels.yaohuo}
        styles={styles}
        visible={view.showYaohuoLoginPanel}
        webViewBlockMessage={blockedMessage}
        webViewRef={view.yaohuoWebViewRef}
        onCheck={() => {
          void account.checkYaohuoCookie();
        }}
        onClear={() => {
          void account.clearYaohuoLogin();
        }}
        onClose={() => view.changeYaohuoLoginPanel(false)}
        onLoginFormMessage={credentials.handleCredentialLoginFormMessage}
        onNavigation={loginNavigation.yaohuo}
        onRequestCredentialFill={() => credentials.openAccountLogin('yaohuo', true)}
        onSetLoading={view.setLoadingYaohuoLoginPage}
        onWebViewState={account.recordYaohuoLoginWebViewState}
      />
    </>
  );
}
