import type { LoginNavigationRequest } from '@/domain/session/loginNavigation';
import type { StyleProp, ViewStyle } from 'react-native';
import type { LoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { AccountHost } from './AccountHost';
import { HiddenBrowserHost } from './HiddenBrowserHost';
import type { useAccountRuntime } from './useAccountRuntime';

type AccountRuntime = ReturnType<typeof useAccountRuntime>;

export function AccountHosts({
  blockedMessage,
  loginNavigation,
  runtime,
  styles,
  theme
}: {
  blockedMessage: string;
  loginNavigation: Record<'linuxdo' | 'nodeimage', (request: LoginNavigationRequest) => boolean>;
  runtime: AccountRuntime;
  styles: LoginWebViewStyles & {
    hiddenBrowserWebView: StyleProp<ViewStyle>;
    hiddenBrowserWebViewHost: StyleProp<ViewStyle>;
  };
  theme: ReaderTheme;
}) {
  const { accountSessionViewModels } = runtime.read;
  const { account, checking, credentials, nodeImage } = runtime.center;
  const hosts = runtime.hosts;

  return (
    <>
      <HiddenBrowserHost
        blockedMessage={blockedMessage}
        failLinuxDoBrowserFetchById={hosts.failLinuxDoBrowserFetchById}
        failNodeSeekBrowserFetchById={hosts.failNodeSeekBrowserFetchById}
        handleLinuxDoBrowserFetchMessage={hosts.handleLinuxDoBrowserFetchMessage}
        handleNodeSeekBrowserFetchMessage={hosts.handleNodeSeekBrowserFetchMessage}
        linuxDoBrowserWebViewRef={hosts.linuxDoBrowserWebViewRef}
        nodeSeekBrowserWebViewRef={hosts.nodeSeekBrowserWebViewRef}
        state={{
          linuxDo: {
            request: hosts.hiddenBrowserFetchRequests.linuxDo,
            userAgent: hosts.linuxDoWebViewUserAgent
          },
          nodeSeek: {
            request: hosts.hiddenBrowserFetchRequests.nodeSeek,
            userAgent: hosts.nodeSeekWebViewUserAgent
          }
        }}
        styles={styles}
        onLinuxDoHttpErrorStatus={hosts.markLinuxDoBrowserFetchHttpError}
        onNodeSeekHttpErrorStatus={hosts.markNodeSeekBrowserFetchHttpError}
      />
      <AccountHost
        checking={checking}
        credentialFillAttempt={
          credentials.credentialFillAttempt?.site === 'linuxdo' ? credentials.credentialFillAttempt.attempt : 0
        }
        credentialFillPending={credentials.pendingCredentialFillSite === 'linuxdo'}
        checkLinuxDoCookie={hosts.verification.checkLinuxDoCookie}
        clearLinuxDoCookie={() => {
          void account.clearLinuxDoCookie();
        }}
        handleLinuxDoMessage={hosts.verification.handleLinuxDoMessage}
        handleLinuxDoNavigation={loginNavigation.linuxdo}
        handleCredentialLoginFormMessage={credentials.handleCredentialLoginFormMessage}
        handleNodeImageAuthMessage={nodeImage.panel.handleMessage}
        handleNodeImageAuthNavigation={loginNavigation.nodeimage}
        linuxDoCredentialSaved={credentials.credentialSummaries.linuxdo.hasCredential}
        linuxDoLoginFormMode={credentials.credentialLoginSite === 'linuxdo'}
        linuxDoSession={accountSessionViewModels.linuxdo}
        linuxDoWebViewError={hosts.linuxDoWebViewError}
        linuxDoWebViewKey={hosts.linuxDoWebViewKey}
        linuxDoWebViewRef={hosts.linuxDoWebViewRef}
        loadingLinuxDoPage={hosts.loadingLinuxDoPage}
        loadingNodeImageAuthPage={nodeImage.panel.loading}
        mountLinuxDoWebView={hosts.mountLinuxDoWebView}
        nodeImageAuthDocument={nodeImage.panel.document}
        nodeImageAuthError={nodeImage.panel.error}
        nodeImageAuthWebViewRef={nodeImage.panel.webViewRef}
        resetLinuxDoWebView={hosts.verification.resetLinuxDoWebView}
        setLinuxDoWebViewErrorForSession={hosts.verification.setLinuxDoWebViewErrorForSession}
        setLoadingLinuxDoPageForSession={hosts.verification.setLoadingLinuxDoPageForSession}
        setLoadingNodeImageAuthPage={nodeImage.panel.setLoading}
        setNodeImageAuthError={nodeImage.panel.fail}
        showLinuxDoPanel={hosts.showLinuxDoPanel}
        showNodeImageAuthPanel={nodeImage.panel.visible}
        styles={styles}
        theme={theme}
        webViewBlockMessage={blockedMessage}
        changeLinuxDoPanel={hosts.verification.changeLinuxDoPanel}
        requestLinuxDoCredentialFill={() => credentials.openAccountLogin('linuxdo', true)}
        closeNodeImageAuthPanel={nodeImage.panel.close}
      />
    </>
  );
}
