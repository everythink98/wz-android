import { describe, expect, it } from 'vitest';
import {
  hasPendingOptimisticTopicAction,
  isTopicScopedActionKey,
  markCurrentNodeSeekOwnRepliesUnlikable,
  nodeSeekAttendanceActionKey,
  shouldInvalidateTopicActionsOnScreenChange,
  topicSnapshotForUserReturn,
  topicEditReplyActionKey,
  topicPollVoteActionKey,
  topicReplyActionKey,
  yaohuoFavoriteActionKey
} from './topicActionControllerHelpers';
import type { TopicSnapshot } from '../appTypes';
import type { Reply, UserProfile } from '../types';

describe('topic action controller helpers', () => {
  it('uses different request keys for different non-optimistic actions on the same topic', () => {
    const topicKey = 'yaohuo:123';

    expect(new Set([
      topicReplyActionKey(topicKey),
      topicEditReplyActionKey(topicKey, 9),
      yaohuoFavoriteActionKey(topicKey),
      topicPollVoteActionKey(topicKey, { id: 'poll-1' })
    ]).size).toBe(4);
  });

  it('keeps vote request keys scoped to each poll', () => {
    const topicKey = 'linuxdo:123';

    expect(topicPollVoteActionKey(topicKey, { id: 'poll-1' })).toBe('vote:linuxdo:123:poll-1');
    expect(topicPollVoteActionKey(topicKey, { name: 'poll_name' })).toBe('vote:linuxdo:123:poll_name');
    expect(topicPollVoteActionKey(topicKey, { postId: '456' })).toBe('vote:linuxdo:123:456');
  });

  it('keeps NodeSeek edit replies separate from new replies', () => {
    expect(topicEditReplyActionKey('nodeseek:123', 9)).toBe('edit-reply:nodeseek:123:9');
    expect(topicEditReplyActionKey('nodeseek:123', 9)).not.toBe(topicReplyActionKey('nodeseek:123'));
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
      replyEditTarget: null,
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

  it('hides NodeSeek interactions on current user replies without inferring delete permission', () => {
    const currentUser: UserProfile = {
      source: 'nodeseek',
      id: '48872',
      username: '凡想世界',
      url: 'https://www.nodeseek.com/space/48872',
      topics: []
    };
    const replies: Reply[] = [
      {
        author: '凡想世界',
        authorId: '48872',
        commentId: 9,
        contentMarkdown: 'reply',
        contentHtml: '<p>reply</p>',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      {
        author: 'someone',
        authorId: '1',
        commentId: 10,
        contentHtml: '<p>other</p>',
        createdAt: '2026-01-01T00:01:00.000Z'
      }
    ];

    const marked = markCurrentNodeSeekOwnRepliesUnlikable(replies, currentUser);

    expect(marked[0]).toMatchObject({ canEdit: true, canLike: false });
    expect(marked[0]).not.toHaveProperty('canDelete');
    expect(marked[1]).not.toHaveProperty('canDelete');
    expect(marked[1]).not.toHaveProperty('canLike');
    expect(replies[0]).not.toHaveProperty('canDelete');
  });

  it('does not show NodeSeek edit on own replies without edit source data', () => {
    const replies: Reply[] = [{
      author: '凡想世界',
      authorId: '48872',
      contentHtml: '<p>reply</p>',
      createdAt: '2026-01-01T00:00:00.000Z'
    }];

    const marked = markCurrentNodeSeekOwnRepliesUnlikable(replies, {
      source: 'nodeseek',
      id: '48872',
      username: '凡想世界',
      url: 'https://www.nodeseek.com/space/48872',
      topics: []
    })[0];

    expect(marked).toMatchObject({ canLike: false });
    expect(marked).not.toHaveProperty('canEdit');
  });

  it('does not infer NodeSeek delete permission from matching usernames', () => {
    const replies: Reply[] = [{
      author: '凡想世界',
      commentId: 9,
      contentHtml: '<p>reply</p>',
      createdAt: '2026-01-01T00:00:00.000Z'
    }];

    expect(markCurrentNodeSeekOwnRepliesUnlikable(replies, {
      source: 'nodeseek',
      id: '48872',
      username: '凡想世界',
      url: 'https://www.nodeseek.com/space/48872',
      topics: []
    })).toBe(replies);
  });

  it('uses the saved NodeSeek login user id when the current user profile is not loaded', () => {
    const replies: Reply[] = [{
      author: '凡想世界',
      authorId: '48872',
      commentId: 9,
      contentMarkdown: 'reply',
      contentHtml: '<p>reply</p>',
      createdAt: '2026-01-01T00:00:00.000Z'
    }];

    expect(markCurrentNodeSeekOwnRepliesUnlikable(replies, undefined, 48872)[0]).toMatchObject({ canEdit: true, canLike: false });
  });

  it('disables NodeSeek interactions for current user replies that are already deletable', () => {
    const replies: Reply[] = [{
      author: '凡想世界',
      authorId: '48872',
      canDelete: true,
      commentId: 9,
      contentMarkdown: 'reply',
      contentHtml: '<p>reply</p>',
      createdAt: '2026-01-01T00:00:00.000Z'
    }];

    expect(markCurrentNodeSeekOwnRepliesUnlikable(replies, undefined, 48872)[0]).toMatchObject({ canDelete: true, canEdit: true, canLike: false });
  });
});
