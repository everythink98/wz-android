import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');
const appControlsSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'components', 'AppControls.tsx'), 'utf8');
const feedScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'FeedScreen.tsx'), 'utf8');
const searchScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'SearchScreen.tsx'), 'utf8');
const moreScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'MoreScreen.tsx'), 'utf8');
const packageSource = readFileSync(join(process.cwd(), 'android-app', 'package.json'), 'utf8');
const babelSource = readFileSync(join(process.cwd(), 'android-app', 'babel.config.js'), 'utf8');
const appConfigSource = readFileSync(join(process.cwd(), 'android-app', 'app.json'), 'utf8');

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
    expect(appSource).toContain("navigationRef.navigate('Topic')");
    expect(appSource).toContain("navigationRef.navigate('User')");
  });

  it('uses native pager tabs for the feed and keeps both tab rows outside the scrolling list', () => {
    expect(feedScreenSource).toContain("from 'react-native-tab-view'");
    expect(feedScreenSource).toContain('TabView');
    expect(feedScreenSource).toContain('renderTabBar={() => null}');
    expect(feedScreenSource).toContain('styles.feedFixedHeader');
    expect(feedScreenSource).toContain('styles.feedPager');
    expect(feedScreenSource).toContain('listRefs');
    expect(feedScreenSource).toContain('scrollToFeedTop');
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
    expect(searchScreenSource).toContain('<ExpandablePanel');
    expect(searchScreenSource).toContain('defaultExpanded');
    expect(searchScreenSource).toContain('group.hasMore');
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
