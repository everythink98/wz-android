import { afterEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { StructuredReplyComposer } from '@/ui/composer/StructuredReplyComposer';
import type { ComposerPresentation, PendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import { composerHostMessageSchema } from '@/ui/composer/structuredComposerBridge';
import { StyleSheet } from 'react-native';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { fireEvent, render, waitFor } from '../render';

function message(type: string, payload: unknown) {
  return { nativeEvent: { data: JSON.stringify({ type, payload }) } };
}

afterEach(() => setDiagnosticWriter(null));

describe('StructuredReplyComposer', () => {
  it('forwards LinuxDo poll capabilities through the existing host-action seam', async () => {
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

  it('keeps the editor WebView from clearing shared login state', async () => {
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
    expect(webView.props.cacheEnabled).toBe(false);
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
        .filter((event) => event.phase === 'intent')
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
      diagnosticEvents.filter((event) => event.phase === 'finish').map(({ outcome, reason }) => ({ outcome, reason }))
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

  it('resets confirmed private-message content with an empty INIT after send', async () => {
    const props = {
      actionBusy: false,
      closeLabel: '关闭私信',
      focusSignal: 0,
      intent: { kind: 'private-message' as const, site: 'nodeseek' as const, conversationId: 'kongb' },
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

    await view.rerender(<StructuredReplyComposer {...props} content="" />);

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

    await fireEvent(webView, 'message', message('READY', { revision: 0 }));
    postMessage.mockClear();
    await view.rerender(<StructuredReplyComposer {...props} content="外部追加" />);
    await waitFor(() =>
      expect(messages()).toContainEqual({
        type: 'COMMAND',
        payload: { name: 'insert-markdown', markdown: '外部追加' }
      })
    );
    expect(messages().map((entry: { type: string }) => entry.type)).not.toContain('INIT');
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
