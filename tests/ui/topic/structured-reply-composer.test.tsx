import { describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useState } from 'react';
import { StructuredReplyComposer } from '@/ui/composer/StructuredReplyComposer';
import type { ComposerPresentation } from '@/domain/forum/structuredComposer';
import { composerHostMessageSchema } from '@/ui/composer/structuredComposerBridge';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '../render';

function message(type: string, payload: unknown) {
  return { nativeEvent: { data: JSON.stringify({ type, payload }) } };
}

describe('StructuredReplyComposer', () => {
  it('[REG-WRITE-065] forwards LinuxDo poll capabilities through the existing host-action seam', async () => {
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

  it('[REG-WRITE-054] keeps a large LinuxDo emoji catalog inside the editor Bridge contract', async () => {
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

  it('[REG-WRITE-056] syncs a late LinuxDo emoji catalog without reinitializing the editor', async () => {
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

  it('[REG-ACCOUNT-045] keeps the editor WebView from clearing shared login state', async () => {
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

  it('[REG-WRITE-047] refreshes the confirmed character count when a snapshot arrives', async () => {
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

  it('[REG-WRITE-039] keeps one nested-scroll WebView across fullscreen and rejects a stale submit snapshot', async () => {
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
    jest.mocked(AsyncStorage.setItem).mockClear();
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
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('wz:composer:mode:nodeseek', 'source');

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
