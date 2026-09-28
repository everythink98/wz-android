import { describe, expect, it } from 'vitest';
import { composerEditorMessageSchema, composerHostMessageSchema } from './structuredComposerBridge';

describe('structured composer bridge schemas', () => {
  it('accepts prepare-panel through the existing host action channel', () => {
    expect(
      composerEditorMessageSchema.safeParse({
        type: 'REQUEST_HOST_ACTION',
        payload: { requestId: 'panel-1', action: 'prepare-panel', data: { documentEpoch: 7 } }
      }).success
    ).toBe(true);
  });
  it('accepts epoch-scoped native toolbar actions and rejects unknown actions', () => {
    expect(
      composerHostMessageSchema.safeParse({
        type: 'COMMAND',
        payload: {
          name: 'toolbar-action',
          documentEpoch: 7,
          action: 'heading-6'
        }
      }).success
    ).toBe(true);
    for (const payload of [
      { name: 'toolbar-action', action: 'bold' },
      { name: 'toolbar-action', documentEpoch: 7, action: 'heading-7' },
      { name: 'toolbar-action', documentEpoch: 7, action: 'execute-script' }
    ])
      expect(composerHostMessageSchema.safeParse({ type: 'COMMAND', payload }).success).toBe(false);
  });

  it('validates complete native toolbar state without accepting open-ended builder values', () => {
    const payload = {
      documentEpoch: 7,
      state: {
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: 0,
        italic: false,
        orderedList: false,
        strike: false,
        table: false,
        taskList: false,
        underline: false,
        link: false,
        imageBusy: false,
        builder: null,
        mode: 'rich'
      }
    };
    expect(composerEditorMessageSchema.safeParse({ type: 'TOOLBAR_STATE', payload }).success).toBe(true);
    expect(
      composerEditorMessageSchema.safeParse({
        type: 'TOOLBAR_STATE',
        payload: {
          ...payload,
          state: { ...payload.state, builder: 'arbitrary-panel' }
        }
      }).success
    ).toBe(false);
  });

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
