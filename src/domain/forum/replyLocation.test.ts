import { describe, expect, it } from 'vitest';
import { findReplyLocation, matchesReplyLocation } from './replyLocation';
import type { Reply } from './models';

describe('reply location identity', () => {
  const alice: Reply = {
    author: 'Alice display',
    authorId: 'alice',
    floor: 6,
    commentId: 101,
    contentHtml: '',
    createdAt: ''
  };
  const bob: Reply = { ...alice, author: 'bob', authorId: 'bob', commentId: 102 };
  it('requires the expected username as well as the exact floor', () => {
    expect(matchesReplyLocation(alice, { floor: 6, expectedAuthorUsername: 'ALICE' })).toBe(true);
    expect(matchesReplyLocation(bob, { floor: 6, expectedAuthorUsername: 'alice' })).toBe(false);
    expect(matchesReplyLocation(alice, { floor: 7, expectedAuthorUsername: 'alice' })).toBe(false);
    expect(findReplyLocation([bob, alice], { floor: 6, expectedAuthorUsername: 'alice' })).toBeUndefined();
  });
  it('rejects ambiguous floors while keeping comment IDs authoritative', () => {
    expect(findReplyLocation([alice, bob], { floor: 6 })).toBeUndefined();
    expect(findReplyLocation([alice, bob], { floor: 99, commentId: 102 })).toBe(bob);
    expect(
      findReplyLocation([alice, { ...alice, commentId: 103 }], { floor: 6, expectedAuthorUsername: 'alice' })
    ).toBeUndefined();
  });
});
