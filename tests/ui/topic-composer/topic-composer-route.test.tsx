import { useState } from 'react';
import { Button, Text } from 'react-native';
import { createNavigationContainerRef, NavigationContainer, StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TopicDetail } from '@/domain/forum/models';
import type { ForumReadPlan } from '@/domain/forum/readPlan';
import { applyBookmarkToTopic } from '@/domain/forum/topicActionState';
import { TopicComposerRoute } from '@/features/topic-composer/TopicComposerRoute';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { act, fireEvent, render, waitFor } from '../render';

const mockRuntime = {
  sessionEpochs: { linuxdo: 0, nodeseek: 0, yaohuo: 0 },
  sessions: { linuxdo: { site: 'linuxdo', status: 'logged-in', currentUser: { id: 'alice' } } },
  getReadPlan: (): ForumReadPlan => ({
    source: 'linuxdo',
    operation: 'topic',
    state: 'ready',
    lane: 'authenticated',
    transport: 'managed-session',
    cacheScope: `authenticated:${mockRuntime.sessionEpochs.linuxdo}`
  }),
  getTopic: jest.fn(),
  notify: jest.fn()
};
const mockLeave = jest.fn(async (): Promise<boolean> => true);
let mockComposerNavigation: { back: () => void; manage: () => void } | undefined;
jest.mock('@/features/topic-composer/TopicComposerRouteRuntime', () => ({
  useTopicComposerRouteRuntime: () => mockRuntime
}));
jest.mock('@/features/topic-composer/useTopicComposerController', () => ({
  useTopicComposerController: ({
    onEdited,
    intent
  }: {
    onEdited: (source: string, id: string) => void;
    intent: { topicId: string };
  }) => ({
    leave: mockLeave,
    finish: () => onEdited('linuxdo', intent.topicId)
  })
}));
jest.mock('@/features/topic-composer/TopicComposerScreen', () => {
  const { Button } = require('react-native');
  return {
    TopicComposerScreen: ({
      controller,
      onBack,
      onManageSources
    }: {
      controller: { finish: () => void };
      onBack: () => void;
      onManageSources: () => void;
    }) => {
      mockComposerNavigation = { back: onBack, manage: onManageSources };
      return (
        <>
          <Button title="完成模拟保存" onPress={controller.finish} />
          <Button title="返回编辑前页面" onPress={onBack} />
          <Button title="管理内容来源" onPress={onManageSources} />
        </>
      );
    }
  };
});
const Stack = createNativeStackNavigator<RootStackParamList>();
const topicKey = (topicId: string, readPlanScope = 'authenticated:0') =>
  forumQueryKeys.topic({ source: 'linuxdo', topicId, scope: { linuxdo: 0, nodeseek: 0, yaohuo: 0 }, readPlanScope });
const key = topicKey('123');
const previous: TopicDetail = {
  source: 'linuxdo',
  id: '123',
  title: '旧标题',
  contentHtml: '旧正文',
  author: '楼主',
  url: 'https://linux.do/t/123',
  createdAt: '2026-01-01',
  replies: [{ author: '读者', commentId: 10, contentHtml: '之前加载的回复', createdAt: '2026-01-01' }],
  replyHasMore: true,
  replyNextPage: 4,
  replyNextOffset: 60,
  replyCompleteness: 'partial'
};
function Topic({ open }: { open: (topicId: string) => void }) {
  const [position, setPosition] = useState('第一页');
  return (
    <>
      <Text>{position}</Text>
      <Button title="保留阅读位置" onPress={() => setPosition('第 3 页 · 只看楼主')} />
      <Button title="编辑主帖" onPress={() => open('123')} />
      <Button title="编辑另一主题" onPress={() => open('456')} />
    </>
  );
}
function renderEditableTopic(navigationRef?: ReturnType<typeof createNavigationContainerRef<RootStackParamList>>) {
  return render(
    <QueryTestWrapper>
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
          <Stack.Screen name="Topic">
            {({ navigation }) => (
              <Topic
                open={(topicId) => navigation.push('TopicComposer', { kind: 'edit', source: 'linuxdo', topicId })}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="TopicComposer" component={TopicComposerRoute} />
          <Stack.Screen name="ReadingSettings">{() => <Text>阅读设置</Text>}</Stack.Screen>
          <Stack.Screen name="MainTabs">{() => <Text>我的</Text>}</Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </QueryTestWrapper>
  );
}
beforeEach(() => {
  appQueryClient.clear();
  mockRuntime.sessionEpochs.linuxdo = 0;
  mockRuntime.getTopic.mockReset();
  mockRuntime.notify.mockClear();
  mockLeave.mockReset().mockResolvedValue(true);
  mockComposerNavigation = undefined;
});

it.each([
  { action: 'back', label: '返回编辑前页面', destination: 'Topic' },
  { action: 'manage', label: '管理内容来源', destination: 'MainTabs' }
] as const)(
  'ignores queued composer $action but waits for draft permission on a visible press',
  async ({ action, label, destination }) => {
    const navigationRef = createNavigationContainerRef<RootStackParamList>();
    const view = await renderEditableTopic(navigationRef);
    await fireEvent.press(view.getByText('编辑主帖'));
    const queuedPress = mockComposerNavigation?.[action];
    if (!queuedPress) throw new Error('Expected the composer navigation action');

    await act(() => navigationRef.navigate('ReadingSettings'));
    expect(navigationRef.getCurrentRoute()?.name).toBe('ReadingSettings');
    await act(() => queuedPress());
    expect(navigationRef.getCurrentRoute()?.name).toBe('ReadingSettings');
    expect(mockLeave).not.toHaveBeenCalled();

    await act(() => navigationRef.goBack());
    expect(navigationRef.getCurrentRoute()?.name).toBe('TopicComposer');
    const leave = Promise.withResolvers<boolean>();
    mockLeave.mockReturnValueOnce(leave.promise);
    await fireEvent.press(view.getByText(label));
    expect(mockLeave).toHaveBeenCalledTimes(1);
    expect(navigationRef.getCurrentRoute()?.name).toBe('TopicComposer');
    await act(() => leave.resolve(true));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe(destination));
  }
);

it.each([false, true])(
  'keeps the warm topic navigation after an old leave approval (returned=%s)',
  async (returned) => {
    const navigation = createNavigationContainerRef<RootStackParamList>();
    const view = await renderEditableTopic(navigation);
    await fireEvent.press(view.getByText('编辑主帖'));
    const leaving = Promise.withResolvers<boolean>();
    mockLeave.mockReturnValueOnce(leaving.promise);
    await fireEvent.press(view.getByText('返回编辑前页面'));
    expect(mockLeave).toHaveBeenCalledTimes(1);
    expect(navigation.getCurrentRoute()?.name).toBe('TopicComposer');

    await act(() => navigation.dispatch(StackActions.push('Topic', { topic: { ...previous, id: '456' } })));
    expect(navigation.getRootState()?.routes.map((route) => route.name)).toEqual(['Topic', 'TopicComposer', 'Topic']);
    if (returned) await act(() => navigation.goBack());
    const routes = navigation.getRootState()?.routes.map((route) => route.key);
    await act(() => leaving.resolve(true));
    expect(navigation.getRootState()?.routes.map((route) => route.key)).toEqual(routes);

    if (!returned) await act(() => navigation.goBack());
    await fireEvent.press(view.getByText('返回编辑前页面'));
    expect(mockLeave).toHaveBeenCalledTimes(2);
    expect(navigation.getRootState()?.routes.map((route) => route.name)).toEqual(['Topic']);
  }
);

it('honors a current request from the top route that must also remove a covered composer', async () => {
  const navigation = createNavigationContainerRef<RootStackParamList>();
  const view = await renderEditableTopic(navigation);
  await act(() => navigation.dispatch(StackActions.replace('MainTabs')));
  await act(() => navigation.dispatch(StackActions.push('Topic', { topic: previous })));
  await fireEvent.press(view.getByText('编辑主帖'));
  await act(() => navigation.dispatch(StackActions.push('Topic', { topic: { ...previous, id: '456' } })));
  const leaving = Promise.withResolvers<boolean>();
  mockLeave.mockReturnValueOnce(leaving.promise);
  await act(() => navigation.dispatch(StackActions.popTo('MainTabs', { screen: 'notifications' })));
  expect(mockLeave).toHaveBeenCalledTimes(1);
  expect(navigation.getRootState()?.routes.map((route) => route.name)).toEqual([
    'MainTabs',
    'Topic',
    'TopicComposer',
    'Topic'
  ]);
  await act(() => leaving.resolve(true));
  expect(navigation.getRootState()?.routes.map((route) => route.name)).toEqual(['MainTabs']);
  expect(view.getByText('我的')).toBeTruthy();
});

it.each([false, true])('保存后返回保留的主题；旧 epoch 的迟到回读不覆盖缓存（换号=%s）', async (changeAccount) => {
  appQueryClient.setQueryData(key, previous);
  const listKey = ['forum', 'all', 'feed', {}];
  appQueryClient.setQueryData(listKey, { pages: [] });
  let finish!: (value: unknown) => void;
  mockRuntime.getTopic.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const view = await renderEditableTopic();
  await fireEvent.press(view.getByText('保留阅读位置'));
  await fireEvent.press(view.getByText('编辑主帖'));
  await fireEvent.press(view.getByText('完成模拟保存'));
  await waitFor(() => expect(mockRuntime.getTopic).toHaveBeenCalledTimes(1));
  expect(view.getByText('第 3 页 · 只看楼主')).toBeTruthy();
  expect(mockRuntime.getTopic).toHaveBeenCalledWith(expect.objectContaining({ trackVisit: false, id: '123' }), {
    plan: expect.objectContaining({ cacheScope: 'authenticated:0' })
  });
  if (changeAccount) mockRuntime.sessionEpochs.linuxdo = 1;
  await act(async () => finish({ ...previous, title: '新标题', contentHtml: '新正文', replies: [], replyNextPage: 1 }));
  await waitFor(() =>
    expect(appQueryClient.getQueryData(key)).toEqual(
      changeAccount ? previous : { ...previous, title: '新标题', contentHtml: '新正文' }
    )
  );
  expect(appQueryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
});

it.each(['success', 'failure'] as const)(
  'keeps the second edit when the first post-save read finishes with %s',
  async (outcome) => {
    appQueryClient.setQueryData(key, previous);
    const first = Promise.withResolvers<typeof previous>();
    const second = Promise.withResolvers<typeof previous>();
    mockRuntime.getTopic.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const view = await renderEditableTopic();
    const submitEdit = async () => {
      await fireEvent.press(await view.findByText('编辑主帖'));
      await fireEvent.press(await view.findByText('完成模拟保存'));
    };
    try {
      await submitEdit();
      await waitFor(() => expect(mockRuntime.getTopic).toHaveBeenCalledTimes(1));
      await submitEdit();
      await waitFor(() => expect(mockRuntime.getTopic).toHaveBeenCalledTimes(2));
      const newest = { ...previous, title: '第二次保存的标题', contentHtml: '第二次保存的正文' };
      await act(async () => second.resolve({ ...newest, replies: [] }));
      expect(appQueryClient.getQueryData(key)).toEqual(newest);
      await act(async () => {
        if (outcome === 'failure') first.reject(new Error('Old request failed'));
        else first.resolve({ ...previous, title: '第一次保存的标题', contentHtml: '第一次保存的正文' });
      });
      expect(appQueryClient.getQueryData(key)).toEqual(newest);
      expect(mockRuntime.getTopic.mock.calls[0][0].signal.aborted).toBe(true);
      expect(mockRuntime.notify).not.toHaveBeenCalled();
    } finally {
      first.resolve(previous);
      second.resolve(previous);
    }
  }
);

it('keeps independent active refreshes for other topics and reports a current read failure', async () => {
  const other = { ...previous, id: '456', title: '另一个主题' };
  appQueryClient.setQueryData(key, previous);
  appQueryClient.setQueryData(topicKey('456'), other);
  const first = Promise.withResolvers<typeof previous>();
  const second = Promise.withResolvers<typeof previous>();
  mockRuntime.getTopic.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const view = await renderEditableTopic();
  try {
    await fireEvent.press(await view.findByText('编辑主帖'));
    await fireEvent.press(await view.findByText('完成模拟保存'));
    await waitFor(() => expect(mockRuntime.getTopic).toHaveBeenCalledTimes(1));
    await fireEvent.press(await view.findByText('编辑另一主题'));
    await fireEvent.press(await view.findByText('完成模拟保存'));
    await waitFor(() => expect(mockRuntime.getTopic).toHaveBeenCalledTimes(2));
    await act(async () => second.reject(new Error('Current request failed')));
    const refreshed = { ...previous, title: '主帖修改后的标题' };
    await act(async () => first.resolve(refreshed));

    expect(mockRuntime.getTopic.mock.calls[0][0].signal.aborted).toBe(false);
    expect(appQueryClient.getQueryData(key)).toEqual(refreshed);
    expect(appQueryClient.getQueryData(topicKey('456'))).toEqual(other);
    expect(mockRuntime.notify).toHaveBeenCalledTimes(1);
    expect(mockRuntime.notify).toHaveBeenCalledWith('修改已保存，正文刷新失败，可在主题菜单刷新全文');
    expect(view.getByText('第一页')).toBeTruthy();
  } finally {
    first.resolve(previous);
    second.resolve(other);
  }
});

it('refreshes the opening without reverting a bookmark or the reply window updated after saving', async () => {
  const unbookmarked = { ...previous, bookmarked: false };
  appQueryClient.setQueryData(key, unbookmarked);
  const read = Promise.withResolvers<typeof unbookmarked>();
  mockRuntime.getTopic.mockReturnValueOnce(read.promise);
  const view = await renderEditableTopic();
  try {
    await fireEvent.press(await view.findByText('保留阅读位置'));
    await fireEvent.press(await view.findByText('编辑主帖'));
    await fireEvent.press(await view.findByText('完成模拟保存'));
    await waitFor(() => expect(mockRuntime.getTopic).toHaveBeenCalledTimes(1));
    expect(view.getByText('第 3 页 · 只看楼主')).toBeTruthy();

    const updated: TopicDetail = {
      ...applyBookmarkToTopic(unbookmarked, { bookmarked: true, bookmarkId: 88 }),
      reading: { topicId: '123', lastReadPostNumber: 22 },
      replyWatermark: 31,
      replies: [{ author: '读者', commentId: 31, contentHtml: '新加载的回复', createdAt: '2026-01-02' }],
      replyHasMore: false,
      replyNextPage: null,
      replyNextOffset: null,
      replyCompleteness: 'complete'
    };
    const repliesKey = forumQueryKeys.replies(key, 'oldest', 'authenticated:0', 'topic-route');
    const replyWindow = { pages: [{ items: updated.replies }], pageParams: [{ page: 3 }] };
    await act(() => {
      appQueryClient.setQueryData(key, updated);
      appQueryClient.setQueryData(repliesKey, replyWindow);
    });
    const latestOpening = {
      title: '改后的标题',
      contentHtml: '<p>改后的正文</p>',
      preparedContent: { contentHtml: '<p>改后的正文</p>', contentPlan: {}, contentPlanKey: 'updated' },
      categoryId: '25',
      category: '开发',
      tags: ['修复']
    };
    await act(async () => read.resolve({ ...unbookmarked, ...latestOpening, replies: [] }));
    expect(appQueryClient.getQueryData(key)).toEqual({ ...updated, ...latestOpening });
    expect(appQueryClient.getQueryData(repliesKey)).toBe(replyWindow);
  } finally {
    read.resolve(unbookmarked);
  }
});

it('does not put an authenticated opening into an existing public topic cache', async () => {
  const publicKey = topicKey('123', 'public:omit');
  const publicDetail = { ...previous, contentHtml: '未登录页面显示的内容' };
  appQueryClient.setQueryData(key, previous);
  appQueryClient.setQueryData(publicKey, publicDetail);
  const current = { ...previous, contentHtml: '账号专属的正文' };
  mockRuntime.getTopic.mockResolvedValueOnce(current);
  const view = await renderEditableTopic();

  await fireEvent.press(await view.findByText('编辑主帖'));
  await fireEvent.press(await view.findByText('完成模拟保存'));
  await waitFor(() => expect(appQueryClient.getQueryData(key)).toEqual(current));
  expect(appQueryClient.getQueryData(publicKey)).toEqual(publicDetail);
  expect(appQueryClient.getQueryState(publicKey)?.isInvalidated).toBe(false);
});

it('does not replace a topic cache recreated after the save read started', async () => {
  appQueryClient.setQueryData(key, previous);
  const read = Promise.withResolvers<TopicDetail>();
  mockRuntime.getTopic.mockReturnValueOnce(read.promise);
  const view = await renderEditableTopic();
  try {
    await fireEvent.press(await view.findByText('编辑主帖'));
    await fireEvent.press(await view.findByText('完成模拟保存'));
    await waitFor(() => expect(mockRuntime.getTopic).toHaveBeenCalledTimes(1));
    const reopenedDetail = { ...previous, title: '从另一层重新载入的正文' };
    await act(() => {
      appQueryClient.removeQueries({ queryKey: key, exact: true });
      appQueryClient.setQueryData(key, reopenedDetail);
    });
    await act(async () => read.resolve({ ...previous, title: '旧读请求返回的标题' }));
    expect(appQueryClient.getQueryData(key)).toEqual(reopenedDetail);
  } finally {
    read.resolve(previous);
  }
});
