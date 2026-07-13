import { describe, expect, it } from 'vitest';
import { replyComposerDraftSessionKey, replyComposerDraftWithUploadedMarkup } from './replyComposerDraft';

describe('reply composer local draft', () => {
  it('appends an upload to the latest local text typed while the upload was running', () => {
    expect(replyComposerDraftWithUploadedMarkup('typed while uploading', '![image](upload://image.png)'))
      .toBe('typed while uploading\n![image](upload://image.png)');
  });

  it('changes the session key even when two edit targets have identical text', () => {
    expect(replyComposerDraftSessionKey(null, { commentId: 11, contentMarkdown: 'same' }))
      .not.toBe(replyComposerDraftSessionKey(null, { commentId: 12, contentMarkdown: 'same' }));
  });
});
