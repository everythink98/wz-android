import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { TopicDetail } from '../../src/types';
import { useTopicSessionController } from '../../src/app/useTopicSessionController';

const topic: TopicDetail = {
  source: 'yaohuo',
  id: '42',
  title: '妖火主题',
  author: 'alice',
  url: 'https://yaohuo.me/bbs/book_view.aspx?id=42',
  createdAt: '2026-07-15T00:00:00.000Z',
  replyCount: 0,
  contentHtml: '<p>正文</p>',
  replies: [],
  bookmarked: false
};

describe('topic session controller', () => {
  it('[REG-XIAOYINSI-008] applies a lower authoritative reply total after submission', async () => {
    const detail: TopicDetail = {
      ...topic,
      source: 'xiaoyinsi',
      id: '84',
      url: 'https://forum.xiaoyinsi.com/t/topic/84',
      replyCount: 100
    };
    const hook = await renderHook(() => useTopicSessionController({
      invalidateTopicActionRequests: jest.fn(),
      notify: jest.fn()
    }));

    await act(() => {
      hook.result.current.commands.topic.beginLoad(detail, 'xiaoyinsi:84');
      hook.result.current.commands.topic.resolveLoad(detail, 0);
      hook.result.current.commands.topic.finishLoad();
    });
    await act(() => hook.result.current.commands.replies.resolve({
      replies: [],
      replyCount: 7,
      requestTopicKey: 'xiaoyinsi:84'
    }));

    expect(hook.result.current.state.topicDetail?.replyCount).toBe(7);
    expect(hook.result.current.state.selectedTopic?.replyCount).toBe(7);
  });

  it('[REG-WRITE-006] keeps an action completed while reading settings is open when restoring the Topic route', async () => {
    const hook = await renderHook(() => useTopicSessionController({
      invalidateTopicActionRequests: jest.fn(),
      notify: jest.fn()
    }));

    await act(() => {
      hook.result.current.commands.navigation.activateRoute('Topic-route');
      hook.result.current.commands.topic.beginLoad(topic, 'yaohuo:42');
      hook.result.current.commands.topic.resolveLoad(topic, 0);
      hook.result.current.commands.topic.finishLoad();
    });
    await act(() => hook.result.current.commands.navigation.saveRoute('Topic-route'));
    await act(() => hook.result.current.commands.actions.applyUpdate({
      type: 'bookmark',
      bookmarked: true,
      bookmarkId: 99
    }));

    expect(hook.result.current.state.topicDetail).toMatchObject({ bookmarked: true, bookmarkId: 99 });

    await act(() => hook.result.current.commands.navigation.restoreRoute('Topic-route'));

    expect(hook.result.current.state.topicDetail).toMatchObject({ bookmarked: true, bookmarkId: 99 });
  });

  it('[REG-WRITE-007] keeps the authoritative NodeSeek poll snapshot when restoring the Topic route', async () => {
    const nodeSeekTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      id: '759903',
      url: 'https://www.nodeseek.com/post-759903-1',
      polls: [{
        id: '2443',
        voted: false,
        options: [
          { id: '71', label: '选项 A' },
          { id: '72', label: '选项 B' }
        ]
      }]
    };
    const confirmedPoll = {
      id: '2443',
      voted: true,
      options: [
        { id: '71', label: '选项 A', count: 2, selected: false },
        { id: '72', label: '选项 B', count: 6, selected: true }
      ]
    };
    const hook = await renderHook(() => useTopicSessionController({
      invalidateTopicActionRequests: jest.fn(),
      notify: jest.fn()
    }));

    await act(() => {
      hook.result.current.commands.navigation.activateRoute('NodeSeek-route');
      hook.result.current.commands.topic.beginLoad(nodeSeekTopic, 'nodeseek:759903');
      hook.result.current.commands.topic.resolveLoad(nodeSeekTopic, 0);
      hook.result.current.commands.topic.finishLoad();
    });
    await act(() => hook.result.current.commands.navigation.saveRoute('NodeSeek-route'));
    await act(() => hook.result.current.commands.actions.applyUpdate({
      type: 'poll-vote',
      patch: {
        pollId: '2443',
        optionIds: ['72'],
        confirmedPoll
      }
    }));

    expect(hook.result.current.state.topicDetail?.polls?.[0]).toEqual(confirmedPoll);

    await act(() => hook.result.current.commands.navigation.restoreRoute('NodeSeek-route'));

    expect(hook.result.current.state.topicDetail?.polls?.[0]).toEqual(confirmedPoll);
  });
});
