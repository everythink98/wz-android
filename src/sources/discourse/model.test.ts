import { describe, expect, it } from 'vitest';

import {
  discourseCategories,
  discourseOriginalPoster,
  discoursePostFields,
  discoursePolls,
  discourseReplyWindow,
  discourseRepliesInStreamOrder,
  discourseStreamReplyWindow,
  discourseTopicFields,
  discourseUsersById
} from './model';

describe('portable Discourse fields', () => {
  it('[REG-TOPIC-067] selects real stream tail IDs and advances toward older windows', () => {
    const stream = Array.from({ length: 46 }, (_, index) => 1000 + index);
    const tail = discourseStreamReplyWindow(stream, {
      limit: 10,
      order: 'newest',
      position: { kind: 'start' }
    });
    const older = discourseStreamReplyWindow(stream, {
      limit: 10,
      order: 'newest',
      position: { kind: 'cursor', page: tail.nextPage!, offset: tail.nextOffset ?? null }
    });

    expect(tail).toMatchObject({
      postIds: [1041, 1042, 1043, 1044, 1045],
      currentPage: 5,
      currentOffset: 40,
      nextPage: 4,
      nextOffset: 30
    });
    expect(older.postIds).toEqual([1031, 1032, 1033, 1034, 1035, 1036, 1037, 1038, 1039, 1040]);
    expect(
      discourseRepliesInStreamOrder(
        [
          { author: 'older', commentId: 1041, contentHtml: '<p>older</p>', createdAt: '', floor: 42 },
          { author: 'middle-1', commentId: 1042, contentHtml: '<p>middle</p>', createdAt: '', floor: 43 },
          { author: 'middle-2', commentId: 1043, contentHtml: '<p>middle</p>', createdAt: '', floor: 44 },
          { author: 'middle-3', commentId: 1044, contentHtml: '<p>middle</p>', createdAt: '', floor: 45 },
          { author: 'newer', commentId: 1045, contentHtml: '<p>newer</p>', createdAt: '', floor: 46 }
        ],
        tail.postIds,
        'newest'
      ).map(({ commentId }) => commentId)
    ).toEqual([1045, 1044, 1043, 1042, 1041]);
    expect(() =>
      discourseStreamReplyWindow(stream, {
        limit: 10,
        order: 'newest',
        position: { kind: 'cursor', page: 99, offset: 30 }
      })
    ).toThrow('游标与页码不一致');
  });

  it.each([
    { order: 'oldest' as const, previousPage: 2, nextPage: 4 },
    { order: 'newest' as const, previousPage: 4, nextPage: 2 }
  ])(
    '[REG-TOPIC-068] derives both $order directions from the current Discourse stream',
    ({ order, previousPage, nextPage }) => {
      const stream = Array.from({ length: 61 }, (_, index) => 1000 + index);
      const center = discourseStreamReplyWindow(stream, {
        limit: 10,
        order,
        position: { kind: 'cursor', page: 3, offset: 20 }
      });
      const previous = discourseStreamReplyWindow(stream, {
        limit: 10,
        order,
        position: { kind: 'cursor', page: center.previousPage!, offset: center.previousOffset ?? null }
      });
      const next = discourseStreamReplyWindow(stream, {
        limit: 10,
        order,
        position: { kind: 'cursor', page: center.nextPage!, offset: center.nextOffset ?? null }
      });

      expect(center).toMatchObject({
        currentPage: 3,
        currentOffset: 20,
        previousPage,
        nextPage
      });
      expect(previous.currentPage).toBe(previousPage);
      expect(next.currentPage).toBe(nextPage);
      expect(new Set([...previous.postIds, ...center.postIds, ...next.postIds]).size).toBe(30);
    }
  );

  it('[REG-TOPIC-067] rejects hydration that returns the right count but the wrong stream IDs', () => {
    expect(() =>
      discourseRepliesInStreamOrder(
        [
          { author: 'one', commentId: 101, contentHtml: '', createdAt: '', floor: 2 },
          { author: 'two', commentId: 102, contentHtml: '', createdAt: '', floor: 3 },
          { author: 'wrong', commentId: 999, contentHtml: '', createdAt: '', floor: 4 }
        ],
        [101, 102, 103],
        'oldest'
      )
    ).toThrow('回复窗口不完整');
  });

  it('[REG-TOPIC-067] rejects an oldest cursor whose page disagrees with its stream offset', () => {
    const stream = Array.from({ length: 46 }, (_, index) => 1000 + index);

    expect(() =>
      discourseStreamReplyWindow(stream, {
        limit: 10,
        order: 'oldest',
        position: { kind: 'cursor', page: 99, offset: 0 }
      })
    ).toThrow('游标与页码不一致');
  });

  it('[REG-TOPIC-067] rejects an anchored post that is absent from the real stream', () => {
    expect(() =>
      discourseReplyWindow(
        {
          post_stream: {
            stream: [1000, 1001, 1002],
            posts: [{ id: 9999, post_number: 2 }]
          }
        },
        10
      )
    ).toThrow('锚点回复流已变化');
  });

  it('maps shared topic semantics and rejects a missing identity', () => {
    expect(
      discourseTopicFields({
        id: 42,
        unicode_title: '共享 &amp; 标题',
        created_at: '2026-01-02T03:04:05Z',
        bumped_at: '2026-01-03T03:04:05Z',
        posts_count: 3,
        views: 9,
        tags: ['android', { name: 'discourse' }],
        closed: true,
        has_accepted_answer: true,
        accepted_answers: [{ post_number: 2 }],
        slow_mode_seconds: 120
      })
    ).toMatchObject({
      id: '42',
      title: '共享 & 标题',
      replyCount: 2,
      viewCount: 9,
      tags: ['android', 'discourse'],
      closed: true,
      solved: true,
      acceptedAnswerFloor: 2,
      slowModeSeconds: 120
    });
    expect(discourseTopicFields({ title: 'missing id' })).toBeNull();
    expect(discourseTopicFields({ id: 42 })).toBeNull();
    expect(discourseTopicFields({ id: 42, title: 'missing time', posts_count: 1 })).toBeNull();
    expect(
      discourseTopicFields({
        id: 42,
        title: 'invalid count',
        created_at: '2026-01-02T03:04:05Z',
        posts_count: 'not-a-number'
      })
    ).toBeNull();
  });

  it('[REG-TOPIC-056] removes Callout protocol markers from shared Discourse topic excerpts', () => {
    expect(
      discourseTopicFields({
        id: 42,
        title: 'Callout topic',
        created_at: '2026-01-02T03:04:05Z',
        posts_count: 1,
        excerpt: '[!warning]- 注意 正文'
      })?.excerpt
    ).toBe('注意 正文');
  });

  it('resolves the original poster from a Discourse topic list payload', () => {
    const users = discourseUsersById([
      { id: 1, username: 'last-replier' },
      { id: 2, username: 'author' }
    ]);

    expect(
      discourseOriginalPoster(
        {
          posters: [
            { user_id: 1, description: 'Most Recent Poster' },
            { user_id: 2, description: 'Original Poster' }
          ]
        },
        users
      )
    ).toMatchObject({ username: 'author' });
  });

  it('maps portable categories and removes Discourse uncategorized', () => {
    expect(
      discourseCategories(
        {
          category_list: {
            categories: [
              { id: 1, name: '未分类', slug: 'uncategorized' },
              { id: 4, name: '开发', slug: 'dev', topic_count: 12, read_restricted: true }
            ]
          }
        },
        'xiaoyinsi'
      )
    ).toEqual([
      {
        source: 'xiaoyinsi',
        id: '4',
        name: '开发',
        slug: 'dev',
        topicCount: 12,
        readRestricted: true
      }
    ]);
  });

  it('maps poll state, selected options, and unsupported poll semantics', () => {
    expect(
      discoursePolls(
        {
          id: 19,
          polls_votes: { choice: ['b'] },
          polls: [
            {
              id: 7,
              name: 'choice',
              type: 'ranked_choice',
              title: '<strong>Pick one</strong>',
              status: 'open',
              public: true,
              voters: 4,
              min: 1,
              max: 2,
              options: [
                { id: 'a', html: 'Alpha', votes: 1 },
                { id: 'b', html: '<em>Beta</em>', votes: 3 }
              ]
            }
          ]
        },
        { includeType: true }
      )
    ).toEqual([
      {
        id: '7',
        name: 'choice',
        postId: '19',
        type: 'ranked_choice',
        title: 'Pick one',
        multiple: false,
        voted: true,
        closed: false,
        public: true,
        readonly: true,
        participantCount: 4,
        min: 1,
        max: 2,
        options: [
          { id: 'a', label: 'Alpha', count: 1, selected: false },
          { id: 'b', label: 'Beta', count: 3, selected: true }
        ]
      }
    ]);
  });

  it('maps shared post permissions and state while rejecting deleted posts', () => {
    expect(
      discoursePostFields({
        id: 23,
        post_number: 2,
        username: 'bob',
        cooked: '<p>portable body</p>',
        created_at: '2026-01-02T03:04:05Z',
        like_count: 0,
        raw: 'portable Markdown',
        can_edit: true,
        can_delete: false,
        bookmarked: false,
        reply_to_post_number: 1,
        reply_to_user: { username: 'alice' },
        accepted_answer: true,
        wiki: true,
        hidden: true,
        post_folding_status: { status: 'folded' },
        needs_category_expert_approval: true,
        post_type: 1,
        actions_summary: [{ id: 2, acted: true, can_act: false }],
        reactions: [
          { id: 'heart', count: 2 },
          { id: '', count: 5 }
        ]
      })
    ).toMatchObject({
      commentId: 23,
      likeCount: 0,
      liked: true,
      canLike: false,
      canEdit: true,
      canDelete: false,
      contentMarkdown: 'portable Markdown',
      bookmarked: false,
      replyTarget: {
        floor: 1,
        author: { name: 'alice', username: 'alice' }
      },
      acceptedAnswer: true,
      wiki: true,
      hidden: true,
      folded: true,
      reactionSummary: [{ id: 'heart', count: 2 }]
    });
    expect(
      discoursePostFields({
        id: 23,
        post_number: 2,
        username: 'bob',
        cooked: '<p>portable body</p>',
        created_at: '2026-01-02T03:04:05Z',
        needs_category_expert_approval: true
      })
    ).not.toHaveProperty('needsApproval');
    expect(discoursePostFields({ id: 23, deleted_at: '2026-01-02T03:04:05Z' })).toBeNull();
    expect(
      discoursePostFields({
        post_number: 2,
        username: 'bob',
        cooked: '<p>body</p>',
        created_at: '2026-01-02T03:04:05Z'
      })
    ).toBeNull();
    expect(
      discoursePostFields({
        id: 23,
        post_number: 2,
        username: '',
        cooked: '<p>body</p>',
        created_at: '2026-01-02T03:04:05Z'
      })
    ).toBeNull();
    expect(
      discoursePostFields({
        id: 23,
        post_number: 2,
        username: 'bob',
        cooked: '',
        created_at: '2026-01-02T03:04:05Z'
      })
    ).toBeNull();
    expect(
      discoursePostFields({
        id: 23,
        post_number: 2,
        username: 'bob',
        cooked: '<p>body</p>',
        created_at: 'invalid'
      })
    ).toBeNull();
    expect(
      discoursePostFields({
        id: 23,
        username: 'bob',
        cooked: '<p>body</p>',
        created_at: '2026-01-02T03:04:05Z'
      })
    ).toBeNull();
  });

  it('[REG-TOPIC-035] keeps a reply target display name separate from its navigable username', () => {
    const basePost = {
      id: 23,
      post_number: 2,
      username: 'bob',
      cooked: '<p>portable body</p>',
      created_at: '2026-01-02T03:04:05Z'
    };

    expect(
      discoursePostFields({
        ...basePost,
        reply_to_user: { name: 'Alice Display' }
      })
    ).toMatchObject({ replyTarget: { author: { name: 'Alice Display' } } });
    expect(
      discoursePostFields({
        ...basePost,
        reply_to_user: { name: 'Alice Display' }
      })?.replyTarget?.author
    ).not.toHaveProperty('username');
    expect(
      discoursePostFields({
        ...basePost,
        reply_to_post_number: 1,
        reply_to_user: { name: 'Alice Display', username: 'alice' }
      })
    ).toMatchObject({
      replyTarget: {
        floor: 1,
        author: { name: 'Alice Display', username: 'alice' }
      }
    });
  });

  it('[REG-TOPIC-026] keeps an accepted reply separate from an empty Discourse system event', () => {
    const acceptedReply = discoursePostFields({
      id: 23,
      post_number: 2,
      username: 'alice',
      cooked: '<p>accepted answer</p>',
      created_at: '2026-01-02T03:04:05Z',
      accepted_answer: true,
      post_type: 1
    });
    const systemEvent = discoursePostFields({
      id: 24,
      post_number: 3,
      username: 'moderator',
      cooked: '',
      created_at: '2026-01-02T04:05:06Z',
      post_type: 3,
      action_code: 'closed.enabled'
    });

    expect(acceptedReply).toMatchObject({
      acceptedAnswer: true,
      cookedHtml: '<p>accepted answer</p>',
      floor: 2
    });
    expect(acceptedReply).not.toHaveProperty('systemAction');
    expect(systemEvent).toMatchObject({
      actionCode: 'closed.enabled',
      cookedHtml: '',
      floor: 3,
      systemAction: true
    });
    expect(systemEvent).not.toHaveProperty('acceptedAnswer');
  });
});
