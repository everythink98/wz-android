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
});
