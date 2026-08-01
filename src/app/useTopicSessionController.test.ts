import { describe, expect, it } from 'vitest';
import type { Reply, TopicDetail } from '@/domain/forum/models';
import { createTopicImageDeriver } from '@/features/topic/model/topicDerivedData';
import {
  filterTopicSessionReplies,
  replyContentAfterComposerClose,
  replyComposerAfterSuccessfulSubmission
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
  it('filters replies without owning their remote state', () => {
    const replies: Reply[] = [
      { author: 'alice', contentHtml: '<p>first</p>', createdAt: '', floor: 1 },
      { author: 'bob', contentHtml: '<p>needle</p><img src="https://img/2.png">', createdAt: '', floor: 2 },
      { author: 'alice', contentHtml: '<p>third needle</p>', createdAt: '', floor: 3 }
    ];
    const filter = (replyFilter: 'all' | 'author' | 'images' | 'newest', commentQuery = '') =>
      filterTopicSessionReplies({
        commentQuery,
        inlineSizedImageUrls: {},
        replyFilter,
        topicDetail: { ...topic, replies },
        topicImageDeriver: createTopicImageDeriver(),
        topicReplies: replies
      }).map(({ floor }) => floor);

    expect(filter('author')).toEqual([1, 3]);
    expect(filter('images')).toEqual([2]);
    expect(filter('newest')).toEqual([3, 2, 1]);
    expect(filter('all', 'needle')).toEqual([2, 3]);
  });

  it('drops edit text on close but keeps a normal draft', () => {
    expect(replyContentAfterComposerClose('普通草稿', null)).toBe('普通草稿');
    expect(
      replyContentAfterComposerClose('旧回复', {
        commentId: 9,
        contentMarkdown: '旧回复',
        topicId: '1',
        ticket: { source: 'linuxdo', identityKey: 'linuxdo:alice', sessionEpoch: 1 }
      })
    ).toBe('');
  });

  it('clears composer-local state after submission', () => {
    expect(replyComposerAfterSuccessfulSubmission()).toEqual({
      replyComposerOpen: false,
      replyContent: '',
      replyEditTarget: null,
      replyFace: '',
      replyTarget: null
    });
  });
});
