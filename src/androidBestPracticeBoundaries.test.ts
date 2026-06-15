import { describe, expect, it } from 'vitest';
import { readAppRuntimeSource, readOptionalProjectFile, readProjectFile } from './sourceTestUtils';

const appEntrySource = readProjectFile('App.tsx');
const appSource = readAppRuntimeSource();
const appRootSource = readProjectFile('src', 'app', 'AppRoot.tsx');
const appShellSource = readProjectFile('src', 'app', 'AppShell.tsx');
const appScreenRenderersSource = readOptionalProjectFile('src', 'app', 'AppScreenRenderers.tsx');
const mainTabScrollToTopSource = readOptionalProjectFile('src', 'app', 'useMainTabScrollToTop.ts');
const accountControllerSource = readProjectFile('src', 'app', 'useAccountController.ts');
const backupStatusControllerSource = readProjectFile('src', 'app', 'useBackupStatusController.ts');
const feedControllerSource = readProjectFile('src', 'app', 'useFeedController.ts');
const globalModalHostSource = readProjectFile('src', 'app', 'GlobalModalHost.tsx');
const linuxDoVerifyModalSource = readOptionalProjectFile('src', 'app', 'LinuxDoVerifyModal.tsx');
const loginWebViewScriptsSource = readOptionalProjectFile('src', 'loginWebViewScripts.ts');
const moreScreenSource = readProjectFile('src', 'screens', 'MoreScreen.tsx');
const morePanelsSource = readProjectFile('src', 'screens', 'more', 'MorePanels.tsx');
const linuxDoLevelPanelSource = readProjectFile('src', 'screens', 'more', 'LinuxDoLevelPanel.tsx');
const readerDataActionsControllerSource = readOptionalProjectFile('src', 'app', 'useReaderDataActionsController.ts');
const searchControllerSource = readProjectFile('src', 'app', 'useSearchController.ts');
const sessionControllerSource = readProjectFile('src', 'app', 'useSessionController.ts');
const sessionControllerHelpersSource = readOptionalProjectFile('src', 'app', 'sessionControllerHelpers.ts');
const topicActionControllerHelpersSource = readOptionalProjectFile('src', 'app', 'topicActionControllerHelpers.ts');
const topicActionsControllerSource = readProjectFile('src', 'app', 'useTopicActionsController.ts');
const topicControllerSource = readProjectFile('src', 'app', 'useTopicController.ts');
const topicUiStateControllerSource = readOptionalProjectFile('src', 'app', 'useTopicUiStateController.ts');
const userControllerSource = readProjectFile('src', 'app', 'useUserController.ts');
const verificationControllerSource = readProjectFile('src', 'app', 'useVerificationController.ts');
const appReadControllerSources = {
  accountControllerSource,
  backupStatusControllerSource,
  feedControllerSource,
  searchControllerSource,
  topicControllerSource,
  userControllerSource
};
const appActionAndAccountRequestSources = {
  accountControllerSource,
  backupStatusControllerSource,
  topicActionsControllerSource
};

describe('Android best-practice boundary guards', () => {
  it('keeps App.tsx as a thin entry file', () => {
    expect(appEntrySource).toContain("import 'react-native-gesture-handler';");
    expect(appEntrySource).toContain("import 'expo-dev-client';");
    expect(appEntrySource).toContain("import { AppRoot } from './src/app/AppRoot';");
    expect(appEntrySource).toContain('export default AppRoot;');
    expect(appEntrySource).not.toContain('AppProviders');
    expect(appEntrySource).not.toContain('AppNavigator');
    expect(appEntrySource).not.toContain('HiddenBrowserHost');
    expect(appEntrySource).not.toContain('GlobalModalHost');
  });

  it('keeps root providers in a focused host', () => {
    const appProvidersSource = readOptionalProjectFile('src', 'app', 'AppProviders.tsx');

    expect(appProvidersSource).toContain('export function AppProviders');
    expect(appProvidersSource).toContain('GestureHandlerRootView');
    expect(appProvidersSource).toContain('SafeAreaProvider');
    expect(appProvidersSource).toContain('KeyboardAvoidingView');
    expect(appProvidersSource).toContain('SafeAreaView');
    expect(appProvidersSource).toContain("edges={['left', 'right', 'bottom']}");
    expect(appShellSource).toContain('<AppProviders');
  });

  it('keeps the Android top inset owned by screen headers only once', () => {
    const appProvidersSource = readOptionalProjectFile('src', 'app', 'AppProviders.tsx');
    const statusBarScrimMatches = appSource.match(/styles\.statusBarScrim/g) || [];

    expect(appProvidersSource).not.toContain("'top'");
    expect(statusBarScrimMatches).toHaveLength(1);
  });

  it('keeps hidden browser WebView rendering in a focused host', () => {
    const hiddenBrowserHostSource = readOptionalProjectFile('src', 'app', 'HiddenBrowserHost.tsx');

    expect(hiddenBrowserHostSource).toContain('export function HiddenBrowserHost');
    expect(hiddenBrowserHostSource).toContain('nodeseek-browser-fetch');
    expect(hiddenBrowserHostSource).toContain('linuxdo-browser-fetch');
    expect(appShellSource).toContain('<HiddenBrowserHost');
    expect(appShellSource).not.toContain('key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}');
    expect(appShellSource).not.toContain('key={`linuxdo-browser-fetch-${linuxDoBrowserFetchRequest.id}`}');
  });

  it('keeps global verification and preview modals in a focused host', () => {
    expect(globalModalHostSource).toContain('export function GlobalModalHost');
    expect(globalModalHostSource).toContain('MemoizedLinuxDoVerifyModal');
    expect(globalModalHostSource).toContain('ImagePreviewModal');
    expect(linuxDoVerifyModalSource).toContain('export function LinuxDoVerifyModal');
    expect(linuxDoVerifyModalSource).toContain('showLinuxDoPanel && mountLinuxDoWebView');
    expect(appShellSource).toContain('<GlobalModalHost');
    expect(appShellSource).not.toContain('<MemoizedLinuxDoVerifyModal');
    expect(appShellSource).not.toContain('<ImagePreviewModal');
  });

  it('keeps WebView probes and global verification outside More screen modules', () => {
    expect(loginWebViewScriptsSource).toContain('NODESEEK_LOGIN_PROBE_SCRIPT');
    expect(loginWebViewScriptsSource).toContain('LINUXDO_WEBVIEW_PROBE_SCRIPT');
    expect(globalModalHostSource).toContain("from './LinuxDoVerifyModal'");
    expect(accountControllerSource).toContain("from '../loginWebViewScripts'");
    expect(verificationControllerSource).toContain("from '../loginWebViewScripts'");
    expect(globalModalHostSource).not.toContain("from '../screens/more/MorePanels'");
    expect(accountControllerSource).not.toContain("from '../screens/more/MorePanels'");
    expect(verificationControllerSource).not.toContain("from '../screens/more/MorePanels'");
    expect(moreScreenSource).not.toContain('MemoizedLinuxDoVerifyModal');
    expect(morePanelsSource).not.toContain('MemoizedLinuxDoVerifyModal');
    expect(morePanelsSource).not.toContain('export function LinuxDoVerifyModal');
    expect(moreScreenSource).not.toContain('NODESEEK_LOGIN_PROBE_SCRIPT');
    expect(moreScreenSource).not.toContain('LINUXDO_WEBVIEW_PROBE_SCRIPT');
    expect(morePanelsSource).not.toContain('export const NODESEEK_LOGIN_PROBE_SCRIPT');
    expect(morePanelsSource).not.toContain('export const LINUXDO_WEBVIEW_PROBE_SCRIPT');
    expect(morePanelsSource).not.toContain('LINUXDO_WEBVIEW_PROBE_SCRIPT');
  });

  it('keeps navigation composition in a focused host', () => {
    const appNavigatorSource = readOptionalProjectFile('src', 'app', 'AppNavigator.tsx');

    expect(appNavigatorSource).toContain('export function AppNavigator');
    expect(appNavigatorSource).toContain('export function MainTabsHost');
    expect(appNavigatorSource).toContain('Tab.Navigator');
    expect(appNavigatorSource).toContain('Stack.Navigator');
    expect(appShellSource).toContain('<AppNavigator');
    expect(appShellSource).not.toContain('<Tab.Navigator');
    expect(appShellSource).not.toContain('<Stack.Navigator');
    expect(appNavigatorSource).not.toContain('activeScreen');
    expect(appShellSource).not.toContain('activeScreen={screen}');
  });

  it('keeps screen render composition outside AppRoot', () => {
    expect(appRootSource).toContain("from './AppScreenRenderers'");
    expect(appRootSource).toContain("from './useMainTabScrollToTop'");
    expect(appRootSource).toContain('useAppScreenRenderers({');
    expect(appRootSource).not.toContain('<FeedScreen');
    expect(appRootSource).not.toContain('<SearchScreen');
    expect(appRootSource).not.toContain('<LibraryScreen');
    expect(appRootSource).not.toContain('<MemoizedMoreScreen');
    expect(appRootSource).not.toContain('<TopicScreen');
    expect(appRootSource).not.toContain('<UserScreen');
    expect(appScreenRenderersSource).toContain('export function useAppScreenRenderers');
    expect(mainTabScrollToTopSource).toContain('export function useMainTabScrollToTop');
    expect(mainTabScrollToTopSource).toContain('moreScrollRef.current?.scrollTo');
  });

  it('keeps local reader data actions outside AppRoot', () => {
    expect(readerDataActionsControllerSource).toContain('export function useReaderDataActionsController');
    expect(appRootSource).toContain("from './useReaderDataActionsController'");
    expect(appRootSource).not.toContain('const updateSettings = useCallback');
    expect(appRootSource).not.toContain('const toggleTopicFavorite = useCallback');
    expect(appRootSource).not.toContain('const toggleUserFollow = useCallback');
    expect(appRootSource).not.toContain('const removeFollowedUser = useCallback');
    expect(appRootSource).not.toContain('const removeLibraryTopic = useCallback');
    expect(appRootSource).not.toContain('const clearHistory = useCallback');
  });

  it('keeps topic screen UI state details outside AppRoot', () => {
    expect(topicUiStateControllerSource).toContain('export function useTopicUiStateController');
    expect(appRootSource).toContain("from './useTopicUiStateController'");
    expect(appRootSource).not.toContain('const [replyFilter, setReplyFilter] = useState');
    expect(appRootSource).not.toContain('const [replyContent, setReplyContent] = useState');
    expect(appRootSource).not.toContain('const [commentQuery, setCommentQuery] = useState');
    expect(appRootSource).not.toContain('const [replyComposerOpen, setReplyComposerOpen] = useState');
    expect(appRootSource).not.toContain('const [replyTarget, setReplyTarget] = useState');
    expect(appRootSource).not.toContain('const [expandedQuotes, setExpandedQuotes] = useState');
    expect(appRootSource).not.toContain('const [loadedQuotedReplies, setLoadedQuotedReplies] = useState');
    expect(appRootSource).not.toContain('const [loadingQuotedFloors, setLoadingQuotedFloors] = useState');
    expect(appRootSource).not.toContain('const updateExpandedQuotes = useCallback');
    expect(appRootSource).not.toContain('const abortQuotedReplyRequests = useCallback');
    expect(appRootSource).not.toContain('const resetQuoteState = useCallback');
    expect(appRootSource).not.toContain('const filteredReplies = useMemo');
    expect(appRootSource).not.toContain('const toggleReplyComposer = useCallback');
    expect(appRootSource).not.toContain('const replyToFloor = useCallback');
  });

  it('keeps pure session helpers outside useSessionController', () => {
    for (const helper of [
      'requestHeaderValue',
      'nodeSeekBrowserResponse',
      'linuxDoBrowserResponse',
      'cleanupNodeSeekBrowserFetchRequest',
      'cleanupLinuxDoBrowserFetchRequest'
    ]) {
      expect(sessionControllerHelpersSource).toContain(`export function ${helper}`);
      expect(sessionControllerSource).not.toContain(`function ${helper}`);
    }
    expect(sessionControllerSource).toContain("from './sessionControllerHelpers'");
  });

  it('keeps pure topic action decisions outside useTopicActionsController', () => {
    for (const helper of [
      'currentTopicActionTopic',
      'canSubmitReplyToTopic',
      'canVotePollOnTopic',
      'isLinuxDoActionTopic',
      'isNodeSeekActionTopic',
      'isYaohuoActionTopic'
    ]) {
      expect(topicActionControllerHelpersSource).toContain(`export function ${helper}`);
      expect(topicActionsControllerSource).not.toContain(`function ${helper}`);
    }
    expect(topicActionControllerHelpersSource).toContain('export const YAOHUO_DEFAULT_CLASS_ID');
    expect(topicActionsControllerSource).toContain("from './topicActionControllerHelpers'");
    expect(topicActionsControllerSource).not.toContain("const YAOHUO_DEFAULT_CLASS_ID = '177'");
  });

  it('does not pass raw cookie headers through More screen props', () => {
    expect(moreScreenSource).not.toContain('yaohuoLoginCookieHeader');
    expect(moreScreenSource).not.toContain('linuxDoWebViewCookieHeader');
    expect(morePanelsSource).not.toContain('yaohuoLoginCookieHeader');
    expect(morePanelsSource).not.toContain('headers: yaohuoLoginCookieHeader ? { Cookie: yaohuoLoginCookieHeader } : undefined');
    expect(appSource).not.toContain('yaohuoLoginCookieHeader');
  });

  it('keeps linux.do verification WebView details out of the More tab panel entry', () => {
    const linuxDoEntryBlock = morePanelsSource.match(/export function LinuxDoVerifyPanel\([\s\S]*?\nexport const MemoizedLinuxDoVerifyPanel/)?.[0] || '';

    expect(linuxDoEntryBlock).toContain('MenuButton');
    expect(linuxDoEntryBlock).not.toContain('LoginWebViewModal');
    expect(linuxDoEntryBlock).not.toContain('linuxDoWebViewRef');
    expect(linuxDoEntryBlock).not.toContain('mountLinuxDoWebView');
    expect(linuxDoEntryBlock).not.toContain('onHandleLinuxDoMessage');
    expect(moreScreenSource).not.toContain('linuxDoWebViewRef');
    expect(moreScreenSource).not.toContain('mountLinuxDoWebView');
    expect(globalModalHostSource).toContain('linuxDoWebViewRef');
    expect(globalModalHostSource).toContain('mountLinuxDoWebView');
  });

  it('keeps app read flows behind the source gateway', () => {
    Object.values(appReadControllerSources).forEach((source) => {
      expect(source).toContain("from '../sources/sourceGateway'");
      expect(source).not.toContain("from '../forumApi'");
      expect(source).not.toContain("from '../yaohuoApi'");
    });
  });

  it('keeps app action and account requests behind the source gateway', () => {
    Object.values(appActionAndAccountRequestSources).forEach((source) => {
      expect(source).toContain("from '../sources/sourceGateway'");
      expect(source).not.toContain("from '../nodeseekActionClient'");
      expect(source).not.toContain("from '../linuxdoActionClient'");
      expect(source).not.toContain("from '../yaohuoActionClient'");
      expect(source).not.toContain("from '../linuxdoLevel'");
    });
  });

  it('keeps linux.do level types behind the source gateway in app and screen modules', () => {
    expect(appRootSource).toContain("from '../sources/sourceGateway'");
    expect(appRootSource).not.toContain("from '../linuxdoLevel'");
    expect(moreScreenSource).toContain("from '../sources/sourceGateway'");
    expect(moreScreenSource).not.toContain("from '../linuxdoLevel'");
    expect(linuxDoLevelPanelSource).toContain("from '../../sources/sourceGateway'");
    expect(linuxDoLevelPanelSource).not.toContain("from '../../linuxdoLevel'");
  });
});
