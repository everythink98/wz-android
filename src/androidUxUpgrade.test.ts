import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const appSource = readProjectFile('android-app', 'App.tsx');
const appNavigatorSource = readProjectFile('android-app', 'src', 'app', 'AppNavigator.tsx');
const backupStatusControllerSource = readProjectFile('android-app', 'src', 'app', 'useBackupStatusController.ts');
const feedControllerSource = readProjectFile('android-app', 'src', 'app', 'useFeedController.ts');
const searchControllerSource = readProjectFile('android-app', 'src', 'app', 'useSearchController.ts');
const topicControllerSource = readProjectFile('android-app', 'src', 'app', 'useTopicController.ts');
const topicNavigationControllerSource = readProjectFile('android-app', 'src', 'app', 'useTopicNavigationController.ts');
const userControllerSource = readProjectFile('android-app', 'src', 'app', 'useUserController.ts');
const verificationControllerSource = readProjectFile('android-app', 'src', 'app', 'useVerificationController.ts');
const linuxDoVerifyModalSource = readProjectFile('android-app', 'src', 'app', 'LinuxDoVerifyModal.tsx');
const appControlsSource = readProjectFile('android-app', 'src', 'components', 'AppControls.tsx');
const feedScreenSource = readProjectFile('android-app', 'src', 'screens', 'FeedScreen.tsx');
const topicScreenSource = readProjectFile('android-app', 'src', 'screens', 'TopicScreen.tsx');
const searchScreenSource = readProjectFile('android-app', 'src', 'screens', 'SearchScreen.tsx');
const searchListItemsSource = readProjectFile('android-app', 'src', 'searchListItems.ts');
const moreScreenSource = readProjectFile('android-app', 'src', 'screens', 'MoreScreen.tsx');
const morePanelsSource = readProjectFile('android-app', 'src', 'screens', 'more', 'MorePanels.tsx');
const packageSource = readProjectFile('android-app', 'package.json');
const babelSource = readProjectFile('android-app', 'babel.config.js');
const appConfigSource = readProjectFile('android-app', 'app.json');

describe('Android App UX upgrade guards', () => {
  it('uses the mature navigation, pager, gesture, animation, safe-area, and feedback dependencies', () => {
    const dependencies = JSON.parse(packageSource).dependencies;

    expect(dependencies).toHaveProperty('@react-navigation/native');
    expect(dependencies).toHaveProperty('@react-navigation/native-stack');
    expect(dependencies).toHaveProperty('@react-navigation/bottom-tabs');
    expect(dependencies).toHaveProperty('react-native-screens');
    expect(dependencies).toHaveProperty('react-native-safe-area-context');
    expect(dependencies).toHaveProperty('react-native-gesture-handler');
    expect(dependencies).toHaveProperty('react-native-tab-view');
    expect(dependencies).toHaveProperty('react-native-pager-view');
    expect(dependencies).toHaveProperty('react-native-reanimated');
    expect(dependencies).toHaveProperty('react-native-worklets');
    expect(dependencies).toHaveProperty('expo-haptics');
    expect(babelSource).toContain('react-native-reanimated/plugin');
    expect(JSON.parse(appConfigSource).expo.newArchEnabled).toBe(true);
    expect(JSON.parse(packageSource).scripts['release:android']).toContain('-PnewArchEnabled=true');
  });

  it('hosts the app in React Navigation with bottom tabs and a standard stack for detail screens', () => {
    expect(appSource).toContain("import 'react-native-gesture-handler';");
    expect(appSource).toContain('<AppNavigator');
    expect(appNavigatorSource).toContain('NavigationContainer');
    expect(appNavigatorSource).toContain('createNativeStackNavigator');
    expect(appNavigatorSource).toContain('createBottomTabNavigator');
    expect(appNavigatorSource).toContain('Stack.Navigator');
    expect(appNavigatorSource).toContain('Tab.Navigator');
    expect(appSource).toContain("StackActions.push('Topic')");
    expect(appSource).toContain("StackActions.push('User')");
  });

  it('uses native stack background, slide transitions, and topic history for detail returns', () => {
    expect(appSource).toContain('const navigationTheme = useMemo');
    expect(appSource).toContain('navigationTheme={navigationTheme}');
    expect(appNavigatorSource).toContain('<NavigationContainer ref={navigationRef} theme={navigationTheme}');
    expect(appNavigatorSource).toContain("animation: 'slide_from_right'");
    expect(appNavigatorSource).toContain('contentStyle: { backgroundColor: theme.background }');
    expect(appSource).toContain('topicBackStackRef');
    expect(topicControllerSource).toContain('const nextTopicKey = topicKey(topic);');
    expect(topicControllerSource).toContain('const activeTopicKey = currentTopicKeyRef.current || (reopenExistingTopicScreen && selectedTopic ? topicKey(selectedTopic) : null);');
    expect(topicControllerSource).toContain('const opensDifferentTopic = nextTopicKey !== activeTopicKey;');
    expect(topicControllerSource).toContain("} else if (opensDifferentTopic) {");
    expect(topicControllerSource).toContain('pushTopicSession(');
    expect(topicControllerSource).toContain('topicSessionFromSnapshot(topicSnapshot())');
    expect(appSource).toContain('restoreTopicSnapshot(previousTopic);');
    expect(appSource).toContain('navigationRef.goBack();');
  });

  it('keeps topic history stable after visiting user pages or refreshing the same topic', () => {
    const changeScreenBlock = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const openTopicBlock = topicControllerSource.match(/const openTopic = useCallback[\s\S]*?\n\n  const refreshTopicReplies/)?.[0] || '';
    const openUserBlock = userControllerSource.match(/const openUser = useCallback[\s\S]*?\n\n  const loadMoreUserTopics/)?.[0] || '';
    const prepareUserNavigationBlock = appSource.match(/const prepareUserNavigation = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const goBackFromTopicBlock = appSource.match(/const goBackFromTopic = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const goBackFromUserBlock = appSource.match(/const goBackFromUser = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const restoreTopicSnapshotBlock = topicNavigationControllerSource.match(/const restoreTopicSnapshot = useCallback\(\(snapshot: TopicSnapshot\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('userReturnTopicRef');
    expect(appSource).toContain('returnScreen: Exclude<Screen,');
    expect(changeScreenBlock).toContain("const leavingTopicForUser = screen === 'topic' && nextScreen === 'user';");
    expect(changeScreenBlock).toContain('if (leavingTopicForUser) {');
    expect(changeScreenBlock).toContain('topicAbortRef.current?.abort();');
    expect(changeScreenBlock).toContain('setTopicBusy(false);');
    expect(changeScreenBlock).toContain("if (nextScreen !== 'topic' && !leavingTopicForUser) {");
    expect(openTopicBlock).toContain('topicBackStackRef.current = [];');
    expect(openTopicBlock).toContain('const reopenExistingTopicScreen = reopenExistingTopicScreenRef.current;');
    expect(openTopicBlock).toContain("if (screen !== 'topic' && !reopenExistingTopicScreen) {");
    expect(openTopicBlock).toMatch(/if \(!reopenExistingTopicScreen\) \{\s*changeScreen\('topic'\);/);
    expect(openUserBlock).toContain('onOpenUserScreen();');
    expect(prepareUserNavigationBlock).toContain("if (screen === 'topic') {");
    expect(prepareUserNavigationBlock).toContain('userReturnTopicRef.current = {');
    expect(prepareUserNavigationBlock).toContain('returnScreen: topicReturnScreenRef.current');
    expect(goBackFromTopicBlock).toContain('const canGoBack = navigationRef.isReady() && navigationRef.canGoBack();');
    expect(goBackFromTopicBlock).toContain('if (canGoBack) {');
    expect(goBackFromUserBlock).toContain('const returnTopic = userReturnScreenRef.current ===');
    expect(goBackFromUserBlock).toContain('topicReturnScreenRef.current = returnTopic.returnScreen;');
    expect(goBackFromUserBlock).toContain('topicBackStackRef.current = [...returnTopic.backStack];');
    expect(goBackFromUserBlock).toContain('const canGoBack = navigationRef.isReady() && navigationRef.canGoBack();');
    expect(goBackFromUserBlock).toContain('const shouldReloadRestoredTopic = Boolean(returnTopic?.snapshot.selectedTopic && !returnTopic.snapshot.topicDetail && !returnTopic.snapshot.topicError);');
    expect(goBackFromUserBlock).toContain('reopenExistingTopicScreenRef.current = true;');
    expect(goBackFromUserBlock).toContain('const selectedReturnTopic = returnTopic.snapshot.selectedTopic;');
    expect(goBackFromUserBlock).toContain('void openTopic(selectedReturnTopic);');
    expect(restoreTopicSnapshotBlock).toContain('restoredTopic ? topicKey(restoredTopic) : null');
  });

  it('preserves the current topic state when a topic links to itself', () => {
    const openTopicBlock = topicControllerSource.match(/const openTopic = useCallback[\s\S]*?\n\n  const refreshTopicReplies/)?.[0] || '';
    const sameTopicGuardIndex = openTopicBlock.indexOf("if (screen === 'topic' && !reopenExistingTopicScreen && !opensDifferentTopic && !nocache) {");

    expect(sameTopicGuardIndex).toBeGreaterThanOrEqual(0);
    expect(openTopicBlock).toContain('return;');
    expect(sameTopicGuardIndex).toBeLessThan(openTopicBlock.indexOf('const requestId = ++topicRequestIdRef.current;'));
  });

  it('restores the previous topic replies before popping nested topic routes', () => {
    const goBackFromTopicBlock = appSource.match(/const goBackFromTopic = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const previousTopicBranch = goBackFromTopicBlock.match(/if \(previousTopic\) \{[\s\S]*?\n      return;\n    \}/)?.[0] || '';

    expect(previousTopicBranch).toContain('restoreTopicSnapshot(previousTopic);\n      if (canGoBack) {');
    expect(previousTopicBranch.indexOf('restoreTopicSnapshot(previousTopic);')).toBeLessThan(previousTopicBranch.indexOf('navigationRef.goBack();'));
    expect(previousTopicBranch).not.toContain('runAfterNavigationInteractions(restorePreviousTopic);');
  });

  it('keeps reply draft state in topic snapshots when returning from nested topics', () => {
    const appTypesSource = readProjectFile('android-app', 'src', 'appTypes.ts');
    const topicSessionSource = readProjectFile('android-app', 'src', 'topicSessionState.ts');
    const topicSnapshotBlock = topicNavigationControllerSource.match(/const topicSnapshot = useCallback\(\(\): TopicSnapshot => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const restoreTopicSnapshotBlock = topicNavigationControllerSource.match(/const restoreTopicSnapshot = useCallback\(\(snapshot: TopicSnapshot\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appTypesSource).toContain('replyContent: string;');
    expect(appTypesSource).toContain('replyComposerOpen: boolean;');
    expect(appTypesSource).toContain('replyTarget: ReplyTarget | null;');
    expect(topicSessionSource).toContain('replyContent: session.replyContent');
    expect(topicSessionSource).toContain('replyComposerOpen: session.replyComposerOpen');
    expect(topicSessionSource).toContain('replyTarget: session.replyTarget');
    expect(topicSnapshotBlock).toContain('replyContent,');
    expect(topicSnapshotBlock).toContain('replyComposerOpen,');
    expect(topicSnapshotBlock).toContain('replyTarget');
    expect(restoreTopicSnapshotBlock).toContain('setReplyContent(session.replyContent);');
    expect(restoreTopicSnapshotBlock).toContain('setReplyComposerOpen(session.replyComposerOpen);');
    expect(restoreTopicSnapshotBlock).toContain('setReplyTarget(session.replyTarget);');
  });

  it('keeps linux.do quote expansion state in topic snapshots when returning from nested topics', () => {
    const appTypesSource = readProjectFile('android-app', 'src', 'appTypes.ts');
    const topicSessionSource = readProjectFile('android-app', 'src', 'topicSessionState.ts');
    const topicSnapshotBlock = topicNavigationControllerSource.match(/const topicSnapshot = useCallback\(\(\): TopicSnapshot => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const restoreTopicSnapshotBlock = topicNavigationControllerSource.match(/const restoreTopicSnapshot = useCallback\(\(snapshot: TopicSnapshot\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appTypesSource).toContain('expandedQuotes: Record<string, boolean>;');
    expect(appTypesSource).toContain('loadedQuotedReplies: Record<number, Reply>;');
    expect(appTypesSource).toContain('loadingQuotedFloors: Record<string, boolean>;');
    expect(topicSessionSource).toContain('expandedQuotes: session.expandedQuotes');
    expect(topicSessionSource).toContain('loadedQuotedReplies: session.loadedQuotedReplies');
    expect(topicSessionSource).toContain('loadingQuotedFloors: session.loadingQuotedFloors');
    expect(topicSnapshotBlock).toContain('expandedQuotes: expandedQuotesRef.current,');
    expect(topicSnapshotBlock).toContain('loadedQuotedReplies: loadedQuotedRepliesRef.current,');
    expect(topicSnapshotBlock).toContain('loadingQuotedFloors: {}');
    expect(restoreTopicSnapshotBlock).toContain('expandedQuotesRef.current = session.expandedQuotes;');
    expect(restoreTopicSnapshotBlock).toContain('loadedQuotedRepliesRef.current = session.loadedQuotedReplies;');
    expect(restoreTopicSnapshotBlock).toContain('loadingQuotedFloorsRef.current = {};');
    expect(restoreTopicSnapshotBlock).toContain('setQuoteStateVersion((current) => current + 1);');
  });

  it('defers leaving topic screens until native return animations finish', () => {
    const goBackFromTopicBlock = appSource.match(/const goBackFromTopic = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const goBackFromUserBlock = appSource.match(/const goBackFromUser = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('InteractionManager');
    expect(appSource).toContain('runAfterNavigationInteractions');
    expect(appSource).toContain('flushDeferredNavigationTask');
    expect(appSource).toContain('onTopicClosing={flushDeferredNavigationTask}');
    expect(appSource).toContain('onUserClosing={flushDeferredNavigationTask}');
    expect(appNavigatorSource).toContain('transitionEnd');
    expect(appNavigatorSource).toContain('freezeOnBlur: true');
    expect(goBackFromTopicBlock).toContain('runAfterNavigationInteractions(() => changeScreen(topicReturnScreenRef.current));');
    expect(goBackFromUserBlock).toContain('runAfterNavigationInteractions(restoreReturnTopic);');
  });

  it('keeps linux.do verification checks from auto-returning to the old topic', () => {
    const checkLinuxDoCookieBlock = verificationControllerSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(checkLinuxDoCookieBlock).toContain('linuxDoPendingTopicVerifiedRef.current = Boolean(pendingLinuxDoTopicRef.current);');
    expect(checkLinuxDoCookieBlock).not.toContain('const returnScreen = topicReturnScreenRef.current;');
    expect(checkLinuxDoCookieBlock).not.toContain('const backStack = [...topicBackStackRef.current];');
    expect(checkLinuxDoCookieBlock).not.toContain('reopenExistingTopicScreenRef.current = true;');
    expect(checkLinuxDoCookieBlock).not.toContain('navigationRef.goBack();');
    expect(checkLinuxDoCookieBlock).not.toContain("setScreen('topic');");
    expect(checkLinuxDoCookieBlock).not.toContain('await openTopic(pendingTopic, true);');
  });

  it('applies the one-time linux.do verified retry guard to reply refresh paths', () => {
    const cloudflareHandlerBlock = verificationControllerSource.match(/const handleLinuxDoCloudflareForTopic = useCallback\(async \(topic: Topic, message: string\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const refreshRepliesBlock = topicControllerSource.match(/const refreshTopicReplies = useCallback[\s\S]*?\n\n  const loadMoreReplies/)?.[0] || '';
    const loadMoreRepliesBlock = topicControllerSource.match(/const loadMoreReplies = useCallback[\s\S]*?\n\n  const refreshTopic/)?.[0] || '';
    const toggleQuotedFloorBlock = topicControllerSource.match(/const toggleQuotedFloor = useCallback[\s\S]*?\n\n  return/)?.[0] || '';

    expect(cloudflareHandlerBlock).toContain('linuxDoVerifiedRetryTopicKeyRef.current === requestTopicKey');
    expect(cloudflareHandlerBlock).toContain('linuxDoPendingTopicVerifiedRef.current = false;');
    expect(cloudflareHandlerBlock).toContain('showLinuxDoVerification(message);');
    for (const block of [refreshRepliesBlock, loadMoreRepliesBlock]) {
      expect(block).toContain('await handleLinuxDoCloudflareForTopic(detail, errorMessage(error));');
      expect(block).not.toContain('showLinuxDoVerification(errorMessage(error));');
    }
    expect(toggleQuotedFloorBlock).toContain('fetcher,');
    expect(toggleQuotedFloorBlock).toContain('await handleLinuxDoCloudflareForTopic(detail, errorMessage(error));');
    expect(toggleQuotedFloorBlock).toContain('fetcher,');
  });

  it('keeps feed source tabs on the component-library pager above one stable feed list', () => {
    expect(feedScreenSource).toContain("from 'react-native-tab-view'");
    expect(feedScreenSource).toContain('TabView');
    expect(feedScreenSource).toContain('renderScene={renderFeedScene}');
    expect(feedScreenSource).toContain('renderTabBar={() => null}');
    expect(feedScreenSource).toContain('onIndexChange={changeFeedSourceAtIndex}');
    expect(feedScreenSource).toContain('styles.feedFixedHeader');
    expect(feedScreenSource).toContain('styles.feedPager');
    expect(feedScreenSource).toContain('listRef');
    expect(feedScreenSource).toContain('scrollFeedToTop');
    expect(feedScreenSource).toContain('refreshControl={');
    expect(feedScreenSource).not.toContain('ListHeaderComponent={header}');
    expect(feedScreenSource).not.toContain('PanGestureHandler');
    expect(feedScreenSource).not.toContain('PanResponder');
  });

  it('makes search source result groups discoverable and collapsible', () => {
    expect(appControlsSource).toContain('ExpandablePanel');
    expect(appControlsSource).toContain('useAnimatedStyle');
    expect(appControlsSource).toContain('withTiming');
    expect(searchScreenSource).toContain('expandedSearchGroups');
    expect(searchScreenSource).toContain('toggleSearchGroup');
    expect(searchScreenSource).toContain('styles.searchGroupHeader');
    expect(searchScreenSource).toContain('accessibilityState={{ expanded: item.expanded }}');
    expect(searchScreenSource).not.toContain('<ExpandablePanel');
    expect(searchScreenSource).toContain('!item.expanded');
    expect(searchScreenSource).toContain('buildSearchListItems');
    expect(searchListItemsSource).toContain("type: 'groupLoadMore'");
  });

  it('does not cap expanded panel content with a fixed height', () => {
    expect(appControlsSource).not.toContain('maxHeight: withTiming(panelExpanded ? 6000 : 0');
    expect(appControlsSource).toContain("display: panelExpanded ? 'flex' : 'none'");
  });

  it('makes More screen sections explicit collapsible panels and renders WebViews only when opened', () => {
    expect(moreScreenSource).toContain('<ExpandablePanel');
    expect(moreScreenSource).toContain('title="备份 / 恢复"');
    expect(moreScreenSource).toContain('title="账号与验证"');
    expect(moreScreenSource).toContain('title="外观"');
    expect(moreScreenSource).toContain('title="状态检查"');
    expect(morePanelsSource).toContain('showLoginPanel && accountExpanded');
    expect(morePanelsSource).toContain('showYaohuoLoginPanel && accountExpanded');
    expect(linuxDoVerifyModalSource).toContain('showLinuxDoPanel && mountLinuxDoWebView');
  });

  it('recovers when a floor directory jump targets an unmeasured reply row', () => {
    expect(topicScreenSource).toContain('handleTopicScrollToIndexFailed');
    expect(topicScreenSource).toContain('onScrollToIndexFailed={handleTopicScrollToIndexFailed}');
    expect(topicScreenSource).toContain('topicScrollRef.current?.scrollToOffset({ offset, animated: true });');
    expect(topicScreenSource).toContain('topicScrollRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.08 });');
  });

  it('cancels stale floor directory retry jumps when the topic list changes', () => {
    expect(topicScreenSource).toContain('const topicScrollRetryIdRef = useRef(0);');
    expect(topicScreenSource).toContain('const retryId = ++topicScrollRetryIdRef.current;');
    expect(topicScreenSource).toContain('if (topicScrollRetryIdRef.current !== retryId) {');
    expect(topicScreenSource).toContain('topicScrollRetryIdRef.current += 1;');
  });

  it('uses one request ownership model for stale Android controller results', () => {
    for (const source of [
      backupStatusControllerSource,
      feedControllerSource,
      searchControllerSource,
      topicControllerSource,
      userControllerSource
    ]) {
      expect(source).toContain('isCurrentOwnedRequest');
      expect(source).toContain('startOwnedRequest');
    }
    expect(backupStatusControllerSource).toContain('const isCurrentBackupRequest =');
    expect(backupStatusControllerSource).toContain('const isCurrentStatusRequest =');
    expect(feedControllerSource).toContain('const isCurrentFeedRequest =');
    expect(searchControllerSource).toContain('const isCurrentSearchRequest =');
    expect(searchControllerSource).toContain('isCurrent: () => isCurrentSearchRequest()');
    expect(searchControllerSource).toContain('options?.isCurrent?.() !== false');
    expect(topicControllerSource).toContain('const isCurrentTopicRequest =');
    expect(topicControllerSource).toContain('const isCurrentRepliesRequest =');
    expect(userControllerSource).toContain('const isCurrentUserRequest =');
  });
});
