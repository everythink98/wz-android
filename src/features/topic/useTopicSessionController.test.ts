import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Reply, TopicDetail } from '@/domain/forum/models';
import { createTopicImageDeriver } from './model/topicDerivedData';
import { prepareReplyContent } from '@/domain/forum/topicContentSplit';
import type { ReplyEditTarget, ReplyTarget } from './model/types';
import {
  filterTopicSessionReplies,
  transitionReplyComposer,
  type ReplyComposerIntent
} from './useTopicSessionController';

const topic: TopicDetail = {
  source: 'linuxdo',
  id: '1',
  title: 'Topic',
  author: 'alice',
  url: 'https://linux.do/t/topic/1',
  createdAt: '2026-05-26T00:00:00.000Z',
  replyCount: 1,
  contentHtml: '<p>Topic</p>',
  replies: []
};

describe('topic local session helpers', () => {
  it('filters replies by author, images, and text', () => {
    const replies: Reply[] = [
      { author: 'alice', contentHtml: '<p>first</p>', createdAt: '', floor: 1 },
      { author: 'bob', contentHtml: '<p>needle</p><img src="https://img/2.png">', createdAt: '', floor: 2 },
      { author: 'alice', contentHtml: '<p>third needle</p>', createdAt: '', floor: 3 }
    ].map((reply) => prepareReplyContent(reply, 'linuxdo'));
    const filter = (replyFilter: 'all' | 'author' | 'images', commentQuery = '') =>
      filterTopicSessionReplies({
        commentQuery,
        inlineSizedImageUrls: {},
        replyFilter,
        source: 'linuxdo',
        topicDetail: { ...topic, replies },
        topicImageDeriver: createTopicImageDeriver(),
        topicReplies: replies
      }).map(({ floor }) => floor);

    expect(filter('author')).toEqual([1, 3]);
    expect(filter('images')).toEqual([2]);
    expect(filter('all', 'needle')).toEqual([2, 3]);
  });

  const floorTarget: ReplyTarget = { floor: 3, author: 'bob', authorId: '7' };
  const editTarget: ReplyEditTarget = {
    commentId: 9,
    contentMarkdown: '旧回复',
    topicId: '1',
    ticket: { source: 'linuxdo', identityKey: 'linuxdo:alice', sessionEpoch: 1 }
  };

  it.each([
    {
      label: 'opens a normal draft',
      state: { intent: { kind: 'closed' as const }, content: '普通草稿', face: '旧表情' },
      event: { type: 'open' as const },
      expected: { intent: { kind: 'new' as const }, content: '普通草稿', face: '' }
    },
    {
      label: 'targets a floor',
      state: { intent: { kind: 'new' as const }, content: '楼层草稿', face: '旧表情' },
      event: { type: 'reply-to-floor' as const, target: floorTarget },
      expected: { intent: { kind: 'floor' as const, target: floorTarget }, content: '楼层草稿', face: '' }
    },
    {
      label: 'starts an edit from the server markdown',
      state: { intent: { kind: 'floor' as const, target: floorTarget }, content: '楼层草稿', face: '旧表情' },
      event: { type: 'edit' as const, target: editTarget },
      expected: { intent: { kind: 'edit' as const, target: editTarget }, content: '旧回复', face: '' }
    },
    {
      label: 'keeps a normal draft on close',
      state: { intent: { kind: 'new' as const }, content: '普通草稿', face: '旧表情' },
      event: { type: 'close' as const },
      expected: { intent: { kind: 'closed' as const }, content: '普通草稿', face: '' }
    },
    {
      label: 'keeps a floor draft on close',
      state: { intent: { kind: 'floor' as const, target: floorTarget }, content: '楼层草稿', face: '旧表情' },
      event: { type: 'close' as const },
      expected: { intent: { kind: 'closed' as const }, content: '楼层草稿', face: '' }
    },
    {
      label: 'clears an edit draft on cancel',
      state: { intent: { kind: 'edit' as const, target: editTarget }, content: '改写中', face: '旧表情' },
      event: { type: 'close' as const },
      expected: { intent: { kind: 'closed' as const }, content: '', face: '' }
    },
    {
      label: 'preserves the draft when a stale edit detaches',
      state: { intent: { kind: 'edit' as const, target: editTarget }, content: '权限失效时保留', face: '旧表情' },
      event: { type: 'detach-edit' as const },
      expected: { intent: { kind: 'closed' as const }, content: '权限失效时保留', face: '' }
    },
    {
      label: 'resets after a successful submission',
      state: { intent: { kind: 'floor' as const, target: floorTarget }, content: '已提交', face: '表情' },
      event: { type: 'complete-submission' as const },
      expected: { intent: { kind: 'closed' as const }, content: '', face: '' }
    },
    {
      label: 'changes draft content',
      state: { intent: { kind: 'new' as const }, content: '旧草稿', face: '' },
      event: { type: 'change-content' as const, content: '新草稿' },
      expected: { intent: { kind: 'new' as const }, content: '新草稿', face: '' }
    },
    {
      label: 'changes the selected face',
      state: { intent: { kind: 'new' as const }, content: '草稿', face: '' },
      event: { type: 'change-face' as const, face: '踩' },
      expected: { intent: { kind: 'new' as const }, content: '草稿', face: '踩' }
    },
    {
      label: 'appends uploaded markup',
      state: { intent: { kind: 'new' as const }, content: '草稿', face: '' },
      event: { type: 'append-markup' as const, markup: '![图](https://img/1.png)' },
      expected: { intent: { kind: 'new' as const }, content: '草稿\n![图](https://img/1.png)', face: '' }
    }
  ])('$label', ({ state, event, expected }) => {
    expect(transitionReplyComposer(state, event)).toEqual(expected);
  });

  it('makes floor and edit targets mutually exclusive in the intent type', () => {
    expectTypeOf<Extract<ReplyComposerIntent, { kind: 'floor' }>>().toEqualTypeOf<{
      kind: 'floor';
      target: ReplyTarget;
    }>();
    expectTypeOf<Extract<ReplyComposerIntent, { kind: 'edit' }>>().toEqualTypeOf<{
      kind: 'edit';
      target: ReplyEditTarget;
    }>();
  });
});
