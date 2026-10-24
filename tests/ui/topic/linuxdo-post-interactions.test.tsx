import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { memo, Profiler, useMemo, type ProfilerOnRenderCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Animated, Dimensions, StyleSheet, Vibration, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { ThumbsUp } from 'lucide-react-native';
import { act, fireEvent, render, waitFor, within } from '../render';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { testLinuxDoInteractionConfig, testPostInteractionReads } from '../topicInteractionFixture';
import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import type { DiscourseBoost, Reply, TopicDetail } from '@/domain/forum/models';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { prepareRequestToSend } from '@/platform/network/request';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import { useTopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import {
  LinuxDoBoostButton,
  LinuxDoBoosts,
  LinuxDoPostInteractionsProvider,
  LinuxDoReactionButton,
  useLinuxDoInteractionOverlayOpen
} from '@/features/topic/components/LinuxDoPostInteractions';
import { createTopicStyles } from '@/features/topic/styles';
import { createTheme } from '@/ui/theme/tokens';

const mockBoostKeyboard = { height: { value: 0 }, state: { value: 4 } };
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  __esModule: true,
  default: jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated').default,
  useAnimatedKeyboard: () => mockBoostKeyboard,
  withTiming: (target: number, _config: unknown, callback?: (finished: boolean) => void) => {
    callback?.(true);
    return target;
  },
  runOnJS: (callback: (...args: unknown[]) => unknown) => callback
}));

const reply: Reply = {
  author: 'alice',
  commentId: 101,
  floor: 2,
  contentHtml: '<p>comment</p>',
  createdAt: '2026-07-20',
  canLike: true,
  currentUserReaction: null,
  siteExtension: {
    boosts: [
      {
        id: 11,
        user: { source: 'linuxdo', username: 'bob', url: 'https://linux.do/u/bob' },
        content: [{ text: '前排' }],
        canDelete: false
      }
    ],
    canBoost: true
  }
};
const opening: TopicDetail = {
  source: 'linuxdo',
  id: '42',
  commentId: 420,
  author: 'alice',
  title: 'Interactions',
  url: 'https://linux.do/t/42',
  createdAt: '2026-07-20',
  contentHtml: '<p>body</p>',
  replies: [reply],
  canLike: true,
  currentUserReaction: null,
  siteExtension: { boosts: [], canBoost: true }
};
const queryKey = forumQueryKeys.topic({ source: 'linuxdo', topicId: '42', scope: initialForumSessionEpochs });
const settings = createEmptyReaderData().settings;
const theme = createTheme(settings);
const styles = createTopicStyles(theme, settings);
const emojiUrls = {
  heart: 'https://linux.do/heart.png',
  laughing: 'https://linux.do/laughing.png',
  bili_057: 'https://linux.do/bili.png',
  face_savoring_food: 'https://linux.do/yum.png',
  star_struck: 'https://linux.do/star_struck.png'
};
const noop = () => {};
const fetcher = jest.fn(async (input: string, init?: RequestInit) => {
  prepareRequestToSend(init);
  if (input.endsWith('/session/csrf')) return new Response('{"csrf":"token"}');
  if (init?.method === 'PUT') {
    const postId = Number(input.match(/posts\/(\d+)/)?.[1]);
    const id = decodeURIComponent(input.match(/custom-reactions\/([^/]+)/)?.[1] || 'heart');
    return new Response(
      JSON.stringify({
        id: postId,
        post_number: postId === 420 ? 1 : 2,
        username: 'alice',
        cooked: '<p>body</p>',
        actions_summary: [{ id: 2, count: 1, can_act: true, acted: false }],
        reactions: [{ id, count: 1 }],
        current_user_reaction: { id, can_undo: true }
      })
    );
  }
  return new Response(
    JSON.stringify({
      id: 99,
      cooked: '<p>合影 <img class="emoji" alt=":bili_057:" src="/bili.png"></p>',
      can_delete: true,
      user: { id: 7, username: 'alice' }
    })
  );
});

const ObservedBoosts = memo(function ObservedBoosts({
  post,
  onRender
}: {
  post: Reply | TopicDetail;
  onRender: ProfilerOnRenderCallback;
}) {
  return (
    <Profiler id="existing-boosts" onRender={onRender}>
      <LinuxDoBoosts post={post} />
    </Profiler>
  );
});
const ReadingProbe = memo(function ReadingProbe({ onRender }: { onRender: ProfilerOnRenderCallback }) {
  const overlayOpen = useLinuxDoInteractionOverlayOpen();
  return (
    <Profiler id="reading-state" onRender={onRender}>
      <View testID="reading-state" accessibilityState={{ disabled: overlayOpen }} />
    </Profiler>
  );
});

function Harness({
  active = true,
  emojiCatalog = emojiUrls,
  showBoosts = true,
  scopeKey = 'linuxdo:42',
  recycledBoostPost,
  onBoostCommit,
  onReadingCommit,
  readInteractionConfig
}: {
  active?: boolean;
  emojiCatalog?: Record<string, string>;
  showBoosts?: boolean;
  scopeKey?: string;
  recycledBoostPost?: Reply;
  onBoostCommit?: ProfilerOnRenderCallback;
  onReadingCommit?: ProfilerOnRenderCallback;
  readInteractionConfig?: ReturnType<typeof testPostInteractionReads>['getLinuxDoInteractionConfig'];
}) {
  const { data: topic = opening } = useQuery({ queryKey, queryFn: async () => opening, enabled: false });
  const topicSession = useTopicSessionController({ topic, notify: noop });
  const environment = useMemo(() => {
    const base = createSiteSessionStates();
    return {
      sessionEpochs: initialForumSessionEpochs,
      siteSessionViewModels: projectTestAccountSessions(
        createSiteSessionStates({
          linuxdo: { ...base.linuxdo, status: 'logged-in', currentUser: testAccountUser('linuxdo') }
        })
      ),
      linuxDoUserAgent: () => 'safe-agent',
      showLinuxDoVerification: noop,
      ensureNodeImageApiKey: async () => null,
      ensureWritableSession: async (source) => ({ source, identityKey: `${source}:7`, sessionEpoch: 0 }),
      isWritableSessionTicketCurrent: () => true,
      fetcher,
      getNodeSeekUserAgent: () => 'safe-agent',
      notify: noop,
      onSessionExpired: noop,
      requestAccountRecheck: noop,
      readGateway: {
        ...testPostInteractionReads(),
        ...(readInteractionConfig ? { getLinuxDoInteractionConfig: readInteractionConfig } : {}),
        getReadPlan: () => ({ state: 'ready', lane: 'authenticated', transport: 'managed-session', cacheScope: '' })
      },
      refreshTopicReplies: async () => true,
      refreshWholeTopic: async () => true
    } satisfies Omit<
      Parameters<typeof useTopicActionsController>[0],
      'active' | 'topicDetail' | 'topicReplies' | 'topicSession'
    >;
  }, [readInteractionConfig]);
  const actions = useTopicActionsController({
    ...environment,
    active,
    topicDetail: topic,
    topicReplies: topic.replies,
    topicSession
  });
  return (
    <LinuxDoPostInteractionsProvider
      active={active}
      scopeKey={scopeKey}
      topic={topic}
      replies={topic.replies}
      actions={actions}
      emojiUrls={emojiCatalog}
      onOpenUser={noop}
    >
      {onReadingCommit ? <ReadingProbe onRender={onReadingCommit} /> : null}
      {recycledBoostPost ? <LinuxDoBoosts post={recycledBoostPost} /> : null}
      {[topic, ...topic.replies].map((post, index) => (
        <View key={post.commentId} testID={index === 0 ? 'opening-actions' : 'comment-actions'}>
          <LinuxDoReactionButton
            post={post}
            icon={ThumbsUp}
            label="赞"
            accessibilityLabel={index === 0 ? '主帖点赞' : '评论点赞'}
            styles={styles}
            theme={theme}
            onPress={() => {}}
          />
          <LinuxDoBoostButton post={post} styles={styles} theme={theme} />
          {showBoosts ? (
            onBoostCommit && index > 0 ? (
              <ObservedBoosts post={post} onRender={onBoostCommit} />
            ) : (
              <LinuxDoBoosts post={post} />
            )
          ) : null}
        </View>
      ))}
    </LinuxDoPostInteractionsProvider>
  );
}

describe('LinuxDo native post interactions', () => {
  beforeEach(() => {
    appQueryClient.clear();
    fetcher.mockClear();
    jest
      .spyOn(Vibration, 'vibrate')
      .mockImplementation(() => {})
      .mockClear();
    appQueryClient.setQueryData(queryKey, opening);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('ignores queued repeat taps and restores the expanded post after mid-animation recycling', async () => {
    const values: Animated.Value[] = [];
    const stop = jest.fn();
    const timing = jest.spyOn(Animated, 'timing').mockImplementation((value): Animated.CompositeAnimation => {
      if (!(value instanceof Animated.Value)) throw new Error('Expected a scalar expansion animation');
      values.push(value);
      let onEnd: Parameters<Animated.CompositeAnimation['start']>[0];
      return {
        start: (callback) => {
          onEnd = callback;
        },
        stop: () => {
          stop();
          onEnd?.({ finished: false });
        },
        reset: noop
      };
    });
    const boosts: DiscourseBoost[] = Array.from({ length: 6 }, (_, index) => ({
      id: 20 + index,
      user: { source: 'linuxdo', username: 'bob', url: 'https://linux.do/u/bob' },
      content: [{ text: `第${index + 1}条` }],
      canDelete: false
    }));
    const firstPost: Reply = { ...reply, siteExtension: { boosts, canBoost: true } };
    const secondPost: Reply = { ...firstPost, commentId: 102 };
    const view = await render(<Harness showBoosts={false} recycledBoostPost={firstPost} />, {
      wrapper: QueryTestWrapper
    });
    const bubbles = view.getByTestId('post-boost-viewport-101').children[0];
    if (typeof bubbles === 'string') throw new Error('Expected the boost layout container');
    await fireEvent(bubbles, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 192 } }
    });
    for (const [index, y] of [0, 0, 40, 80, 120, 160].entries()) {
      await fireEvent(view.getByTestId(`post-boost-101-${20 + index}`), 'layout', {
        nativeEvent: { layout: { x: index === 1 ? 132 : 0, y, width: 120, height: 32 } }
      });
    }
    const expandButton = view.getByLabelText('查看全部 6 条加电');
    const queuedPress = expandButton.props.onStartShouldSetResponder?.testOnly_pressabilityConfig?.().onPress;
    if (typeof queuedPress !== 'function') throw new Error('Expected the queued expand press handler');
    await fireEvent.press(expandButton);
    const value = values[0];
    if (!value) throw new Error('Expected the boost expansion to start');
    await act(() => value.setValue(0.5));
    expect(StyleSheet.flatten(view.getByTestId('post-boost-viewport-101').props.style).height).toBe(174);
    // Replay an already queued native press after the live footer disables pointer events.
    await act(() => queuedPress());
    expect(timing).toHaveBeenCalledTimes(1);
    expect(StyleSheet.flatten(view.getByTestId('post-boost-viewport-101').props.style).height).toBe(174);

    await view.rerender(<Harness showBoosts={false} recycledBoostPost={secondPost} />);
    expect(stop).toHaveBeenCalledTimes(1);
    await view.rerender(<Harness showBoosts={false} recycledBoostPost={firstPost} />);
    expect(StyleSheet.flatten(view.getByTestId('post-boost-viewport-101').props.style).height).toBeUndefined();
    expect(view.getByLabelText('加电 第6条')).toBeTruthy();
    expect(view.queryByLabelText('查看全部 6 条加电', { includeHiddenElements: true })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await view.unmount();
  });
  it.each(['opening', 'comment'])(
    'keeps the expand action beside the fourth %s row when it fits and moves it below on a narrower layout',
    async (target) => {
      const boosts: DiscourseBoost[] = Array.from({ length: 6 }, (_, index) => ({
        id: 20 + index,
        user: { source: 'linuxdo', username: 'bob', url: 'https://linux.do/u/bob' },
        content: [{ text: `第${index + 1}条` }],
        canDelete: false
      }));
      const siteExtension = { boosts, canBoost: true };
      appQueryClient.setQueryData(
        queryKey,
        target === 'opening' ? { ...opening, siteExtension } : { ...opening, replies: [{ ...reply, siteExtension }] }
      );
      const postId = target === 'opening' ? 420 : 101;
      const view = await render(<Harness />, { wrapper: QueryTestWrapper });
      const bubbles = view.getByTestId(`post-boost-viewport-${postId}`).children[0];
      if (typeof bubbles === 'string') throw new Error('Expected the boost layout container');
      await fireEvent(bubbles, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 192 } }
      });
      for (const [index, y] of [0, 0, 40, 80, 120, 160].entries()) {
        await fireEvent(view.getByTestId(`post-boost-${postId}-${20 + index}`), 'layout', {
          nativeEvent: { layout: { x: index === 1 ? 86 : 0, y, width: index === 4 ? 120 : 80, height: 32 } }
        });
      }
      const actions = view.getByTestId(`post-boost-actions-${postId}`);
      expect(actions).toHaveStyle({ position: 'absolute', left: 126, top: 116 });
      expect(within(actions).getByLabelText('添加加电')).toBeTruthy();
      expect(view.queryByLabelText('加电 第6条')).toBeNull();

      await fireEvent(bubbles, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 192 } }
      });
      expect(StyleSheet.flatten(view.getByTestId(`post-boost-actions-${postId}`).props.style).position).not.toBe(
        'absolute'
      );
      expect(view.getByLabelText('加电 第5条')).toBeTruthy();
      expect(view.queryByLabelText('加电 第6条')).toBeNull();

      await fireEvent(bubbles, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 192 } }
      });
      expect(view.getByTestId(`post-boost-actions-${postId}`)).toHaveStyle({
        position: 'absolute',
        left: 126,
        top: 116
      });
      expect(view.queryByLabelText('加电 第6条')).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
      await view.unmount();
    }
  );
  it.each(['opening', 'comment'])(
    'reveals boosts after four measured rows and preserves the expanded %s after recycling',
    async (target) => {
      const boosts: DiscourseBoost[] = Array.from({ length: 6 }, (_, index) => ({
        id: 20 + index,
        user: { source: 'linuxdo', username: 'bob', url: 'https://linux.do/u/bob' },
        content: [{ text: `第${index + 1}条` }],
        canDelete: false
      }));
      const siteExtension = { boosts, canBoost: true };
      appQueryClient.setQueryData(
        queryKey,
        target === 'opening' ? { ...opening, siteExtension } : { ...opening, replies: [{ ...reply, siteExtension }] }
      );
      const postId = target === 'opening' ? 420 : 101;
      const view = await render(<Harness />, { wrapper: QueryTestWrapper });
      const bubbles = view.getByTestId(`post-boost-viewport-${postId}`).children[0];
      if (typeof bubbles === 'string') throw new Error('Expected the boost layout container');
      await fireEvent(bubbles, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 192 } }
      });
      for (const [index, y] of [0, 0, 40, 80, 120, 120].entries()) {
        await fireEvent(view.getByTestId(`post-boost-${postId}-${20 + index}`), 'layout', {
          nativeEvent: { layout: { x: index === 1 || index === 5 ? 132 : 0, y, width: 120, height: 32 } }
        });
      }
      expect(view.queryByLabelText('查看全部 6 条加电')).toBeNull();
      expect(view.getByLabelText('加电 第6条')).toBeTruthy();

      await fireEvent(view.getByTestId(`post-boost-${postId}-25`), 'layout', {
        nativeEvent: { layout: { x: 0, y: 160, width: 120, height: 32 } }
      });
      for (const index of [1, 2, 3, 4, 5]) {
        expect(view.getByLabelText(`加电 第${index}条`)).toBeTruthy();
      }
      expect(view.queryByLabelText('加电 第6条')).toBeNull();
      expect(view.queryByText(/查看全部/)).toBeNull();
      const hidden = view.getByTestId(`post-boost-${postId}-25`, { includeHiddenElements: true });
      expect(hidden).toHaveProp('importantForAccessibility', 'no-hide-descendants');
      expect(hidden).toHaveProp('pointerEvents', 'none');
      expect(within(view.getByTestId(`post-boosts-${postId}`)).getByLabelText('添加加电')).toBeTruthy();

      await fireEvent.press(view.getByLabelText('查看全部 6 条加电'));
      expect(view.getByLabelText('加电 第6条')).toBeTruthy();
      expect(view.queryByLabelText('查看全部 6 条加电')).toBeNull();
      expect(view.queryByRole('button', { name: /收起/ })).toBeNull();
      await view.rerender(<Harness showBoosts={false} />);
      expect(view.queryByTestId(`post-boosts-${postId}`)).toBeNull();
      await view.rerender(<Harness />);
      expect(view.getByLabelText('加电 第6条')).toBeTruthy();
      expect(view.queryByLabelText('查看全部 6 条加电')).toBeNull();

      await view.rerender(<Harness scopeKey="linuxdo:43" />);
      const recycledBubbles = view.getByTestId(`post-boost-viewport-${postId}`).children[0];
      if (typeof recycledBubbles === 'string') throw new Error('Expected the recycled boost layout container');
      await fireEvent(recycledBubbles, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 192 } }
      });
      for (const [index, y] of [0, 0, 40, 80, 120, 160].entries()) {
        await fireEvent(
          view.getByTestId(`post-boost-${postId}-${20 + index}`, { includeHiddenElements: true }),
          'layout',
          {
            nativeEvent: { layout: { x: index === 1 ? 132 : 0, y, width: 120, height: 32 } }
          }
        );
      }
      expect(view.queryByLabelText('加电 第6条')).toBeNull();
      expect(view.getByLabelText('查看全部 6 条加电')).toBeTruthy();
      expect(fetcher).not.toHaveBeenCalled();
      await view.unmount();
    }
  );
  it.each(['opening', 'comment'])(
    'renders known boost shortcodes beside text when the catalog arrives on %s',
    async (target) => {
      const boost: DiscourseBoost = {
        id: 19,
        user: { source: 'linuxdo', username: 'bob', url: 'https://linux.do/u/bob' },
        content: [
          { text: '难道说安卓:star_struck::face_savoring_food: :unknown: :constructor: ' },
          { emoji: ':heart:', imageUrl: emojiUrls.heart }
        ],
        canDelete: false
      };
      const siteExtension = { boosts: [boost], canBoost: true };
      appQueryClient.setQueryData(
        queryKey,
        target === 'opening' ? { ...opening, siteExtension } : { ...opening, replies: [{ ...reply, siteExtension }] }
      );
      const view = await render(<Harness emojiCatalog={{}} />, { wrapper: QueryTestWrapper });
      const label = '加电 难道说安卓:star_struck::face_savoring_food: :unknown: :constructor: :heart:';
      expect(within(view.getByLabelText(label)).queryByLabelText(':star_struck:')).toBeNull();
      await view.rerender(<Harness />);
      const bubble = within(view.getByLabelText(label));
      expect(bubble.getByLabelText(':star_struck:')).toHaveProp(
        'source',
        expect.arrayContaining([expect.objectContaining({ uri: emojiUrls.star_struck })])
      );
      expect(bubble.getByLabelText(':face_savoring_food:')).toHaveProp(
        'source',
        expect.arrayContaining([expect.objectContaining({ uri: emojiUrls.face_savoring_food })])
      );
      expect(bubble.getByLabelText(':heart:')).toHaveProp(
        'source',
        expect.arrayContaining([expect.objectContaining({ uri: emojiUrls.heart })])
      );
      expect(bubble.getByText(/:unknown:/)).toBeTruthy();
      expect(bubble.getByText(/:constructor:/)).toBeTruthy();
      expect(bubble.queryByText(/:star_struck:/)).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
      await view.unmount();
    }
  );
  it.each(['top', 'bottom'] as const)(
    'keeps the reaction picker inside the %s safe edge without writing',
    async (edge) => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryTestWrapper>
          <SafeAreaInsetsContext.Provider value={{ top: 64, bottom: 34, left: 0, right: 0 }}>
            {children}
          </SafeAreaInsetsContext.Provider>
        </QueryTestWrapper>
      );
      const height = Dimensions.get('window').height;
      const view = await render(<Harness />, { wrapper });
      await fireEvent(view.getByLabelText('主帖点赞'), 'longPress', {
        nativeEvent: { pageX: 120, pageY: edge === 'top' ? 100 : height - 10 }
      });
      await waitFor(() => expect(view.getByLabelText('反应 bili_057')).toBeTruthy());
      expect(view.getByLabelText('关闭表情反应').parent?.children[1]).toHaveStyle({
        top: edge === 'top' ? 72 : height - 34 - 210
      });
      expect(fetcher).not.toHaveBeenCalled();
    }
  );

  it.each(['主帖点赞', '评论点赞'])(
    'opens reactions with one short vibration and no write on long press of %s',
    async (label) => {
      const view = await render(<Harness />, { wrapper: QueryTestWrapper });
      expect(Vibration.vibrate).not.toHaveBeenCalled();
      await fireEvent(view.getByLabelText(label), 'longPress', { nativeEvent: { pageX: 120, pageY: 350 } });
      await waitFor(() => expect(view.getByLabelText('反应 bili_057')).toBeTruthy());
      expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
      expect(Vibration.vibrate).toHaveBeenCalledWith(15);
      expect(fetcher).not.toHaveBeenCalled();
      await fireEvent.press(view.getByLabelText('反应 bili_057'));
      await waitFor(() => expect(view.queryByLabelText('反应 bili_057')).toBeNull());
      const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
      expect(writes).toHaveLength(1);
      expect(writes[0][0]).toContain(`/posts/${label === '主帖点赞' ? 420 : 101}/`);
      expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
      await view.unmount();
    }
  );
  it.each(['主帖点赞', '评论点赞'])('keeps a short press of %s free of vibration', async (label) => {
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await fireEvent.press(view.getByLabelText(label));
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1));
    expect(view.queryByText('选择表情反应')).toBeNull();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
    await view.unmount();
  });
  it('opens reactions with one vibration through the accessibility long-press action', async () => {
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await fireEvent(view.getByLabelText('主帖点赞'), 'accessibilityAction', {
      nativeEvent: { actionName: 'longpress' }
    });
    await waitFor(() => expect(view.getByLabelText('反应 bili_057')).toBeTruthy());
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    await view.unmount();
  });
  it('uses the rocket at the end of comment bubbles and inserts custom emoji into short text', async () => {
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await fireEvent.press(within(view.getByTestId('post-boosts-101')).getByLabelText('添加加电'));
    await waitFor(() => expect(view.getByText('加电给 alice · #2')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('加电内容'), '合影');
    await fireEvent.press(view.getByLabelText('选择加电表情'));
    await fireEvent.press(view.getByLabelText('插入表情 bili_057'));
    expect(view.getByLabelText('加电内容').props.value).toBe('合影 :bili_057:');
    await fireEvent.press(view.getByText('发送加电'));
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1));
    await waitFor(() => expect(view.queryByLabelText('加电内容')).toBeNull());
    expect(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')?.[0]).toBe(
      'https://linux.do/discourse-boosts/posts/101/boosts.json'
    );
    expect(within(view.getByTestId('post-boosts-101')).getByLabelText('加电 合影 :bili_057:')).toBeTruthy();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
    await view.unmount();
  });
  it('opens a scoped keyboard before configuration finishes and preserves the draft after closing', async () => {
    const config = Promise.withResolvers<typeof testLinuxDoInteractionConfig>();
    const readConfig = jest.fn(() => config.promise);
    const view = await render(<Harness readInteractionConfig={readConfig} />, { wrapper: QueryTestWrapper });
    try {
      await fireEvent.press(within(view.getByTestId('opening-actions')).getByLabelText('添加加电'));
      await waitFor(() => expect(readConfig).toHaveBeenCalledTimes(1));
      expect(view.queryByTestId('composer-modal-keyboard-host')).toBeNull();
      expect(view.getByTestId('composer-bottom-sheet')).toHaveProp('enabled', true);
      expect(view.getByLabelText('加电内容')).toHaveProp('autoFocus', true);
      expect(view.getByLabelText('加电内容')).toHaveProp('editable', true);
      expect(view.getByLabelText('发送加电')).toBeDisabled();
      await fireEvent.changeText(view.getByLabelText('加电内容'), '保留草稿');
      await fireEvent.press(view.getAllByLabelText('关闭加电')[0]);
      expect(view.queryByLabelText('加电内容')).toBeNull();
      expect(view.queryByLabelText('关闭加电')).toBeNull();
      expect(view.getByLabelText('加电内容', { includeHiddenElements: true })).toHaveProp('value', '保留草稿');
      await fireEvent.press(within(view.getByTestId('opening-actions')).getByLabelText('添加加电'));
      expect(view.getByLabelText('加电内容')).toHaveProp('value', '保留草稿');
      expect(view.getByLabelText('发送加电')).toBeDisabled();
      await fireEvent.press(view.getAllByLabelText('关闭加电')[1]);
      expect(view.queryByLabelText('加电内容')).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        config.resolve(testLinuxDoInteractionConfig);
        await config.promise;
      });
      await waitFor(() => expect(appQueryClient.isFetching({ queryKey: forumQueryKeys.interactionConfig(0) })).toBe(0));
      await view.unmount();
    }
  });
  it('updates the short-text draft without committing existing boosts or reading state', async () => {
    const boostCommits = jest.fn<ProfilerOnRenderCallback>();
    const readingCommits = jest.fn<ProfilerOnRenderCallback>();
    const view = await render(<Harness onBoostCommit={boostCommits} onReadingCommit={readingCommits} />, {
      wrapper: QueryTestWrapper
    });
    await fireEvent.press(within(view.getByTestId('opening-actions')).getByLabelText('添加加电'));
    await waitFor(() => expect(view.getByLabelText('加电内容')).toBeTruthy());
    expect(view.getByTestId('reading-state')).toHaveProp('accessibilityState', { disabled: true });
    boostCommits.mockClear();
    readingCommits.mockClear();

    for (const text of ['保', '保留', '保留草稿']) {
      await fireEvent.changeText(view.getByLabelText('加电内容'), text);
    }

    expect(view.getByLabelText('加电内容')).toHaveProp('value', '保留草稿');
    expect({ boosts: boostCommits.mock.calls.length, reading: readingCommits.mock.calls.length }).toEqual({
      boosts: 0,
      reading: 0
    });
    expect(fetcher).not.toHaveBeenCalled();
    await view.unmount();
  });
  it('hides the boost input with its topic route and restores its separate draft on return', async () => {
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await fireEvent.press(within(view.getByTestId('opening-actions')).getByLabelText('添加加电'));
    await fireEvent.changeText(view.getByLabelText('加电内容'), '保留草稿');
    await view.rerender(<Harness active={false} />);
    expect(view.queryByLabelText('加电内容')).toBeNull();
    await view.rerender(<Harness />);
    expect(view.queryByLabelText('加电内容')).toBeNull();
    await fireEvent.press(within(view.getByTestId('opening-actions')).getByLabelText('添加加电'));
    expect(view.getByLabelText('加电内容')).toHaveProp('value', '保留草稿');
    expect(view.getByLabelText('加电内容')).toHaveProp('autoFocus', true);
    expect(fetcher).not.toHaveBeenCalled();
    await view.unmount();
  });
  it('closes an opened reaction picker when its route stops being active', async () => {
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await fireEvent(view.getByLabelText('主帖点赞'), 'longPress', { nativeEvent: { pageX: 120, pageY: 350 } });
    await waitFor(() => expect(view.getByText('选择表情反应')).toBeTruthy());
    await view.rerender(<Harness active={false} />);
    expect(view.queryByText('选择表情反应')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await view.unmount();
  });
});
