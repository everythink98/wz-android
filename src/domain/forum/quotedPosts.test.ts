import { describe, expect, it } from 'vitest';
import {
  discourseQuotedPostReferenceFromAttributes,
  quotedPostReferenceFromReply,
  quotedPostReferenceKey,
  replyForQuotedPost,
  topicForQuotedPost
} from './quotedPosts';
import type { Reply } from './models';

describe('quoted post contract', () => {
  it('uses a valid quote reference without a URL and refuses conflicting topic URLs', () => {
    const reference = { source: 'linuxdo' as const, topicId: '42', postNumber: 6 };
    expect(topicForQuotedPost({ reference })).toMatchObject({
      source: 'linuxdo',
      id: '42',
      url: 'https://linux.do/t/42'
    });
    expect(topicForQuotedPost({ reference, topicUrl: '/t/topic/42/6' }, 'https://linux.do/t/99')).toMatchObject({
      id: '42'
    });
    for (const topicUrl of ['https://linux.do/t/99', 'https://www.v2ex.com/t/42', 'https://evil.example/t/42']) {
      expect(topicForQuotedPost({ reference, topicUrl })).toBeNull();
    }
    expect(topicForQuotedPost({ reference: { ...reference, topicId: '../42' } })).toBeNull();
  });
  it('normalizes topic-body and reply quotes to the same reference shape', () => {
    const topicBodyReference = discourseQuotedPostReferenceFromAttributes(
      'linuxdo',
      {
        'data-topic': '2427021',
        'data-post': '1'
      },
      '2427605'
    );
    const replyReference = quotedPostReferenceFromReply('linuxdo', '2427605', 1);

    expect(topicBodyReference).toEqual({ source: 'linuxdo', topicId: '2427021', postNumber: 1 });
    expect(
      discourseQuotedPostReferenceFromAttributes(
        'linuxdo',
        {
          'data-post': '2'
        },
        '42'
      )
    ).toEqual({ source: 'linuxdo', topicId: '42', postNumber: 2 });
    expect(replyReference).toEqual({ source: 'linuxdo', topicId: '2427605', postNumber: 1 });
  });

  it('keeps same-numbered posts from different topics in separate cache entries', () => {
    const first = quotedPostReferenceFromReply('linuxdo', '100', 1);
    const second = quotedPostReferenceFromReply('linuxdo', '200', 1);

    expect(first && quotedPostReferenceKey(first)).toBe('linuxdo:100:1');
    expect(second && quotedPostReferenceKey(second)).toBe('linuxdo:200:1');
  });

  it('prefers the current same-topic reply over a stale quote cache entry', () => {
    const currentReply: Reply = {
      author: 'current',
      contentHtml: '<p>current</p>',
      createdAt: '2026-08-15T00:00:00.000Z',
      floor: 2
    };
    const cachedReply: Reply = {
      ...currentReply,
      author: 'cached',
      contentHtml: '<p>cached</p>'
    };

    expect(
      replyForQuotedPost(
        { source: 'nodeseek', topicId: '100', postNumber: 2 },
        'nodeseek',
        '100',
        new Map([[2, currentReply]]),
        { 'nodeseek:100:2': cachedReply }
      )
    ).toBe(currentReply);
  });
});
