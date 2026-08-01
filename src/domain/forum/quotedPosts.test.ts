import { describe, expect, it } from 'vitest';
import {
  discourseQuotedPostReferenceFromAttributes,
  quotedPostReferenceFromReply,
  quotedPostReferenceKey
} from './quotedPosts';

describe('quoted post contract', () => {
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
        'xiaoyinsi',
        {
          'data-post': '2'
        },
        '42'
      )
    ).toEqual({ source: 'xiaoyinsi', topicId: '42', postNumber: 2 });
    expect(replyReference).toEqual({ source: 'linuxdo', topicId: '2427605', postNumber: 1 });
  });

  it('keeps same-numbered posts from different topics in separate cache entries', () => {
    const first = quotedPostReferenceFromReply('linuxdo', '100', 1);
    const second = quotedPostReferenceFromReply('linuxdo', '200', 1);

    expect(first && quotedPostReferenceKey(first)).toBe('linuxdo:100:1');
    expect(second && quotedPostReferenceKey(second)).toBe('linuxdo:200:1');
  });
});
