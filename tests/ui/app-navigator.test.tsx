import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  AppNavigator,
  navigateAppScreen,
  navigationRef,
  openReadingSettingsScreen,
  type MainTabParamList
} from '../../src/app/AppNavigator';
import { createEmptyReaderData } from '../../src/readerData';
import { createStyles, createTheme } from '../../src/theme';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Home: Icon, MoreHorizontal: Icon, Search: Icon, Star: Icon };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);

function StatefulTab({ label }: { label: string }) {
  const [value, setValue] = useState('');
  return (
    <View>
      <Text>{label}页面</Text>
      <TextInput accessibilityLabel={`${label}状态`} value={value} onChangeText={setValue} />
    </View>
  );
}

describe('App navigator UI state', () => {
  it('preserves tab state while pushing and popping nested Topic/User routes', async () => {
    const onReady = jest.fn();
    const onScreenChange = jest.fn();
    const onTabPress = jest.fn<(target: keyof MainTabParamList) => void>();
    const view = await render(
      <AppNavigator
        moreHasBadge
        navigationTheme={DefaultTheme}
        renderFeedTab={() => <StatefulTab label="首页" />}
        renderLibraryTab={() => <StatefulTab label="收藏" />}
        renderMoreTab={() => <StatefulTab label="更多" />}
        renderReadingSettingsScreen={() => <Text>阅读设置页面</Text>}
        renderSearchTab={() => <StatefulTab label="搜索" />}
        renderTopicScreen={() => <Text>主题详情页面</Text>}
        renderUserScreen={() => <Text>用户详情页面</Text>}
        styles={styles}
        theme={theme}
        onReady={onReady}
        onScreenChange={onScreenChange}
        onTabPress={onTabPress}
        onTopicClosing={jest.fn()}
        onUserClosing={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(view.getByText('首页页面')).toBeTruthy();
    });
    await fireEvent.changeText(view.getByLabelText('首页状态'), '保留首页输入');

    await fireEvent.press(view.getByTestId('main-tab-search'));
    await waitFor(() => expect(view.getByText('搜索页面')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('搜索状态'), '保留搜索输入');
    expect(onTabPress).toHaveBeenCalledWith('search');

    await act(async () => {
      expect(navigateAppScreen('topic')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('主题详情页面')).toBeTruthy());
    await act(async () => {
      expect(navigateAppScreen('user')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('用户详情页面')).toBeTruthy());

    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => expect(view.getByText('主题详情页面')).toBeTruthy());
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => {
      expect(view.getByLabelText('搜索状态').props.value).toBe('保留搜索输入');
    });

    await fireEvent.press(view.getByTestId('main-tab-feed'));
    await waitFor(() => {
      expect(view.getByLabelText('首页状态').props.value).toBe('保留首页输入');
    });
    expect(view.getByLabelText('更多，有可用更新')).toBeTruthy();
  });

  it.each(['feed', 'search'] as const)('keeps the fixed %s → Topic → User → Topic return stack', async (origin) => {
    const view = await render(
      <AppNavigator
        moreHasBadge={false}
        navigationTheme={DefaultTheme}
        renderFeedTab={() => <StatefulTab label="首页" />}
        renderLibraryTab={() => <StatefulTab label="收藏" />}
        renderMoreTab={() => <StatefulTab label="更多" />}
        renderReadingSettingsScreen={() => <Text>阅读设置页面</Text>}
        renderSearchTab={() => <StatefulTab label="搜索" />}
        renderTopicScreen={() => <Text>固定主题 topic-42</Text>}
        renderUserScreen={() => <Text>固定用户 alice</Text>}
        styles={styles}
        theme={theme}
        onReady={jest.fn()}
        onScreenChange={jest.fn()}
        onTabPress={jest.fn()}
        onTopicClosing={jest.fn()}
        onUserClosing={jest.fn()}
      />
    );
    const originLabel = origin === 'feed' ? '首页' : '搜索';

    await waitFor(() => expect(view.getByText('首页页面')).toBeTruthy());
    if (origin === 'search') {
      await fireEvent.press(view.getByTestId('main-tab-search'));
      await waitFor(() => expect(view.getByText('搜索页面')).toBeTruthy());
    }
    await fireEvent.changeText(view.getByLabelText(`${originLabel}状态`), `${origin}-state`);

    await act(async () => { expect(navigateAppScreen('topic')).toBe(true); });
    await waitFor(() => expect(view.getByText('固定主题 topic-42')).toBeTruthy());
    await act(async () => { expect(navigateAppScreen('user')).toBe(true); });
    await waitFor(() => expect(view.getByText('固定用户 alice')).toBeTruthy());
    await act(async () => { expect(navigateAppScreen('topic')).toBe(true); });
    await waitFor(() => expect(view.getByText('固定主题 topic-42')).toBeTruthy());

    await act(async () => { navigationRef.goBack(); });
    await waitFor(() => expect(view.getByText('固定用户 alice')).toBeTruthy());
    await act(async () => { navigationRef.goBack(); });
    await waitFor(() => expect(view.getByText('固定主题 topic-42')).toBeTruthy());
    await act(async () => { navigationRef.goBack(); });
    await waitFor(() => expect(view.getByLabelText(`${originLabel}状态`).props.value).toBe(`${origin}-state`));
  });

  it('[REG-TOPIC-002] returns from topic reading settings without losing the topic route', async () => {
    const StatefulTopic = () => {
      const [value, setValue] = useState('');
      return (
        <View>
          <Text>主题详情页面</Text>
          <TextInput accessibilityLabel="主题阅读状态" value={value} onChangeText={setValue} />
          <Pressable accessibilityRole="button" accessibilityLabel="阅读设置" onPress={openReadingSettingsScreen}>
            <Text>阅读设置</Text>
          </Pressable>
        </View>
      );
    };
    const view = await render(
      <AppNavigator
        moreHasBadge={false}
        navigationTheme={DefaultTheme}
        renderFeedTab={() => <StatefulTab label="首页" />}
        renderLibraryTab={() => <StatefulTab label="收藏" />}
        renderMoreTab={() => <StatefulTab label="更多" />}
        renderReadingSettingsScreen={() => <Text>阅读设置页面</Text>}
        renderSearchTab={() => <StatefulTab label="搜索" />}
        renderTopicScreen={() => <StatefulTopic />}
        renderUserScreen={() => <Text>用户详情页面</Text>}
        styles={styles}
        theme={theme}
        onReady={jest.fn()}
        onScreenChange={jest.fn()}
        onTabPress={jest.fn()}
        onTopicClosing={jest.fn()}
        onUserClosing={jest.fn()}
      />
    );

    await waitFor(() => expect(view.getByText('首页页面')).toBeTruthy());
    await act(async () => {
      expect(navigateAppScreen('topic')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('主题详情页面')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('主题阅读状态'), '保留筛选和位置');

    await fireEvent.press(view.getByLabelText('阅读设置'));
    await waitFor(() => expect(view.getByText('阅读设置页面')).toBeTruthy());
    await act(async () => {
      navigationRef.goBack();
    });

    await waitFor(() => {
      expect(view.getByText('主题详情页面')).toBeTruthy();
      expect(view.getByLabelText('主题阅读状态').props.value).toBe('保留筛选和位置');
    });
  });

});
