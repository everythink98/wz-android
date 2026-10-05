import { afterEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createRef, useState } from 'react';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { StructuredReplyComposer, type StructuredReplyComposerHandle } from '@/ui/composer/StructuredReplyComposer';
import type { ComposerIntent, ComposerPresentation, PendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import { composerHostMessageSchema } from '@/ui/composer/structuredComposerBridge';
import { AppState, DeviceEventEmitter, Keyboard, StyleSheet, Text } from 'react-native';
import { recordUserInteraction, userPresent } from '@/platform/network/userPresence';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { act, fireEvent, render, waitFor } from '../render';

function message(type: string, payload: unknown) {
  return { nativeEvent: { data: JSON.stringify({ type, payload }) } };
}

afterEach(() => setDiagnosticWriter(null));

describe('StructuredReplyComposer', () => {
  it.each(['success', 'reject', 'close-reopen', 'read-only-resume', 'missing-handoff'] as const)(
    'completes prepare-panel only after its current keyboard handoff: %s',
    async (outcome) => {
      const hidden = Promise.withResolvers<void>();
      const awaitKeyboardSettled = jest.fn(() => hidden.promise);
      const props = {
        actionBusy: false,
        content: '保留正文',
        initialMode: 'rich' as const,
        intent: { kind: 'reply' as const, site: 'linuxdo' as const, topicId: 'panel-handoff' },
        pendingNodeSeekPolls: [],
        presentation: 'sheet' as const,
        visible: true,
        onSnapshot: jest.fn(),
        awaitKeyboardSettled: outcome === 'missing-handoff' ? undefined : awaitKeyboardSettled
      };
      const view = await render(<StructuredReplyComposer {...props} />);
      const webView = view.getByTestId('structured-composer-webview');
      await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
      const results = () =>
        webView.props.postMessageMock.mock.calls
          .map(([raw]: [string]) => JSON.parse(raw))
          .filter(
            (event: { payload?: { name?: string; requestId?: string } }) =>
              event.payload?.name === 'host-action-result' && event.payload.requestId === 'panel-1'
          );
      await fireEvent(
        webView,
        'message',
        message('REQUEST_HOST_ACTION', { requestId: 'panel-1', action: 'prepare-panel', data: { documentEpoch: 0 } })
      );
      if (outcome !== 'missing-handoff') {
        expect(awaitKeyboardSettled).toHaveBeenCalledTimes(1);
        expect(results()).toHaveLength(0);
        if (outcome === 'close-reopen') {
          await view.rerender(<StructuredReplyComposer {...props} visible={false} />);
          await view.rerender(<StructuredReplyComposer {...props} />);
        } else if (outcome === 'read-only-resume') {
          await view.rerender(<StructuredReplyComposer {...props} readOnly />);
          await view.rerender(<StructuredReplyComposer {...props} />);
        }
        await act(async () => {
          if (outcome === 'reject') hidden.reject(new Error('keyboard unavailable'));
          else hidden.resolve();
        });
      }
      await waitFor(() => expect(results()).toHaveLength(1));
      if (outcome === 'success') expect(results()[0].payload.error).toBeUndefined();
      else expect(results()[0].payload.error).toEqual(expect.any(String));
      await view.unmount();
    }
  );

  it('keeps editing tools beside the native footer and sends actions without moving editor focus', async () => {
    const props = {
      actionBusy: false,
      content: '保留正文和选区',
      initialMode: 'rich' as const,
      intent: { kind: 'reply' as const, site: 'nodeseek' as const, topicId: 'native-tools' },
      pendingNodeSeekPolls: [],
      presentation: 'fullscreen' as const,
      visible: true,
      onSnapshot: jest.fn()
    };
    const view = await render(<StructuredReplyComposer {...props} />);
    const webView = view.getByTestId('structured-composer-webview');
    const source = webView.props.source;
    const state = {
      blockquote: false,
      bold: true,
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
    };
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    await fireEvent(webView, 'message', message('TOOLBAR_STATE', { documentEpoch: 0, state }));
    expect(view.getByTestId('composer-toolbar')).toBeOnTheScreen();
    const focusCalls = webView.props.requestFocusMock.mock.calls.length;
    await fireEvent.press(view.getByLabelText('粗体'));
    expect(webView.props.postMessageMock).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'COMMAND',
        payload: { name: 'toolbar-action', documentEpoch: 0, action: 'bold' }
      })
    );
    expect(webView.props.requestFocusMock).toHaveBeenCalledTimes(focusCalls);
    expect(view.getByTestId('structured-composer-webview').props.source).toBe(source);
    await fireEvent(
      webView,
      'message',
      message('TOOLBAR_STATE', { documentEpoch: 99, state: { ...state, imageBusy: true } })
    );
    expect(view.getByLabelText('图片')).not.toBeDisabled();
    await view.rerender(<StructuredReplyComposer {...props} actionBusy />);
    expect(view.getByLabelText('粗体')).toBeDisabled();
    await view.rerender(<StructuredReplyComposer {...props} readOnly />);
    expect(view.queryByTestId('composer-toolbar')).toBeNull();
    await view.unmount();
  });

  it.each(['submit-entry', 'pending-snapshot'] as const)(
    'blocks %s while an image is handing off its keyboard',
    async (phase) => {
      const hidden = Promise.withResolvers<void>();
      const onSubmit = jest.fn();
      const view = await render(
        <StructuredReplyComposer
          actionBusy={false}
          content="待发送正文"
          initialMode="rich"
          intent={{ kind: 'reply', site: 'linuxdo', topicId: 'handoff' }}
          pendingNodeSeekPolls={[]}
          presentation="sheet"
          visible
          submitLabel="发送回复"
          onSnapshot={jest.fn()}
          onSubmit={onSubmit}
          onUploadImage={async () => undefined}
          awaitKeyboardSettled={() => hidden.promise}
        />
      );
      const webView = view.getByTestId('structured-composer-webview');
      await fireEvent(webView, 'loadEnd');
      await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
      let snapshotId: string | undefined;
      if (phase === 'pending-snapshot') {
        await fireEvent.press(view.getByLabelText('发送回复'));
        snapshotId = webView.props.postMessageMock.mock.calls
          .map(([raw]: [string]) => JSON.parse(raw))
          .findLast((event: { type: string }) => event.type === 'REQUEST_SNAPSHOT').payload.requestId;
      }
      await fireEvent(
        webView,
        'message',
        message('REQUEST_HOST_ACTION', {
          requestId: 'upload-1',
          action: 'upload-image',
          data: { uploadId: 'upload-anchor', documentEpoch: 0 }
        })
      );
      try {
        if (phase === 'submit-entry') {
          expect(view.getByLabelText('发送回复')).toBeDisabled();
          await fireEvent.press(view.getByLabelText('发送回复'));
        } else {
          await fireEvent(
            webView,
            'message',
            message('SNAPSHOT', {
              documentEpoch: 0,
              requestId: snapshotId,
              snapshot: {
                revision: 1,
                markdown: '待发送正文',
                mode: 'rich',
                isEmpty: false,
                validationIssues: [],
                pendingNodeSeekPolls: []
              }
            })
          );
        }
        expect(onSubmit).not.toHaveBeenCalled();
        await fireEvent(
          webView,
          'message',
          message('REQUEST_HOST_ACTION', {
            requestId: 'upload-1',
            action: 'upload-image',
            data: { uploadId: 'upload-anchor', documentEpoch: 0 }
          })
        );
        expect(view.getByLabelText('发送回复')).toBeDisabled();
      } finally {
        await act(() => hidden.resolve());
        await view.unmount();
      }
    }
  );
  it('accepts a body return only from the current ready, visible and writable editor', async () => {
    const onReturnToEditor = jest.fn();
    const props = {
      actionBusy: false,
      content: '保留正文',
      initialMode: 'rich' as const,
      intent: { kind: 'create-topic' as const, site: 'linuxdo' as const, draftId: 'return-draft' },
      pendingNodeSeekPolls: [],
      presentation: 'embedded' as const,
      visible: true,
      onReturnToEditor,
      onSnapshot: jest.fn()
    };
    const view = await render(<StructuredReplyComposer {...props} />);
    const webView = view.getByTestId('structured-composer-webview');
    const returnToBody = async (documentEpoch = 0) =>
      fireEvent(webView, 'message', message('RETURN_TO_EDITOR', { documentEpoch }));
    await returnToBody();
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    await returnToBody(99);
    await view.rerender(<StructuredReplyComposer {...props} visible={false} />);
    await returnToBody();
    await view.rerender(<StructuredReplyComposer {...props} readOnly />);
    await returnToBody();
    await view.rerender(<StructuredReplyComposer {...props} dismissPanels />);
    await returnToBody();
    expect(onReturnToEditor).not.toHaveBeenCalled();
    expect(webView.props.requestFocusMock).not.toHaveBeenCalled();
    await view.rerender(<StructuredReplyComposer {...props} />);
    await returnToBody();
    expect(onReturnToEditor).toHaveBeenCalledTimes(1);
    expect(webView.props.requestFocusMock).toHaveBeenCalledTimes(1);
  });

  it('consumes each focus request once and waits for a writable editor for a new request', async () => {
    const props = {
      actionBusy: false,
      content: '保留正文和光标',
      initialMode: 'rich' as const,
      intent: { kind: 'create-topic' as const, site: 'linuxdo' as const, draftId: 'focus-draft' },
      pendingNodeSeekPolls: [],
      presentation: 'embedded' as const,
      visible: true,
      onSnapshot: jest.fn()
    };
    const view = await render(<StructuredReplyComposer {...props} focusSignal={1} />);
    const webView = view.getByTestId('structured-composer-webview');
    const source = webView.props.source;
    const postMessage = webView.props.postMessageMock;
    const requestFocus = webView.props.requestFocusMock;
    expect(requestFocus).not.toHaveBeenCalled();
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    expect(requestFocus).toHaveBeenCalledTimes(1);

    // Preview and submitting change readOnly without requesting focus again.
    await view.rerender(<StructuredReplyComposer {...props} focusSignal={1} readOnly />);
    await view.rerender(<StructuredReplyComposer {...props} focusSignal={1} />);
    expect(requestFocus).toHaveBeenCalledTimes(1);

    await view.rerender(<StructuredReplyComposer {...props} focusSignal={2} readOnly />);
    expect(requestFocus).toHaveBeenCalledTimes(1);
    await view.rerender(<StructuredReplyComposer {...props} focusSignal={2} />);
    expect(requestFocus).toHaveBeenCalledTimes(2);
    expect(view.getByTestId('structured-composer-webview').props.postMessageMock).toBe(postMessage);
    expect(view.getByTestId('structured-composer-webview').props.source).toBe(source);
    const messages = postMessage.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    expect(messages.filter((entry: { type: string }) => entry.type === 'INIT')).toHaveLength(0);
    expect(
      messages.filter((entry: { type: string; payload: { name?: string } }) => entry.payload.name === 'focus')
    ).toHaveLength(2);
  });

  it('keeps a replacement document reserved when an older submission rejects', async () => {
    const previous = Promise.withResolvers<void>();
    const current = Promise.withResolvers<void>();
    const onSubmit = jest
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(previous.promise)
      .mockReturnValueOnce(current.promise);
    const props = {
      actionBusy: false,
      content: '原正文',
      initialMode: 'rich' as const,
      intent: { kind: 'reply' as const, site: 'nodeseek' as const, topicId: 'old' },
      pendingNodeSeekPolls: [],
      presentation: 'sheet' as const,
      visible: true,
      onSnapshot: jest.fn(),
      onSubmit
    };
    const view = await render(<StructuredReplyComposer {...props} />);
    const webView = view.getByTestId('structured-composer-webview');
    const messages = () => webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    const answer = async (documentEpoch: number, markdown: string) => {
      const request = messages().findLast((entry: { type: string }) => entry.type === 'REQUEST_SNAPSHOT');
      await fireEvent(
        webView,
        'message',
        message('SNAPSHOT', {
          documentEpoch,
          requestId: request.payload.requestId,
          snapshot: {
            revision: 1,
            markdown,
            mode: 'rich',
            isEmpty: false,
            validationIssues: [],
            pendingNodeSeekPolls: []
          }
        })
      );
    };
    try {
      await fireEvent(webView, 'loadEnd');
      await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
      await fireEvent.press(view.getByLabelText('发送回复'));
      await answer(0, '原正文');
      expect(onSubmit).toHaveBeenCalledTimes(1);

      await view.rerender(
        <StructuredReplyComposer {...props} content="新正文" intent={{ ...props.intent, topicId: 'new' }} />
      );
      const documentEpoch = messages().findLast((entry: { type: string }) => entry.type === 'INIT').payload
        .documentEpoch;
      await fireEvent(webView, 'message', message('READY', { documentEpoch, revision: 0 }));
      await fireEvent.press(view.getByLabelText('发送回复'));
      await act(async () => previous.reject(new Error('旧提交失败')));
      expect(view.queryByText('旧提交失败')).toBeNull();
      expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(view.getByLabelText('发送回复'));
      expect(messages().filter((entry: { type: string }) => entry.type === 'REQUEST_SNAPSHOT')).toHaveLength(2);
      await answer(documentEpoch, '新正文');
      expect(onSubmit).toHaveBeenCalledTimes(2);
      await act(async () => current.resolve());
      expect(view.getByLabelText('发送回复').props.accessibilityState.disabled).toBe(false);
    } finally {
      await act(async () => {
        previous.resolve();
        current.resolve();
      });
    }
  });

  it.each(['sheet', 'fullscreen'] as const)(
    'restores a %s form on close but keeps a native Back collapse after its delayed close message',
    async (initialPresentation) => {
      const onPresentationChange = jest.fn();
      const props = {
        actionBusy: false,
        content: '保留正文',
        initialMode: 'rich' as const,
        intent: { kind: 'reply' as const, site: 'nodeseek' as const, topicId: '123' },
        pendingNodeSeekPolls: [],
        visible: true,
        onPresentationChange,
        onSnapshot: jest.fn()
      };
      const view = await render(<StructuredReplyComposer {...props} presentation={initialPresentation} />);
      const webView = view.getByTestId('structured-composer-webview');
      const source = webView.props.source;
      const postMessage = webView.props.postMessageMock;
      await fireEvent(webView, 'message', message('PANEL_CHANGED', { documentEpoch: 0, open: true, layout: 'form' }));
      expect(onPresentationChange).toHaveBeenLastCalledWith('fullscreen');
      expect(view.queryByTestId('structured-composer-header')).toBeNull();
      expect(view.queryByTestId('structured-composer-footer')).toBeNull();
      await view.rerender(<StructuredReplyComposer {...props} presentation="fullscreen" />);
      await fireEvent(webView, 'message', message('PANEL_CHANGED', { documentEpoch: 0, open: false }));
      expect(onPresentationChange).toHaveBeenLastCalledWith(initialPresentation);
      await view.rerender(<StructuredReplyComposer {...props} presentation={initialPresentation} />);
      await fireEvent(webView, 'message', message('PANEL_CHANGED', { documentEpoch: 0, open: true, layout: 'form' }));
      await view.rerender(<StructuredReplyComposer {...props} presentation="fullscreen" />);
      // The native sheet handles Android Back by leaving fullscreen first.
      await view.rerender(<StructuredReplyComposer {...props} presentation="sheet" />);
      expect(webView.props.postMessageMock).toHaveBeenLastCalledWith(
        JSON.stringify({ type: 'COMMAND', payload: { name: 'blur' } })
      );
      await fireEvent(webView, 'message', message('PANEL_CHANGED', { documentEpoch: 0, open: false }));
      expect(onPresentationChange).toHaveBeenLastCalledWith('sheet');
      expect(view.getByTestId('structured-composer-header')).toBeTruthy();
      expect(view.getByTestId('structured-composer-footer')).toBeTruthy();
      expect(view.getByTestId('structured-composer-webview').props.postMessageMock).toBe(postMessage);
      expect(view.getByTestId('structured-composer-webview').props.source).toBe(source);
      expect(postMessage.mock.calls.map(([raw]: [string]) => JSON.parse(raw).type)).not.toContain('INIT');
    }
  );
  it.each(['sheet', 'fullscreen'] as const)(
    'gives expressions the %s composer space and restores controls without reloading the draft',
    async (presentation) => {
      const onPresentationChange = jest.fn();
      const view = await render(
        <StructuredReplyComposer
          actionBusy={false}
          content="保留正文"
          initialMode="rich"
          intent={{ kind: 'reply', site: 'nodeseek', topicId: 'expressions' }}
          pendingNodeSeekPolls={[]}
          presentation={presentation}
          visible
          onPresentationChange={onPresentationChange}
          onSnapshot={jest.fn()}
        />
      );
      const webView = view.getByTestId('structured-composer-webview');
      const source = webView.props.source;
      await fireEvent(
        webView,
        'message',
        message('PANEL_CHANGED', { documentEpoch: 0, open: true, layout: 'expression' })
      );
      expect(view.getByTestId('structured-composer-header')).toBeTruthy();
      expect(view.queryByTestId('structured-composer-footer')).toBeNull();
      expect(view.queryByLabelText('表情')).toBeNull();
      expect(onPresentationChange).not.toHaveBeenCalled();
      await fireEvent(webView, 'message', message('PANEL_CHANGED', { documentEpoch: 0, open: false }));
      expect(view.getByTestId('structured-composer-footer')).toBeTruthy();
      expect(view.getByLabelText('表情')).toBeTruthy();
      expect(webView.props.source).toBe(source);
      expect(onPresentationChange).not.toHaveBeenCalled();
    }
  );
  it('restores the initial draft before loadEnd and keeps the HTML stable while editing', async () => {
    const content = '已恢复的草稿 </script><script>window.unexpected=true</script>';
    const props = {
      actionBusy: false,
      content,
      initialMode: 'rich' as const,
      intent: { kind: 'create-topic' as const, site: 'linuxdo' as const, draftId: 'entry-draft' },
      pendingNodeSeekPolls: [],
      presentation: 'embedded' as const,
      visible: true,
      onSnapshot: jest.fn()
    };
    const view = await render(<StructuredReplyComposer {...props} />);
    const webView = view.getByTestId('structured-composer-webview');
    const inits = () =>
      webView.props.postMessageMock.mock.calls
        .map(([raw]: [string]) => JSON.parse(raw))
        .filter((entry: { type: string }) => entry.type === 'INIT');
    const source = webView.props.source;
    const serialized = source.html.match(/id="composer-initial-document">(.*?)<\/script>/s)?.[1];
    expect(JSON.parse(serialized)).toEqual(
      expect.objectContaining({ payload: expect.objectContaining({ documentEpoch: 0, markdown: content }) })
    );
    expect(serialized).not.toContain('<');
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    await fireEvent(webView, 'loadEnd');
    expect(inits()).toHaveLength(0);
    await view.rerender(<StructuredReplyComposer {...props} content="后续修改" />);
    expect(webView.props.source).toBe(source);
    expect(inits()).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ documentEpoch: 1, markdown: '后续修改' }) })
    ]);
  });

  it('reloads the current draft without replaying the document captured when the page opened', async () => {
    const ref = createRef<StructuredReplyComposerHandle>();
    const props = {
      actionBusy: false,
      initialMode: 'rich' as const,
      intent: { kind: 'create-topic' as const, site: 'linuxdo' as const, draftId: 'reload-draft' },
      pendingNodeSeekPolls: [],
      presentation: 'embedded' as const,
      visible: true,
      onSnapshot: jest.fn()
    };
    const view = await render(<StructuredReplyComposer {...props} ref={ref} content="打开时的正文" />);
    const first = view.getByTestId('structured-composer-webview');
    await fireEvent(first, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    await view.rerender(<StructuredReplyComposer {...props} ref={ref} content="最新的正文" />);
    await fireEvent(first, 'message', message('READY', { documentEpoch: 1, revision: 0 }));
    await fireEvent(first, 'renderProcessGone');
    await fireEvent.press(view.getByText('重载编辑器'));
    const reloaded = view.getByTestId('structured-composer-webview');
    expect(reloaded.props.source.html).not.toContain('id="composer-initial-document"');
    await fireEvent(reloaded, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    await expect(ref.current!.requestSnapshot()).rejects.toThrow('尚未就绪');
    await fireEvent(reloaded, 'loadEnd');
    const init = reloaded.props.postMessageMock.mock.calls
      .map(([raw]: [string]) => JSON.parse(raw))
      .find((event: { type: string }) => event.type === 'INIT');
    expect(init.payload.markdown).toBe('最新的正文');
    expect(init.payload.documentEpoch).toBeGreaterThan(1);
  });

  it('acknowledges native upload placeholders without focusing and rejects a replaced document', async () => {
    const ref = createRef<StructuredReplyComposerHandle>();
    const props = {
      actionBusy: false,
      content: 'IME末字',
      initialMode: 'rich' as const,
      intent: { kind: 'create-topic' as const, site: 'linuxdo' as const, draftId: 'upload-draft' },
      pendingNodeSeekPolls: [],
      presentation: 'embedded' as const,
      visible: true,
      onSnapshot: jest.fn()
    };
    const view = await render(<StructuredReplyComposer ref={ref} {...props} />);
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'loadEnd');
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    const messages = () => webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    const acknowledge = async (markdown = props.content) => {
      const command = messages().at(-1).payload;
      await fireEvent(
        webView,
        'message',
        message('UPLOAD_COMMAND_RESULT', {
          uploadId: command.uploadId,
          documentEpoch: command.documentEpoch,
          command: command.name,
          accepted: true
        })
      );
      const request = messages().findLast((entry: { type: string }) => entry.type === 'REQUEST_SNAPSHOT');
      await fireEvent(
        webView,
        'message',
        message('SNAPSHOT', {
          documentEpoch: 0,
          requestId: request.payload.requestId,
          snapshot: {
            revision: 1,
            markdown,
            mode: 'rich',
            isEmpty: false,
            validationIssues: [],
            pendingNodeSeekPolls: []
          }
        })
      );
    };
    let pending!: Promise<string>;
    let settled = false;
    await act(() => {
      pending = ref.current!.beginImageUpload().then((id) => {
        settled = true;
        return id;
      });
    });
    expect(settled).toBe(false);
    expect(messages().at(-1).payload).toEqual(
      expect.objectContaining({ name: 'begin-image-upload', documentEpoch: 0 })
    );
    await acknowledge();
    const id = await pending;
    expect(props.onSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ markdown: 'IME末字' }));
    let finish!: Promise<void>;
    await act(() => {
      finish = ref.current!.finishImageUpload(id, '![图片](https://example.com/a.png)');
    });
    expect(messages().at(-1).payload).toEqual({
      name: 'finish-image-upload',
      documentEpoch: 0,
      uploadId: id,
      markdown: '![图片](https://example.com/a.png)'
    });
    await acknowledge('IME末字\n![图片](https://example.com/a.png)');
    await finish;
    expect(messages().some((entry: { payload: { name?: string } }) => entry.payload?.name === 'focus')).toBe(false);
    await act(() => {
      pending = ref.current!.beginImageUpload();
    });
    const rejected = expect(pending).rejects.toThrow('编辑器未接受上传位置');
    const refusedCommand = messages().at(-1).payload;
    await fireEvent(
      webView,
      'message',
      message('UPLOAD_COMMAND_RESULT', {
        uploadId: refusedCommand.uploadId,
        documentEpoch: 0,
        command: 'begin-image-upload',
        accepted: false
      })
    );
    await rejected;
    expect(messages().at(-1).payload).toEqual({
      name: 'finish-image-upload',
      uploadId: refusedCommand.uploadId,
      documentEpoch: 0
    });
    await act(() => {
      pending = ref.current!.beginImageUpload();
    });
    await acknowledge();
    const stale = await pending;
    await view.rerender(<StructuredReplyComposer ref={ref} {...props} content="另一个草稿" />);
    await expect(ref.current!.finishImageUpload(stale, '不能插入')).rejects.toThrow('编辑文档已变化');
  });
  it.each(['timeout', 'rejected'] as const)(
    'releases an upload after its finish acknowledgement is %s',
    async (failure) => {
      const ref = createRef<StructuredReplyComposerHandle>();
      const view = await render(
        <StructuredReplyComposer
          ref={ref}
          actionBusy={false}
          content="正文"
          initialMode="rich"
          intent={{ kind: 'create-topic', site: 'linuxdo', draftId: 'upload-recovery' }}
          pendingNodeSeekPolls={[]}
          presentation="embedded"
          visible
          onSnapshot={jest.fn()}
        />
      );
      const webView = view.getByTestId('structured-composer-webview');
      await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
      const messages = () => webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
      const acknowledge = (command: { uploadId: string; name: string }, accepted = true) =>
        fireEvent(
          webView,
          'message',
          message('UPLOAD_COMMAND_RESULT', {
            uploadId: command.uploadId,
            documentEpoch: 0,
            command: command.name,
            accepted
          })
        );
      const begin = async () => {
        let pending!: Promise<string>;
        await act(() => {
          pending = ref.current!.beginImageUpload();
        });
        await acknowledge(messages().at(-1).payload);
        const request = messages().findLast((entry: { type: string }) => entry.type === 'REQUEST_SNAPSHOT');
        await fireEvent(
          webView,
          'message',
          message('SNAPSHOT', {
            documentEpoch: 0,
            requestId: request.payload.requestId,
            snapshot: {
              revision: 1,
              markdown: '正文',
              mode: 'rich',
              isEmpty: false,
              validationIssues: [],
              pendingNodeSeekPolls: []
            }
          })
        );
        return pending;
      };
      const id = await begin();
      let finishing!: Promise<void>;
      await act(() => {
        finishing = ref.current!.finishImageUpload(id, '![图片](https://example.com/a.png)');
      });
      const command = messages().at(-1).payload;
      const failed = expect(finishing).rejects.toThrow(failure === 'timeout' ? '未确认' : '未接受');
      if (failure === 'rejected') await acknowledge(command, false);
      await act(async () => {
        await failed;
      });
      // The first finish may already have inserted the image; cleanup must never resend the markup.
      await act(async () => {
        await ref.current!.finishImageUpload(id).catch(() => undefined);
      });
      const next = await begin();
      expect(next).not.toBe(id);
      await acknowledge(command);
      await expect(ref.current!.beginImageUpload()).rejects.toThrow('请等待当前上传完成');
      expect(
        messages().filter(
          (entry: { payload?: { markdown?: string } }) =>
            entry.payload?.markdown === '![图片](https://example.com/a.png)'
        )
      ).toHaveLength(1);
      await view.unmount();
    }
  );

  it.each(['create-topic', 'reply'] as const)(
    'keeps %s snapshot ownership explicit across native picker backgrounding',
    async (kind) => {
      const previousSubscriptions = jest.mocked(AppState.addEventListener).mock.calls.length;
      const ref = createRef<StructuredReplyComposerHandle>();
      const view = await render(
        <StructuredReplyComposer
          ref={ref}
          actionBusy={false}
          content="正文"
          intent={
            kind === 'create-topic'
              ? { kind, site: 'nodeseek', draftId: 'picker-draft' }
              : { kind, site: 'nodeseek', topicId: '42' }
          }
          pendingNodeSeekPolls={[]}
          presentation="embedded"
          visible
          onSnapshot={jest.fn()}
        />
      );
      const webView = view.getByTestId('structured-composer-webview');
      await fireEvent(webView, 'loadEnd');
      await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
      const onAppState = jest
        .mocked(AppState.addEventListener)
        .mock.calls.slice(previousSubscriptions)
        .findLast(([event]) => event === 'change')?.[1];
      expect(onAppState).toBeDefined();
      const requests = () =>
        webView.props.postMessageMock.mock.calls
          .map(([raw]: [string]) => JSON.parse(raw))
          .filter((event: { type: string }) => event.type === 'REQUEST_SNAPSHOT');
      await act(() => onAppState?.('background'));
      expect(requests()).toHaveLength(kind === 'create-topic' ? 0 : 1);
      await act(() => onAppState?.('active'));
      let pending!: ReturnType<StructuredReplyComposerHandle['requestSnapshot']>;
      await act(() => {
        pending = ref.current!.requestSnapshot();
      });
      const snapshot = {
        revision: 1,
        markdown: '最新正文',
        mode: 'rich',
        isEmpty: false,
        validationIssues: [],
        pendingNodeSeekPolls: []
      };
      for (const request of requests()) {
        await fireEvent(
          webView,
          'message',
          message('SNAPSHOT', { documentEpoch: 0, requestId: request.payload.requestId, snapshot })
        );
      }
      await expect(pending).resolves.toEqual(snapshot);
    }
  );

  it('replaces consecutive category templates in a topic draft without appending either template', async () => {
    const props = {
      actionBusy: false,
      initialMode: 'source' as const,
      intent: { kind: 'create-topic' as const, site: 'linuxdo' as const, draftId: 'draft-templates' },
      pendingNodeSeekPolls: [],
      presentation: 'embedded' as const,
      visible: true,
      onSnapshot: jest.fn()
    };
    const view = await render(<StructuredReplyComposer {...props} content="模板甲" />);
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'loadEnd');
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    await view.rerender(<StructuredReplyComposer {...props} content="模板乙" />);
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 1, revision: 0 }));
    await view.rerender(<StructuredReplyComposer {...props} content="模板乙新增要求" />);
    const messages = webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    expect(
      messages
        .filter((event: { type: string }) => event.type === 'INIT')
        .map((event: { payload: { markdown: string } }) => event.payload.markdown)
    ).toEqual(['模板乙', '模板乙新增要求']);
    expect(
      messages.some(
        (event: { type: string; payload: { name?: string } }) =>
          event.type === 'COMMAND' && event.payload.name === 'insert-markdown'
      )
    ).toBe(false);
  });
  it('restores an embedded topic draft and inserts attachments through the current selection', async () => {
    const ref = createRef<StructuredReplyComposerHandle>();
    const props = {
      actionBusy: false,
      content: '正文',
      initialMode: 'source' as const,
      intent: { kind: 'create-topic' as const, site: 'linuxdo' as const, draftId: 'draft-1' },
      pendingNodeSeekPolls: [],
      presentation: 'embedded' as const,
      footerActions: <Text>页面媒体操作</Text>,
      visible: true,
      onTogglePreview: jest.fn(),
      onPanelChange: jest.fn(),
      onSnapshot: jest.fn()
    };
    const view = await render(<StructuredReplyComposer ref={ref} {...props} />);
    expect(view.queryByLabelText('发送回复')).toBeNull();
    expect(view.queryByLabelText('收起回复')).toBeNull();
    expect(view.queryByLabelText('全屏')).toBeNull();
    expect(view.queryByTestId('structured-composer-header')).toBeNull();
    expect(view.queryByTestId('structured-composer-footer')).toBeNull();
    expect(view.queryByLabelText('源码')).toBeNull();
    const webView = view.getByTestId('structured-composer-webview');
    const messages = () => webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    await fireEvent(webView, 'loadEnd');
    expect(JSON.parse(webView.props.source.html.match(/id="composer-initial-document">(.*?)<\/script>/s)?.[1])).toEqual(
      expect.objectContaining({
        type: 'INIT',
        payload: expect.objectContaining({ intentKind: 'create-topic', mode: 'source' })
      })
    );
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    await fireEvent(webView, 'message', message('PANEL_CHANGED', { documentEpoch: 0, open: true }));
    expect(props.onPanelChange).toHaveBeenLastCalledWith(true);
    await fireEvent(webView, 'message', message('PANEL_CHANGED', { documentEpoch: 99, open: false }));
    expect(props.onPanelChange).toHaveBeenCalledTimes(1);
    await fireEvent(
      webView,
      'message',
      message('REQUEST_HOST_ACTION', { requestId: 'preview', action: 'preview-topic' })
    );
    expect(props.onTogglePreview).toHaveBeenCalledTimes(1);
    let inserted: Promise<void>;
    await act(() => {
      inserted = ref.current!.insertMarkup('[附件](https://example.com/a.pdf)');
    });
    const request = messages().findLast((entry: { type: string }) => entry.type === 'REQUEST_SNAPSHOT');
    expect(messages()).toContainEqual({
      type: 'COMMAND',
      payload: { name: 'insert-markdown', markdown: '[附件](https://example.com/a.pdf)' }
    });
    await fireEvent(
      webView,
      'message',
      message('SNAPSHOT', {
        documentEpoch: 0,
        requestId: request.payload.requestId,
        snapshot: {
          revision: 1,
          markdown: '正文[附件](https://example.com/a.pdf)',
          mode: 'source',
          isEmpty: false,
          validationIssues: [],
          pendingNodeSeekPolls: []
        }
      })
    );
    await inserted!;
    expect(messages().filter((entry: { type: string }) => entry.type === 'INIT')).toHaveLength(0);
    await view.rerender(<StructuredReplyComposer ref={ref} {...props} readOnly />);
    expect(messages()).toContainEqual({ type: 'SET_READ_ONLY', payload: { readOnly: true } });
    await expect(ref.current!.insertMarkup('不能编辑')).rejects.toThrow('退出预览');
  });
  it('renews activity only for an explicit input message from a visible composer', async () => {
    const previous = AppState.currentState;
    AppState.currentState = 'active';
    let now = 100_000;
    const clock = jest.spyOn(performance, 'now').mockImplementation(() => now);
    recordUserInteraction();
    try {
      const view = await render(
        <StructuredReplyComposer
          actionBusy={false}
          closeLabel="收起回复"
          discourseEmojiUrls={{}}
          focusSignal={0}
          intent={{ site: 'linuxdo', kind: 'reply', topicId: '12' }}
          content=""
          pendingNodeSeekPolls={[]}
          presentation="sheet"
          submitLabel="发送回复"
          title="回复"
          visible
          onOpenChange={jest.fn()}
          onPresentationChange={jest.fn()}
          onSnapshot={jest.fn()}
          onSubmit={jest.fn()}
        />
      );
      const webView = view.getByTestId('structured-composer-webview');
      now += 60_000;
      await fireEvent(webView, 'message', message('READY', { revision: 0 }));
      await fireEvent(
        webView,
        'message',
        message('STATE_CHANGED', { revision: 1, mode: 'rich', isEmpty: false, canUndo: true, canRedo: false })
      );
      expect(userPresent()).toBe(false);
      await fireEvent(webView, 'message', message('USER_INTERACTION', {}));
      expect(userPresent()).toBe(true);
      now += 60_000;
      await fireEvent(webView, 'message', message('USER_INTERACTION', { text: 'must-not-cross' }));
      expect(userPresent()).toBe(false);
    } finally {
      clock.mockRestore();
      AppState.currentState = previous;
    }
  });
  it('records snapshot timeouts even when the closing caller handles the rejection', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const ref = createRef<StructuredReplyComposerHandle>();
    const view = await render(
      <StructuredReplyComposer
        ref={ref}
        actionBusy={false}
        closeLabel="收起回复"
        content="private draft"
        discourseEmojiUrls={{}}
        focusSignal={0}
        intent={{ kind: 'reply', site: 'linuxdo', topicId: '42' }}
        pendingNodeSeekPolls={[]}
        presentation="sheet"
        submitLabel="发送回复"
        title="回复"
        visible
        onOpenChange={jest.fn()}
        onPresentationChange={jest.fn()}
        onSnapshot={jest.fn()}
        onSubmit={jest.fn()}
      />
    );
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'loadEnd');
    await fireEvent(webView, 'message', message('READY', { revision: 0 }));
    await act(async () => {
      await ref.current!.requestSnapshot().catch(() => undefined);
    });
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        operation: 'composer-snapshot',
        phase: 'finish',
        outcome: 'failure',
        reason: 'timeout'
      })
    );
    expect(lines.join('')).not.toContain('private draft');
  });
  it('records renderer loss and runtime parse failures without the draft', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const view = await render(
      <StructuredReplyComposer
        actionBusy={false}
        closeLabel="收起回复"
        content="private draft"
        discourseEmojiUrls={{}}
        focusSignal={0}
        intent={{ kind: 'reply', site: 'linuxdo', topicId: '42' }}
        pendingNodeSeekPolls={[]}
        presentation="sheet"
        submitLabel="发送回复"
        title="回复"
        visible
        onOpenChange={jest.fn()}
        onPresentationChange={jest.fn()}
        onSnapshot={jest.fn()}
        onSubmit={jest.fn()}
      />
    );
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(
      webView,
      'message',
      message('ERROR', { code: 'markdown-parse-failed', message: 'private draft', revision: 0 })
    );
    await fireEvent(webView, 'renderProcessGone', { nativeEvent: { didCrash: true } });
    expect(lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'composer-error', phase: 'finish', editorError: 'markdown-parse-failed' }),
        expect.objectContaining({ operation: 'composer-error', phase: 'finish', reason: 'renderer_gone' })
      ])
    );
    expect(lines.join('')).not.toContain('private draft');
  });
  it('waits for the viewport and editor activation ACK before opening an image picker', async () => {
    const keyboardVisible = jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    const settled = Promise.withResolvers<void>();
    const awaitKeyboardSettled = jest.fn(() => settled.promise);
    const onUploadImage = jest.fn(async () => '![图片](https://example.com/a.png)');
    try {
      const view = await render(
        <StructuredReplyComposer
          actionBusy={false}
          content=""
          initialMode="rich"
          intent={{ kind: 'reply', site: 'nodeseek', topicId: '42' }}
          pendingNodeSeekPolls={[]}
          presentation="sheet"
          visible
          onSnapshot={jest.fn()}
          onUploadImage={onUploadImage}
          awaitKeyboardSettled={awaitKeyboardSettled}
        />
      );
      const webView = view.getByTestId('structured-composer-webview');
      const sent = () => webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
      await fireEvent(webView, 'loadEnd');
      await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
      webView.props.postMessageMock.mockClear();
      await fireEvent(
        webView,
        'message',
        message('REQUEST_HOST_ACTION', {
          requestId: 'image',
          action: 'upload-image',
          data: { uploadId: 'image-anchor', documentEpoch: 0 }
        })
      );
      expect(onUploadImage).not.toHaveBeenCalled();
      expect(sent()).not.toContainEqual({ type: 'COMMAND', payload: { name: 'blur' } });
      await act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));
      expect(onUploadImage).not.toHaveBeenCalled();
      expect(awaitKeyboardSettled).toHaveBeenCalledTimes(1);
      await act(() => settled.resolve());
      expect(onUploadImage).not.toHaveBeenCalled();
      expect(sent()).toContainEqual({
        type: 'COMMAND',
        payload: { name: 'begin-image-upload', uploadId: 'image-anchor', documentEpoch: 0 }
      });
      const ack = (uploadId: string, documentEpoch: number) =>
        fireEvent(
          webView,
          'message',
          message('UPLOAD_COMMAND_RESULT', {
            command: 'begin-image-upload',
            uploadId,
            documentEpoch,
            accepted: true
          })
        );
      await ack('other-upload', 0);
      await ack('image-anchor', 99);
      expect(onUploadImage).not.toHaveBeenCalled();
      await ack('image-anchor', 0);
      await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));
      expect(sent()).not.toContainEqual({ type: 'COMMAND', payload: { name: 'blur' } });
    } finally {
      keyboardVisible.mockRestore();
    }
  });

  it.each(['rejected', 'timeout'] as const)(
    'clears a toolbar upload after its activation ACK is %s and permits a fresh request',
    async (failure) => {
      const onUploadImage = jest.fn(async () => undefined);
      const view = await render(
        <StructuredReplyComposer
          actionBusy={false}
          content="保留正文"
          initialMode="rich"
          intent={{ kind: 'reply', site: 'linuxdo', topicId: 'activation-recovery' }}
          pendingNodeSeekPolls={[]}
          presentation="sheet"
          visible
          submitLabel="发送回复"
          onSnapshot={jest.fn()}
          onSubmit={jest.fn()}
          onUploadImage={onUploadImage}
          awaitKeyboardSettled={async () => undefined}
        />
      );
      const webView = view.getByTestId('structured-composer-webview');
      await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
      const sent = () => webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
      const request = (id: string) =>
        fireEvent(
          webView,
          'message',
          message('REQUEST_HOST_ACTION', {
            requestId: id,
            action: 'upload-image',
            data: { uploadId: `${id}-anchor`, documentEpoch: 0 }
          })
        );
      const ack = (id: string, accepted = true) =>
        fireEvent(
          webView,
          'message',
          message('UPLOAD_COMMAND_RESULT', {
            command: 'begin-image-upload',
            uploadId: `${id}-anchor`,
            documentEpoch: 0,
            accepted
          })
        );
      jest.useFakeTimers();
      try {
        await request('failed');
        expect(view.getByLabelText('发送回复')).toBeDisabled();
        if (failure === 'rejected') await ack('failed', false);
        else await act(() => jest.advanceTimersByTime(1500));
        expect(onUploadImage).not.toHaveBeenCalled();
        expect(view.getByLabelText('发送回复')).not.toBeDisabled();
        expect(sent()).toContainEqual({
          type: 'COMMAND',
          payload: {
            name: 'finish-image-upload',
            uploadId: 'failed-anchor',
            documentEpoch: 0
          }
        });
        await request('fresh');
        await ack('failed');
        expect(onUploadImage).not.toHaveBeenCalled();
        await ack('fresh');
        expect(onUploadImage).toHaveBeenCalledTimes(1);
      } finally {
        await view.unmount();
        jest.useRealTimers();
      }
    }
  );

  it.each(['missing', 'rejected'] as const)(
    'rejects a %s viewport handoff without opening the picker',
    async (kind) => {
      const onUploadImage = jest.fn();
      const view = await render(
        <StructuredReplyComposer
          actionBusy={false}
          content=""
          initialMode="rich"
          intent={{ kind: 'reply', site: 'nodeseek', topicId: '42' }}
          pendingNodeSeekPolls={[]}
          presentation="sheet"
          visible
          onSnapshot={jest.fn()}
          onUploadImage={onUploadImage}
          awaitKeyboardSettled={
            kind === 'missing'
              ? undefined
              : async () => {
                  throw new Error('键盘尚未收起');
                }
          }
        />
      );
      const webView = view.getByTestId('structured-composer-webview');
      await fireEvent(
        webView,
        'message',
        message('REQUEST_HOST_ACTION', {
          requestId: 'image',
          action: 'upload-image',
          data: { uploadId: 'image-anchor', documentEpoch: 0 }
        })
      );
      expect(onUploadImage).not.toHaveBeenCalled();
      expect(webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual({
        type: 'COMMAND',
        payload: {
          name: 'host-action-result',
          requestId: 'image',
          error: kind === 'missing' ? '当前入口尚未准备好图片选择' : '键盘尚未收起'
        }
      });
    }
  );

  it.each(
    (['close', 'replace', 'unmount', 'read-only', 'busy', 'background'] as const).flatMap((change) =>
      (['viewport', 'activation'] as const).map((phase) => ({ change, phase }))
    )
  )('does not open a stale picker after $change while its $phase settles', async ({ change, phase }) => {
    const settled = Promise.withResolvers<void>();
    const onUploadImage = jest.fn();
    const props = {
      actionBusy: false,
      content: '',
      initialMode: 'rich' as const,
      intent: { kind: 'reply' as const, site: 'nodeseek' as const, topicId: '42' },
      pendingNodeSeekPolls: [],
      presentation: 'sheet' as const,
      visible: true,
      onSnapshot: jest.fn(),
      onUploadImage,
      awaitKeyboardSettled: () => settled.promise
    };
    const view = await render(<StructuredReplyComposer {...props} />);
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'loadEnd');
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    await fireEvent(
      webView,
      'message',
      message('REQUEST_HOST_ACTION', {
        requestId: 'image',
        action: 'upload-image',
        data: { uploadId: 'image-anchor', documentEpoch: 0 }
      })
    );
    if (phase === 'activation') {
      await act(() => settled.resolve());
      expect(onUploadImage).not.toHaveBeenCalled();
    }
    const state = AppState.currentState;
    const receive = webView.props.onMessage;
    if (change === 'background') AppState.currentState = 'background';
    try {
      if (change === 'unmount') await view.unmount();
      else
        await view.rerender(
          <StructuredReplyComposer
            {...props}
            visible={change !== 'close'}
            readOnly={change === 'read-only'}
            actionBusy={change === 'busy'}
            intent={change === 'replace' ? { ...props.intent, topicId: 'new' } : props.intent}
          />
        );
      if (phase === 'viewport') await act(() => settled.resolve());
      else
        await act(() =>
          receive(
            message('UPLOAD_COMMAND_RESULT', {
              command: 'begin-image-upload',
              uploadId: 'image-anchor',
              documentEpoch: 0,
              accepted: true
            })
          )
        );
      expect(onUploadImage).not.toHaveBeenCalled();
    } finally {
      AppState.currentState = state;
      if (change !== 'unmount') await view.unmount();
    }
  });

  it.each(
    (['close', 'read-only', 'busy', 'reply-background', 'topic-background'] as const).flatMap((change) =>
      (['viewport', 'activation'] as const).map((phase) => ({ change, phase }))
    )
  )('keeps a $phase upload invalid after a temporary $change is restored', async ({ change, phase }) => {
    const settled = Promise.withResolvers<void>();
    const onUploadImage = jest.fn(async () => undefined);
    const previousSubscriptions = jest.mocked(AppState.addEventListener).mock.calls.length;
    const props = {
      actionBusy: false,
      content: '保留正文',
      initialMode: 'rich' as const,
      intent:
        change === 'topic-background'
          ? { kind: 'create-topic' as const, site: 'nodeseek' as const, draftId: 'same-draft' }
          : { kind: 'reply' as const, site: 'nodeseek' as const, topicId: 'same-topic' },
      pendingNodeSeekPolls: [],
      presentation: 'sheet' as const,
      visible: true,
      onSnapshot: jest.fn(),
      onUploadImage,
      awaitKeyboardSettled: () => settled.promise
    };
    const view = await render(<StructuredReplyComposer {...props} />);
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    const sent = () => webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    const request = (id: string) =>
      fireEvent(
        webView,
        'message',
        message('REQUEST_HOST_ACTION', {
          requestId: id,
          action: 'upload-image',
          data: { uploadId: `${id}-anchor`, documentEpoch: 0 }
        })
      );
    const ack = (id: string) =>
      fireEvent(
        webView,
        'message',
        message('UPLOAD_COMMAND_RESULT', {
          command: 'begin-image-upload',
          uploadId: `${id}-anchor`,
          documentEpoch: 0,
          accepted: true
        })
      );
    const state = AppState.currentState;
    try {
      await request('old');
      if (phase === 'activation') await act(() => settled.resolve());
      if (change.endsWith('background')) {
        const onAppState = jest
          .mocked(AppState.addEventListener)
          .mock.calls.slice(previousSubscriptions)
          .findLast(([event]) => event === 'change')?.[1];
        await act(() => {
          AppState.currentState = 'background';
          onAppState?.('background');
        });
        await act(() => {
          AppState.currentState = 'active';
          onAppState?.('active');
        });
      } else {
        await view.rerender(
          <StructuredReplyComposer
            {...props}
            visible={change !== 'close'}
            readOnly={change === 'read-only'}
            actionBusy={change === 'busy'}
          />
        );
        await view.rerender(<StructuredReplyComposer {...props} />);
      }
      if (phase === 'viewport') await act(() => settled.resolve());
      await ack('old');
      expect(onUploadImage).not.toHaveBeenCalled();
      expect(sent()).toContainEqual({
        type: 'COMMAND',
        payload: { name: 'finish-image-upload', uploadId: 'old-anchor', documentEpoch: 0 }
      });
      expect(sent()).toContainEqual({
        type: 'COMMAND',
        payload: { name: 'host-action-result', requestId: 'old', error: expect.any(String) }
      });
      await request('fresh');
      await ack('old');
      expect(onUploadImage).not.toHaveBeenCalled();
      await ack('fresh');
      expect(onUploadImage).toHaveBeenCalledTimes(1);
    } finally {
      AppState.currentState = state;
      await view.unmount();
    }
  });

  it('keeps an opened picker valid while its system activity backgrounds the editor', async () => {
    const upload = Promise.withResolvers<string>();
    const previousSubscriptions = jest.mocked(AppState.addEventListener).mock.calls.length;
    const onUploadImage = jest.fn(() => upload.promise);
    const props = {
      actionBusy: false,
      content: '保留正文',
      initialMode: 'rich' as const,
      intent: { kind: 'reply' as const, site: 'nodeseek' as const, topicId: 'picker-background' },
      pendingNodeSeekPolls: [],
      presentation: 'sheet' as const,
      visible: true,
      onSnapshot: jest.fn(),
      onUploadImage,
      awaitKeyboardSettled: async () => undefined
    };
    const view = await render(<StructuredReplyComposer {...props} />);
    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'message', message('READY', { documentEpoch: 0, revision: 0 }));
    const sent = () => webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
    const state = AppState.currentState;
    try {
      await fireEvent(
        webView,
        'message',
        message('REQUEST_HOST_ACTION', {
          requestId: 'opened',
          action: 'upload-image',
          data: { uploadId: 'opened-anchor', documentEpoch: 0 }
        })
      );
      await fireEvent(
        webView,
        'message',
        message('UPLOAD_COMMAND_RESULT', {
          command: 'begin-image-upload',
          uploadId: 'opened-anchor',
          documentEpoch: 0,
          accepted: true
        })
      );
      expect(onUploadImage).toHaveBeenCalledTimes(1);
      const onAppState = jest
        .mocked(AppState.addEventListener)
        .mock.calls.slice(previousSubscriptions)
        .findLast(([event]) => event === 'change')?.[1];
      await act(() => {
        AppState.currentState = 'background';
        onAppState?.('background');
      });
      await view.rerender(<StructuredReplyComposer {...props} actionBusy />);
      await act(() => {
        AppState.currentState = 'active';
        onAppState?.('active');
      });
      await act(() => upload.resolve('![图片](https://example.com/picked.png)'));
      expect(sent()).toContainEqual({
        type: 'COMMAND',
        payload: {
          name: 'host-action-result',
          requestId: 'opened',
          result: { markdown: '![图片](https://example.com/picked.png)' }
        }
      });
      expect(
        sent().some((event: { payload?: { name?: string } }) => event.payload?.name === 'finish-image-upload')
      ).toBe(false);
    } finally {
      AppState.currentState = state;
      await view.unmount();
    }
  });

  it('forwards LinuxDo poll capabilities and image lookup through the existing host-action seam', async () => {
    const onResolveLinuxDoUpload = jest.fn(async () => 'https://cdn.example.com/photo.png');
    const onLoadLinuxDoPollCapabilities = jest.fn(async () => ({
      groups: [{ id: 10, name: 'trust_level_1', displayName: '信任级别 1' }],
      canUseStaffResults: false
    }));
    const view = await render(
      <StructuredReplyComposer
        actionBusy={false}
        closeLabel="收起回复"
        content=""
        discourseEmojiUrls={{}}
        focusSignal={0}
        intent={{ kind: 'reply', site: 'linuxdo', topicId: '42' }}
        pendingNodeSeekPolls={[]}
        presentation="sheet"
        submitLabel="发送回复"
        title="回复"
        visible
        onLoadLinuxDoPollCapabilities={onLoadLinuxDoPollCapabilities}
        onResolveLinuxDoUpload={onResolveLinuxDoUpload}
        onOpenChange={jest.fn()}
        onPresentationChange={jest.fn()}
        onSnapshot={jest.fn()}
        onSubmit={jest.fn()}
      />
    );

    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(
      webView,
      'message',
      message('REQUEST_HOST_ACTION', {
        requestId: 'poll-capabilities',
        action: 'load-linuxdo-poll-capabilities'
      })
    );

    await waitFor(() => expect(onLoadLinuxDoPollCapabilities).toHaveBeenCalledTimes(1));
    await fireEvent(
      webView,
      'message',
      message('REQUEST_HOST_ACTION', {
        requestId: 'image-url',
        action: 'resolve-linuxdo-upload',
        data: { shortUrl: 'upload://abc.png' }
      })
    );
    await waitFor(() => expect(onResolveLinuxDoUpload).toHaveBeenCalledWith('upload://abc.png'));
    await waitFor(() =>
      expect(webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual({
        type: 'COMMAND',
        payload: {
          name: 'host-action-result',
          requestId: 'image-url',
          result: { url: 'https://cdn.example.com/photo.png' }
        }
      })
    );
    await waitFor(() =>
      expect(webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual({
        type: 'COMMAND',
        payload: {
          name: 'host-action-result',
          requestId: 'poll-capabilities',
          result: {
            groups: [{ id: 10, name: 'trust_level_1', displayName: '信任级别 1' }],
            canUseStaffResults: false
          }
        }
      })
    );
  });

  it('keeps a large LinuxDo emoji catalog inside the editor Bridge contract', async () => {
    const discourseEmojiUrls = Object.fromEntries(
      Array.from({ length: 2001 }, (_, index) => [`emoji_${index}`, `https://linux.do/emoji/${index}.png`])
    );
    const view = await render(
      <StructuredReplyComposer
        actionBusy={false}
        closeLabel="收起回复"
        content=""
        discourseEmojiUrls={discourseEmojiUrls}
        focusSignal={0}
        intent={{ kind: 'reply', site: 'linuxdo', topicId: '42' }}
        pendingNodeSeekPolls={[]}
        presentation="sheet"
        submitLabel="发送回复"
        title="回复"
        visible
        onOpenChange={jest.fn()}
        onPresentationChange={jest.fn()}
        onSnapshot={jest.fn()}
        onSubmit={jest.fn()}
      />
    );

    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'loadEnd');
    const init = webView.props.postMessageMock.mock.calls
      .map(([raw]: [string]) => JSON.parse(raw))
      .findLast((entry: { type: string }) => entry.type === 'INIT');

    expect(composerHostMessageSchema.safeParse(init).success).toBe(true);
    expect(init.payload.discourseEmoji).toHaveLength(2000);
  });

  it('syncs a late LinuxDo emoji catalog without reinitializing the editor', async () => {
    const props = {
      actionBusy: false,
      closeLabel: '收起回复',
      content: 'draft',
      focusSignal: 0,
      intent: { kind: 'reply' as const, site: 'linuxdo' as const, topicId: '42' },
      pendingNodeSeekPolls: [],
      presentation: 'sheet' as const,
      submitLabel: '发送回复',
      title: '回复',
      visible: true,
      onOpenChange: jest.fn(),
      onPresentationChange: jest.fn(),
      onSnapshot: jest.fn(),
      onSubmit: jest.fn()
    };
    const view = await render(<StructuredReplyComposer {...props} discourseEmojiUrls={{}} />);
    const webView = view.getByTestId('structured-composer-webview');
    expect(webView.props.automaticallyAdjustContentInsets).toBe(false);
    const postMessage = webView.props.postMessageMock;
    await fireEvent(webView, 'loadEnd');
    await fireEvent(webView, 'message', message('READY', { revision: 0 }));
    postMessage.mockClear();

    await view.rerender(
      <StructuredReplyComposer
        {...props}
        discourseEmojiUrls={{ grinning_face: 'https://linux.do/images/emoji/grinning-face.png' }}
      />
    );

    await waitFor(() =>
      expect(postMessage.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual({
        type: 'COMMAND',
        payload: {
          name: 'set-discourse-emoji',
          discourseEmoji: [{ name: 'grinning_face', url: 'https://linux.do/images/emoji/grinning-face.png' }]
        }
      })
    );
    expect(postMessage.mock.calls.map(([raw]: [string]) => JSON.parse(raw).type)).not.toContain('INIT');
  });

  it('updates theme in the same WebView without reinitializing or resetting draft revision', async () => {
    const intent = { kind: 'reply' as const, site: 'nodeseek' as const, topicId: '42' };
    const pendingNodeSeekPolls: PendingNodeSeekPoll[] = [];
    const onSubmit = jest.fn();
    const onOpenChange = jest.fn();
    const onPresentationChange = jest.fn();
    const onSnapshot = jest.fn();
    function Host({ appearance }: { appearance: 'dark' | 'light' }) {
      const settings = { ...createEmptyReaderData().settings, theme: appearance };
      const theme = createTheme(settings);
      return (
        <ReaderStyleProvider value={{ settings, theme }}>
          <StructuredReplyComposer
            actionBusy={false}
            closeLabel="收起回复"
            content="draft"
            focusSignal={0}
            intent={intent}
            pendingNodeSeekPolls={pendingNodeSeekPolls}
            presentation="sheet"
            submitLabel="发送回复"
            title="回复"
            visible
            onOpenChange={onOpenChange}
            onPresentationChange={onPresentationChange}
            onSnapshot={onSnapshot}
            onSubmit={onSubmit}
          />
        </ReaderStyleProvider>
      );
    }
    const view = await render(<Host appearance="light" />);
    const webView = view.getByTestId('structured-composer-webview');
    const postMessage = webView.props.postMessageMock;
    const messages = () => postMessage.mock.calls.map(([raw]: [string]) => JSON.parse(raw));

    await fireEvent(webView, 'loadEnd');
    await waitFor(() => expect(messages().filter((entry: { type: string }) => entry.type === 'INIT')).toHaveLength(1));

    await view.rerender(<Host appearance="dark" />);
    expect(view.getByTestId('structured-composer-webview')).toBe(webView);
    expect(view.getByTestId('structured-composer-webview').props.postMessageMock).toBe(postMessage);
    expect(messages().filter((entry: { type: string }) => entry.type === 'INIT')).toHaveLength(1);

    await fireEvent(webView, 'message', message('READY', { revision: 0 }));
    await waitFor(() =>
      expect(messages().filter((entry: { type: string }) => entry.type === 'SET_THEME')).toHaveLength(1)
    );
    const darkThemeMessage = messages().findLast((entry: { type: string }) => entry.type === 'SET_THEME');
    expect(composerHostMessageSchema.safeParse(darkThemeMessage).success).toBe(true);
    expect(darkThemeMessage).toEqual(
      expect.objectContaining({
        type: 'SET_THEME',
        payload: expect.objectContaining({ dark: true, fontScale: 1 })
      })
    );

    await fireEvent(
      webView,
      'message',
      message('STATE_CHANGED', { revision: 7, mode: 'rich', isEmpty: false, canUndo: true, canRedo: false })
    );
    await view.rerender(<Host appearance="light" />);
    await waitFor(() =>
      expect(messages().filter((entry: { type: string }) => entry.type === 'SET_THEME')).toHaveLength(2)
    );
    expect(messages().filter((entry: { type: string }) => entry.type === 'INIT')).toHaveLength(1);
    expect(view.getByTestId('structured-composer-webview')).toBe(webView);

    await fireEvent.press(view.getByLabelText('发送回复'));
    const request = messages().findLast((entry: { type: string }) => entry.type === 'REQUEST_SNAPSHOT');
    await fireEvent(
      webView,
      'message',
      message('SNAPSHOT', {
        requestId: request.payload.requestId,
        snapshot: {
          revision: 6,
          markdown: 'stale draft',
          mode: 'rich',
          isEmpty: false,
          validationIssues: [],
          pendingNodeSeekPolls: []
        }
      })
    );

    await waitFor(() => expect(view.getByText('编辑器返回了过期正文，请重试')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses the resource cache without clearing shared login state', async () => {
    const view = await render(
      <StructuredReplyComposer
        actionBusy={false}
        closeLabel="收起回复"
        content="draft"
        focusSignal={0}
        intent={{ kind: 'reply', site: 'nodeseek', topicId: '42' }}
        pendingNodeSeekPolls={[]}
        presentation="sheet"
        submitLabel="发送回复"
        title="回复"
        visible={false}
        onOpenChange={jest.fn()}
        onPresentationChange={jest.fn()}
        onSnapshot={jest.fn()}
        onSubmit={jest.fn()}
      />
    );

    const webView = view.getByTestId('structured-composer-webview');
    expect(webView.props.incognito).not.toBe(true);
    expect(webView.props.cacheEnabled).toBe(true);
    expect(webView.props.domStorageEnabled).toBe(false);
    expect(webView.props.saveFormDataDisabled).toBe(true);
    expect(StyleSheet.flatten(view.getByTestId('structured-composer-header').props.style)).toEqual(
      expect.objectContaining({ paddingHorizontal: 0 })
    );
    expect(StyleSheet.flatten(view.getByLabelText('富文本').props.style)).toEqual(
      expect.objectContaining({ minHeight: 48, minWidth: 48 })
    );
  });

  it('keeps recoverable Bridge protocol faults out of content feedback', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    const props = {
      actionBusy: false,
      closeLabel: '关闭编辑',
      focusSignal: 0,
      pendingNodeSeekPolls: [],
      presentation: 'sheet' as const,
      submitLabel: '保存编辑',
      visible: true,
      onOpenChange: jest.fn(),
      onPresentationChange: jest.fn(),
      onSnapshot: jest.fn(),
      onSubmit: jest.fn()
    };
    const editor = (commentId: string, content: string) => (
      <StructuredReplyComposer
        {...props}
        content={content}
        intent={{
          kind: 'edit-reply',
          site: 'nodeseek',
          topicId: '42',
          commentId,
          sourceMarkdown: content
        }}
        title={`编辑 #${commentId}`}
      />
    );
    const view = await render(editor('9', '简单文本'));
    const webView = view.getByTestId('structured-composer-webview');

    await fireEvent(webView, 'loadEnd');
    await fireEvent(webView, 'message', message('READY', { revision: 0 }));
    await fireEvent(webView, 'message', { nativeEvent: { data: 'not-json' } });
    expect(view.queryByText('编辑器返回了无效消息')).toBeNull();

    await fireEvent(webView, 'message', message('UNKNOWN', {}));
    expect(view.queryByText('编辑器返回了无效消息')).toBeNull();

    await fireEvent(
      webView,
      'message',
      message('ERROR', { code: 'bridge-invalid', message: '编辑器收到无效消息', revision: 0 })
    );
    await fireEvent(
      webView,
      'message',
      message('STATE_CHANGED', { revision: 1, mode: 'rich', isEmpty: false, canUndo: false, canRedo: false })
    );
    expect(view.queryByText('编辑器收到无效消息')).toBeNull();
    expect(view.getByLabelText('保存编辑').props.accessibilityState.disabled).toBe(false);

    const diagnosticEvents = diagnosticLines.map((line) => JSON.parse(line));
    expect(
      diagnosticEvents
        .filter((event) => event.phase === 'intent' && event.operation === 'webview-transport')
        .map(({ area, operation, site, channel, isReady, isVisible }) => ({
          area,
          operation,
          site,
          channel,
          isReady,
          isVisible
        }))
    ).toEqual([
      {
        area: 'webview',
        operation: 'webview-transport',
        site: 'nodeseek',
        channel: 'native',
        isReady: true,
        isVisible: true
      },
      {
        area: 'webview',
        operation: 'webview-transport',
        site: 'nodeseek',
        channel: 'native',
        isReady: true,
        isVisible: true
      },
      {
        area: 'webview',
        operation: 'webview-transport',
        site: 'nodeseek',
        channel: 'webview',
        isReady: true,
        isVisible: true
      }
    ]);
    expect(
      diagnosticEvents
        .filter((event) => event.phase === 'finish' && event.operation === 'webview-transport')
        .map(({ outcome, reason }) => ({ outcome, reason }))
    ).toEqual([
      { outcome: 'failure', reason: 'invalid_response' },
      { outcome: 'failure', reason: 'invalid_response' },
      { outcome: 'failure', reason: 'invalid_response' }
    ]);
    expect(diagnosticLines.join('\n')).not.toContain('简单文本');
    expect(diagnosticLines.join('\n')).not.toContain('not-json');

    await fireEvent(
      webView,
      'message',
      message('ERROR', { code: 'markdown-parse-failed', message: 'Markdown 解析失败', revision: 1 })
    );
    expect(view.getByText('Markdown 解析失败')).toBeTruthy();

    webView.props.postMessageMock.mockClear();
    await view.rerender(editor('10', '另一段文本'));
    await waitFor(() => expect(view.queryByText('Markdown 解析失败')).toBeNull());
    expect(webView.props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual({
      type: 'INIT',
      payload: expect.objectContaining({ markdown: '另一段文本' })
    });
  });

  it.each<ComposerIntent>([
    { kind: 'private-message', site: 'nodeseek', conversationId: 'kongb' },
    { kind: 'reply', site: 'nodeseek', topicId: '42', replyTo: { floor: 2, author: '楼友' } },
    { kind: 'reply', site: 'linuxdo', topicId: '42', replyTo: { floor: 2, author: '楼友' } }
  ])('clears submitted content before reopening $site $kind and preserves unsent drafts', async (intent) => {
    const props = {
      actionBusy: false,
      closeLabel: '关闭私信',
      focusSignal: 0,
      intent,
      pendingNodeSeekPolls: [],
      presentation: 'sheet' as const,
      submitLabel: '发送私信',
      title: '回复私信',
      visible: true,
      onOpenChange: jest.fn(),
      onPresentationChange: jest.fn(),
      onSnapshot: jest.fn(),
      onSubmit: jest.fn()
    };
    const view = await render(<StructuredReplyComposer {...props} content="已发送正文" />);
    const webView = view.getByTestId('structured-composer-webview');
    const postMessage = webView.props.postMessageMock;
    const messages = () => postMessage.mock.calls.map(([raw]: [string]) => JSON.parse(raw));

    await fireEvent(webView, 'loadEnd');
    await waitFor(() => expect(messages().some((entry: { type: string }) => entry.type === 'INIT')).toBe(true));
    await fireEvent(webView, 'message', message('READY', { revision: 0 }));
    postMessage.mockClear();

    await view.rerender(<StructuredReplyComposer {...props} content="已发送正文" visible={false} />);
    await view.rerender(<StructuredReplyComposer {...props} content="已发送正文" />);
    expect(messages().map((entry: { type: string }) => entry.type)).not.toContain('INIT');
    postMessage.mockClear();

    await view.rerender(<StructuredReplyComposer {...props} content="" visible={false} />);

    await waitFor(() =>
      expect(messages()).toContainEqual({
        type: 'INIT',
        payload: expect.objectContaining({ markdown: '' })
      })
    );
    expect(messages()).not.toContainEqual({
      type: 'COMMAND',
      payload: { name: 'insert-markdown', markdown: '' }
    });

    const documentEpoch = messages().findLast((entry: { type: string }) => entry.type === 'INIT').payload.documentEpoch;
    await fireEvent(webView, 'message', message('READY', { documentEpoch, revision: 0 }));
    postMessage.mockClear();
    await view.rerender(<StructuredReplyComposer {...props} content="" />);
    expect(view.getByTestId('structured-composer-webview').props.postMessageMock).toBe(postMessage);
    expect(messages().map((entry: { type: string }) => entry.type)).not.toContain('INIT');
    await view.rerender(<StructuredReplyComposer {...props} content="外部追加" />);
    await waitFor(() =>
      expect(messages()).toContainEqual({
        type: 'COMMAND',
        payload: { name: 'insert-markdown', markdown: '外部追加' }
      })
    );
    expect(messages().map((entry: { type: string }) => entry.type)).not.toContain('INIT');
    await view.rerender(<StructuredReplyComposer {...props} content="外部追加" actionBusy />);
    // The previous confirmed prop can arrive again before the insertion's snapshot.
    await view.rerender(<StructuredReplyComposer {...props} content="" actionBusy />);
    await view.rerender(<StructuredReplyComposer {...props} content="外部追加" actionBusy />);
    expect(
      messages().filter((entry: { payload?: { name?: string } }) => entry.payload?.name === 'insert-markdown')
    ).toHaveLength(1);
  });

  it('refreshes the confirmed character count when a snapshot arrives', async () => {
    const view = await render(
      <StructuredReplyComposer
        actionBusy={false}
        closeLabel="收起回复"
        content=""
        focusSignal={0}
        intent={{ kind: 'edit-reply', site: 'nodeseek', topicId: '42', commentId: '9', sourceMarkdown: '' }}
        pendingNodeSeekPolls={[]}
        presentation="sheet"
        submitLabel="保存编辑"
        title="编辑 #9"
        visible
        onOpenChange={jest.fn()}
        onPresentationChange={jest.fn()}
        onSnapshot={jest.fn()}
        onSubmit={jest.fn()}
      />
    );

    const webView = view.getByTestId('structured-composer-webview');
    await fireEvent(webView, 'message', message('READY', { revision: 0 }));
    await fireEvent(webView, 'loadEnd');
    await waitFor(() =>
      expect(webView.props.postMessageMock.mock.calls.some(([raw]: [string]) => JSON.parse(raw).type === 'INIT')).toBe(
        true
      )
    );
    await fireEvent(webView, 'message', message('READY', { revision: 0 }));
    await waitFor(() => expect(view.getByText('0 字符')).toBeTruthy());
    await view.rerender(
      <StructuredReplyComposer
        actionBusy={false}
        closeLabel="收起回复"
        content="table markdown"
        focusSignal={0}
        intent={{
          kind: 'edit-reply',
          site: 'nodeseek',
          topicId: '42',
          commentId: '9',
          sourceMarkdown: 'table markdown'
        }}
        pendingNodeSeekPolls={[]}
        presentation="sheet"
        submitLabel="保存编辑"
        title="编辑 #9"
        visible
        onOpenChange={jest.fn()}
        onPresentationChange={jest.fn()}
        onSnapshot={jest.fn()}
        onSubmit={jest.fn()}
      />
    );
    await waitFor(() => expect(view.getByText('14 字符')).toBeTruthy());
    await fireEvent(
      webView,
      'message',
      message('STATE_CHANGED', { revision: 1, mode: 'rich', isEmpty: false, canUndo: false, canRedo: false })
    );
    await fireEvent(
      webView,
      'message',
      message('SNAPSHOT', {
        snapshot: {
          revision: 1,
          markdown: 'table markdown',
          mode: 'rich',
          isEmpty: false,
          validationIssues: [],
          pendingNodeSeekPolls: []
        }
      })
    );

    await waitFor(() => expect(view.getByText('14 字符')).toBeTruthy());
  });

  it('keeps one nested-scroll WebView across fullscreen and rejects a stale submit snapshot', async () => {
    const onSnapshot = jest.fn();
    const onSubmit = jest.fn();
    function Host({ visible = true }: { visible?: boolean }) {
      const [presentation, setPresentation] = useState<ComposerPresentation>('sheet');
      return (
        <StructuredReplyComposer
          actionBusy={false}
          closeLabel="收起回复"
          content="draft"
          focusSignal={1}
          intent={{ kind: 'reply', site: 'nodeseek', topicId: '42' }}
          pendingNodeSeekPolls={[]}
          presentation={presentation}
          submitLabel="发送回复"
          title="回复"
          visible={visible}
          onOpenChange={jest.fn()}
          onPresentationChange={setPresentation}
          onSnapshot={onSnapshot}
          onSubmit={onSubmit}
        />
      );
    }
    const view = await render(<Host />);
    const webView = view.getByTestId('structured-composer-webview');
    const postMessage = webView.props.postMessageMock;
    const requestFocus = webView.props.requestFocusMock;
    expect(webView.props.nestedScrollEnabled).toBe(true);
    expect(webView.props.androidPrewarmOnWindowVisible).toBe(true);
    expect(StyleSheet.flatten(view.getByTestId('structured-composer-editor-frame').props.style)).toEqual(
      expect.objectContaining({ flex: 1, minHeight: 0 })
    );
    await fireEvent(webView, 'loadEnd');
    await waitFor(() =>
      expect(postMessage.mock.calls.map(([raw]: [string]) => JSON.parse(raw).type)).toContain('INIT')
    );
    await fireEvent(webView, 'message', message('READY', { revision: 0 }));
    await waitFor(() => expect(requestFocus).toHaveBeenCalledTimes(1));
    expect(postMessage.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual({
      type: 'COMMAND',
      payload: { name: 'focus' }
    });
    await fireEvent(
      webView,
      'message',
      message('STATE_CHANGED', { revision: 2, mode: 'rich', isEmpty: false, canUndo: true, canRedo: false })
    );
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');
    await fireEvent(
      webView,
      'message',
      message('STATE_CHANGED', { revision: 2, mode: 'source', isEmpty: false, canUndo: true, canRedo: false })
    );
    await fireEvent.press(view.getByLabelText('源码'));
    expect(requestFocus).toHaveBeenCalledTimes(2);
    await fireEvent(
      webView,
      'message',
      message('STATE_CHANGED', { revision: 2, mode: 'source', isEmpty: false, canUndo: true, canRedo: false })
    );
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(setItemSpy).toHaveBeenCalledWith('wz:composer:mode:nodeseek', 'source');
    setItemSpy.mockRestore();

    await fireEvent.press(view.getByLabelText('全屏'));
    expect(view.getByLabelText('退出全屏')).toBeTruthy();
    const fullscreenWebView = view.getByTestId('structured-composer-webview');
    expect(fullscreenWebView.props.postMessageMock).toBe(postMessage);
    expect(fullscreenWebView.props.androidPrewarmOnWindowVisible).toBe(true);
    expect(StyleSheet.flatten(view.getByTestId('structured-composer-editor-frame').props.style)).toEqual(
      expect.objectContaining({ flex: 1, minHeight: 0 })
    );
    expect(StyleSheet.flatten(view.getByTestId('structured-composer-footer').props.style)).toEqual(
      expect.objectContaining({ flexShrink: 0, height: 60 })
    );

    await fireEvent.press(view.getByLabelText('发送回复'));
    const staleRequest = postMessage.mock.calls
      .map(([raw]: [string]) => JSON.parse(raw))
      .findLast((entry: { type: string }) => entry.type === 'REQUEST_SNAPSHOT');
    await fireEvent(
      webView,
      'message',
      message('SNAPSHOT', {
        requestId: staleRequest.payload.requestId,
        snapshot: {
          revision: 1,
          markdown: 'stale',
          mode: 'rich',
          isEmpty: false,
          validationIssues: [],
          pendingNodeSeekPolls: []
        }
      })
    );
    await waitFor(() => expect(view.getByText('编辑器返回了过期正文，请重试')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('发送回复'));
    const currentRequest = postMessage.mock.calls
      .map(([raw]: [string]) => JSON.parse(raw))
      .findLast((entry: { type: string }) => entry.type === 'REQUEST_SNAPSHOT');
    await fireEvent(
      webView,
      'message',
      message('SNAPSHOT', {
        requestId: currentRequest.payload.requestId,
        snapshot: {
          revision: 2,
          markdown: 'current',
          mode: 'rich',
          isEmpty: false,
          validationIssues: [],
          pendingNodeSeekPolls: []
        }
      })
    );
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ markdown: 'current' })));
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));

    postMessage.mockClear();
    await view.rerender(<Host visible={false} />);
    // A native options panel can disable interaction while this editor remains visible behind it.
    expect(view.getByTestId('structured-composer-webview').props.androidPrewarmOnWindowVisible).toBe(true);
    await waitFor(() =>
      expect(postMessage.mock.calls.map(([raw]: [string]) => JSON.parse(raw))).toContainEqual({
        type: 'COMMAND',
        payload: { name: 'blur' }
      })
    );
    expect(
      postMessage.mock.calls
        .map(([raw]: [string]) => JSON.parse(raw))
        .filter((entry: { type: string }) => entry.type === 'REQUEST_SNAPSHOT')
    ).toHaveLength(0);
  });
});
