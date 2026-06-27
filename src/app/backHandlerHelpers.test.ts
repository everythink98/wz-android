import { describe, expect, it } from 'vitest';
import { shouldCloseReplyComposerOnBack } from './backHandlerHelpers';

describe('Android back handler helpers', () => {
  it('closes the reply composer only on the topic screen', () => {
    expect(shouldCloseReplyComposerOnBack('topic', true)).toBe(true);
    expect(shouldCloseReplyComposerOnBack('user', true)).toBe(false);
    expect(shouldCloseReplyComposerOnBack('topic', false)).toBe(false);
  });
});
