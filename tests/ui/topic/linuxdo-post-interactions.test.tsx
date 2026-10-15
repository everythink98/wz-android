import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { memo, Profiler, useMemo, type ProfilerOnRenderCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { ThumbsUp } from 'lucide-react-native';
import { act, fireEvent, render, waitFor, within } from '../render';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { testLinuxDoInteractionConfig, testPostInteractionReads } from '../topicInteractionFixture';
import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import type { Reply, TopicDetail } from '@/domain/forum/models';
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
  bili_057: 'https://linux.do/bili.png'
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
  onBoostCommit,
  onReadingCommit,
  readInteractionConfig
}: {
  active?: boolean;
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
      scopeKey="linuxdo:42"
      topic={topic}
      replies={topic.replies}
      actions={actions}
      emojiUrls={emojiUrls}
      onOpenUser={noop}
    >
      {onReadingCommit ? <ReadingProbe onRender={onReadingCommit} /> : null}
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
          {onBoostCommit && index > 0 ? (
            <ObservedBoosts post={post} onRender={onBoostCommit} />
          ) : (
            <LinuxDoBoosts post={post} />
          )}
        </View>
      ))}
    </LinuxDoPostInteractionsProvider>
  );
}

describe('LinuxDo native post interactions', () => {
  beforeEach(() => {
    appQueryClient.clear();
    fetcher.mockClear();
    appQueryClient.setQueryData(queryKey, opening);
  });
  it.each(['主帖点赞', '评论点赞'])('opens reactions without a write on long press of %s', async (label) => {
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await fireEvent(view.getByLabelText(label), 'longPress', { nativeEvent: { pageX: 120, pageY: 350 } });
    await waitFor(() => expect(view.getByLabelText('反应 bili_057')).toBeTruthy());
    expect(fetcher).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('反应 bili_057'));
    await waitFor(() => expect(view.queryByLabelText('反应 bili_057')).toBeNull());
    const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toContain(`/posts/${label === '主帖点赞' ? 420 : 101}/`);
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
