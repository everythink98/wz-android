import { describe, expect, it } from 'vitest';

import {
  discourseCategories,
  discourseOriginalPoster,
  discoursePostFields,
  discoursePolls,
  discourseTopicFields,
  discourseUsersById
} from './discourseModel';

describe('portable Discourse fields', () => {
  it('maps shared topic semantics and rejects a missing identity', () => {
    expect(discourseTopicFields({
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
    })).toMatchObject({
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
    expect(discourseTopicFields({
      id: 42,
      title: 'invalid count',
      created_at: '2026-01-02T03:04:05Z',
      posts_count: 'not-a-number'
    })).toBeNull();
  });

  it('resolves the original poster from a Discourse topic list payload', () => {
    const users = discourseUsersById([
      { id: 1, username: 'last-replier' },
      { id: 2, username: 'author' }
    ]);

    expect(discourseOriginalPoster({
      posters: [
        { user_id: 1, description: 'Most Recent Poster' },
        { user_id: 2, description: 'Original Poster' }
      ]
    }, users)).toMatchObject({ username: 'author' });
  });

  it('maps portable categories and removes Discourse uncategorized', () => {
    expect(discourseCategories({
      category_list: {
        categories: [
          { id: 1, name: '未分类', slug: 'uncategorized' },
          { id: 4, name: '开发', slug: 'dev', topic_count: 12, read_restricted: true }
        ]
      }
    }, 'xiaoyinsi')).toEqual([{
      source: 'xiaoyinsi',
      id: '4',
      name: '开发',
      slug: 'dev',
      topicCount: 12,
      readRestricted: true
    }]);
  });

  it('maps poll state, selected options, and unsupported poll semantics', () => {
    expect(discoursePolls({
      id: 19,
      polls_votes: { choice: ['b'] },
      polls: [{
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
      }]
    }, { includeType: true })).toEqual([{
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
    }]);
  });

  it('maps shared post permissions and state while rejecting deleted posts', () => {
    expect(discoursePostFields({
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
      reply_to_user: { username: 'alice' },
      accepted_answer: true,
      wiki: true,
      hidden: true,
      post_folding_status: { status: 'folded' },
      needs_category_expert_approval: true,
      post_type: 1,
      actions_summary: [{ id: 2, acted: true, can_act: false }],
      reactions: [{ id: 'heart', count: 2 }, { id: '', count: 5 }]
    })).toMatchObject({
      commentId: 23,
      likeCount: 0,
      liked: true,
      canLike: false,
      canEdit: true,
      canDelete: false,
      contentMarkdown: 'portable Markdown',
      bookmarked: false,
      replyTargetAuthor: 'alice',
      acceptedAnswer: true,
      wiki: true,
      hidden: true,
      folded: true,
      reactionSummary: [{ id: 'heart', count: 2 }]
    });
    expect(discoursePostFields({
      id: 23,
      post_number: 2,
      username: 'bob',
      cooked: '<p>portable body</p>',
      created_at: '2026-01-02T03:04:05Z',
      needs_category_expert_approval: true
    })).not.toHaveProperty('needsApproval');
    expect(discoursePostFields({ id: 23, deleted_at: '2026-01-02T03:04:05Z' })).toBeNull();
    expect(discoursePostFields({
      post_number: 2,
      username: 'bob',
      cooked: '<p>body</p>',
      created_at: '2026-01-02T03:04:05Z'
    })).toBeNull();
    expect(discoursePostFields({
      id: 23,
      post_number: 2,
      username: '',
      cooked: '<p>body</p>',
      created_at: '2026-01-02T03:04:05Z'
    })).toBeNull();
    expect(discoursePostFields({
      id: 23,
      post_number: 2,
      username: 'bob',
      cooked: '',
      created_at: '2026-01-02T03:04:05Z'
    })).toBeNull();
    expect(discoursePostFields({
      id: 23,
      post_number: 2,
      username: 'bob',
      cooked: '<p>body</p>',
      created_at: 'invalid'
    })).toBeNull();
    expect(discoursePostFields({
      id: 23,
      username: 'bob',
      cooked: '<p>body</p>',
      created_at: '2026-01-02T03:04:05Z'
    })).toBeNull();
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
