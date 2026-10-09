import { projectTestAccountSessions } from '../../helpers/accountSessions';
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Image, ScrollView, StyleSheet } from 'react-native';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { formatDateTime } from '@/domain/forum/presentation';
import { createEmptyReaderData, type ReaderSettings } from '@/domain/reader/readerData';
import type { ForumNotification } from '@/domain/notifications/models';
import type { NotificationState } from '@/platform/notifications/notificationStore';
import {
  NotificationDetailScreen as NotificationDetailScreenView,
  NotificationSettingsScreen,
  NotificationsScreen
} from '@/features/notifications/NotificationScreens';
import { act, fireEvent, render, waitFor, within } from '../render';
import { createTheme, lineHeightMultiplier } from '@/ui/theme/tokens';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';

jest.mock('@/ui/media/ImagePreviewModal', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable, Text, View } = require('react-native') as typeof import('react-native');
  return {
    ImagePreviewModal: ({
      preview,
      onClose,
      onSelect
    }: React.ComponentProps<typeof import('@/ui/media/ImagePreviewModal').ImagePreviewModal>) =>
      preview
        ? ReactModule.createElement(
            View,
            { testID: 'message-image-preview' },
            ReactModule.createElement(Text, { testID: 'message-preview-data' }, JSON.stringify(preview)),
            ReactModule.createElement(Pressable, { accessibilityLabel: '关闭图片预览', onPress: onClose }),
            ReactModule.createElement(Pressable, { accessibilityLabel: '预览切到第一张', onPress: () => onSelect(0) })
          )
        : null
  };
});

// Metro uses the source entry and React 19's JSX runtime. The CommonJS entry
// uses createElement, which still applies defaultProps and hides missing styles.
jest.mock('react-native-render-html', () => jest.requireActual('react-native-render-html/src'));

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
  return {
    ChevronDown: Icon,
    ChevronRight: Icon,
    CodeXml: Icon,
    Maximize2: Icon,
    Minimize2: Icon,
    Redo2: Icon,
    TextCursorInput: Icon,
    Undo2: Icon,
    X: Icon
  };
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
    return ReactModule.createElement(
      NativeView,
      {
        maxDynamicContentSize,
        testID: 'composer-bottom-sheet',
        accessibilityElementsHidden: index < 0,
        importantForAccessibility: index < 0 ? 'no-hide-descendants' : 'auto'
      } as React.ComponentProps<typeof NativeView>,
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
      ReactModule.createElement(NativeView, null, children),
    useBottomSheetInternal: () => ({
      animatedIndex: { get: () => -1 },
      animatedAnimationState: { get: () => ({ nextIndex: undefined }) },
      animatedPosition: { get: () => 0 },
      animatedDetentsState: { get: () => ({ detents: [] }) },
      animatedKeyboardState: { set: jest.fn() },
      animatedLayoutState: { get: () => ({ rawContainerHeight: 800, containerHeight: 800 }), modify: jest.fn() }
    })
  };
});

let mockSafeAreaBottom = 0;
let mockSafeAreaTop = 0;
let mockNotificationFlashListExtraData: unknown;
let mockNotificationFlashListData: unknown;
let mockNotificationNestedScrollEnabled: boolean | undefined;
const mockNotificationScrollToOffset = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: mockSafeAreaBottom, left: 0, right: 0, top: mockSafeAreaTop })
}));

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable, View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ({
      ref,
      data = [],
      extraData,
      keyExtractor,
      ListEmptyComponent,
      ListFooterComponent,
      ListHeaderComponent,
      nestedScrollEnabled,
      onEndReached,
      refreshControl,
      renderItem,
      testID
    }: {
      ref?: React.Ref<{ scrollToOffset: typeof mockNotificationScrollToOffset }>;
      data?: unknown[];
      extraData?: unknown;
      keyExtractor?: (item: unknown, index: number) => string;
      ListEmptyComponent?: React.ReactNode;
      ListFooterComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      nestedScrollEnabled?: boolean;
      onEndReached?: () => void;
      refreshControl?: React.ReactNode;
      renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
      testID?: string;
    }) => {
      ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: mockNotificationScrollToOffset }));
      mockNotificationFlashListExtraData = extraData;
      mockNotificationFlashListData = data;
      mockNotificationNestedScrollEnabled = nestedScrollEnabled;
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
    activeSources: ['nodeseek', 'linuxdo', 'yaohuo'] as const,
    enabledSources: ['nodeseek', 'linuxdo', 'yaohuo'] as const,
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
    onChangeSource: jest.fn(),
    onChangeUnreadOnly: jest.fn(),
    onItemPress: jest.fn(),
    onLoadMore: jest.fn(),
    onMarkAll: jest.fn(),
    onRefresh: jest.fn(),
    onRetryAccountStatus: jest.fn(),
    onLoginSource: jest.fn(),
    onRetrySource: jest.fn()
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
      yaohuo: { ...sourceState }
    }
  };
}

describe('notification screens', () => {
  const imageDetail = {
    notification: { ...notification, kind: 'private-message' as const },
    title: '私信图片',
    messages: [
      {
        id: 'photo',
        author: 'Bob',
        createdAt: null,
        contentHtml:
          '<p><img src="https://www.nodeseek.com/photo-thumb.png" data-original="https://www.nodeseek.com/photo-original.png" width="300" height="200" alt="第一张" referrerpolicy="no-referrer"></p>'
      },
      {
        id: 'sticker',
        author: 'Bob',
        createdAt: null,
        contentHtml:
          '<p><img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/04.png" alt="ac04" width="64" height="64"></p><p>文字<img class="emoji" src="https://linux.do/images/emoji/twemoji/smile.png" alt=":smile:" width="20" height="20"></p><p><a href="https://example.com/page">外部链接</a><a href="https://linux.do/t/topic/123/4">主题链接</a></p>'
      }
    ]
  };

  it('displays message bitmaps from their real load when native size probing rejects the image scheme', async () => {
    jest.spyOn(Image, 'getSize').mockImplementation((_uri, _success, failure) => {
      failure?.(new Error('Unsupported uri scheme for encoded image fetch!'));
    });
    const detail = {
      ...imageDetail,
      messages: [
        {
          id: 'embedded',
          author: 'Bob',
          createdAt: null,
          contentHtml: '<img src="data:image/png;base64,aW1hZ2U=" alt="嵌入图片">'
        }
      ]
    };
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={detail}
        loading={false}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    expect(view.queryByTestId('image-error')).toBeNull();
    await fireEvent(view.getByLabelText('嵌入图片'), 'load', { nativeEvent: { source: { width: 960, height: 640 } } });
    expect(StyleSheet.flatten(view.getByLabelText('嵌入图片').props.style)).toMatchObject({
      width: 259,
      height: (259 * 640) / 960
    });
    await fireEvent.press(view.getByLabelText('预览图片：嵌入图片'));
    expect(view.getByTestId('message-image-preview')).toBeTruthy();
  });

  it('preserves small photos, bounds portrait height without cropping, and keeps failed photos previewable', async () => {
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={{
          ...imageDetail,
          messages: [
            {
              id: 'dimensions',
              author: 'Bob',
              createdAt: null,
              contentHtml:
                '<img src="https://example.com/small.png" width="48" height="32" alt="小图片"><img src="https://example.com/portrait.png" width="640" height="960" alt="竖图片">'
            }
          ]
        }}
        loading={false}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />
    );
    await fireEvent(view.getByLabelText('小图片'), 'load', { nativeEvent: { source: { width: 960, height: 640 } } });
    expect(StyleSheet.flatten(view.getByLabelText('小图片').props.style)).toMatchObject({ width: 48, height: 32 });
    await fireEvent(view.getByLabelText('竖图片'), 'load', { nativeEvent: { source: { width: 640, height: 960 } } });
    const portraitSize = StyleSheet.flatten(view.getByLabelText('竖图片').props.style);
    expect(portraitSize.height).toBe(320);
    expect(portraitSize.width / portraitSize.height).toBeCloseTo(640 / 960);
    await fireEvent(view.getByLabelText('竖图片'), 'error', { nativeEvent: { error: 'decode failed' } });
    expect(view.getByText('图片加载失败：竖图片')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('预览图片：竖图片'));
    expect(JSON.parse(view.getByTestId('message-preview-data').props.children).index).toBe(1);
  });

  it('suspends pending and new automatic scrolling while a photo preview is open and resumes the existing follow state', async () => {
    const frames: FrameRequestCallback[] = [];
    const animation = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(() => undefined);
    const flushFrames = async () => {
      const pending = frames.splice(0);
      await act(() => {
        pending.forEach((callback) => callback(0));
      });
    };
    try {
      const view = await render(
        <NotificationDetailScreen
          contentWidth={360}
          detail={imageDetail}
          loading={false}
          onOpenTopic={jest.fn()}
          onRetry={jest.fn()}
        />
      );
      const scroll = view.getByTestId('notification-detail-scroll');
      await fireEvent(scroll, 'contentSizeChange', 360, 1200);
      await fireEvent.press(view.getByLabelText('预览图片：第一张'));
      await flushFrames();
      expect(scrollToEnd).not.toHaveBeenCalled();
      await fireEvent(scroll, 'contentSizeChange', 360, 1300);
      await flushFrames();
      expect(scrollToEnd).not.toHaveBeenCalled();
      await fireEvent.press(view.getByLabelText('关闭图片预览'));
      expect(scrollToEnd).not.toHaveBeenCalled();
      await fireEvent(scroll, 'contentSizeChange', 360, 1400);
      await flushFrames();
      expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
    } finally {
      animation.mockRestore();
      scrollToEnd.mockRestore();
    }
  });

  it('opens private-message photos and stickers in one native preview gallery without moving the conversation', async () => {
    const onOpenExternalUrl = jest.fn();
    const onOpenTopic = jest.fn();
    const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(() => undefined);
    try {
      const view = await render(
        <NotificationDetailScreen
          contentWidth={360}
          detail={imageDetail}
          loading={false}
          onOpenExternalUrl={onOpenExternalUrl}
          onOpenTopic={onOpenTopic}
          onRetry={jest.fn()}
        />
      );
      const scroll = view.getByTestId('notification-detail-scroll');
      const imageHeaders = view.getByLabelText('第一张').props.source[0].headers;
      expect(imageHeaders).toMatchObject({
        'X-WZ-Forum-Media-Source': 'nodeseek',
        'X-WZ-Forum-Media-Identity': expect.stringContaining('nodeseek:')
      });
      expect(imageHeaders?.Referer).toBeUndefined();
      await fireEvent(scroll, 'scrollBeginDrag');
      await fireEvent.press(view.getByLabelText('预览图片：第一张'));
      const first = JSON.parse(view.getByTestId('message-preview-data').props.children);
      expect(first).toMatchObject({
        contentSource: 'nodeseek',
        index: 0,
        referrer: { documentUrl: 'https://www.nodeseek.com' }
      });
      expect(first.items).toHaveLength(2);
      expect(first.items[0]).toMatchObject({
        originalUri: 'https://www.nodeseek.com/photo-original.png',
        referrerPolicy: 'no-referrer'
      });
      await fireEvent.press(view.getByLabelText('关闭图片预览'));
      expect(view.queryByTestId('message-image-preview')).toBeNull();
      await fireEvent.press(view.getByLabelText('预览图片：ac04'));
      expect(JSON.parse(view.getByTestId('message-preview-data').props.children).index).toBe(1);
      await fireEvent.press(view.getByLabelText('预览切到第一张'));
      expect(JSON.parse(view.getByTestId('message-preview-data').props.children).index).toBe(0);
      await fireEvent.press(view.getByLabelText('关闭图片预览'));
      await fireEvent.press(view.getByLabelText(':smile:'));
      expect(view.queryByTestId('message-image-preview')).toBeNull();
      await fireEvent.press(view.getByText('外部链接'));
      expect(onOpenExternalUrl).toHaveBeenCalledTimes(1);
      expect(onOpenExternalUrl).toHaveBeenCalledWith('https://example.com/page');
      await fireEvent.press(view.getByText('主题链接'));
      expect(onOpenTopic).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'linuxdo', id: '123' }),
        expect.anything()
      );
      expect(scrollToEnd).not.toHaveBeenCalled();
      expect(view.getByTestId('notification-detail-scroll')).toBe(scroll);
    } finally {
      scrollToEnd.mockRestore();
    }
  });

  it.each(['blur', 'identity', 'unavailable', 'conversation'] as const)(
    'closes private image previews on %s changes',
    async (change) => {
      const tree = (changed: boolean) => (
        <ForumSessionEpochProvider
          sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: changed && change === 'identity' ? 1 : 0 }}
        >
          <NotificationDetailScreen
            contentWidth={360}
            detail={
              changed && change === 'unavailable'
                ? undefined
                : changed && change === 'conversation'
                  ? { ...imageDetail, notification: { ...imageDetail.notification, id: 'next' } }
                  : imageDetail
            }
            routeActive={!(changed && change === 'blur')}
            loading={false}
            onOpenTopic={jest.fn()}
            onRetry={jest.fn()}
          />
        </ForumSessionEpochProvider>
      );
      const view = await render(tree(false));
      await fireEvent.press(view.getByLabelText('预览图片：第一张'));
      expect(view.getByTestId('message-image-preview')).toBeTruthy();
      await view.rerender(tree(true));
      expect(view.queryByTestId('message-image-preview')).toBeNull();
    }
  );

  it('shows a source history limit without inventing a next page', async () => {
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        source="linuxdo"
        historyNotices={{ linuxdo: '仅显示近期私信' }}
        hasMore={false}
      />
    );
    expect(view.getByText('仅显示近期私信')).toBeTruthy();
    expect(view.queryByRole('button', { name: '继续加载消息' })).toBeNull();
    expect(view.queryByTestId('notification-list-end-reached')).toBeNull();
  });

  it('explains independent source pagination without treating a failed site as complete', async () => {
    const onLoadMore = jest.fn();
    const props = {
      ...listProps(),
      pagination: { nodeseek: 'more', linuxdo: 'complete', yaohuo: 'complete' } as const,
      errors: { yaohuo: { kind: 'ordinary', message: '连接中断' } } as const,
      hasMore: true,
      onLoadMore
    };
    const view = await render(<NotificationsScreen {...props} />);
    expect(view.getByText('NodeSeek · 还有更多消息')).toBeTruthy();
    expect(view.getByText('linux.do · 已到当前末尾')).toBeTruthy();
    expect(view.getByText('妖火 · 读取中断，可重试')).toBeTruthy();
    expect(view.queryByText('各站当前可提供的消息已加载完成')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '继续加载消息' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    await view.rerender(<NotificationsScreen {...props} hasMore={false} />);
    expect(view.queryByRole('button', { name: '继续加载消息' })).toBeNull();
    expect(view.queryByText('各站当前可提供的消息已加载完成')).toBeNull();
    expect(view.getByRole('button', { name: '重试 妖火' })).toBeTruthy();
    await view.rerender(
      <NotificationsScreen
        {...props}
        hasMore={false}
        errors={{}}
        pagination={{ nodeseek: 'complete', linuxdo: 'complete', yaohuo: 'complete' }}
      />
    );
    expect(view.getByText('各站当前可提供的消息已加载完成')).toBeTruthy();
    expect(view.queryByText('linux.do · 已到当前末尾')).toBeNull();
  });

  it('resets list position only when filters change and suppresses pagination during manual refresh', async () => {
    const props = listProps();
    const view = await render(<NotificationsScreen {...props} hasMore />);
    mockNotificationScrollToOffset.mockClear();
    await view.rerender(<NotificationsScreen {...props} hasMore refreshing />);
    expect(view.queryByTestId('notification-list-end-reached')).toBeNull();
    expect(mockNotificationScrollToOffset).not.toHaveBeenCalled();
    await view.rerender(<NotificationsScreen {...props} hasMore unreadOnly />);
    expect(mockNotificationScrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
    expect(view.getByTestId('notification-list-end-reached')).toBeTruthy();
  });

  it('lets repeated manual scrolling interrupt pending bottom-follow across new messages and return-to-latest actions', async () => {
    const frames: FrameRequestCallback[] = [];
    const animation = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const flushFrames = async () => {
      const pending = frames.splice(0);
      await act(() => pending.forEach((callback) => callback(0)));
    };
    const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(() => undefined);
    const message = { id: '1', author: '张三', contentText: '历史消息', createdAt: null };
    const props = {
      contentWidth: 360,
      loading: false,
      onOpenTopic: jest.fn(),
      onRetry: jest.fn(),
      detail: { notification, title: '会话', messages: [message] }
    };
    try {
      const view = await render(<NotificationDetailScreen {...props} />);
      const scroll = view.getByTestId('notification-detail-scroll');
      const position = {
        nativeEvent: {
          contentOffset: { x: 0, y: 0 },
          contentSize: { width: 360, height: 1200 },
          layoutMeasurement: { width: 360, height: 600 }
        }
      };
      await fireEvent.scroll(scroll, position);
      await fireEvent(scroll, 'contentSizeChange', 360, 1200);
      // A real drag takes ownership even if the previous content layout queued a follow frame.
      await fireEvent(scroll, 'scrollBeginDrag');
      await fireEvent.scroll(scroll, position);
      await flushFrames();
      expect(scrollToEnd).not.toHaveBeenCalled();
      await view.rerender(
        <NotificationDetailScreen
          {...props}
          detail={{ ...props.detail, messages: [message, { ...message, id: '2', contentText: '新消息' }] }}
        />
      );
      await fireEvent(view.getByTestId('notification-detail-scroll'), 'contentSizeChange', 360, 1300);
      await flushFrames();
      expect(scrollToEnd).not.toHaveBeenCalled();
      await fireEvent.press(view.getByRole('button', { name: '回到最新消息' }));
      expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
      expect(view.queryByRole('button', { name: '回到最新消息' })).toBeNull();

      await fireEvent(scroll, 'contentSizeChange', 360, 1400);
      await fireEvent(scroll, 'scrollBeginDrag');
      await fireEvent.scroll(scroll, position);
      await flushFrames();
      expect(scrollToEnd).toHaveBeenCalledTimes(1);
      expect(view.getByRole('button', { name: '回到最新消息' })).toBeTruthy();
      await fireEvent.press(view.getByRole('button', { name: '回到最新消息' }));
      await fireEvent(scroll, 'contentSizeChange', 360, 1500);
      await flushFrames();
      expect(scrollToEnd.mock.calls.map(([options]) => options)).toEqual([
        { animated: true },
        { animated: true },
        { animated: false }
      ]);
      expect(view.getByTestId('notification-detail-scroll')).toBe(scroll);
      expect(view.getByText('新消息')).toBeTruthy();
    } finally {
      animation.mockRestore();
      scrollToEnd.mockRestore();
    }
  });

  it('loads earlier messages explicitly, preserves readable messages on failure and stops following the bottom', async () => {
    const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(() => undefined);
    const onLoadEarlierMessages = jest.fn();
    const onResetMessageHistory = jest.fn();
    const message = { id: '31', author: '张三', contentText: '已看到的消息', createdAt: null };
    const props = {
      contentWidth: 360,
      loading: false,
      onOpenTopic: jest.fn(),
      onRetry: jest.fn(),
      onLoadEarlierMessages,
      onResetMessageHistory,
      detail: { notification, title: '会话', messages: [message], messageHistory: { olderCursor: '31' } }
    };
    try {
      const view = await render(<NotificationDetailScreen {...props} />);
      await fireEvent.press(view.getByRole('button', { name: '加载更早消息' }));
      expect(onLoadEarlierMessages).toHaveBeenCalledTimes(1);
      await view.rerender(<NotificationDetailScreen {...props} historyBusy />);
      expect(view.getByRole('button', { name: '加载更早消息' })).toBeDisabled();
      await view.rerender(<NotificationDetailScreen {...props} historyError="网络暂不可用" />);
      expect(view.getByText('已看到的消息')).toBeTruthy();
      expect(view.getByText('网络暂不可用')).toBeTruthy();
      await fireEvent.press(view.getByRole('button', { name: '重新读取会话' }));
      expect(onResetMessageHistory).toHaveBeenCalledTimes(1);
      await fireEvent.press(view.getByRole('button', { name: '加载更早消息' }));
      expect(onLoadEarlierMessages).toHaveBeenCalledTimes(2);
      await view.rerender(
        <NotificationDetailScreen
          {...props}
          detail={{
            ...props.detail,
            messages: [{ ...message, id: '1', contentText: '更早的消息' }, message],
            messageHistory: { olderCursor: null }
          }}
        />
      );
      await fireEvent(view.getByTestId('notification-detail-scroll'), 'contentSizeChange', 360, 1300);
      expect(scrollToEnd).not.toHaveBeenCalled();
      expect(view.getByText('已到最早消息')).toBeTruthy();
      await view.rerender(
        <NotificationDetailScreen
          {...props}
          detail={{ ...props.detail, messageHistory: { olderCursor: null } }}
          historyError="历史游标重复，请重新读取"
        />
      );
      expect(view.queryByText('已到最早消息')).toBeNull();
      expect(view.getByRole('button', { name: '重新读取会话' })).toBeTruthy();
      expect(view.queryByRole('button', { name: '加载更早消息' })).toBeNull();
      expect(view.getByText('已看到的消息')).toBeTruthy();
    } finally {
      scrollToEnd.mockRestore();
    }
  });

  it('distinguishes a failed empty list from an empty inbox and offers unread recovery', async () => {
    const onChangeUnreadOnly = jest.fn();
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        items={[]}
        errors={{ nodeseek: { kind: 'ordinary', message: '网络中断' } }}
      />
    );
    expect(view.getByText('消息暂未加载成功')).toBeTruthy();
    expect(view.queryByText('暂无消息')).toBeNull();
    await view.rerender(
      <NotificationsScreen {...listProps()} items={[]} unreadOnly onChangeUnreadOnly={onChangeUnreadOnly} />
    );
    await fireEvent.press(view.getByRole('button', { name: '查看全部消息' }));
    expect(onChangeUnreadOnly).toHaveBeenCalledWith(false);
  });

  it('keeps account confirmation distinct from login actions', async () => {
    const view = await render(
      <NotificationsScreen {...listProps()} activeSources={[]} items={[]} source="nodeseek" sourceUnknown />
    );
    expect(view.getAllByRole('button', { name: '重试账号核对' })).toHaveLength(1);
    expect(view.queryByRole('button', { name: '去登录 NodeSeek' })).toBeNull();
    await view.rerender(
      <NotificationsScreen {...listProps()} activeSources={[]} items={[]} source="nodeseek" sourcePending />
    );
    expect(view.queryByRole('button', { name: '去登录 NodeSeek' })).toBeNull();
  });

  it('retains a loaded conversation and exposes refresh failure and the saved draft', async () => {
    const onRetry = jest.fn();
    const onOpenReply = jest.fn();
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={{
          notification,
          title: '会话',
          messages: [{ id: 'm1', author: '张三', contentText: '已有消息', createdAt: null }],
          reply: { format: 'plain-text' }
        }}
        loading={false}
        error="会话刷新失败"
        replyContent="还没写完的回复"
        onOpenReply={onOpenReply}
        onOpenTopic={jest.fn()}
        onRetry={onRetry}
      />
    );
    expect(view.getByText('已有消息')).toBeTruthy();
    expect(view.getByText('会话刷新失败')).toBeTruthy();
    expect(
      within(view.getByTestId('notification-detail-scroll')).queryByRole('button', { name: '重试读取消息' })
    ).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '重试读取消息' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(view.getByText('草稿')).toBeTruthy();
    expect(view.getByText('还没写完的回复')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: '继续编辑私信草稿' }));
    expect(onOpenReply).toHaveBeenCalledTimes(1);
  });

  it('reuses visible items across loading changes and equivalent source membership', async () => {
    const props = listProps();
    const view = await render(<NotificationsScreen {...props} />);
    const visible = mockNotificationFlashListData;
    await view.rerender(
      <NotificationsScreen {...props} refreshing activeSources={['yaohuo', 'linuxdo', 'nodeseek']} />
    );
    expect(mockNotificationFlashListData).toBe(visible);
    await view.rerender(<NotificationsScreen {...props} activeSources={['linuxdo']} />);
    expect(mockNotificationFlashListData).toEqual([]);
  });
  it('invalidates the mounted message list when reader appearance changes', async () => {
    const darkSettings: ReaderSettings = { ...createEmptyReaderData().settings, theme: 'dark' };
    const lightSettings: ReaderSettings = { ...darkSettings, theme: 'light' };
    const themedScreen = (settings: ReaderSettings) => (
      <ReaderStyleProvider value={{ settings, theme: createTheme(settings) }}>
        <NotificationsScreen {...listProps()} />
      </ReaderStyleProvider>
    );
    const view = await render(themedScreen(darkSettings));

    expect(mockNotificationFlashListExtraData).toBe(darkSettings);
    await view.rerender(themedScreen(lightSettings));
    expect(mockNotificationFlashListExtraData).toBe(lightSettings);
  });

  it('uses the enabled content-source order for tabs and hides disabled-source rows and errors', async () => {
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        activeSources={['linuxdo', 'nodeseek']}
        enabledSources={['linuxdo', 'nodeseek']}
        errors={{
          linuxdo: { kind: 'ordinary', message: '暂不可用' },
          yaohuo: { kind: 'ordinary', message: '不应展示' }
        }}
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

  it('renders one compact retry action for each failed source', async () => {
    const onItemPress = jest.fn();
    const onRetrySource = jest.fn();
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        errors={{
          linuxdo: { kind: 'ordinary', message: '暂不可用' },
          yaohuo: { kind: 'ordinary', message: '读取失败' }
        }}
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

  it('renders adapter-owned categories only for a selected source', async () => {
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

    expect(mockNotificationNestedScrollEnabled).toBe(false);
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

  it('shows a signed-in source as confirming while its identity is pending', async () => {
    const view = await render(
      <NotificationsScreen {...listProps()} activeSources={[]} items={[]} source="linuxdo" sourcePending />
    );

    expect(view.getByText('账号确认中')).toBeTruthy();
    expect(view.getByText('正在确认linux.do账号身份；完成后会自动加载消息。')).toBeTruthy();
    expect(view.queryByText(/请先登录/)).toBeNull();
    expect(view.queryByLabelText('重试账号核对')).toBeNull();
  });

  it('presents a terminal unknown message source as retryable instead of logged out', async () => {
    const onRetryAccountStatus = jest.fn();
    const view = await render(
      <NotificationsScreen
        {...listProps()}
        activeSources={[]}
        items={[]}
        source="yaohuo"
        sourceUnknown
        onRetryAccountStatus={onRetryAccountStatus}
      />
    );

    expect(view.getByText('账号状态暂不可确认')).toBeTruthy();
    expect(view.getByText('本次账号核对失败；消息请求已暂停，可在账号中心重试核对。')).toBeTruthy();
    expect(view.queryByText('请先登录 妖火，并确认账号身份。')).toBeNull();
    await fireEvent.press(view.getByLabelText('重试账号核对'));
    expect(onRetryAccountStatus).toHaveBeenCalledTimes(1);
  });

  it('never renders cached private rows for a pending source', async () => {
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
    await fireEvent.press(view.getByText('查看完整主题'), { nativeEvent: { pageX: 120, pageY: 300 } });
    expect(onOpenTopic).toHaveBeenCalledWith();
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

  it('gives rich notification links the app accent affordance', async () => {
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

  it('keeps a Topic audio fallback link in notification detail without adding player controls', async () => {
    const onOpenExternalUrl = jest.fn();
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={{
          notification: { ...notification, kind: 'system' },
          title: '消息详情',
          contentHtml:
            '<forum-audio src="https://media.example/topic.mp3"><a href="https://media.example/topic.mp3">打开音频</a></forum-audio>'
        }}
        loading={false}
        onOpenExternalUrl={onOpenExternalUrl}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />
    );

    expect(view.queryByLabelText('播放音频')).toBeNull();
    await fireEvent.press(view.getByRole('link', { name: '打开音频' }));
    expect(onOpenExternalUrl).toHaveBeenCalledWith('https://media.example/topic.mp3');
  });

  it('keeps Yaohuo topic links in-app and preserves the full-reply page', async () => {
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
      kind: 'reply',
      target: { floor: 90 }
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

  it('keeps fixed detail actions above the bottom safe area', async () => {
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

  it('keeps the fixed message editor flexible with its fullscreen and submit actions accessible', async () => {
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

    expect(view.getByTestId('composer-bottom-sheet')).toHaveProp('pointerEvents', 'auto');
    expect(StyleSheet.flatten(view.getByTestId('composer-bottom-sheet-content').props.style).flex).toBe(1);
    expect(view.getByLabelText('全屏')).toBeTruthy();
    expect(view.getByLabelText('发送回复')).toBeTruthy();
    mockSafeAreaBottom = 0;
    mockSafeAreaTop = 0;
  });

  it('renders ordered conversation bubbles and the site-format reply composer', async () => {
    const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd').mockImplementation(() => undefined);
    const onOpenReply = jest.fn();
    const onReplyContentChange = jest.fn();
    const onReplyClose = jest.fn();
    const onReplySnapshot = jest.fn();
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
      onReplyClose,
      onReplyContentChange,
      onReplySnapshot,
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
    expect(view.getByTestId('notification-detail-scroll').props.maintainVisibleContentPosition).toEqual({
      minIndexForVisible: 2
    });
    expect(view.getByText(formatDateTime('2026-08-03T10:00:00Z'))).toBeTruthy();
    expect(view.getByText(formatDateTime('2026-08-03T10:01:00Z'))).toBeTruthy();
    fireEvent(view.getByTestId('notification-detail-scroll'), 'contentSizeChange', 360, 640);
    await waitFor(() => expect(scrollToEnd).toHaveBeenCalledWith({ animated: false }));
    expect(view.getByText('原站仅提供最近 20 条聊天记录。')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('继续编辑私信草稿'));
    expect(onOpenReply).toHaveBeenCalledTimes(1);
    expect(view.getByText('草稿')).toBeTruthy();

    await view.rerender(<NotificationDetailScreen {...props} replyVisible />);
    const webView = view.getByTestId('structured-composer-webview');
    expect(view.queryByPlaceholderText('输入回复内容')).toBeNull();
    await fireEvent(webView, 'loadEnd');
    await waitFor(() =>
      expect(
        webView.props.postMessageMock.mock.calls
          .map(([message]: [string]) => JSON.parse(message))
          .some(
            (message: { type: string; payload?: { markdown?: string } }) =>
              message.type === 'INIT' && message.payload?.markdown === '保留草稿'
          )
      ).toBe(true)
    );
    await fireEvent(webView, 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'READY', payload: { revision: 0 } }) }
    });
    await fireEvent(webView, 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: 'STATE_CHANGED',
          payload: { revision: 0, mode: 'rich', isEmpty: false, canUndo: false, canRedo: false }
        })
      }
    });
    await view.rerender(<NotificationDetailScreen {...props} replyBusy replyVisible />);
    expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(true);
    await view.rerender(<NotificationDetailScreen {...props} replyVisible />);
    await fireEvent(webView, 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: 'SNAPSHOT',
          payload: {
            snapshot: {
              revision: 1,
              markdown: '新草稿',
              mode: 'rich',
              isEmpty: false,
              validationIssues: [],
              pendingNodeSeekPolls: []
            }
          }
        })
      }
    });
    expect(onReplyContentChange).toHaveBeenCalledWith('新草稿');
    await fireEvent.press(view.getByLabelText('发送回复'));
    const request = [...webView.props.postMessageMock.mock.calls]
      .map(([message]: [string]) => JSON.parse(message))
      .findLast((message) => message.type === 'REQUEST_SNAPSHOT');
    await fireEvent(webView, 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: 'SNAPSHOT',
          payload: {
            requestId: request.payload.requestId,
            snapshot: {
              revision: 1,
              markdown: '新草稿',
              mode: 'rich',
              isEmpty: false,
              validationIssues: [],
              pendingNodeSeekPolls: []
            }
          }
        })
      }
    });
    await waitFor(() => expect(onSubmitReply).toHaveBeenCalledTimes(1));

    onReplyClose.mockClear();
    onReplySnapshot.mockClear();
    await fireEvent.press(view.getByLabelText('取消'));
    const closeRequest = [...webView.props.postMessageMock.mock.calls]
      .map(([message]: [string]) => JSON.parse(message))
      .findLast((message) => message.type === 'REQUEST_SNAPSHOT');
    await fireEvent(webView, 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: 'SNAPSHOT',
          payload: {
            requestId: closeRequest.payload.requestId,
            snapshot: {
              revision: 1,
              markdown: '关闭前草稿',
              mode: 'rich',
              isEmpty: false,
              validationIssues: [],
              pendingNodeSeekPolls: []
            }
          }
        })
      }
    });
    await waitFor(() => expect(onReplyClose).toHaveBeenCalledTimes(1));
    expect(onReplySnapshot).toHaveBeenCalledTimes(1);

    await view.unmount();
    const linuxDoView = await render(
      <NotificationDetailScreen
        {...props}
        detail={{ ...detail, notification: { ...detail.notification, source: 'linuxdo' } }}
        discourseEmojiUrls={{ party_parrot: 'https://example.com/party.png' }}
        replyVisible
      />
    );
    const linuxDoWebView = linuxDoView.getByTestId('structured-composer-webview');
    await fireEvent(linuxDoWebView, 'loadEnd');
    await waitFor(() =>
      expect(
        linuxDoWebView.props.postMessageMock.mock.calls
          .map(([message]: [string]) => JSON.parse(message))
          .find((message: { type: string }) => message.type === 'INIT')?.payload.discourseEmoji
      ).toEqual([{ name: 'party_parrot', url: 'https://example.com/party.png' }])
    );

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
    expect(yaohuoView.getByLabelText('私信回复内容')).toBeTruthy();
    expect(yaohuoView.queryByLabelText('表情')).toBeNull();
    expect(yaohuoView.queryByLabelText('图片')).toBeNull();
    scrollToEnd.mockRestore();
  });

  it('snapshots exactly once before route blur closes the structured composer', async () => {
    const onReplyClose = jest.fn();
    const onReplySnapshot = jest.fn();
    const detail = {
      notification: { ...notification, kind: 'private-message' as const },
      title: '与 Bob 的私信',
      messages: [],
      reply: { format: 'markdown' as const }
    };
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={detail}
        loading={false}
        replyContent="路由切换前草稿"
        replyVisible
        routeActive
        onOpenTopic={jest.fn()}
        onReplyClose={onReplyClose}
        onReplySnapshot={onReplySnapshot}
        onRetry={jest.fn()}
      />
    );
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'loadEnd');
    await fireEvent(webView, 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'READY', payload: { revision: 0 } }) }
    });

    await view.rerender(
      <NotificationDetailScreen
        contentWidth={360}
        detail={detail}
        loading={false}
        replyContent="路由切换前草稿"
        replyVisible
        routeActive={false}
        onOpenTopic={jest.fn()}
        onReplyClose={onReplyClose}
        onReplySnapshot={onReplySnapshot}
        onRetry={jest.fn()}
      />
    );
    const requests = webView.props.postMessageMock.mock.calls
      .map(([message]: [string]) => JSON.parse(message))
      .filter((message: { type: string }) => message.type === 'REQUEST_SNAPSHOT');
    expect(requests).toHaveLength(1);
    expect(onReplyClose).not.toHaveBeenCalled();

    await fireEvent(webView, 'message', {
      nativeEvent: {
        data: JSON.stringify({
          type: 'SNAPSHOT',
          payload: {
            requestId: requests[0].payload.requestId,
            snapshot: {
              revision: 1,
              markdown: '路由切换前草稿',
              mode: 'rich',
              isEmpty: false,
              validationIssues: [],
              pendingNodeSeekPolls: []
            }
          }
        })
      }
    });

    await waitFor(() => expect(onReplyClose).toHaveBeenCalledTimes(1));
    expect(onReplySnapshot).toHaveBeenCalledTimes(1);
  });

  it.each(
    (['detail', 'original', 'message'] as const).flatMap((surface) =>
      (['light', 'dark'] as const).map((theme) => ({ surface, theme }))
    )
  )('preserves rich-text formatting in $surface content with $theme appearance', async ({ surface, theme: mode }) => {
    const settings = {
      ...createEmptyReaderData().settings,
      theme: mode,
      fontScale: mode === 'dark' ? 1.3 : 1,
      lineHeight: mode === 'dark' ? ('loose' as const) : ('standard' as const),
      fontFamily: 'serif' as const
    };
    const theme = createTheme(settings);
    const html =
      '<h2>小标题</h2><p>正文段落</p><p><strong>强调</strong> <em>斜体</em></p><blockquote>引用文字</blockquote><pre><code>const value = 1;</code></pre><p><span class="bbcode-u">下划线</span></p>' +
      '<p>表情前<img class="emoji" src="https://linux.do/images/emoji/twemoji/face_with_peeking_eye.png" alt=":face_with_peeking_eye:" width="20" height="20">表情后</p>';
    const view = await render(
      <NotificationDetailScreen
        contentWidth={360}
        detail={{
          notification,
          title: '通知',
          ...(surface !== 'message' ? { contentHtml: html } : {}),
          ...(surface !== 'detail'
            ? {
                messages:
                  surface === 'message'
                    ? [{ id: 'formatted', author: '作者', contentHtml: html, createdAt: null, mine: false }]
                    : []
              }
            : {})
        }}
        loading={false}
        onOpenTopic={jest.fn()}
        onRetry={jest.fn()}
      />,
      { wrapper: ({ children }) => <ReaderStyleProvider value={{ settings, theme }}>{children}</ReaderStyleProvider> }
    );
    const style = (text: string) => StyleSheet.flatten(view.getByText(text).props.style);
    const ancestorStyles = (text: string) => {
      const styles = [];
      for (let node = view.getByText(text); node; node = node.parent!) {
        styles.push(StyleSheet.flatten(node.props.style));
      }
      return styles;
    };
    expect(style('小标题').fontSize).toBeGreaterThan(style('正文段落').fontSize);
    expect(style('正文段落')).toMatchObject({
      color: theme.ink,
      fontFamily: 'serif',
      fontSize: Math.round((surface === 'message' ? 14 : 15) * settings.fontScale),
      lineHeight: Math.round(
        Math.round((surface === 'message' ? 14 : 15) * settings.fontScale) * lineHeightMultiplier(settings.lineHeight)
      )
    });
    expect(['bold', '700']).toContain(style('强调').fontWeight);
    expect(style('斜体').fontStyle).toBe('italic');
    expect(style('下划线').textDecorationLine).toBe('underline');
    expect(style('const value = 1;').fontFamily).toBe('monospace');
    expect(ancestorStyles('正文段落')).toContainEqual(
      expect.objectContaining({ marginBottom: surface === 'message' ? 6 : 18 })
    );
    expect(ancestorStyles('引用文字')).toContainEqual(expect.objectContaining({ borderLeftWidth: 2 }));
    expect(view.getByText('表情前表情后')).toBeTruthy();
    const emoji = view.getByLabelText(':face_with_peeking_eye:');
    expect(StyleSheet.flatten(emoji.props.style)).toMatchObject({
      height: Math.round(20 * settings.fontScale),
      width: Math.round(20 * settings.fontScale) + 4
    });
    await fireEvent(emoji, 'error', { nativeEvent: { error: 'unavailable' } });
    expect(view.getByText('表情前:face_with_peeking_eye:表情后')).toBeTruthy();
  });

  it('renders NodeSeek private-message Markdown and stickers as forum content', async () => {
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

    expect(StyleSheet.flatten(view.getByText('WZ-NS-RENDER').props.style).fontWeight).toBe('700');
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
        sessions={projectTestAccountSessions(createSiteSessionStates())}
        state={notificationState()}
        onOpenSystemSettings={jest.fn()}
        onToggleGlobal={jest.fn()}
        onToggleSource={jest.fn()}
      />
    );

    const sourceToggles = view
      .getAllByRole('switch')
      .map((element) => element.props.accessibilityLabel as string)
      .filter((label) => label !== 'Android 消息通知');
    expect(sourceToggles).toEqual(['linux.do 消息通知', 'NodeSeek 消息通知']);
    expect(view.queryByLabelText('妖火 消息通知')).toBeNull();
  });

  it('forwards every source toggle', async () => {
    const onToggleSource = jest.fn();
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        enabledSources={['nodeseek', 'linuxdo', 'yaohuo']}
        permission="granted"
        sessions={projectTestAccountSessions(createSiteSessionStates())}
        state={notificationState()}
        onOpenSystemSettings={jest.fn()}
        onToggleGlobal={jest.fn()}
        onToggleSource={onToggleSource}
      />
    );

    for (const [label, source] of [
      ['NodeSeek', 'nodeseek'],
      ['linux.do', 'linuxdo'],
      ['妖火', 'yaohuo']
    ] as const) {
      await fireEvent(view.getByLabelText(`${label} 消息通知`), 'valueChange', true);
      expect(onToggleSource).toHaveBeenLastCalledWith(source, true);
    }
  });

  it('keeps a signed-in LinuxDo notification source available while its account check runs', async () => {
    const sessions = projectTestAccountSessions(
      createSiteSessionStates({
        linuxdo: {
          site: 'linuxdo',
          status: 'logged-in',
          cookieSummary: [],
          isVerifying: true,
          currentUser: {
            source: 'linuxdo',
            id: '7',
            username: 'temple-user',
            url: 'https://linux.do/u/temple-user'
          }
        }
      })
    );
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        enabledSources={['nodeseek', 'linuxdo', 'yaohuo']}
        permission="granted"
        sessions={sessions}
        state={notificationState()}
        onOpenSystemSettings={jest.fn()}
        onToggleGlobal={jest.fn()}
        onToggleSource={jest.fn()}
      />
    );

    expect(view.getByText('已关闭')).toBeTruthy();
    expect(view.getAllByText('未登录；开关意图会保留')).toHaveLength(2);
  });

  it('shows terminal unknown as retryable instead of logged out', async () => {
    const sessions = projectTestAccountSessions(createSiteSessionStates());
    sessions.yaohuo = { ...sessions.yaohuo, identityTrust: 'unknown' };
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        enabledSources={['nodeseek', 'linuxdo', 'yaohuo']}
        permission="granted"
        sessions={sessions}
        state={notificationState()}
        onOpenSystemSettings={jest.fn()}
        onToggleGlobal={jest.fn()}
        onToggleSource={jest.fn()}
      />
    );

    expect(view.getByText('账号状态暂不可确认；开关意图会保留，可重试核对')).toBeTruthy();
    expect(view.getAllByText('未登录；开关意图会保留')).toHaveLength(2);
  });

  it('keeps denied permission intent visible and offers system settings', async () => {
    const onOpenSystemSettings = jest.fn();
    const view = await render(
      <NotificationSettingsScreen
        backgroundEnabled={false}
        backgroundError=""
        busy={false}
        enabledSources={['nodeseek', 'linuxdo', 'yaohuo']}
        permission="denied"
        sessions={projectTestAccountSessions(createSiteSessionStates())}
        state={notificationState()}
        onOpenSystemSettings={onOpenSystemSettings}
        onToggleGlobal={jest.fn()}
        onToggleSource={jest.fn()}
      />
    );

    expect(view.getByText('系统通知权限未开启')).toBeTruthy();
    await fireEvent.press(view.getByText('打开系统设置'));
    expect(onOpenSystemSettings).toHaveBeenCalledTimes(1);
  });
});
