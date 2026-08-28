import { describe, expect, it } from 'vitest';
import { composerEditorMessageSchema, composerHostMessageSchema } from './structuredComposerBridge';

describe('structured composer bridge schemas', () => {
  it('rejects unknown fields at both message boundaries', () => {
    expect(
      composerHostMessageSchema.safeParse({
        type: 'REQUEST_SNAPSHOT',
        payload: { requestId: 'request-1', credential: 'must-not-cross' }
      }).success
    ).toBe(false);
    expect(
      composerEditorMessageSchema.safeParse({
        type: 'READY',
        payload: { revision: 0 },
        markdown: 'must-not-be-accepted'
      }).success
    ).toBe(false);
  });
});
