import { describe, expect, it } from 'vitest';
import {
  hasPendingOptimisticTopicAction,
  isTopicScopedActionKey,
  nodeSeekAttendanceActionKey,
  shouldInvalidateTopicActionsOnScreenChange,
  topicSnapshotForUserReturn,
  topicPollVoteActionKey,
  topicReplyActionKey,
  yaohuoFavoriteActionKey
} from './topicActionControllerHelpers';
import type { TopicSnapshot } from '../appTypes';

describe('topic action controller helpers', () => {
  it('uses different request keys for different non-optimistic actions on the same topic', () => {
    const topicKey = 'yaohuo:123';

    expect(new Set([
      topicReplyActionKey(topicKey),
      yaohuoFavoriteActionKey(topicKey),
      topicPollVoteActionKey(topicKey, { id: 'poll-1' })
    ]).size).toBe(3);
  });

  it('keeps vote request keys scoped to each poll', () => {
    const topicKey = 'linuxdo:123';

    expect(topicPollVoteActionKey(topicKey, { id: 'poll-1' })).toBe('vote:linuxdo:123:poll-1');
    expect(topicPollVoteActionKey(topicKey, { name: 'poll_name' })).toBe('vote:linuxdo:123:poll_name');
    expect(topicPollVoteActionKey(topicKey, { postId: '456' })).toBe('vote:linuxdo:123:456');
  });

  it('invalidates topic actions when leaving a topic for a user profile', () => {
    expect(shouldInvalidateTopicActionsOnScreenChange('topic', 'user')).toBe(true);
    expect(shouldInvalidateTopicActionsOnScreenChange('topic', 'feed')).toBe(true);
    expect(shouldInvalidateTopicActionsOnScreenChange('topic', 'topic')).toBe(false);
    expect(shouldInvalidateTopicActionsOnScreenChange('more', 'user')).toBe(false);
  });

  it('keeps NodeSeek check-in outside topic-scoped cancellation', () => {
    expect(isTopicScopedActionKey(nodeSeekAttendanceActionKey())).toBe(false);
    expect(isTopicScopedActionKey(topicReplyActionKey('nodeseek:123'))).toBe(true);
  });

  it('drops loaded topic details from return snapshots while optimistic actions are pending', () => {
    const snapshot: TopicSnapshot = {
      selectedTopic: null,
      topicDetail: {
        source: 'nodeseek',
        id: '123',
        title: 'topic',
        author: 'a',
        url: 'https://example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        replyCount: 1,
        contentHtml: '',
        replies: [],
        upvoted: true
      },
      topicReplies: [{ author: 'b', contentHtml: '', createdAt: '2026-01-01T00:00:00.000Z', commentId: 2, liked: true }],
      topicError: '',
      replyHasMore: true,
      replyNextPage: 2,
      replyNextOffset: 20,
      unreadReplyCount: 1,
      commentQuery: '',
      replyFilter: 'all',
      replyContent: '',
      replyComposerOpen: false,
      replyTarget: null,
      expandedQuotes: { '1': true },
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      scrollY: 120
    };

    expect(hasPendingOptimisticTopicAction({ a: { confirmed: false, displayed: true, desired: true, inFlight: true } })).toBe(true);
    expect(topicSnapshotForUserReturn(snapshot, true)).toEqual(expect.objectContaining({
      selectedTopic: snapshot.topicDetail,
      topicDetail: null,
      topicReplies: [],
      replyHasMore: false,
      replyNextPage: null,
      replyNextOffset: null,
      unreadReplyCount: 0,
      expandedQuotes: {},
      scrollY: 0
    }));
    expect(topicSnapshotForUserReturn(snapshot, false)).toBe(snapshot);
  });
});
