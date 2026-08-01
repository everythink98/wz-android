import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  AppNavigator,
  currentTopicRouteKey,
  navigateAppScreen,
  navigationRef,
  openReadingSettingsScreen,
  pushTopicRoute,
  type MainTabParamList
} from '@/app/AppNavigator';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { useOriginalImageUpgradeEnabled } from '@/platform/media/originalImageLoading';
import { createStyles, createTheme } from '@/theme';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Home: Icon, MoreHorizontal: Icon, Search: Icon, Star: Icon };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);

function topicPresentation(
  content: React.ReactNode,
  identity = 'linuxdo:topic-42',
  routeSessionEpoch = 0,
  sessionEpoch = routeSessionEpoch
) {
  return {
    content,
    identity,
    loadingContent: <Text>主题加载中</Text>,
    routeSessionEpoch,
    sessionEpoch
  };
}

function OriginalUpgradeProbe({ label }: { label: string }) {
  const enabled = useOriginalImageUpgradeEnabled();
  return <Text>{`${label} originals ${enabled ? 'active' : 'paused'}`}</Text>;
}

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
        renderTopicScreen={() => topicPresentation(<Text>主题详情页面</Text>)}
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
        renderTopicScreen={() => topicPresentation(<Text>固定主题 topic-42</Text>)}
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

    await act(async () => {
      expect(navigateAppScreen('topic')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('固定主题 topic-42')).toBeTruthy());
    await act(async () => {
      expect(navigateAppScreen('user')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('固定用户 alice')).toBeTruthy());
    await act(async () => {
      expect(navigateAppScreen('topic')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('固定主题 topic-42')).toBeTruthy());

    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => expect(view.getByText('固定用户 alice')).toBeTruthy());
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => expect(view.getByText('固定主题 topic-42')).toBeTruthy());
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => expect(view.getByLabelText(`${originLabel}状态`).props.value).toBe(`${origin}-state`));
  });

  it('[REG-PERF-008] keeps each native Topic route bound to its own presentation', async () => {
    let showPresentation: (presentation: string) => void = () => {
      throw new Error('Topic presentation harness is not ready');
    };
    const renderTopicScreenSpy = jest.fn<(routeKey: string) => void>();
    const Harness = () => {
      const [activePresentation, setActivePresentation] = useState('A ready');
      showPresentation = setActivePresentation;
      const renderTopicScreen = ({ routeKey }: { routeKey: string }) => {
        renderTopicScreenSpy(routeKey);
        return topicPresentation(
          <Text>{activePresentation}</Text>,
          activePresentation.startsWith('A') ? 'linuxdo:A' : 'linuxdo:B'
        );
      };
      return (
        <AppNavigator
          moreHasBadge={false}
          navigationTheme={DefaultTheme}
          renderFeedTab={() => <StatefulTab label="首页" />}
          renderLibraryTab={() => <StatefulTab label="收藏" />}
          renderMoreTab={() => <StatefulTab label="更多" />}
          renderReadingSettingsScreen={() => <Text>阅读设置页面</Text>}
          renderSearchTab={() => <StatefulTab label="搜索" />}
          renderTopicScreen={renderTopicScreen}
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
    };
    const view = await render(<Harness />);

    await waitFor(() => expect(view.getByText('首页页面')).toBeTruthy());
    await act(async () => {
      expect(navigateAppScreen('topic')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('A ready')).toBeTruthy());
    const topicAKey = currentTopicRouteKey();
    expect(topicAKey).toEqual(expect.any(String));

    await act(async () => {
      showPresentation('B loading');
      expect(pushTopicRoute({ source: 'linuxdo', topicId: 'B' })).toBe(true);
    });
    await waitFor(() => expect(view.getByText('B loading')).toBeTruthy());
    const topicBKey = currentTopicRouteKey();
    expect(topicBKey).toEqual(expect.any(String));
    expect(topicBKey).not.toBe(topicAKey);

    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => {
      expect(currentTopicRouteKey()).toBe(topicAKey);
      expect(view.getByText('A ready', { includeHiddenElements: true })).toBeTruthy();
      expect(view.queryByText('B loading', { includeHiddenElements: true })).toBeNull();
      expect(renderTopicScreenSpy).toHaveBeenCalledWith(topicAKey);
      expect(renderTopicScreenSpy).toHaveBeenCalledWith(topicBKey);
    });
    await act(async () => showPresentation('A ready'));
    await waitFor(() => expect(view.getByText('A ready')).toBeTruthy());
  });

  it('[REG-TOPIC-057] rejects stale Topic content and accepts the replacement session epoch', async () => {
    let invalidateEpochZero: () => void = () => {
      throw new Error('Topic epoch harness is not ready');
    };
    let publishEpochOne: () => void = () => {
      throw new Error('Topic epoch harness is not ready');
    };
    const Harness = () => {
      const [routeEpoch, setRouteEpoch] = useState(0);
      const [contentEpoch, setContentEpoch] = useState(0);
      invalidateEpochZero = () => setRouteEpoch(1);
      publishEpochOne = () => setContentEpoch(1);
      return (
        <AppNavigator
          moreHasBadge={false}
          navigationTheme={DefaultTheme}
          renderFeedTab={() => <StatefulTab label="首页" />}
          renderLibraryTab={() => <StatefulTab label="收藏" />}
          renderMoreTab={() => <StatefulTab label="更多" />}
          renderReadingSettingsScreen={() => <Text>阅读设置页面</Text>}
          renderSearchTab={() => <StatefulTab label="搜索" />}
          renderTopicScreen={() =>
            topicPresentation(<Text>{`A epoch ${contentEpoch}`}</Text>, 'linuxdo:A', routeEpoch, contentEpoch)
          }
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
    };
    const view = await render(<Harness />);

    await waitFor(() => expect(view.getByText('首页页面')).toBeTruthy());
    await act(async () => {
      expect(navigateAppScreen('topic')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('A epoch 0')).toBeTruthy());

    await act(async () => invalidateEpochZero());
    await waitFor(() => {
      expect(view.getByText('主题加载中', { includeHiddenElements: true })).toBeTruthy();
      expect(view.queryByText('A epoch 0', { includeHiddenElements: true })).toBeNull();
      expect(view.queryByText('A epoch 1', { includeHiddenElements: true })).toBeNull();
    });

    await act(async () => publishEpochOne());
    await waitFor(() => {
      expect(view.getByText('A epoch 1')).toBeTruthy();
      expect(view.queryByText('A epoch 0', { includeHiddenElements: true })).toBeNull();
      expect(view.queryByText('主题加载中', { includeHiddenElements: true })).toBeNull();
    });
  });

  it('[REG-TOPIC-057] invalidates an inactive Topic route before it is restored', async () => {
    let showTopicB: () => void = () => {
      throw new Error('Topic epoch harness is not ready');
    };
    let invalidateTopicA: () => void = () => {
      throw new Error('Topic epoch harness is not ready');
    };
    let restoreTopicA: () => void = () => {
      throw new Error('Topic epoch harness is not ready');
    };
    const Harness = () => {
      const [activeTopic, setActiveTopic] = useState({ source: 'linuxdo', id: 'A', sessionEpoch: 0 });
      const [topicAEpoch, setTopicAEpoch] = useState(0);
      showTopicB = () => setActiveTopic({ source: 'nodeseek', id: 'B', sessionEpoch: 0 });
      invalidateTopicA = () => setTopicAEpoch(1);
      restoreTopicA = () => setActiveTopic({ source: 'linuxdo', id: 'A', sessionEpoch: 1 });
      return (
        <AppNavigator
          moreHasBadge={false}
          navigationTheme={DefaultTheme}
          renderFeedTab={() => <StatefulTab label="首页" />}
          renderLibraryTab={() => <StatefulTab label="收藏" />}
          renderMoreTab={() => <StatefulTab label="更多" />}
          renderReadingSettingsScreen={() => <Text>阅读设置页面</Text>}
          renderSearchTab={() => <StatefulTab label="搜索" />}
          renderTopicScreen={({ routeSource, seed }) =>
            topicPresentation(
              <Text>{`${activeTopic.id} epoch ${activeTopic.sessionEpoch}`}</Text>,
              `${activeTopic.source}:${activeTopic.id}`,
              (seed?.source || routeSource || activeTopic.source) === 'linuxdo' ? topicAEpoch : 0,
              activeTopic.sessionEpoch
            )
          }
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
    };
    const view = await render(<Harness />);

    await waitFor(() => expect(view.getByText('首页页面')).toBeTruthy());
    await act(async () => {
      expect(navigateAppScreen('topic')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('A epoch 0')).toBeTruthy());

    await act(async () => {
      showTopicB();
      expect(pushTopicRoute({ source: 'nodeseek', topicId: 'B' })).toBe(true);
    });
    await waitFor(() => expect(view.getByText('B epoch 0')).toBeTruthy());
    await act(async () => invalidateTopicA());
    await waitFor(() => {
      expect(view.queryByText('A epoch 0', { includeHiddenElements: true })).toBeNull();
      expect(view.getByText('主题加载中', { includeHiddenElements: true })).toBeTruthy();
    });

    await act(async () => navigationRef.goBack());
    await waitFor(() => expect(view.getByText('主题加载中', { includeHiddenElements: true })).toBeTruthy());
    await act(async () => restoreTopicA());
    await waitFor(() => {
      expect(view.getByText('A epoch 1')).toBeTruthy();
      expect(view.queryByText('A epoch 0', { includeHiddenElements: true })).toBeNull();
    });
  });

  it('[REG-PERF-008] pauses original-image upgrades on an inactive Topic route', async () => {
    let showTopicB: () => void = () => {
      throw new Error('Topic image harness is not ready');
    };
    const Harness = () => {
      const [topicId, setTopicId] = useState('A');
      showTopicB = () => setTopicId('B');
      return (
        <AppNavigator
          moreHasBadge={false}
          navigationTheme={DefaultTheme}
          renderFeedTab={() => <StatefulTab label="首页" />}
          renderLibraryTab={() => <StatefulTab label="收藏" />}
          renderMoreTab={() => <StatefulTab label="更多" />}
          renderReadingSettingsScreen={() => <Text>阅读设置页面</Text>}
          renderSearchTab={() => <StatefulTab label="搜索" />}
          renderTopicScreen={() => topicPresentation(<OriginalUpgradeProbe label={topicId} />, `linuxdo:${topicId}`)}
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
    };
    const view = await render(<Harness />);

    await waitFor(() => expect(view.getByText('首页页面')).toBeTruthy());
    await act(async () => {
      expect(pushTopicRoute({ source: 'linuxdo', topicId: 'A' })).toBe(true);
    });
    await waitFor(() => expect(view.getByText('A originals active')).toBeTruthy());

    await act(async () => {
      showTopicB();
      expect(pushTopicRoute({ source: 'linuxdo', topicId: 'B' })).toBe(true);
    });
    await waitFor(() => {
      expect(view.getByText('B originals active')).toBeTruthy();
      expect(view.getByText('A originals paused', { includeHiddenElements: true })).toBeTruthy();
    });
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
        renderTopicScreen={() => topicPresentation(<StatefulTopic />)}
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
