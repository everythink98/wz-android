import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import { formatDateTime } from '@/domain/forum/presentation';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import type { ForumNotification } from '@/domain/notifications/models';
import type { NotificationState } from '@/platform/notifications/notificationStore';
import {
  NotificationDetailScreen as NotificationDetailScreenView,
  NotificationSettingsScreen,
  NotificationsScreen
} from '@/features/notifications/NotificationScreens';
import { fireEvent, render, waitFor } from '../render';
import { createTheme } from '@/ui/theme/tokens';

const ignoreExternalUrl = () => undefined;

function NotificationDetailScreen({
  onOpenExternalUrl = ignoreExternalUrl,
  ...props
}: Omit<React.ComponentProps<typeof NotificationDetailScreenView>, 'onOpenExternalUrl'> & {
  onOpenExternalUrl?: (url: string) => void;
}) {
  return <NotificationDetailScreenView {...props} onOpenExternalUrl={onOpenExternalUrl} />;
}

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { ChevronRight: Icon };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactModule = require('react') as typeof React;
  const { TextInput, View: NativeView } = require('react-native') as typeof import('react-native');
  const BottomSheet = ReactModule.forwardRef(function BottomSheet(
    {
      children,
      index,
      maxDynamicContentSize
    }: { children?: React.ReactNode; index: number; maxDynamicContentSize?: number },
    ref
  ) {
    ReactModule.useImperativeHandle(ref, () => ({ close: () => undefined }));
    return index < 0
      ? null
      : ReactModule.createElement(
          NativeView,
          { maxDynamicContentSize, testID: 'composer-bottom-sheet' } as React.ComponentProps<typeof NativeView>,
          children
        );
  });
  return {
    __esModule: true,
    default: BottomSheet,
    BottomSheetBackdrop: () => null,
    BottomSheetFlatList: ({
      data = [],
      keyExtractor,
      renderItem
    }: {
      data?: unknown[];
      keyExtractor?: (item: unknown, index: number) => string;
      renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
    }) =>
      ReactModule.createElement(
        NativeView,
        null,
        ...data.map((item, index) =>
          ReactModule.createElement(
            NativeView,
            { key: keyExtractor?.(item, index) ?? index },
            renderItem?.({ item, index })
          )
        )
      ),
    BottomSheetTextInput: ReactModule.forwardRef(function BottomSheetTextInput(props: Record<string, unknown>, ref) {
      void ref;
      return ReactModule.createElement(TextInput, props);
    }),
    BottomSheetView: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(NativeView, null, children)
  };
});

let mockSafeAreaBottom = 0;
let mockSafeAreaTop = 0;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: mockSafeAreaBottom, left: 0, right: 0, top: mockSafeAreaTop })
}));

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
    enabledSources: ['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi'] as const,
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
  it('uses the enabled content-source order for tabs and hides disabled-source rows and errors', async () => {
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        activeSources={['linuxdo', 'nodeseek']}
        enabledSources={['linuxdo', 'nodeseek']}
        errors={{ linuxdo: '暂不可用', yaohuo: '不应展示' }}
      />
    );

    const sourceTabs = view
      .getAllByRole('button')
      .map((element) => element.props.testID as string | undefined)
      .filter((testID): testID is string => Boolean(testID?.startsWith('notification-source-')));
    expect(sourceTabs).toEqual([
      'notification-source-all',
      'notification-source-linuxdo',
      'notification-source-nodeseek'
    ]);
    expect(view.getByText('linux.do：暂不可用')).toBeTruthy();
    expect(view.queryByText('妖火：不应展示')).toBeNull();
    expect(view.queryByTestId('notification-source-yaohuo')).toBeNull();
    expect(view.queryByTestId('notification-source-xiaoyinsi')).toBeNull();
  });

  it('shows content-source management guidance and no cached rows when every source is disabled', async () => {
    const view = await render(
      <NotificationsScreen {...listProps()} activeSources={[]} enabledSources={[]} errors={{}} source="all" />
    );

    expect(view.getByText('尚未启用内容源')).toBeTruthy();
    expect(view.getByText('请前往“更多”中的“内容源”面板启用想看的站点。')).toBeTruthy();
    expect(view.getByTestId('notification-source-all')).toBeTruthy();
    expect(view.queryByTestId('notification-source-nodeseek')).toBeNull();
    expect(view.queryByLabelText('NodeSeek，未读，张三，回复了你，一个主题')).toBeNull();
  });

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
    const categories = [{ id: 'inbox', label: '全部' }];
    const view = await render(
      <NotificationsScreen {...listProps()} categories={categories} categoryId="inbox" source="nodeseek" />
    );
    expect(view.getByLabelText('将 NodeSeek 全部标记为已读')).toBeTruthy();

    await view.rerender(
      <NotificationsScreen {...listProps()} categories={categories} categoryId="inbox" source="yaohuo" />
    );
    expect(view.queryByText('全部已读')).toBeNull();
    expect(view.getByText('逐条打开后已读')).toBeTruthy();
  });

  it('[REG-NOTIFY-031] renders adapter-owned categories only for a selected source', async () => {
    const onChangeCategory = jest.fn();
    const categories = [
      { id: 'all', label: '全部' },
      { id: 'mentions', label: '@我' },
      { id: 'replies', label: '回复主题' },
      { id: 'messages', label: '私信' }
    ];
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        categories={categories}
        categoryId="all"
        source="nodeseek"
        onChangeCategory={onChangeCategory}
      />
    );

    expect(view.getByTestId('notification-category-mentions')).toBeTruthy();
    expect(view.getByText('私信')).toBeTruthy();
    await fireEvent.press(view.getByTestId('notification-category-messages'));
    expect(onChangeCategory).toHaveBeenCalledWith('messages');

    await view.rerender(
      <NotificationsScreen
        {...listProps()}
        categories={categories}
        categoryId="messages"
        source="nodeseek"
        onChangeCategory={onChangeCategory}
      />
    );
    expect(view.queryByText('全部已读')).toBeNull();

    await view.rerender(
      <NotificationsScreen
        {...listProps()}
        categories={categories}
        categoryId="all"
        source="all"
        onChangeCategory={onChangeCategory}
      />
    );
    expect(view.queryByTestId('notification-category-mentions')).toBeNull();
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

  it('[REG-ACCOUNT-031] presents a terminal unknown message source as retryable instead of logged out', async () => {
    const view = await render(
      <NotificationsScreen {...listProps()} activeSources={[]} items={[]} source="yaohuo" sourceUnknown />
    );

    expect(view.getByText('账号状态暂不可确认')).toBeTruthy();
    expect(view.getByText('本次账号核对失败；消息请求已暂停，可在账号中心重试核对。')).toBeTruthy();
    expect(view.queryByText('请先登录 妖火，并确认账号身份。')).toBeNull();
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
    await fireEvent.press(view.getByText('前往主题回复'));
    expect(onOpenTopic).toHaveBeenCalledTimes(1);
  });

  it('[REG-NOTIFY-040] gives rich notification links the app accent affordance', async () => {
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={{
          notification: { ...notification, kind: 'system' },
          title: '消息详情',
          contentHtml: '<p>正文 <a href="https://example.com/topic">查看链接</a></p>'
        }}
        loading={false}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />
    );

    expect(StyleSheet.flatten(view.getByText('查看链接').props.style).color).toBe(
      createTheme(createEmptyReaderData().settings).primary
    );
  });

  it('[REG-NOTIFY-044][REG-NOTIFY-045] keeps Yaohuo topic links in-app and preserves the full-reply page', async () => {
    const onOpenExternalUrl = jest.fn();
    const onOpenTopic = jest.fn();
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={{
          notification: {
            ...notification,
            source: 'yaohuo',
            kind: 'private-message',
            target: {
              type: 'message-detail',
              messageId: '41',
              url: 'https://www.yaohuo.me/bbs/messagelist_view.aspx?id=41'
            }
          },
          title: '妖火私信',
          contentHtml:
            '<a href="https://www.yaohuo.me/bbs-321.html">查看主题帖</a> | <a href="https://www.yaohuo.me/bbs/book_re.aspx?classid=177&amp;id=321&amp;tofloor=90&amp;fromuserid=1000">查看完整回复</a>'
        }}
        loading={false}
        onOpenExternalUrl={onOpenExternalUrl}
        onOpenTopic={onOpenTopic}
        onRetry={jest.fn()}
      />
    );

    await fireEvent.press(view.getByRole('link', { name: '查看主题帖' }));
    await fireEvent.press(view.getByRole('link', { name: '查看完整回复' }));

    expect(onOpenExternalUrl).not.toHaveBeenCalled();
    expect(onOpenTopic).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: '321', source: 'yaohuo' }));
    expect(onOpenTopic).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: '321', source: 'yaohuo' }), {
      floor: 90
    });
  });

  it('distinguishes topic replies from notifications that are read-only at the source', async () => {
    const view = await render(
      <NotificationDetailScreen
        canOpenTopic
        contentWidth={360}
        detail={{ notification: { ...notification, kind: 'mention' }, title: '消息详情', contentText: '正文' }}
        loading={false}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />
    );

    expect(view.getByText('前往主题回复')).toBeTruthy();
    await view.rerender(
      <NotificationDetailScreen
        contentWidth={360}
        detail={{
          notification: {
            ...notification,
            kind: 'system',
            target: { type: 'information' }
          },
          title: '系统消息',
          contentText: '正文'
        }}
        loading={false}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    expect(view.getByText('系统通知由原站提供为只读。')).toBeTruthy();
  });

  it('[REG-NOTIFY-034] keeps fixed detail actions above the bottom safe area', async () => {
    mockSafeAreaBottom = 24;
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={{
          notification: { ...notification, kind: 'private-message' },
          title: '与 Bob 的私信',
          messages: [],
          reply: { format: 'markdown' }
        }}
        loading={false}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />
    );

    expect(StyleSheet.flatten(view.getByTestId('notification-reply-dock').props.style).paddingBottom).toBe(33);
    await view.rerender(
      <NotificationDetailScreen
        canOpenTopic
        contentWidth={360}
        detail={{ notification, title: '消息详情', contentText: '正文' }}
        loading={false}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    expect(StyleSheet.flatten(view.getByTestId('notification-topic-action-dock').props.style).paddingBottom).toBe(33);
    mockSafeAreaBottom = 0;
  });

  it('[REG-NOTIFY-041] lets the shared composer grow through the safe viewport before clipping actions', async () => {
    mockSafeAreaBottom = 24;
    mockSafeAreaTop = 24;
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={{
          notification: { ...notification, kind: 'private-message' },
          title: '与 Bob 的私信',
          messages: [],
          reply: { format: 'markdown' }
        }}
        loading={false}
        replyBusy={false}
        replyContent=""
        replyVisible
        onOpenTopic={jest.fn()}
        onOpenReply={jest.fn()}
        onReplyClose={jest.fn()}
        onReplyContentChange={jest.fn()}
        onRetry={jest.fn()}
        onSubmitReply={jest.fn()}
      />
    );

    expect(view.getByTestId('composer-bottom-sheet').props.maxDynamicContentSize).toBe(
      Math.round((Dimensions.get('window').height - mockSafeAreaTop) * 0.75)
    );
    mockSafeAreaBottom = 0;
    mockSafeAreaTop = 0;
  });

  it('[REG-NOTIFY-031][REG-NOTIFY-032] renders ordered conversation bubbles and the site-format reply composer', async () => {
    const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(() => undefined);
    const onOpenReply = jest.fn();
    const onReplyContentChange = jest.fn();
    const onSubmitReply = jest.fn();
    const detail = {
      notification: { ...notification, kind: 'private-message' as const },
      title: '与 Bob 的私信',
      messages: [
        {
          id: '1',
          author: 'Bob',
          contentHtml: '<p>第一条</p>',
          createdAt: '2026-08-03T10:00:00Z',
          mine: false
        },
        {
          id: '2',
          author: 'Alice',
          contentText: '第二条',
          createdAt: '2026-08-03T10:01:00Z',
          mine: true
        }
      ],
      reply: { format: 'markdown' as const },
      historyNotice: '原站仅提供最近 20 条聊天记录。'
    };
    const props = {
      canOpenTopic: false,
      contentWidth: 360,
      detail,
      loading: false,
      onOpenTopic: jest.fn(),
      onRetry: jest.fn(),
      onOpenReply,
      onReplyClose: jest.fn(),
      onReplyContentChange,
      onSubmitReply,
      onUploadReplyImage: jest.fn(),
      replyBusy: false,
      replyContent: '保留草稿',
      replyVisible: false
    };
    const view = await render(<NotificationDetailScreen {...props} />);

    expect(view.getByText('Bob')).toBeTruthy();
    expect(view.getByText('第一条')).toBeTruthy();
    expect(view.getByText('Alice')).toBeTruthy();
    expect(view.getByText('第二条')).toBeTruthy();
    expect(view.getAllByText(/第[一二]条/).map((node) => node.props.children)).toEqual(['第一条', '第二条']);
    expect(StyleSheet.flatten(view.getByTestId('notification-message-1').props.style).alignItems).toBe('flex-start');
    expect(StyleSheet.flatten(view.getByTestId('notification-message-2').props.style).alignItems).toBe('flex-end');
    expect(StyleSheet.flatten(view.getByTestId('notification-conversation-messages').props.style).justifyContent).toBe(
      'flex-end'
    );
    expect(view.getByText(formatDateTime('2026-08-03T10:00:00Z'))).toBeTruthy();
    expect(view.getByText(formatDateTime('2026-08-03T10:01:00Z'))).toBeTruthy();
    fireEvent(view.getByTestId('notification-detail-scroll'), 'contentSizeChange', 360, 640);
    await waitFor(() => expect(scrollToEnd).toHaveBeenCalledWith({ animated: false }));
    expect(view.getByText('原站仅提供最近 20 条聊天记录。')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('回复私信'));
    expect(onOpenReply).toHaveBeenCalledTimes(1);
    expect(view.getByText('Markdown')).toBeTruthy();

    await view.rerender(<NotificationDetailScreen {...props} replyVisible />);
    expect(view.getByPlaceholderText('输入回复内容').props.value).toBe('保留草稿');
    expect(view.getByLabelText('表情')).toBeTruthy();
    expect(view.getByLabelText('图片')).toBeTruthy();
    await view.rerender(<NotificationDetailScreen {...props} replyBusy replyVisible />);
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(true);
    await view.rerender(<NotificationDetailScreen {...props} replyVisible />);
    await fireEvent.changeText(view.getByPlaceholderText('输入回复内容'), '新草稿');
    expect(onReplyContentChange).toHaveBeenCalledWith('新草稿');
    await fireEvent.press(view.getByLabelText('发送回复'));
    expect(onSubmitReply).toHaveBeenCalledTimes(1);

    await view.unmount();
    const linuxDoView = await render(
      <NotificationDetailScreen
        {...props}
        detail={{ ...detail, notification: { ...detail.notification, source: 'linuxdo' } }}
        discourseEmojiUrls={{ party_parrot: 'https://example.com/party.png' }}
        replyVisible
      />
    );
    await fireEvent.press(linuxDoView.getByLabelText('表情'));
    expect(linuxDoView.getByLabelText('party parrot')).toBeTruthy();
    expect(linuxDoView.getByLabelText('图片')).toBeTruthy();

    await linuxDoView.unmount();
    const yaohuoView = await render(
      <NotificationDetailScreen
        {...props}
        detail={{
          ...detail,
          notification: { ...detail.notification, source: 'yaohuo' },
          reply: { format: 'plain-text' }
        }}
        replyVisible
      />
    );
    expect(yaohuoView.getByText('纯文本')).toBeTruthy();
    expect(yaohuoView.queryByLabelText('表情')).toBeNull();
    expect(yaohuoView.queryByLabelText('图片')).toBeNull();
    scrollToEnd.mockRestore();
  });

  it('[REG-NOTIFY-057] renders NodeSeek private-message Markdown and stickers as forum content', async () => {
    const detail = {
      notification: { ...notification, kind: 'private-message' as const },
      title: '与 KongB 的私信',
      messages: [
        {
          id: 'render-fixture',
          author: '我',
          contentHtml:
            '<p><strong>WZ-NS-RENDER</strong> <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/04.png" alt="ac04"></p>',
          createdAt: '2026-08-08T09:29:18Z',
          mine: true
        }
      ],
      reply: { format: 'markdown' as const }
    };

    const view = await render(
      <NotificationDetailScreen
        canOpenTopic={false}
        contentWidth={360}
        detail={detail}
        loading={false}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />
    );

    expect(StyleSheet.flatten(view.getByText('WZ-NS-RENDER').props.style).fontWeight).toBe('bold');
    expect(view.getByLabelText('ac04')).toBeTruthy();
  });

  it('shows notification settings only for enabled sources in user order', async () => {
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        enabledSources={['linuxdo', 'nodeseek']}
        permission="granted"
        sessions={createSiteSessionViewModels(createSiteSessionStates())}
        state={notificationState()}
        xiaoyinsiNeedsUpgrade={false}
        onOpenSystemSettings={jest.fn()}
        onToggleGlobal={jest.fn()}
        onToggleSource={jest.fn()}
        onUpgradeXiaoyinsi={jest.fn()}
      />
    );

    const sourceToggles = view
      .getAllByRole('switch')
      .map((element) => element.props.accessibilityLabel as string)
      .filter((label) => label !== 'Android 消息通知');
    expect(sourceToggles).toEqual(['linux.do 消息通知', 'NodeSeek 消息通知']);
    expect(view.queryByLabelText('妖火 消息通知')).toBeNull();
    expect(view.queryByLabelText('小隐寺 消息通知')).toBeNull();
  });

  it('forwards every source toggle and the Xiaoyinsi authorization upgrade', async () => {
    const onToggleSource = jest.fn();
    const onUpgradeXiaoyinsi = jest.fn();
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        enabledSources={['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi']}
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

  it('[REG-PERF-019] keeps a signed-in Xiaoyinsi notification source available while its account check runs', async () => {
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
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        enabledSources={['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi']}
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

    expect(view.getByText('已关闭')).toBeTruthy();
    expect(view.getAllByText('未登录；开关意图会保留')).toHaveLength(3);
  });

  it('[REG-ACCOUNT-031] shows terminal unknown as retryable instead of logged out', async () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates());
    sessions.yaohuo = { ...sessions.yaohuo, identityTrust: 'unknown' };
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        enabledSources={['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi']}
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

    expect(view.getByText('账号状态暂不可确认；开关意图会保留，可重试核对')).toBeTruthy();
    expect(view.getAllByText('未登录；开关意图会保留')).toHaveLength(3);
  });

  it('keeps denied permission intent visible and offers system settings', async () => {
    const onOpenSystemSettings = jest.fn();
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        enabledSources={['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi']}
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
