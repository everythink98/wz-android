import { describe, expect, it } from 'vitest';
import { hasNextReplyPage, hasPreviousReplyPage } from './useTopicController';

describe('topic query pagination', () => {
  it('accepts an advancing reply cursor', () => {
    expect(
      hasNextReplyPage({
        hasMore: true,
        requestedPage: 1,
        requestedOffset: 0,
        nextPage: 2,
        nextOffset: 20
      })
    ).toBe(true);
  });

  it('rejects a repeated reply cursor', () => {
    expect(
      hasNextReplyPage({
        hasMore: true,
        requestedPage: 2,
        requestedOffset: 20,
        nextPage: 2,
        nextOffset: 20
      })
    ).toBe(false);
  });

  it('[REG-TOPIC-062] accepts an advancing previous cursor and rejects a repeated one', () => {
    expect(
      hasPreviousReplyPage({
        requestedPage: 16,
        requestedOffset: 150,
        previousPage: 15,
        previousOffset: 140
      })
    ).toBe(true);
    expect(
      hasPreviousReplyPage({
        requestedPage: 16,
        requestedOffset: 150,
        previousPage: 16,
        previousOffset: 150
      })
    ).toBe(false);
  });
});
