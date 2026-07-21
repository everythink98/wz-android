import { describe, expect, it } from 'vitest';
import { hasNextReplyPage } from './useTopicController';

describe('topic query pagination', () => {
  it('accepts an advancing reply cursor', () => {
    expect(hasNextReplyPage({
      hasMore: true,
      requestedPage: 1,
      requestedOffset: 0,
      nextPage: 2,
      nextOffset: 20
    })).toBe(true);
  });

  it('rejects a repeated reply cursor', () => {
    expect(hasNextReplyPage({
      hasMore: true,
      requestedPage: 2,
      requestedOffset: 20,
      nextPage: 2,
      nextOffset: 20
    })).toBe(false);
  });
});
