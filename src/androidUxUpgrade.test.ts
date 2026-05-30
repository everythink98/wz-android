import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const appSource = readProjectFile('android-app', 'App.tsx');
const appControlsSource = readProjectFile('android-app', 'src', 'components', 'AppControls.tsx');
const feedScreenSource = readProjectFile('android-app', 'src', 'screens', 'FeedScreen.tsx');
const searchScreenSource = readProjectFile('android-app', 'src', 'screens', 'SearchScreen.tsx');
const searchListItemsSource = readProjectFile('android-app', 'src', 'searchListItems.ts');
const moreScreenSource = readProjectFile('android-app', 'src', 'screens', 'MoreScreen.tsx');
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
    expect(appSource).toContain('NavigationContainer');
    expect(appSource).toContain('createNativeStackNavigator');
    expect(appSource).toContain('createBottomTabNavigator');
    expect(appSource).toContain('Stack.Navigator');
    expect(appSource).toContain('Tab.Navigator');
    expect(appSource).toContain("StackActions.push('Topic')");
    expect(appSource).toContain("StackActions.push('User')");
  });

  it('uses native stack background, slide transitions, and topic history for detail returns', () => {
    expect(appSource).toContain('const navigationTheme = useMemo');
    expect(appSource).toContain('<NavigationContainer ref={navigationRef} theme={navigationTheme}');
    expect(appSource).toContain("animation: 'slide_from_right'");
    expect(appSource).toContain('contentStyle: { backgroundColor: theme.background }');
    expect(appSource).toContain('topicBackStackRef');
    expect(appSource).toContain('const currentTopicKey = currentTopicKeyRef.current || (reopenExistingTopicScreen && selectedTopic ? topicKey(selectedTopic) : null);');
    expect(appSource).toContain('const opensDifferentTopic = topicKey(topic) !== currentTopicKey;');
    expect(appSource).toContain("} else if (opensDifferentTopic) {");
    expect(appSource).toContain('topicBackStackRef.current.push(topicSnapshot());');
    expect(appSource).toContain('restoreTopicSnapshot(previousTopic);');
    expect(appSource).toContain('navigationRef.goBack();');
  });

  it('keeps topic history stable after visiting user pages or refreshing the same topic', () => {
    const changeScreenBlock = appSource.match(/const changeScreen = useCallback\(\(nextScreen: Screen\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const openTopicBlock = appSource.match(/const openTopic = useCallback\(async \(topic: Topic, nocache = false\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const openUserBlock = appSource.match(/const openUser = useCallback\(async \(user: UserProfile, nocache = false\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const goBackFromTopicBlock = appSource.match(/const goBackFromTopic = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const goBackFromUserBlock = appSource.match(/const goBackFromUser = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const restoreTopicSnapshotBlock = appSource.match(/const restoreTopicSnapshot = useCallback\(\(snapshot: TopicSnapshot\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

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
    expect(openUserBlock).toContain("if (screen === 'topic') {");
    expect(openUserBlock).toContain('userReturnTopicRef.current = {');
    expect(openUserBlock).toContain('returnScreen: topicReturnScreenRef.current');
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

  it('defers heavy topic restore work until native return animations finish', () => {
    const goBackFromTopicBlock = appSource.match(/const goBackFromTopic = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';
    const goBackFromUserBlock = appSource.match(/const goBackFromUser = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(appSource).toContain('InteractionManager');
    expect(appSource).toContain('runAfterNavigationInteractions');
    expect(appSource).toContain('flushDeferredNavigationTask');
    expect(appSource).toContain('transitionEnd');
    expect(appSource).toContain('freezeOnBlur: true');
    expect(goBackFromTopicBlock).toContain('runAfterNavigationInteractions(restorePreviousTopic);');
    expect(goBackFromTopicBlock).toContain('runAfterNavigationInteractions(() => changeScreen(topicReturnScreenRef.current));');
    expect(goBackFromUserBlock).toContain('runAfterNavigationInteractions(restoreReturnTopic);');
  });

  it('keeps linux.do verification checks from auto-returning to the old topic', () => {
    const checkLinuxDoCookieBlock = appSource.match(/const checkLinuxDoCookie = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] || '';

    expect(checkLinuxDoCookieBlock).toContain('linuxDoPendingTopicVerifiedRef.current = Boolean(pendingLinuxDoTopicRef.current);');
    expect(checkLinuxDoCookieBlock).not.toContain('const returnScreen = topicReturnScreenRef.current;');
    expect(checkLinuxDoCookieBlock).not.toContain('const backStack = [...topicBackStackRef.current];');
    expect(checkLinuxDoCookieBlock).not.toContain('reopenExistingTopicScreenRef.current = true;');
    expect(checkLinuxDoCookieBlock).not.toContain('navigationRef.goBack();');
    expect(checkLinuxDoCookieBlock).not.toContain("setScreen('topic');");
    expect(checkLinuxDoCookieBlock).not.toContain('await openTopic(pendingTopic, true);');
  });

  it('applies the one-time linux.do verified retry guard to reply refresh paths', () => {
    const refreshRepliesBlock = appSource.match(/const refreshTopicReplies = useCallback\(async[\s\S]*?\n  \}, \[clearYaohuoLoginState/)?.[0] || '';
    const loadMoreRepliesBlock = appSource.match(/const loadMoreReplies = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[clearYaohuoLoginState/)?.[0] || '';

    for (const block of [refreshRepliesBlock, loadMoreRepliesBlock]) {
      const guardIndex = block.indexOf('linuxDoVerifiedRetryTopicKeyRef.current === requestTopicKey');
      const verifyIndex = block.indexOf('showLinuxDoVerification(errorMessage(error));');

      expect(guardIndex).toBeGreaterThan(-1);
      expect(verifyIndex).toBeGreaterThan(-1);
      expect(guardIndex).toBeLessThan(verifyIndex);
      expect(block).toContain('linuxDoPendingTopicVerifiedRef.current = false;');
    }
  });

  it('uses native pager tabs for the feed and keeps both tab rows outside the scrolling list', () => {
    expect(feedScreenSource).toContain("from 'react-native-tab-view'");
    expect(feedScreenSource).toContain('TabView');
    expect(feedScreenSource).toContain('renderTabBar={() => null}');
    expect(feedScreenSource).toContain('styles.feedFixedHeader');
    expect(feedScreenSource).toContain('styles.feedPager');
    expect(feedScreenSource).toContain('listRefs');
    expect(feedScreenSource).toContain('scrollFeedToTop');
    expect(feedScreenSource).toContain('onRefreshPress');
    expect(feedScreenSource).not.toContain('ListHeaderComponent={header}');
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
    expect(moreScreenSource).toContain('showLoginPanel && accountExpanded');
    expect(moreScreenSource).toContain('showYaohuoLoginPanel && accountExpanded');
    expect(moreScreenSource).toContain('showLinuxDoPanel && accountExpanded');
  });
});
