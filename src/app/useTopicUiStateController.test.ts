import { describe, expect, it } from 'vitest';
import { replyContentAfterComposerClose } from './useTopicUiStateController';

describe('topic UI state controller helpers', () => {
  it('clears edited reply text when closing edit mode without dropping normal drafts', () => {
    expect(replyContentAfterComposerClose('普通草稿', null)).toBe('普通草稿');
    expect(replyContentAfterComposerClose('旧回复内容', {
      commentId: 9,
      contentMarkdown: '旧回复内容'
    })).toBe('');
  });
});
