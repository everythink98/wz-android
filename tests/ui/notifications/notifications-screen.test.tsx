import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { ForumNotification } from '@/domain/notifications/models';
import type { NotificationState } from '@/platform/notifications/notificationStore';
import {
  NotificationDetailScreen,
  NotificationSettingsScreen,
  NotificationsScreen
} from '@/features/notifications/NotificationScreens';
import { fireEvent, render } from '../render';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { ChevronRight: Icon };
});

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable, View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ({
      data = [],
      keyExtractor,
      ListEmptyComponent,
      ListFooterComponent,
      ListHeaderComponent,
      onEndReached,
      refreshControl,
      renderItem,
      testID
    }: {
      data?: unknown[];
      keyExtractor?: (item: unknown, index: number) => string;
      ListEmptyComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      onEndReached?: () => void;
      refreshControl?: React.ReactNode;
      renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
      testID?: string;
    }) => {
      const refreshHandler = ReactModule.isValidElement<{ onRefresh?: () => void }>(refreshControl)
        ? refreshControl.props.onRefresh
        : undefined;
      return ReactModule.createElement(
        View,
        { testID },
        ListHeaderComponent,
        refreshControl,
        ...data.map((item: unknown, index: number) =>
          ReactModule.createElement(View, { key: keyExtractor?.(item, index) || index }, renderItem?.({ item, index }))
        ),
        data.length ? null : ListEmptyComponent,
        ListFooterComponent,
        refreshHandler
          ? ReactModule.createElement(Pressable, { testID: 'notification-list-refresh', onPress: refreshHandler })
          : null,
        onEndReached
          ? ReactModule.createElement(Pressable, { testID: 'notification-list-end-reached', onPress: onEndReached })
          : null
      );
    }
  };
});

const notification: ForumNotification = {
  source: 'nodeseek',
  id: 'reply:1',
  kind: 'reply',
  actor: { name: '张三' },
  title: '一个主题',
  preview: '回复预览',
  createdAt: null,
  unread: true,
  target: { type: 'information' }
};

function listProps() {
  return {
    activeSources: ['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi'] as const,
    errors: {},
    fetchingMore: false,
    hasMore: false,
    items: [notification],
    loading: false,
    markAllBusy: false,
    refreshing: false,
    source: 'all' as const,
    sourcePending: false,
    unreadOnly: false,
    xiaoyinsiNeedsUpgrade: false,
    onChangeSource: jest.fn(),
    onChangeUnreadOnly: jest.fn(),
    onItemPress: jest.fn(),
    onLoadMore: jest.fn(),
    onMarkAll: jest.fn(),
    onRefresh: jest.fn(),
    onRetrySource: jest.fn(),
    onUpgradeXiaoyinsi: jest.fn()
  };
}

function notificationState(globalEnabled = true): NotificationState {
  const sourceState = { intentEnabled: false, baselineReady: false, deliveredIds: [] };
  return {
    version: 1,
    globalEnabled,
    hasOptedIn: globalEnabled,
    sources: {
      nodeseek: { ...sourceState },
      linuxdo: { ...sourceState },
      yaohuo: { ...sourceState },
      xiaoyinsi: { ...sourceState }
    }
  };
}

describe('notification screens', () => {
  it('[REG-NOTIFY-015] renders one compact retry action for each failed source', async () => {
    const onItemPress = jest.fn();
    const onRetrySource = jest.fn();
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        errors={{ linuxdo: '暂不可用', yaohuo: '读取失败' }}
        onItemPress={onItemPress}
        onRetrySource={onRetrySource}
      />
    );

    await fireEvent.press(view.getByLabelText('NodeSeek，未读，张三，回复了你，一个主题'));
    expect(onItemPress).toHaveBeenCalledWith(notification);
    expect(view.getByText('linux.do：暂不可用')).toBeTruthy();
    expect(view.getByText('妖火：读取失败')).toBeTruthy();
    expect(view.getByTestId('notification-outcome-partial-all')).toBeTruthy();
    await fireEvent.press(view.getByText('重试 linux.do'));
    expect(onRetrySource).toHaveBeenCalledWith('linuxdo');
    expect(view.queryByText('重试暂不可用的站点')).toBeNull();
  });

  it('shows mark-all only where the source protocol supports it', async () => {
    const view = await render(<NotificationsScreen {...listProps()} source="nodeseek" />);
    expect(view.getByLabelText('将 NodeSeek 全部标记为已读')).toBeTruthy();

    await view.rerender(<NotificationsScreen {...listProps()} source="yaohuo" />);
    expect(view.queryByText('全部已读')).toBeNull();
    expect(view.getByText('妖火需逐条打开消息，由原站确认已读状态。')).toBeTruthy();
  });

  it('forwards source, unread, refresh, and pagination interactions', async () => {
    const onChangeSource = jest.fn();
    const onChangeUnreadOnly = jest.fn();
    const onLoadMore = jest.fn();
    const onRefresh = jest.fn();
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        hasMore
        onChangeSource={onChangeSource}
        onChangeUnreadOnly={onChangeUnreadOnly}
        onLoadMore={onLoadMore}
        onRefresh={onRefresh}
      />
    );

    await fireEvent.press(view.getByTestId('notification-source-linuxdo'));
    expect(onChangeSource).toHaveBeenCalledWith('linuxdo');
    await fireEvent(view.getByLabelText('只看未读'), 'valueChange', true);
    expect(onChangeUnreadOnly).toHaveBeenCalledWith(true);
    await fireEvent.press(view.getByTestId('notification-list-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByTestId('notification-list-end-reached'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await view.rerender(<NotificationsScreen {...listProps()} hasMore={false} onLoadMore={onLoadMore} />);
    expect(view.queryByTestId('notification-list-end-reached')).toBeNull();
  });

  it('keeps unavailable-source status out of an otherwise useful overview', async () => {
    const view = await render(<NotificationsScreen {...listProps()} activeSources={['nodeseek']} />);

    expect(view.queryByText(/暂停：/)).toBeNull();
  });

  it('[REG-NOTIFY-005] offers the Xiaoyinsi message-scope upgrade without calling the signed-in user logged out', async () => {
    const onUpgradeXiaoyinsi = jest.fn();
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        activeSources={['nodeseek']}
        items={[]}
        source="xiaoyinsi"
        xiaoyinsiNeedsUpgrade
        onUpgradeXiaoyinsi={onUpgradeXiaoyinsi}
      />
    );

    expect(view.queryByText(/请先登录/)).toBeNull();
    expect(view.getByText('需要升级消息授权')).toBeTruthy();
    expect(view.getByText(/原有读写授权仍然可用/)).toBeTruthy();
    await fireEvent.press(view.getByText('升级消息授权'));
    expect(onUpgradeXiaoyinsi).toHaveBeenCalledTimes(1);
  });

  it('shows a signed-in source as confirming while its identity is pending', async () => {
    const view = await render(
      <NotificationsScreen {...listProps()} activeSources={[]} items={[]} source="xiaoyinsi" sourcePending />
    );

    expect(view.getByText('账号确认中')).toBeTruthy();
    expect(view.getByText('正在确认小隐寺账号身份；完成后会自动加载消息。')).toBeTruthy();
    expect(view.queryByText(/请先登录/)).toBeNull();
  });

  it('[REG-NOTIFY-019] never renders cached private rows for a pending source', async () => {
    const view = await render(
      <NotificationsScreen {...listProps()} activeSources={[]} source="nodeseek" sourcePending />
    );

    expect(view.getByText('账号确认中')).toBeTruthy();
    expect(view.queryByLabelText('NodeSeek，未读，张三，回复了你，一个主题')).toBeNull();
  });

  it('keeps the full-topic escape hatch when notification detail fails', async () => {
    const onOpenTopic = jest.fn();
    const onRetry = jest.fn();
    const view = await render(
      <NotificationDetailScreen
        canOpenTopic
        contentWidth={360}
        error="帖子内容未找到"
        loading={false}
        onOpenTopic={onOpenTopic}
        onRetry={onRetry}
      />
    );

    expect(view.getByText('帖子内容未找到')).toBeTruthy();
    await fireEvent.press(view.getByText('查看完整主题'));
    expect(onOpenTopic).toHaveBeenCalledTimes(1);
    expect(view.getByText('重试')).toBeTruthy();
  });

  it('renders detail content and keeps read failure visible without blocking the topic', async () => {
    const onOpenTopic = jest.fn();
    const view = await render(
      <NotificationDetailScreen
        canOpenTopic
        contentWidth={360}
        detail={{ notification, title: '消息详情', contentText: '这里是完整正文' }}
        loading={false}
        markMessage="原站未确认已读，请稍后重试"
        onOpenTopic={onOpenTopic}
        onRetry={jest.fn()}
      />
    );

    expect(view.getByText('这里是完整正文')).toBeTruthy();
    expect(view.getByText('原站未确认已读，请稍后重试')).toBeTruthy();
    await fireEvent.press(view.getByText('查看完整主题'));
    expect(onOpenTopic).toHaveBeenCalledTimes(1);
  });

  it('forwards every source toggle and the Xiaoyinsi authorization upgrade', async () => {
    const onToggleSource = jest.fn();
    const onUpgradeXiaoyinsi = jest.fn();
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        permission="granted"
        sessions={createSiteSessionViewModels(createSiteSessionStates())}
        state={notificationState()}
        xiaoyinsiNeedsUpgrade
        onOpenSystemSettings={jest.fn()}
        onToggleGlobal={jest.fn()}
        onToggleSource={onToggleSource}
        onUpgradeXiaoyinsi={onUpgradeXiaoyinsi}
      />
    );

    for (const [label, source] of [
      ['NodeSeek', 'nodeseek'],
      ['linux.do', 'linuxdo'],
      ['妖火', 'yaohuo'],
      ['小隐寺', 'xiaoyinsi']
    ] as const) {
      await fireEvent(view.getByLabelText(`${label} 消息通知`), 'valueChange', true);
      expect(onToggleSource).toHaveBeenLastCalledWith(source, true);
    }
    await fireEvent.press(view.getByLabelText('升级小隐寺消息授权'));
    expect(onUpgradeXiaoyinsi).toHaveBeenCalledTimes(1);
  });

  it('shows a signed-in Xiaoyinsi account as confirming instead of logged out', async () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        xiaoyinsi: {
          site: 'xiaoyinsi',
          status: 'logged-in',
          cookieSummary: [],
          isVerifying: true,
          currentUser: {
            source: 'xiaoyinsi',
            id: '7',
            username: 'temple-user',
            url: 'https://xiaoyinsi.net/u/temple-user',
            topics: []
          }
        }
      })
    );
    sessions.xiaoyinsi = { ...sessions.xiaoyinsi, isLoggedIn: true, identityTrust: 'pending' };
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        permission="granted"
        sessions={sessions}
        state={notificationState()}
        xiaoyinsiNeedsUpgrade={false}
        onOpenSystemSettings={jest.fn()}
        onToggleGlobal={jest.fn()}
        onToggleSource={jest.fn()}
        onUpgradeXiaoyinsi={jest.fn()}
      />
    );

    expect(view.getByText('账号确认中；开关意图会保留')).toBeTruthy();
    expect(view.getAllByText('未登录；开关意图会保留')).toHaveLength(3);
  });

  it('[REG-NOTIFY-016] shows a pending identity as confirming before login is established', async () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates());
    sessions.yaohuo = { ...sessions.yaohuo, identityTrust: 'pending' };
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        permission="granted"
        sessions={sessions}
        state={notificationState()}
        xiaoyinsiNeedsUpgrade={false}
        onOpenSystemSettings={jest.fn()}
        onToggleGlobal={jest.fn()}
        onToggleSource={jest.fn()}
        onUpgradeXiaoyinsi={jest.fn()}
      />
    );

    expect(view.getByText('账号确认中；开关意图会保留')).toBeTruthy();
    expect(view.getAllByText('未登录；开关意图会保留')).toHaveLength(3);
  });

  it('keeps denied permission intent visible and offers system settings', async () => {
    const onOpenSystemSettings = jest.fn();
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        permission="denied"
        sessions={createSiteSessionViewModels(createSiteSessionStates())}
        state={notificationState()}
        xiaoyinsiNeedsUpgrade={false}
        onOpenSystemSettings={onOpenSystemSettings}
        onToggleGlobal={jest.fn()}
        onToggleSource={jest.fn()}
        onUpgradeXiaoyinsi={jest.fn()}
      />
    );

    expect(view.getByText('系统通知权限未开启')).toBeTruthy();
    await fireEvent.press(view.getByText('打开系统设置'));
    expect(onOpenSystemSettings).toHaveBeenCalledTimes(1);
  });
});
