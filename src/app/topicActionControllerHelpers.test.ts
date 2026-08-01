import { describe, expect, it } from 'vitest';
import {
  canSubmitReplyToTopic,
  applyEditedReplyContent,
  markCurrentNodeSeekOwnRepliesUnlikable,
  shouldApplyEditedReplyFallback,
  topicEditReplyActionKey,
  topicPollVoteActionKey,
  topicReplyActionKey,
  yaohuoFavoriteActionKey
} from './topicActionControllerHelpers';
import type { Reply, UserProfile } from '@/domain/forum/models';

describe('topic action controller helpers', () => {
  it('[REG-XIAOYINSI-007] requires the server topic permission before submitting a 小隐寺 reply', () => {
    const topic = {
      source: 'xiaoyinsi' as const,
      id: '42',
      title: '小隐寺主题',
      author: 'alice',
      url: 'https://forum.xiaoyinsi.com/t/topic/42',
      createdAt: '2026-07-18T00:00:00.000Z',
      replyCount: 0
    };

    expect(canSubmitReplyToTopic({ ...topic, canCreatePost: true })).toBe(true);
    expect(canSubmitReplyToTopic({ ...topic, canCreatePost: false })).toBe(false);
    expect(canSubmitReplyToTopic(topic)).toBe(false);
  });

  it('uses different request keys for different non-optimistic actions on the same topic', () => {
    const topicKey = 'yaohuo:123';

    expect(
      new Set([
        topicReplyActionKey(topicKey),
        topicEditReplyActionKey(topicKey, 9),
        yaohuoFavoriteActionKey(topicKey),
        topicPollVoteActionKey(topicKey, { id: 'poll-1' })
      ]).size
    ).toBe(4);
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
    const replies: Reply[] = [
      {
        author: '凡想世界',
        authorId: '48872',
        contentHtml: '<p>reply</p>',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ];

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
    const replies: Reply[] = [
      {
        author: '凡想世界',
        commentId: 9,
        contentHtml: '<p>reply</p>',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ];

    expect(
      markCurrentNodeSeekOwnRepliesUnlikable(replies, {
        source: 'nodeseek',
        id: '48872',
        username: '凡想世界',
        url: 'https://www.nodeseek.com/space/48872',
        topics: []
      })
    ).toBe(replies);
  });

  it('updates only the edited reply content locally', () => {
    const replies: Reply[] = [
      {
        author: '凡想世界',
        authorId: '48872',
        commentId: 9,
        contentMarkdown: '旧回复',
        contentHtml: '<p>旧回复</p>',
        createdAt: '2026-01-01T00:00:00.000Z'
      },
      {
        author: 'someone',
        commentId: 10,
        contentHtml: '<p>其他回复</p>',
        createdAt: '2026-01-01T00:01:00.000Z'
      }
    ];

    const updated = applyEditedReplyContent(
      replies,
      {
        commentId: 9,
        contentMarkdown: '新回复 **重点**'
      },
      'nodeseek'
    );

    expect(updated[0]).toMatchObject({
      author: '凡想世界',
      authorId: '48872',
      commentId: 9,
      contentMarkdown: '新回复 **重点**'
    });
    expect(updated[0].contentHtml).toContain('<strong>重点</strong>');
    expect(updated[1]).toBe(replies[1]);
  });

  it('does not apply NodeSeek markdown fallback to linux.do edited replies', () => {
    const replies: Reply[] = [
      {
        author: 'alice',
        commentId: 9,
        contentMarkdown: '旧回复',
        contentHtml: '<p>旧回复</p>',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ];

    expect(
      applyEditedReplyContent(
        replies,
        {
          commentId: 9,
          contentMarkdown: 'https://linux.do/t/42'
        },
        'linuxdo'
      )
    ).toBe(replies);
  });

  it('does not override refreshed edited replies that already came back from the source', () => {
    const refreshed: Reply[] = [
      {
        author: '凡想世界',
        authorId: '48872',
        commentId: 9,
        contentHtml: '<p><a href="https://example.com">正式渲染</a></p>',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ];

    expect(
      shouldApplyEditedReplyFallback(
        refreshed,
        {
          commentId: 9,
          contentMarkdown: '本地提交 https://example.com'
        },
        'nodeseek'
      )
    ).toBe(false);
    expect(
      shouldApplyEditedReplyFallback(
        [],
        {
          commentId: 9,
          contentMarkdown: '本地提交 https://example.com'
        },
        'nodeseek'
      )
    ).toBe(true);
  });

  it('uses the saved NodeSeek login user id when the current user profile is not loaded', () => {
    const replies: Reply[] = [
      {
        author: '凡想世界',
        authorId: '48872',
        commentId: 9,
        contentMarkdown: 'reply',
        contentHtml: '<p>reply</p>',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ];

    expect(markCurrentNodeSeekOwnRepliesUnlikable(replies, undefined, 48872)[0]).toMatchObject({
      canEdit: true,
      canLike: false
    });
  });

  it('disables NodeSeek interactions for current user replies that are already deletable', () => {
    const replies: Reply[] = [
      {
        author: '凡想世界',
        authorId: '48872',
        canDelete: true,
        commentId: 9,
        contentMarkdown: 'reply',
        contentHtml: '<p>reply</p>',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
    ];

    expect(markCurrentNodeSeekOwnRepliesUnlikable(replies, undefined, 48872)[0]).toMatchObject({
      canDelete: true,
      canEdit: true,
      canLike: false
    });
  });
});
