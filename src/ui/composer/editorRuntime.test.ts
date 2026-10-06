// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { NODESEEK_STICKER_CATEGORIES } from '@/domain/forum/nodeSeekStickers';
import {
  ComposerEditorRuntime,
  composerEditorExtensions,
  sanitizePastedHtml,
  setGfmColumnAlignment
} from './editorRuntime';
import type { ComposerToolbarAction } from './structuredComposerBridge';

const TEST_THEME = {
  dark: false,
  ink: '#111111',
  muted: '#666666',
  surface: '#ffffff',
  surface2: '#f5f5f5',
  line: '#dddddd',
  primary: '#1267d6',
  primarySoft: '#e8f2ff',
  danger: '#b3261e',
  fontScale: 1
};

const mountedRuntimes: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = [];

async function mountRuntime({
  discourseEmoji = [],
  documentEpoch,
  initialDocument = false,
  intentKind = 'reply',
  markdown = '',
  mode = 'rich',
  nodeSeekMemberId,
  readOnly,
  runtimeStyle = false,
  site = 'linuxdo',
  theme = TEST_THEME,
  waitForFrame = true
}: {
  discourseEmoji?: { name: string; url: string }[];
  documentEpoch?: number;
  initialDocument?: boolean;
  intentKind?: 'reply' | 'create-topic' | 'edit-topic' | 'private-message';
  markdown?: string;
  mode?: 'rich' | 'source';
  nodeSeekMemberId?: string | null;
  readOnly?: boolean;
  runtimeStyle?: boolean;
  site?: 'linuxdo' | 'nodeseek';
  theme?: typeof TEST_THEME;
  waitForFrame?: boolean;
} = {}) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) })
  });
  Object.defineProperty(Text.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) })
  });
  const postMessage = vi.fn();
  window.ReactNativeWebView = { postMessage };
  if (runtimeStyle) {
    const style = document.createElement('style');
    style.dataset.editorRuntimeTestStyle = '';
    style.textContent = readFileSync('src/ui/composer/editorRuntime.css', 'utf8');
    document.head.append(style);
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mountedRuntimes.push({ host, root });
  let currentEpoch = documentEpoch ?? 0;
  const send = async (message: unknown) => {
    const incoming = message as { type: string; payload?: { documentEpoch?: number } };
    if (incoming.type === 'INIT') currentEpoch = incoming.payload?.documentEpoch ?? 0;
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
      if (waitForFrame) await new Promise(requestAnimationFrame);
    });
  };
  const initialMessage = {
    type: 'INIT',
    payload: {
      site,
      intentKind,
      markdown,
      pendingNodeSeekPolls: [],
      mode,
      ...(documentEpoch === undefined ? {} : { documentEpoch }),
      ...(readOnly === undefined ? {} : { readOnly }),
      ...(site === 'nodeseek' && nodeSeekMemberId !== null ? { nodeSeekMemberId: nodeSeekMemberId || '54874' } : {}),
      discourseEmoji,
      theme
    }
  };
  if (initialDocument) {
    const data = document.createElement('script');
    data.id = 'composer-initial-document';
    data.type = 'application/json';
    data.textContent = JSON.stringify(initialMessage);
    document.head.append(data);
  }
  await act(async () => root.render(createElement(ComposerEditorRuntime)));
  if (!initialDocument) await send(initialMessage);
  const finishPanelHandoff = async (since: number) => {
    const request = postMessage.mock.calls
      .slice(since)
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((message) => message.type === 'REQUEST_HOST_ACTION' && message.payload.action === 'prepare-panel');
    if (request)
      await send({ type: 'COMMAND', payload: { name: 'host-action-result', requestId: request.payload.requestId } });
  };
  const toolbarAction = async (action: ComposerToolbarAction) => {
    const since = postMessage.mock.calls.length;
    await send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: currentEpoch, action } });
    await finishPanelHandoff(since);
  };
  const toolbarState = () =>
    postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((message) => message.type === 'TOOLBAR_STATE')?.payload.state;
  return { host, postMessage, root, send, toolbarAction, toolbarState, finishPanelHandoff };
}

function activateToolbarUpload(
  send: (message: unknown) => Promise<void>,
  request: { payload: { data: { uploadId: string; documentEpoch: number } } }
) {
  return send({ type: 'COMMAND', payload: { name: 'begin-image-upload', ...request.payload.data } });
}

describe('Composer editor runtime codec', () => {
  it.each(
    (['rich', 'source'] as const).flatMap((mode) =>
      (['close', 'read-only'] as const).map((reason) => ({ mode, reason }))
    )
  )('keeps the new $mode focus when $reason and reopening occur before the next frame', async ({ mode, reason }) => {
    const { host, send } = await mountRuntime({ mode, markdown: '保留正文', waitForFrame: false });
    const input = host.querySelector<HTMLElement>(mode === 'rich' ? '.ProseMirror' : '.cm-content')!;
    await act(async () => input.focus());
    expect(document.activeElement).toBe(input);
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      if (reason === 'close') await send({ type: 'COMMAND', payload: { name: 'blur' } });
      else {
        await send({ type: 'SET_READ_ONLY', payload: { readOnly: true } });
        await send({ type: 'SET_READ_ONLY', payload: { readOnly: false } });
      }
      await send({ type: 'COMMAND', payload: { name: 'focus' } });
      await act(async () => frames.splice(0).forEach((callback) => callback(performance.now())));
    } finally {
      requestFrame.mockRestore();
    }
    expect(document.activeElement).toBe(input);
    expect(input.textContent).toBe('保留正文');
  });

  it.each(
    (['linuxdo', 'nodeseek'] as const).flatMap((site) =>
      (
        [
          { intentKind: 'create-topic', label: '主题正文', nextIntentKind: 'reply', nextLabel: '回复正文' },
          { intentKind: 'edit-topic', label: '主题正文', nextIntentKind: 'private-message', nextLabel: '回复正文' },
          { intentKind: 'reply', label: '回复正文', nextIntentKind: 'edit-topic', nextLabel: '主题正文' },
          { intentKind: 'private-message', label: '回复正文', nextIntentKind: 'create-topic', nextLabel: '主题正文' }
        ] as const
      ).map((intent) => ({ site, ...intent }))
    )
  )(
    'names the $site $intentKind source input through mode switches and a new empty document',
    async ({ site, intentKind, label, nextIntentKind, nextLabel }) => {
      const { host, send, toolbarAction } = await mountRuntime({ site, intentKind });
      const source = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
      const input = source.contentDOM;
      const richInput = host.querySelector<HTMLElement>('.ProseMirror')!;
      expect(richInput.getAttribute('aria-label')).toBe(`${label}富文本编辑器`);
      const switchMode = async (mode: 'rich' | 'source') => {
        if (intentKind === 'create-topic' || intentKind === 'edit-topic') {
          await toolbarAction('more');
          await act(async () => {
            host
              .querySelector<HTMLButtonElement>(`button[aria-label="切换到${mode === 'source' ? '源码' : '富文本'}"]`)!
              .click();
            await new Promise(requestAnimationFrame);
          });
        } else {
          // Reply and message mode controls live in the native composer header.
          await send({ type: 'SET_MODE', payload: { mode } });
        }
      };

      await switchMode('source');
      expect(input.getAttribute('aria-label')).toBe(`${label}源码编辑器`);
      expect(input.getAttribute('role')).toBe('textbox');
      expect(input.getAttribute('aria-multiline')).toBe('true');
      expect(input.getAttribute('contenteditable')).toBe('true');
      expect(input.closest('.source-pane')?.getAttribute('aria-hidden')).not.toBe('true');
      expect(richInput.closest('.editor-pane')?.getAttribute('aria-hidden')).toBe('true');

      await switchMode('rich');
      expect(richInput.getAttribute('aria-label')).toBe(`${label}富文本编辑器`);
      expect(richInput.closest('.editor-pane')?.getAttribute('aria-hidden')).not.toBe('true');
      expect(input.closest('.source-pane')?.getAttribute('aria-hidden')).toBe('true');

      await send({
        type: 'INIT',
        payload: {
          documentEpoch: 1,
          site,
          intentKind: nextIntentKind,
          markdown: '',
          pendingNodeSeekPolls: [],
          mode: 'source',
          theme: TEST_THEME
        }
      });
      expect(EditorView.findFromDOM(host.querySelector('.cm-editor')!)).toBe(source);
      expect(source.contentDOM).toBe(input);
      expect(input.getAttribute('aria-label')).toBe(`${nextLabel}源码编辑器`);
      expect(input.getAttribute('role')).toBe('textbox');
      expect(input.getAttribute('aria-multiline')).toBe('true');
      expect(input.getAttribute('contenteditable')).toBe('true');
      expect(input.closest('.source-pane')?.getAttribute('aria-hidden')).not.toBe('true');
      expect(richInput.closest('.editor-pane')?.getAttribute('aria-hidden')).toBe('true');
      expect(source.state.doc.toString()).toBe('');
    }
  );

  it.each(['rich', 'source'] as const)(
    'awaits prepare-panel before blurring or opening the %s link form',
    async (mode) => {
      const { host, send, postMessage } = await mountRuntime({
        documentEpoch: 7,
        mode,
        markdown: '保留选区'
      });
      const input = host.querySelector<HTMLElement>(mode === 'rich' ? '.ProseMirror' : '.cm-content')!;
      await act(async () => input.focus());
      const blur = vi.spyOn(input, 'blur');
      postMessage.mockClear();
      await send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action: 'link' } });
      expect(blur).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      expect(host.querySelector('[aria-label="链接设置"]')).toBeNull();
      const request = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((event) => event.payload?.action === 'prepare-panel');
      expect(request?.payload.data).toEqual({ documentEpoch: 7 });
      const events = () => postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)));
      const ownership = events().findIndex((event) => event.type === 'PANEL_CHANGED' && event.payload.open);
      expect(ownership).toBeGreaterThanOrEqual(0);
      expect(ownership).toBeLessThan(events().findIndex((event) => event.payload?.action === 'prepare-panel'));
      expect(events()[ownership].payload).toEqual({ documentEpoch: 7, open: true });
      await send({ type: 'COMMAND', payload: { name: 'host-action-result', requestId: request.payload.requestId } });
      await act(async () => {
        await new Promise(requestAnimationFrame);
      });
      expect(blur).toHaveBeenCalled();
      expect(host.querySelector('[aria-label="链接设置"]')).not.toBeNull();
      expect(input.textContent).toBe('保留选区');
      expect(
        events()
          .filter((event) => event.type === 'PANEL_CHANGED')
          .every((event) => event.payload.open)
      ).toBe(true);
      await send({ type: 'COMMAND', payload: { name: 'blur' } });
      expect(events().findLast((event) => event.type === 'PANEL_CHANGED').payload.open).toBe(false);
    }
  );

  it.each(['blur', 'read-only', 'mode', 'init', 'destroy', 'reject'] as const)(
    'discards prepare-panel acknowledgement after %s invalidates its owner',
    async (reason) => {
      const { host, send, postMessage } = await mountRuntime({
        documentEpoch: 7,
        markdown: '原草稿'
      });
      await send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action: 'link' } });
      const request = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((event) => event.payload?.action === 'prepare-panel');
      expect(request).toBeDefined();
      const panelOpen = () =>
        postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.type === 'PANEL_CHANGED').payload.open;
      expect(panelOpen()).toBe(true);
      if (reason === 'blur') await send({ type: 'COMMAND', payload: { name: 'blur' } });
      else if (reason === 'read-only') {
        await send({ type: 'SET_READ_ONLY', payload: { readOnly: true } });
        await send({ type: 'SET_READ_ONLY', payload: { readOnly: false } });
      } else if (reason === 'mode') await send({ type: 'SET_MODE', payload: { mode: 'source' } });
      else if (reason === 'destroy') await send({ type: 'DESTROY' });
      else if (reason === 'reject')
        await send({
          type: 'COMMAND',
          payload: { name: 'host-action-result', requestId: request.payload.requestId, error: 'keyboard unavailable' }
        });
      else
        await send({
          type: 'INIT',
          payload: {
            site: 'linuxdo',
            intentKind: 'reply',
            documentEpoch: 8,
            markdown: '新草稿',
            mode: 'rich',
            pendingNodeSeekPolls: [],
            theme: TEST_THEME
          }
        });
      expect(panelOpen()).toBe(false);
      await send({ type: 'COMMAND', payload: { name: 'host-action-result', requestId: request.payload.requestId } });
      expect(host.querySelector('[aria-label="链接设置"]')).toBeNull();
      expect(panelOpen()).toBe(false);
    }
  );

  it('keeps prepare-panel shared by the native toolbar and the HTML format builder', async () => {
    const { host, send, postMessage } = await mountRuntime({
      documentEpoch: 7,
      intentKind: 'create-topic'
    });
    const requests = () =>
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .filter((event) => event.payload?.action === 'prepare-panel');
    await send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action: 'format' } });
    expect(requests()).toHaveLength(1);
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: requests()[0].payload.requestId }
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="文字格式"] button[aria-label="链接"]')!.click();
    });
    expect(requests()).toHaveLength(2);
    expect(host.querySelector('[aria-label="链接设置"]')).toBeNull();
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: requests()[1].payload.requestId }
    });
    expect(host.querySelector('[aria-label="链接设置"]')).not.toBeNull();
  });

  it('does not reopen a link after its HTML builder is closed during prepare-panel', async () => {
    const { host, send, postMessage } = await mountRuntime({
      documentEpoch: 7,
      intentKind: 'create-topic'
    });
    const requests = () =>
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .filter((event) => event.payload?.action === 'prepare-panel');
    await send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action: 'format' } });
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: requests()[0].payload.requestId }
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="文字格式"] button[aria-label="链接"]')!.click();
    });
    expect(requests()).toHaveLength(2);
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="文字格式"] button[aria-label="关闭"]')!.click();
    });
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: requests()[1].payload.requestId }
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('does not reopen a tool after opening preview during prepare-panel', async () => {
    const { host, send, postMessage } = await mountRuntime({
      documentEpoch: 7,
      intentKind: 'create-topic'
    });
    const requests = () =>
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .filter((event) => event.payload?.action === 'prepare-panel');
    await send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action: 'more' } });
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: requests()[0].payload.requestId }
    });
    await send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action: 'format' } });
    expect(requests()).toHaveLength(2);
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('[aria-label="更多编辑工具"] button')]
        .find((button) => button.textContent === '预览')!
        .click();
    });
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: requests()[1].payload.requestId }
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(
    (['nodeseek', 'linuxdo'] as const).flatMap((site) => (['rich', 'source'] as const).map((mode) => ({ site, mode })))
  )(
    'closes the $site expression panel when the $mode body receives focus and preserves its cache',
    async ({ site, mode }) => {
      for (const intentKind of ['reply', 'private-message'] as const) {
        const { host, toolbarAction, postMessage } = await mountRuntime({
          site,
          mode,
          intentKind,
          runtimeStyle: true,
          markdown: '保留正文',
          discourseEmoji: [{ name: 'smile', url: 'https://linux.do/smile.png' }]
        });
        await toolbarAction('emoji');
        const panel = host.querySelector<HTMLElement>('[data-expression-cache]')!;
        const body = panel.querySelector<HTMLElement>('.builder-body')!;
        const image = panel.querySelector<HTMLImageElement>('.expression-grid:not([hidden]) img')!;
        const navigation = panel.querySelector(site === 'nodeseek' ? '.category-rail' : '.expression-search')!;
        expect(body.contains(navigation)).toBe(false);
        expect(
          getComputedStyle(host.querySelector(mode === 'rich' ? '.editor-pane' : '.source-pane')!).visibility
        ).toBe('hidden');
        expect(
          postMessage.mock.calls
            .map(([raw]) => JSON.parse(String(raw)))
            .findLast((event) => event.type === 'PANEL_CHANGED').payload
        ).toMatchObject({ open: true, layout: 'expression' });
        body.scrollTop = 120;
        await act(async () => image.dispatchEvent(new Event('load')));
        const input = host.querySelector<HTMLElement>(mode === 'rich' ? '.ProseMirror' : '.cm-content')!;
        await act(async () => input.focus());
        expect(document.activeElement).toBe(input);
        expect(panel.hidden).toBe(true);
        expect(
          postMessage.mock.calls
            .map(([raw]) => JSON.parse(String(raw)))
            .findLast((event) => event.type === 'PANEL_CHANGED').payload.open
        ).toBe(false);
        await toolbarAction('emoji');
        expect(host.querySelector('[data-expression-cache]')).toBe(panel);
        expect(panel.querySelector('.expression-grid:not([hidden]) img')).toBe(image);
        expect(body.scrollTop).toBe(120);
      }
    }
  );

  it.each(['reply', 'create-topic', 'edit-topic'] as const)(
    'uses the native accessory without duplicating the %s bottom toolbar',
    async (intentKind) => {
      const { host, send, postMessage } = await mountRuntime({
        intentKind,
        documentEpoch: 7,
        markdown: '正文'
      });
      expect(host.querySelector('.runtime > .toolbar-stack, .runtime > .topic-toolbar')).toBeNull();
      expect(host.querySelector('.ProseMirror')?.textContent).toBe('正文');
      if (intentKind === 'reply') return;
      await send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action: 'format' } });
      const request = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((event) => event.payload?.action === 'prepare-panel');
      await send({ type: 'COMMAND', payload: { name: 'host-action-result', requestId: request.payload.requestId } });
      expect(host.querySelector('[role="dialog"][aria-label="文字格式"] .toolbar-stack')).not.toBeNull();
    }
  );

  it('applies native formatting to the rich selection and only reports changed toolbar state', async () => {
    const { host, send, postMessage } = await mountRuntime({ documentEpoch: 7, markdown: '甲乙丙' });
    const editor = (host.querySelector('.composer-document') as HTMLElement & { editor: Editor }).editor;
    const action = (action: string) =>
      send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action } });
    const states = () =>
      postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw))).filter((event) => event.type === 'TOOLBAR_STATE');
    await act(async () => editor.commands.setTextSelection({ from: 2, to: 3 }));
    await action('bold');
    expect(editor.getMarkdown()).toBe('甲**乙**丙');
    expect(states().at(-1)?.payload).toMatchObject({ documentEpoch: 7, state: { bold: true, mode: 'rich' } });
    await action('heading-3');
    expect(editor.getMarkdown().trim()).toBe('### 甲**乙**丙');
    expect(states().at(-1)?.payload.state.heading).toBe(3);
    await action('heading-0');
    await action('ordered-list');
    expect(editor.getMarkdown()).toMatch(/^1\. 甲\*\*乙\*\*丙/);
    expect(states().at(-1)?.payload.state.orderedList).toBe(true);
    postMessage.mockClear();
    await act(async () => editor.commands.insertContent('丁'));
    await new Promise(requestAnimationFrame);
    expect(states()).toHaveLength(0);
  });

  it('uses existing source format and form handlers for native toolbar commands', async () => {
    const { host, send, postMessage } = await mountRuntime({
      documentEpoch: 7,
      mode: 'source',
      markdown: '甲乙丙'
    });
    const source = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
    const action = (action: string) =>
      send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action } });
    await act(async () => source.dispatch({ selection: { anchor: 1, head: 2 } }));
    await action('bold');
    expect(source.state.doc.toString()).toBe('甲**乙**丙');
    await act(async () => source.dispatch({ selection: { anchor: 0, head: source.state.doc.length } }));
    await action('heading-2');
    expect(source.state.doc.toString()).toBe('## 甲**乙**丙');
    await action('link');
    const request = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((event) => event.payload?.action === 'prepare-panel');
    await send({ type: 'COMMAND', payload: { name: 'host-action-result', requestId: request.payload.requestId } });
    expect(host.querySelector('[role="dialog"][aria-label="链接设置"]')).not.toBeNull();
    const states = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .filter((event) => event.type === 'TOOLBAR_STATE');
    expect(states.at(-1)?.payload.state).toMatchObject({ mode: 'source', bold: false, heading: 0, builder: 'link' });
  });

  it.each(['rich', 'source'] as const)(
    'keeps the %s native image action on the existing upload handoff',
    async (mode) => {
      const { host, send, postMessage } = await mountRuntime({
        documentEpoch: 7,
        mode,
        markdown: '保留正文'
      });
      const body = host.querySelector<HTMLElement>(mode === 'rich' ? '.ProseMirror' : '.cm-content')!;
      await act(async () => body.focus());
      const action = { type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch: 7, action: 'upload-image' } };
      // Android dispatches queued host messages in order. Do not yield between
      // pressing image and requesting the snapshot used by an immediate submit.
      await act(async () => {
        for (const message of [
          action,
          { type: 'REQUEST_SNAPSHOT', payload: { requestId: 'submit-after-image' } },
          action
        ])
          document.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
        await new Promise(requestAnimationFrame);
      });
      const messages = () => postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)));
      const requests = messages().filter(
        (event) => event.type === 'REQUEST_HOST_ACTION' && event.payload.action === 'upload-image'
      );
      expect(requests).toHaveLength(1);
      const uploadIndex = messages().findIndex(
        (event) => event.type === 'REQUEST_HOST_ACTION' && event.payload.requestId === requests[0].payload.requestId
      );
      const snapshotIndex = messages().findIndex((event) => event.payload?.requestId === 'submit-after-image');
      expect(snapshotIndex).toBeGreaterThan(uploadIndex);
      expect(uploadIndex).toBeGreaterThanOrEqual(0);
      expect(messages()[snapshotIndex]).toMatchObject({
        type: 'SNAPSHOT',
        payload: { documentEpoch: 7, snapshot: { markdown: '保留正文', validationIssues: [] } }
      });
      expect(body).toBe(document.activeElement);
      expect(body.getAttribute('virtualkeyboardpolicy')).toBe('manual');
      expect(host.querySelector('.composer-image-upload, .source-image-upload')).toBeNull();
      expect(messages().findLast((event) => event.type === 'TOOLBAR_STATE')?.payload.state.imageBusy).toBe(true);
      await activateToolbarUpload(send, requests[0]);
      expect(document.activeElement).not.toBe(body);
      expect(messages().findLast((event) => event.type === 'UPLOAD_COMMAND_RESULT')?.payload.accepted).toBe(true);
      await send({
        type: 'COMMAND',
        payload: { name: 'host-action-result', requestId: requests[0].payload.requestId }
      });
      expect(messages().findLast((event) => event.type === 'TOOLBAR_STATE')?.payload.state.imageBusy).toBe(false);
      expect(body.textContent).toContain('保留正文');
    }
  );

  it('rejects stale, read-only and unsupported native toolbar actions', async () => {
    const { host, send, postMessage } = await mountRuntime({
      documentEpoch: 7,
      site: 'nodeseek',
      intentKind: 'private-message',
      markdown: '正文'
    });
    const editor = (host.querySelector('.composer-document') as HTMLElement & { editor: Editor }).editor;
    const action = (action: string, documentEpoch = 7) =>
      send({ type: 'COMMAND', payload: { name: 'toolbar-action', documentEpoch, action } });
    await act(async () => editor.commands.setTextSelection({ from: 1, to: 3 }));
    await action('bold', 6);
    for (const name of ['underline', 'poll', 'stardust', 'private', 'templates', 'format', 'more']) await action(name);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(editor.getMarkdown()).toBe('正文');
    await send({ type: 'SET_READ_ONLY', payload: { readOnly: true } });
    for (const name of ['bold', 'emoji', 'upload-image', 'focus-editor']) await action(name);
    expect(editor.getMarkdown()).toBe('正文');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .filter((event) => event.type === 'REQUEST_HOST_ACTION')
    ).toHaveLength(0);
    await send({ type: 'DESTROY' });
    postMessage.mockClear();
    await action('upload-image');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it.each(['rich', 'source'] as const)(
    'announces returning to the %s body before closing tools without changing the draft',
    async (mode) => {
      const { host, postMessage, send, toolbarAction, finishPanelHandoff } = await mountRuntime({
        intentKind: 'create-topic',
        mode,
        markdown: '保留正文'
      });
      const body = host.querySelector(mode === 'rich' ? '.ProseMirror' : '.cm-content')!;
      const click = async (label: string) => {
        if (label === '文字格式') return toolbarAction('format');
        if (label === '输入正文') return toolbarAction('focus-editor');
        const since = postMessage.mock.calls.length;
        await act(async () => {
          host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
          await new Promise(requestAnimationFrame);
        });
        await finishPanelHandoff(since);
      };
      await click('文字格式');
      postMessage.mockClear();
      await click('输入正文');
      const events = postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)));
      const focusIntent = events.findIndex((event) => event.type === 'RETURN_TO_EDITOR');
      const close = events.findIndex((event) => event.type === 'PANEL_CHANGED' && !event.payload.open);
      expect(focusIntent).toBeGreaterThanOrEqual(0);
      expect(events[focusIntent].payload).toEqual({ documentEpoch: 0 });
      expect(close).toBeGreaterThan(focusIntent);
      expect(document.activeElement).toBe(body);
      expect(host.querySelector(mode === 'rich' ? '.ProseMirror' : '.cm-content')).toBe(body);
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'body-return' } });
      expect(
        postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.payload?.requestId === 'body-return')
          .payload.snapshot.markdown.trim()
      ).toBe('保留正文');

      await click('文字格式');
      postMessage.mockClear();
      await send({ type: 'COMMAND', payload: { name: 'blur' } });
      expect(postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)).type)).not.toContain('RETURN_TO_EDITOR');
      await click('文字格式');
      await click('链接');
      postMessage.mockClear();
      await act(async () =>
        host.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="关闭"]')!.click()
      );
      expect(postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)).type)).not.toContain('RETURN_TO_EDITOR');
      await click('输入正文');
      expect(postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)).type)).toContain('RETURN_TO_EDITOR');
    }
  );

  it.each(['reply', 'create-topic', 'edit-topic'] as const)(
    'defers expression panels and unused categories in %s',
    async (intentKind) => {
      for (const site of ['nodeseek', 'linuxdo'] as const) {
        const { host, root, toolbarAction } = await mountRuntime({
          intentKind,
          site,
          discourseEmoji: [{ name: 'smile', url: 'https://linux.do/smile.png' }]
        });
        expect(host.querySelector('[data-expression-cache]')).toBeNull();
        await toolbarAction('emoji');
        const panel = host.querySelector<HTMLElement>('[data-expression-cache]')!;
        expect(panel.hidden).toBe(false);
        const image = panel.querySelector<HTMLImageElement>('.expression-grid:not([hidden]) img')!;
        expect(image.getAttribute('src')).toBeTruthy();
        expect(image.getAttribute('loading')).toBe('lazy');
        expect(panel.querySelectorAll('.expression-grid[hidden] img[src]')).toHaveLength(0);
        await act(async () => panel.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click());
        await toolbarAction('emoji');
        expect(panel.querySelector('.expression-grid:not([hidden]) img')).toBe(image);
        await act(async () => root.unmount());
        host.remove();
      }
    }
  );
  it.each(['rich', 'source'] as const)(
    'keeps the %s selection through the topic format panel and mode switch',
    async (mode) => {
      const { host, postMessage, send, toolbarAction, finishPanelHandoff } = await mountRuntime({
        intentKind: 'create-topic',
        mode,
        markdown: '甲乙丙'
      });
      const click = async (label: string) => {
        if (label === '文字格式') return toolbarAction('format');
        if (label === '更多编辑工具') return toolbarAction('more');
        const since = postMessage.mock.calls.length;
        const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
          (item) => item.getAttribute('aria-label') === label || item.textContent === label
        );
        expect(button).toBeTruthy();
        await act(async () => {
          button!.click();
          await new Promise(requestAnimationFrame);
        });
        await finishPanelHandoff(since);
      };
      const editor = (host.querySelector('.composer-document') as HTMLElement & { editor: Editor }).editor;
      await act(async () => {
        if (mode === 'rich') editor.commands.setTextSelection({ from: 2, to: 3 });
        else EditorView.findFromDOM(host.querySelector('.cm-editor')!)!.dispatch({ selection: { anchor: 1, head: 2 } });
      });
      expect(host.querySelector('button[aria-label="粗体"]')).toBeNull();
      await click('文字格式');
      expect(host.querySelector('[role="dialog"][aria-label="文字格式"]')?.getAttribute('aria-modal')).toBeNull();
      expect(postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)))).toContainEqual({
        type: 'PANEL_CHANGED',
        payload: { documentEpoch: 0, open: true }
      });
      await click('粗体');
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'formatted-topic' } });
      const messages = () => postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)));
      expect(
        messages()
          .findLast((event) => event.payload?.requestId === 'formatted-topic')
          .payload.snapshot.markdown.trim()
      ).toBe('甲**乙**丙');
      expect(host.querySelector('[role="dialog"][aria-label="文字格式"]')).not.toBeNull();
      expect(document.activeElement?.closest('.ProseMirror, .cm-content')).toBeNull();
      await click('更多编辑工具');
      await click(mode === 'rich' ? '切换到源码' : '切换到富文本');
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'switched-topic' } });
      expect(
        messages().findLast((event) => event.payload?.requestId === 'switched-topic').payload.snapshot
      ).toMatchObject({
        mode: mode === 'rich' ? 'source' : 'rich',
        markdown: expect.stringContaining('甲**乙**丙')
      });
      await click('更多编辑工具');
      expect(host.textContent).not.toContain('帖子选项');
      expect(host.textContent).not.toContain('附件与草稿');
      await click('预览');
      const request = messages().findLast((event) => event.type === 'REQUEST_HOST_ACTION');
      expect(request.payload.action).toBe('preview-topic');
      await send({
        type: 'COMMAND',
        payload: { name: 'host-action-result', requestId: request.payload.requestId, result: {} }
      });
    }
  );
  it('opens a single expanded link form without an HTML reply toolbar', async () => {
    const { host, toolbarAction } = await mountRuntime({ runtimeStyle: true, site: 'nodeseek' });
    expect(host.querySelector('.runtime > .toolbar-stack')).toBeNull();
    await toolbarAction('link');
    const dialog = host.querySelector<HTMLElement>('[role="dialog"][aria-label="链接设置"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.closest('[data-expanded="true"]')).not.toBeNull();
    expect(getComputedStyle(host.querySelector('.editor-pane')!).visibility).toBe('hidden');
  });
  it('hides table actions while editing a poll and pins the form action outside its scroller', async () => {
    const { host, toolbarAction } = await mountRuntime({ site: 'nodeseek', runtimeStyle: true });
    await toolbarAction('table');
    expect(document.querySelector('[aria-label="表格操作"]')).not.toBeNull();
    await toolbarAction('poll');
    expect(document.querySelector('[aria-label="表格操作"]')).toBeNull();
    const dialog = host.querySelector<HTMLElement>('[role="dialog"][aria-label="NodeSeek 投票"]')!;
    expect(dialog.closest('[data-expanded="true"]')).not.toBeNull();
    expect(dialog.querySelector('.builder-body .primary')).toBeNull();
    expect(dialog.querySelector('.builder-actions .primary')?.textContent).toBe('插入投票');
  });
  it('restores the local initial document without waiting for a host message', async () => {
    const { host, postMessage, send } = await mountRuntime({ initialDocument: true, markdown: '本机草稿末字' });
    const types = () => postMessage.mock.calls.map(([raw]) => JSON.parse(raw).type);
    expect(types()).toContain('READY');
    expect(host.querySelector('.ProseMirror')?.textContent).toBe('本机草稿末字');
    expect(document.getElementById('composer-initial-document')).toBeNull();
    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    expect(types().filter((type: string) => type === 'READY')).toHaveLength(1);
  });

  it.each(
    (['linuxdo', 'nodeseek'] as const).flatMap((site) => (['rich', 'source'] as const).map((mode) => ({ site, mode })))
  )(
    'preserves $site attachment Markdown while presenting its $mode preview with site-specific labels',
    async ({ site, mode }) => {
      const markdown = [
        '[**报告**.txt|attachment](upload://abc123.txt "文件")',
        '[普通链接](https://example.com/readme)',
        '[不是|attachment标记](https://example.com/other)'
      ].join('\n\n');
      const { host, send, postMessage } = await mountRuntime({ site, mode, markdown });
      await send({ type: 'SET_READ_ONLY', payload: { readOnly: true } });
      const links = host.querySelectorAll('.composer-document a');
      expect(links[0]?.textContent).toBe(site === 'linuxdo' ? '报告.txt' : '报告.txt|attachment');
      expect(links[0]?.querySelector('strong')?.textContent).toBe('报告');
      expect(links[0]?.classList.contains('composer-attachment')).toBe(site === 'linuxdo');
      expect(links[1]?.textContent).toBe('普通链接');
      expect(links[2]?.textContent).toBe('不是|attachment标记');
      expect(links[1]?.classList.contains('composer-attachment')).toBe(false);
      expect(links[2]?.classList.contains('composer-attachment')).toBe(false);
      await send({ type: 'SET_READ_ONLY', payload: { readOnly: false } });
      await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
      await send({ type: 'SET_MODE', payload: { mode: 'source' } });
      expect(host.querySelector('.cm-content')?.textContent).toContain('|attachment');
      await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'attachment-roundtrip' } });
      const messages = postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw)));
      expect(
        messages
          .findLast((event) => event.payload?.requestId === 'attachment-roundtrip')
          .payload.snapshot.markdown.trim()
      ).toBe(markdown);
      expect(messages.some((event) => event.type === 'REQUEST_HOST_ACTION')).toBe(false);
    }
  );

  it('clears attachment presentation when the same editor changes from linux.do to NodeSeek', async () => {
    const markdown = '[文件.txt|attachment](https://example.com/file.txt)';
    const { host, send } = await mountRuntime({ markdown });
    expect(host.querySelector('.composer-document a')?.textContent).toBe('文件.txt');
    await send({
      type: 'INIT',
      payload: {
        documentEpoch: 1,
        site: 'nodeseek',
        intentKind: 'create-topic',
        markdown,
        pendingNodeSeekPolls: [],
        mode: 'rich',
        theme: TEST_THEME
      }
    });
    expect(host.querySelector('.composer-document a')?.textContent).toBe('文件.txt|attachment');
    expect(host.querySelector('.composer-attachment')).toBeNull();
  });

  it.each(['rich', 'source'] as const)(
    'rejects a native upload while %s is read-only instead of acknowledging an absent placeholder',
    async (mode) => {
      const { host, send, postMessage } = await mountRuntime({ mode, markdown: '保留' });
      await send({ type: 'SET_READ_ONLY', payload: { readOnly: true } });
      await send({
        type: 'COMMAND',
        payload: { name: 'begin-image-upload', documentEpoch: 0, uploadId: 'preview-upload' }
      });
      expect(host.querySelector('.composer-image-upload')).toBeNull();
      expect(
        postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.type === 'UPLOAD_COMMAND_RESULT').payload
      ).toEqual({ command: 'begin-image-upload', documentEpoch: 0, uploadId: 'preview-upload', accepted: false });
      await send({ type: 'SET_READ_ONLY', payload: { readOnly: false } });
      await send({
        type: 'COMMAND',
        payload: { name: 'begin-image-upload', documentEpoch: 0, uploadId: 'editing-upload' }
      });
      expect(host.querySelector('.composer-image-upload')).not.toBeNull();
      expect(
        postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.type === 'UPLOAD_COMMAND_RESULT').payload.accepted
      ).toBe(true);
    }
  );
  it.each(['rich', 'source'] as const)(
    'settles native image uploads at the mapped %s selection without focusing',
    async (mode) => {
      const { host, send, postMessage } = await mountRuntime({ mode, markdown: '原文' });
      const input = host.querySelector<HTMLElement>(mode === 'rich' ? '.composer-document' : '.cm-content')!;
      await send({ type: 'COMMAND', payload: { name: 'begin-image-upload', uploadId: 'native-1', documentEpoch: 0 } });
      expect(host.querySelector('.composer-image-upload')).not.toBeNull();
      // Typing at an empty upload anchor must be retained, not swallowed by the late image.
      await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '新增' } });
      await send({ type: 'COMMAND', payload: { name: 'blur' } });
      const editor = (host.querySelector('.composer-document') as HTMLElement & { editor: Editor }).editor;
      const transactions: boolean[] = [];
      const visibleImageFrames: boolean[] = [];
      editor.on('transaction', ({ transaction }) => {
        transactions.push(transaction.scrolledIntoView);
        if (mode === 'rich')
          visibleImageFrames.push(Boolean(host.querySelector('.composer-image-upload, .composer-image')));
      });
      await send({
        type: 'COMMAND',
        payload: {
          name: 'finish-image-upload',
          uploadId: 'native-1',
          documentEpoch: 0,
          markdown: '![图](https://example.com/a.png)'
        }
      });
      expect(host.querySelector('.composer-image-upload')).toBeNull();
      expect(document.activeElement).not.toBe(input);
      expect(transactions).not.toContain(true);
      if (mode === 'rich') {
        expect(visibleImageFrames.length).toBeGreaterThan(0);
        expect(visibleImageFrames).not.toContain(false);
      }
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'native-upload' } });
      const snapshot = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((event) => event.payload?.requestId === 'native-upload').payload.snapshot;
      expect(snapshot.markdown).toContain('新增');
      expect(snapshot.markdown).toContain('原文');
      expect(snapshot.markdown).toContain('![图](https://example.com/a.png)');
      await send({ type: 'COMMAND', payload: { name: 'begin-image-upload', uploadId: 'stale', documentEpoch: 0 } });
      await send({
        type: 'INIT',
        payload: {
          documentEpoch: 1,
          site: 'linuxdo',
          intentKind: 'create-topic',
          markdown: '新草稿',
          mode,
          pendingNodeSeekPolls: [],
          theme: TEST_THEME
        }
      });
      await send({
        type: 'COMMAND',
        payload: { name: 'finish-image-upload', uploadId: 'stale', documentEpoch: 0, markdown: '错误图片' }
      });
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'new-draft' } });
      expect(
        postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.payload?.requestId === 'new-draft')
          .payload.snapshot.markdown.trim()
      ).toBe('新草稿');
      expect(host.querySelector('.composer-image-upload')).toBeNull();
    }
  );
  it.each(['rich', 'source'] as const)(
    'holds the %s keyboard policy without changing content or selection before upload activation',
    async (mode) => {
      const { host, send, postMessage, toolbarAction } = await mountRuntime({ mode, markdown: '前文后文' });
      const input = host.querySelector<HTMLElement>(mode === 'rich' ? '.composer-document' : '.cm-content')!;
      const editor = (host.querySelector('.composer-document') as HTMLElement & { editor: Editor }).editor;
      const source = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!;
      await send({ type: 'COMMAND', payload: { name: 'focus' } });
      await act(async () => {
        if (mode === 'rich') editor.commands.setTextSelection(3);
        else source.dispatch({ selection: { anchor: 2 } });
        await new Promise(requestAnimationFrame);
      });
      let policyAtRequest: string | null = null;
      let focusedAtRequest = false;
      postMessage.mockImplementation((raw) => {
        const message = JSON.parse(String(raw));
        if (message.type === 'REQUEST_HOST_ACTION' && message.payload.action === 'upload-image') {
          policyAtRequest = input.getAttribute('virtualkeyboardpolicy');
          focusedAtRequest = document.activeElement === input;
        }
      });
      const selection = window.getSelection()!;
      const selectionWrites = (['collapse', 'extend', 'removeAllRanges', 'addRange'] as const).map((method) =>
        vi.spyOn(selection, method)
      );
      const mutations: MutationRecord[] = [];
      const observer = new MutationObserver((records) => mutations.push(...records));
      observer.observe(input, { subtree: true, childList: true, characterData: true, attributes: true });
      const before = input.innerHTML;
      try {
        await toolbarAction('upload-image');
        expect(policyAtRequest).toBe('manual');
        expect(focusedAtRequest).toBe(true);
        expect(input.innerHTML).toBe(before);
        expect(
          [...mutations, ...observer.takeRecords()].map((record) => ({
            type: record.type,
            input: record.target === input,
            attribute: record.attributeName
          }))
        ).toEqual([{ type: 'attributes', input: true, attribute: 'virtualkeyboardpolicy' }]);
        selectionWrites.forEach((write) => expect(write).not.toHaveBeenCalled());
        expect(document.activeElement).toBe(input);
        expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
        expect(host.querySelector('.composer-image-upload')).toBeNull();
      } finally {
        observer.disconnect();
        selectionWrites.forEach((write) => write.mockRestore());
      }
      const request = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((event) => event.payload?.action === 'upload-image');
      const uploadId = request.payload.data.uploadId;
      for (const candidate of [
        { uploadId: 'another-upload', documentEpoch: 0 },
        { uploadId, documentEpoch: 99 }
      ]) {
        await send({ type: 'COMMAND', payload: { name: 'begin-image-upload', ...candidate } });
        expect(postMessage.mock.calls.map(([raw]) => JSON.parse(String(raw))).at(-1).payload.accepted).toBe(false);
        expect(document.activeElement).toBe(input);
        expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
        expect(host.querySelector('.composer-image-upload')).toBeNull();
      }
      // Commit IME text at the saved caret, then move the live caret elsewhere.
      await act(async () => {
        if (mode === 'rich') {
          editor.view.dispatch(editor.state.tr.insertText('新增', 3));
          editor.commands.setTextSelection(1);
        } else {
          source.dispatch({ changes: { from: 2, insert: '新增' } });
          source.dispatch({ selection: { anchor: 0 } });
        }
      });
      let focusedAtAck = true;
      let policyAtAck: string | null = 'manual';
      let policyAtBlur: string | null = null;
      const blur = input.blur.bind(input);
      vi.spyOn(input, 'blur').mockImplementation(() => {
        policyAtBlur = input.getAttribute('virtualkeyboardpolicy');
        blur();
      });
      postMessage.mockImplementation((raw) => {
        if (JSON.parse(String(raw)).type === 'UPLOAD_COMMAND_RESULT') {
          focusedAtAck = document.activeElement === input;
          policyAtAck = input.getAttribute('virtualkeyboardpolicy');
        }
      });
      await send({ type: 'COMMAND', payload: { name: 'begin-image-upload', uploadId, documentEpoch: 0 } });
      expect(focusedAtAck).toBe(false);
      expect(policyAtBlur).toBe('manual');
      expect(policyAtAck).toBeNull();
      expect(host.querySelector('.composer-image-upload')?.textContent).toBe('上传中…');
      await send({
        type: 'COMMAND',
        payload: {
          name: 'host-action-result',
          requestId: request.payload.requestId,
          result: { markdown: '![图](https://example.com/a.png)' }
        }
      });
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'mapped-handoff' } });
      const snapshot = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((event) => event.payload?.requestId === 'mapped-handoff').payload.snapshot;
      expect(snapshot.markdown.replace(/\s/g, '')).toBe('前文新增![图](https://example.com/a.png)后文');
      expect(host.querySelector('.composer-image-upload')).toBeNull();
    }
  );
  it.each(['rich', 'source'] as const)(
    'cancels an unactivated %s upload without changing input and rejects its late activation',
    async (mode) => {
      vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      const { host, postMessage, send, toolbarAction, toolbarState } = await mountRuntime({
        mode,
        markdown: '保留正文'
      });
      const input = host.querySelector<HTMLElement>(mode === 'rich' ? '.composer-document' : '.cm-content')!;
      await send({ type: 'COMMAND', payload: { name: 'focus' } });
      input.setAttribute('virtualkeyboardpolicy', 'auto');
      const before = input.innerHTML;
      const begin = async () => {
        await toolbarAction('upload-image');
        return postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.payload?.action === 'upload-image');
      };
      const first = await begin();
      expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
      await send({
        type: 'COMMAND',
        payload: { name: 'host-action-result', requestId: first.payload.requestId, error: '键盘交接取消' }
      });
      expect(input.innerHTML).toBe(before);
      expect(document.activeElement).toBe(input);
      expect(input.getAttribute('virtualkeyboardpolicy')).toBe('auto');
      expect(host.querySelector('.composer-image-upload')).toBeNull();
      expect(toolbarState().imageBusy).toBe(false);
      const next = await begin();
      expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
      expect(next.payload.data.uploadId).not.toBe(first.payload.data.uploadId);
      await activateToolbarUpload(send, first);
      expect(
        postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.type === 'UPLOAD_COMMAND_RESULT').payload.accepted
      ).toBe(false);
      expect(document.activeElement).toBe(input);
      expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
      expect(host.querySelector('.composer-image-upload')).toBeNull();
      await activateToolbarUpload(send, next);
      expect(input.getAttribute('virtualkeyboardpolicy')).toBe('auto');
      await send({ type: 'COMMAND', payload: { name: 'host-action-result', requestId: next.payload.requestId } });
      expect(host.querySelector('.composer-image-upload')).toBeNull();
      expect(toolbarState().imageBusy).toBe(false);
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'cancel-retry' } });
      expect(
        postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.payload?.requestId === 'cancel-retry')
          .payload.snapshot.markdown.trim()
      ).toBe('保留正文');
    }
  );
  it.each(['linuxdo', 'nodeseek'] as const)(
    'inserts a new %s topic image between the chosen paragraphs',
    async (site) => {
      const markdown = '前文\n\n后文';
      const { host, send, postMessage, toolbarAction, toolbarState } = await mountRuntime({ site, markdown });
      expect(toolbarState().imageBusy).toBe(false);
      await send({
        type: 'INIT',
        payload: {
          site,
          intentKind: 'create-topic',
          markdown,
          pendingNodeSeekPolls: [],
          mode: 'rich',
          nodeSeekMemberId: '54874',
          theme: TEST_THEME
        }
      });
      expect(host.querySelector('.runtime > .toolbar-stack, .runtime > .topic-toolbar')).toBeNull();
      const dom = host.querySelector<HTMLElement>('.composer-document')!;
      const editor = (dom as HTMLElement & { editor: Editor }).editor;
      await act(async () => editor.commands.setTextSelection(3));
      await toolbarAction('upload-image');
      expect(host.querySelector('.composer-image-upload')).toBeNull();
      expect(editor.getMarkdown().trim()).toBe(markdown);
      const request = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((event) => event.payload?.action === 'upload-image');
      expect(request).toBeDefined();
      await activateToolbarUpload(send, request);
      expect(host.querySelector('.composer-image-upload')?.textContent).toBe('上传中…');
      // Moving the cursor while the native picker is active must not move its insertion anchor.
      await act(async () => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
      await send({
        type: 'COMMAND',
        payload: {
          name: 'host-action-result',
          requestId: request.payload.requestId,
          result: { markdown: '![图片](https://example.com/image.png)' }
        }
      });
      expect(host.querySelector('.composer-image-upload')).toBeNull();
      expect(document.activeElement).not.toBe(dom);
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'topic-image' } });
      const snapshot = postMessage.mock.calls
        .map(([raw]) => JSON.parse(raw))
        .findLast((event) => event.payload?.requestId === 'topic-image');
      expect(snapshot.payload.snapshot.markdown.replace(/\n{3,}/g, '\n\n').trim()).toBe(
        '前文\n\n![图片](https://example.com/image.png)\n\n后文'
      );
    }
  );

  it.each(['rich', 'source'] as const)(
    'previews %s without changing the draft mode or allowing edits',
    async (mode) => {
      const { host, postMessage, send } = await mountRuntime({ markdown: '**保留草稿**', mode });
      await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '新增' } });
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'before-preview' } });
      const snapshot = (id: string) =>
        postMessage.mock.calls.map(([raw]) => JSON.parse(raw)).findLast((event) => event.payload?.requestId === id)
          .payload.snapshot;
      const before = snapshot('before-preview');
      await send({ type: 'SET_READ_ONLY', payload: { readOnly: true } });
      expect(host.querySelector('.editor-pane.active')).not.toBeNull();
      expect(host.querySelector('.tiptap')?.getAttribute('contenteditable')).toBe('false');
      expect(host.querySelector('button[aria-label="投票"]')).toBeNull();
      await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '不应插入' } });
      await send({ type: 'COMMAND', payload: { name: 'undo' } });
      await send({ type: 'SET_MODE', payload: { mode: mode === 'rich' ? 'source' : 'rich' } });
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'preview' } });
      expect(snapshot('preview')).toEqual(before);
      await send({ type: 'SET_READ_ONLY', payload: { readOnly: false } });
      await send({ type: 'COMMAND', payload: { name: 'undo' } });
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'after-preview' } });
      expect(snapshot('after-preview').mode).toBe(mode);
      expect(snapshot('after-preview').markdown.trim()).toBe('**保留草稿**');
    }
  );
  it.each(['rich', 'source'] as const)(
    'hides selected image outlines in %s previews and restores them when editing resumes',
    async (mode) => {
      const { host, send } = await mountRuntime({
        markdown: '![预览图片](https://example.com/image.png)',
        mode,
        runtimeStyle: true
      });
      const document = host.querySelector<HTMLElement>('.composer-document')!;
      const editor = (document as HTMLElement & { editor: Editor }).editor;
      await act(async () => editor.commands.setNodeSelection(0));
      const selectedImage = () => host.querySelector<HTMLElement>('.composer-image.ProseMirror-selectednode')!;
      expect(getComputedStyle(selectedImage()).outline).toContain('2px');

      await send({ type: 'SET_READ_ONLY', payload: { readOnly: true } });
      expect(document.getAttribute('contenteditable')).toBe('false');
      expect(getComputedStyle(selectedImage()).outline).toBe('none');

      await send({ type: 'SET_READ_ONLY', payload: { readOnly: false } });
      expect(document.getAttribute('contenteditable')).toBe('true');
      expect(getComputedStyle(selectedImage()).outline).toContain('2px');
    }
  );
  it.each([
    ['rich', true],
    ['source', true],
    ['rich', false],
    ['source', false]
  ] as const)(
    'keeps a replacement %s document unchanged when an old upload completes (activated: %s)',
    async (mode, activated) => {
      const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
      const { host, postMessage, send, toolbarAction, toolbarState } = await mountRuntime({ mode, markdown: '旧草稿' });
      const input = host.querySelector<HTMLElement>(mode === 'rich' ? '.composer-document' : '.cm-content')!;
      await send({ type: 'COMMAND', payload: { name: 'focus' } });
      await toolbarAction('upload-image');
      expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
      const request = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((message) => message.payload?.action === 'upload-image');
      if (activated) await activateToolbarUpload(send, request);
      await send({
        type: 'INIT',
        payload: {
          documentEpoch: 1,
          site: 'linuxdo',
          intentKind: 'reply',
          markdown: '新文档必须完整保留',
          pendingNodeSeekPolls: [],
          mode,
          theme: TEST_THEME
        }
      });
      expect(input.getAttribute('virtualkeyboardpolicy')).toBeNull();
      expect(alert).not.toHaveBeenCalled();
      expect(toolbarState().imageBusy).toBe(false);
      await toolbarAction('upload-image');
      expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
      const currentRequest = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((message) => message.payload?.action === 'upload-image');
      expect(currentRequest.payload.requestId).not.toBe(request.payload.requestId);
      await send({
        type: 'COMMAND',
        payload: {
          name: 'host-action-result',
          requestId: request.payload.requestId,
          result: { markdown: '![旧图片](https://example.com/old.png)' }
        }
      });
      expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'replacement-after-upload' } });
      const snapshot = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((message) => message.payload?.requestId === 'replacement-after-upload').payload.snapshot;
      expect(snapshot.markdown.trim()).toBe('新文档必须完整保留');
      expect(toolbarState().imageBusy).toBe(true);
      await send({
        type: 'COMMAND',
        payload: { name: 'host-action-result', requestId: request.payload.requestId, error: '旧上传失败' }
      });
      expect(alert).not.toHaveBeenCalled();
      expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
      await activateToolbarUpload(send, currentRequest);
      expect(input.getAttribute('virtualkeyboardpolicy')).toBeNull();
      await send({
        type: 'COMMAND',
        payload: {
          name: 'host-action-result',
          requestId: currentRequest.payload.requestId,
          result: { markdown: '![新图片](https://example.com/new.png)' }
        }
      });
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'current-after-upload' } });
      const currentSnapshot = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((message) => message.payload?.requestId === 'current-after-upload').payload.snapshot;
      expect(currentSnapshot.markdown).toContain('新文档必须完整保留');
      expect(currentSnapshot.markdown).toContain('![新图片](https://example.com/new.png)');
      expect(currentSnapshot.markdown).not.toContain('旧图片');
      expect(toolbarState().imageBusy).toBe(false);
    }
  );

  it.each([
    ['rich', 'destroy'],
    ['source', 'destroy'],
    ['rich', 'unmount'],
    ['source', 'unmount']
  ] as const)('restores the %s input policy when pending upload ends by %s', async (mode, cleanup) => {
    const { host, root, send, toolbarAction } = await mountRuntime({ mode, markdown: '保留正文' });
    const input = host.querySelector<HTMLElement>(mode === 'rich' ? '.composer-document' : '.cm-content')!;
    input.setAttribute('virtualkeyboardpolicy', 'auto');
    await send({ type: 'COMMAND', payload: { name: 'focus' } });
    await toolbarAction('upload-image');
    expect(input.getAttribute('virtualkeyboardpolicy')).toBe('manual');
    if (cleanup === 'destroy') await send({ type: 'DESTROY' });
    else await act(async () => root.unmount());
    expect(input.getAttribute('virtualkeyboardpolicy')).toBe('auto');
  });

  it('keeps replacement template loading independent of cancelled document requests', async () => {
    const { host, postMessage, send, toolbarAction } = await mountRuntime();
    const openTemplates = async () => {
      await toolbarAction('templates');
      return postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((entry) => entry.payload?.action === 'load-linuxdo-templates').payload.requestId;
    };
    const oldRequest = await openTemplates();
    await send({
      type: 'INIT',
      payload: {
        documentEpoch: 1,
        site: 'linuxdo',
        intentKind: 'reply',
        markdown: '',
        pendingNodeSeekPolls: [],
        mode: 'rich',
        theme: TEST_THEME
      }
    });
    const currentRequest = await openTemplates();
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: oldRequest,
        result: { templates: [{ id: 'old', title: '旧模板', content: '旧正文' }] }
      }
    });
    expect(host.textContent).not.toContain('旧模板');
    expect(host.textContent).toContain('正在读取模板…');
    expect(host.querySelector('.error')).toBeNull();
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: currentRequest,
        result: { templates: [{ id: 'new', title: '新模板', content: '新正文' }] }
      }
    });
    expect(host.textContent).toContain('新模板');
    expect(host.textContent).not.toContain('正在读取模板…');
    expect(host.textContent).not.toContain('旧模板');
  });

  it.each(
    (['rich', 'source'] as const).flatMap((mode) =>
      (['success', 'cancel', 'failure', ...(mode === 'rich' ? (['insertion-failure'] as const) : [])] as const).map(
        (outcome) => ({ mode, outcome })
      )
    )
  )('keeps $mode focus until host handoff and input closed on $outcome', async ({ mode, outcome }) => {
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const { host, send, postMessage, toolbarAction, toolbarState } = await mountRuntime({ mode, markdown: '保留草稿' });
    const input = host.querySelector<HTMLElement>(mode === 'rich' ? '.composer-document' : '.cm-content')!;
    await send({ type: 'COMMAND', payload: { name: 'focus' } });
    expect(document.activeElement).toBe(input);
    const blur = vi.spyOn(input, 'blur');
    let focusedAtRequest = false;
    postMessage.mockImplementation((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'REQUEST_HOST_ACTION' && message.payload.action === 'upload-image') {
        focusedAtRequest = document.activeElement === input;
      }
    });
    await toolbarAction('upload-image');
    const request = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((message) => message.payload?.action === 'upload-image');
    expect(focusedAtRequest).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(blur).not.toHaveBeenCalled();
    expect(host.querySelector('.composer-image-upload')).toBeNull();
    await activateToolbarUpload(send, request);
    expect(host.querySelector('.composer-image-upload')?.textContent).toBe('上传中…');
    expect(blur).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'pending-image' } });
    expect(
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((message) => message.payload?.requestId === 'pending-image')
        .payload.snapshot.markdown.trim()
    ).toBe('保留草稿');
    if (outcome === 'insertion-failure') {
      const editor = (input as HTMLElement & { editor: Editor }).editor;
      vi.spyOn(editor, 'chain').mockImplementationOnce(() => {
        throw new Error('插入失败');
      });
    }
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: request.payload.requestId,
        ...(outcome === 'success' || outcome === 'insertion-failure'
          ? { result: { markdown: '![测试](https://example.com/image.png)' } }
          : outcome === 'failure'
            ? { error: '上传失败' }
            : {})
      }
    });
    expect(document.activeElement).not.toBe(input);
    expect(host.querySelector('.composer-image-upload')).toBeNull();
    expect(toolbarState().imageBusy).toBe(false);
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'after-picker' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((message) => message.payload?.requestId === 'after-picker').payload.snapshot;
    expect(snapshot.markdown).toContain('保留草稿');
    expect(snapshot.markdown.includes('https://example.com/image.png')).toBe(outcome === 'success');
  });

  it('resolves newly inserted uploads but fails closed for malformed or foreign-site short URLs', async () => {
    const { host, send, postMessage } = await mountRuntime();
    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '![new](upload://aB12.webp)' } });
    const lookup = postMessage.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .findLast((event) => event.payload?.action === 'resolve-linuxdo-upload');
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: lookup.payload.requestId,
        result: { url: 'https://cdn.example.com/aB12.webp' }
      }
    });
    expect(host.querySelector<HTMLImageElement>('.composer-image img')!.src).toBe('https://cdn.example.com/aB12.webp');
    for (const [site, markdown] of [
      ['linuxdo', '![bad](upload://../secret.png)'],
      ['nodeseek', '![foreign](upload://abc.png)']
    ] as const) {
      const mounted = await mountRuntime({ site, markdown });
      expect(mounted.host.querySelector<HTMLImageElement>('.composer-image img')!.hasAttribute('src')).toBe(false);
      expect(mounted.host.querySelector('.composer-image-feedback')!.textContent).toContain('图片加载失败');
    }
  });

  it('previews Discourse uploads over HTTPS without rewriting draft Markdown', async () => {
    const url = 'upload://abc123.png';
    const markdown = `![photo](${url})`;
    const { host, postMessage, send } = await mountRuntime({ markdown });
    const preview = () => host.querySelector<HTMLImageElement>('.composer-image img')!;
    const failedLookup = postMessage.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .findLast((event) => event.payload?.action === 'resolve-linuxdo-upload');
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: failedLookup.payload.requestId, error: 'lookup unavailable' }
    });
    expect(host.querySelector('.composer-image-feedback')!.textContent).toContain('图片加载失败');
    await act(async () => host.querySelector<HTMLButtonElement>('.composer-image-feedback')!.click());
    const lookup = postMessage.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .findLast((event) => event.payload?.action === 'resolve-linuxdo-upload');
    expect(lookup.payload.requestId).not.toBe(failedLookup.payload.requestId);
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: lookup.payload.requestId,
        result: { url: 'https://cdn.example.com/abc123.png' }
      }
    });
    expect(preview().src).toBe('https://cdn.example.com/abc123.png');
    await act(async () => preview().dispatchEvent(new Event('error')));
    await act(async () => host.querySelector<HTMLButtonElement>('.composer-image-feedback')!.click());
    expect(preview().src).toBe('https://cdn.example.com/abc123.png');
    const loadedPreview = preview();
    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    expect(preview()).toBe(loadedPreview);
    expect(preview().src).toBe('https://cdn.example.com/abc123.png');
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'upload-preview' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .findLast((event) => event.payload?.requestId === 'upload-preview').payload.snapshot;
    expect(snapshot.markdown.trim()).toBe(markdown);
  });

  it('restarts identical upload previews for the replacement document', async () => {
    const markdown = '![photo](upload://abc123.png)';
    const { host, postMessage, send } = await mountRuntime({ markdown });
    const requests = () =>
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(raw))
        .filter((event) => event.payload?.action === 'resolve-linuxdo-upload');
    const oldRequest = requests().at(-1);
    const initialMessageCount = postMessage.mock.calls.length;
    await send({
      type: 'INIT',
      payload: {
        documentEpoch: 1,
        site: 'linuxdo',
        intentKind: 'reply',
        markdown,
        pendingNodeSeekPolls: [],
        mode: 'rich',
        theme: TEST_THEME
      }
    });
    expect(requests()).toHaveLength(2);
    const replacementMessages = postMessage.mock.calls.slice(initialMessageCount).map(([raw]) => JSON.parse(raw));
    expect(replacementMessages.filter((message) => message.type === 'SNAPSHOT')).toEqual([]);
    expect(
      replacementMessages.filter((message) => message.type === 'STATE_CHANGED').map((message) => message.payload)
    ).toEqual([expect.objectContaining({ documentEpoch: 1, revision: 0, isEmpty: false })]);
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: oldRequest.payload.requestId,
        result: { url: 'https://cdn.example.com/old.png' }
      }
    });
    expect(host.querySelector<HTMLImageElement>('.composer-image img')!.hasAttribute('src')).toBe(false);
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: requests().at(-1).payload.requestId,
        result: { url: 'https://cdn.example.com/new.png' }
      }
    });
    expect(host.querySelector<HTMLImageElement>('.composer-image img')!.src).toBe('https://cdn.example.com/new.png');
    expect(host.querySelector('.composer-image-feedback')!.textContent).not.toContain('图片加载失败');
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'replacement-preview' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .findLast((message) => message.payload?.requestId === 'replacement-preview').payload.snapshot;
    expect(snapshot).toMatchObject({ revision: 0, isEmpty: false });
    expect(snapshot.markdown.trim()).toBe(markdown);
  });

  it.each([
    ['nodeseek', 'rich'],
    ['linuxdo', 'rich'],
    ['nodeseek', 'source'],
    ['linuxdo', 'source']
  ] as const)('clears the submitted %s %s document before the next reply', async (site, mode) => {
    const { host, postMessage, send } = await mountRuntime({ site, mode, markdown: '已发送正文' });
    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '补充内容' } });
    await send({
      type: 'INIT',
      payload: {
        documentEpoch: 7,
        site,
        intentKind: 'reply',
        markdown: '',
        pendingNodeSeekPolls: [],
        mode,
        discourseEmoji: [],
        theme: TEST_THEME
      }
    });
    expect(host.querySelector('.ProseMirror')?.textContent).toBe('');
    expect(host.querySelector('.cm-content')?.textContent || '').toBe('');
    expect(
      postMessage.mock.calls.map(([raw]) => JSON.parse(raw)).findLast((event) => event.type === 'READY').payload
        .documentEpoch
    ).toBe(7);
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'next-reply' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .findLast((event) => event.payload?.requestId === 'next-reply').payload.snapshot;
    expect(snapshot).toMatchObject({ markdown: '', isEmpty: true, pendingNodeSeekPolls: [] });
  });

  it('reports trusted input without treating programmatic editor updates as activity', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { postMessage, send, root } = await mountRuntime();
    try {
      const registered = add.mock.calls.find(
        ([event, , options]) =>
          event === 'input' && typeof options === 'object' && options.capture === true && options.passive === true
      );
      expect(registered).toBeDefined();
      const input = registered![1] as (event: Event) => void;
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'passive-read' } });
      input({ isTrusted: false } as Event);
      expect(postMessage.mock.calls.map(([raw]) => JSON.parse(raw).type)).not.toContain('USER_INTERACTION');
      input({ isTrusted: true } as Event);
      expect(
        postMessage.mock.calls.map(([raw]) => JSON.parse(raw)).filter((event) => event.type === 'USER_INTERACTION')
      ).toEqual([{ type: 'USER_INTERACTION', payload: {} }]);
      await act(async () => root.unmount());
      mountedRuntimes
        .splice(
          mountedRuntimes.findIndex((item) => item.root === root),
          1
        )[0]
        .host.remove();
      expect(remove).toHaveBeenCalledWith('input', input, true);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });
  const resizeCallbacks = new Map<Element, () => void>();
  beforeEach(() => {
    resizeCallbacks.clear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}
        observe(target: Element) {
          resizeCallbacks.set(target, this.callback);
        }
        disconnect() {
          resizeCallbacks.forEach((callback, target) => {
            if (callback === this.callback) resizeCallbacks.delete(target);
          });
        }
      }
    );
  });
  it.each(['nodeseek', 'linuxdo'] as const)(
    'keeps pending and failed %s reply images visible and retries without changing the document',
    async (site) => {
      const markdown = '![长图](https://example.com/long.png "原图标题")';
      const { host, send } = await mountRuntime({ site, markdown, runtimeStyle: true });
      const dom = host.querySelector<HTMLElement>('.composer-document')!;
      const editor = (dom as HTMLElement & { editor: Editor }).editor;
      const original = editor.getMarkdown();
      const feedback = dom.querySelector<HTMLButtonElement>('.composer-image-feedback');
      const wrapper = dom.querySelector<HTMLElement>('.composer-image')!;
      expect(feedback?.textContent).toBe('图片加载中…');
      expect(feedback?.hidden).toBe(false);
      expect(getComputedStyle(wrapper).width).not.toBe('fit-content');
      expect(getComputedStyle(feedback!).width).toBe('100%');
      expect(Number.parseFloat(getComputedStyle(feedback!).minHeight)).toBeGreaterThanOrEqual(48);
      const first = dom.querySelector('img')!;
      await act(async () => first.dispatchEvent(new Event('error')));
      expect(feedback?.textContent).toBe('图片加载失败，点击重试');
      expect(feedback?.disabled).toBe(false);
      expect(getComputedStyle(wrapper).width).not.toBe('fit-content');
      await act(async () => feedback?.click());
      const retry = dom.querySelector('img')!;
      expect(retry).not.toBe(first);
      expect(retry.getAttribute('src')).toBe(first.getAttribute('src'));
      await act(async () => first.dispatchEvent(new Event('load')));
      expect(feedback?.hidden).toBe(false);
      await act(async () => retry.dispatchEvent(new Event('load')));
      expect(feedback?.hidden).toBe(true);
      expect(retry.hidden).toBe(false);
      await act(async () => editor.commands.setNodeSelection(0));
      expect(wrapper.classList.contains('ProseMirror-selectednode')).toBe(true);
      expect(getComputedStyle(wrapper).width).toBe('fit-content');
      expect(getComputedStyle(wrapper).maxWidth).toBe('100%');
      expect(getComputedStyle(wrapper).outline).toContain('2px');
      expect(editor.getMarkdown()).toBe(original);
      expect(editor.can().undo()).toBe(false);
      await send({ type: 'SET_MODE', payload: { mode: 'source' } });
      await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
      expect(editor.getMarkdown()).toBe(original);
      expect(dom.querySelector('img')).toBe(retry);
    }
  );

  it.each(['load', 'error', 'pending'] as const)(
    'deletes a selected %s image with the IME before the browser resets its selection',
    async (status) => {
      const markdown = '![图片](https://example.com/image.png)\n\n保留文字';
      const { host } = await mountRuntime({ markdown });
      const dom = host.querySelector<HTMLElement>('.composer-document')!;
      const editor = (dom as HTMLElement & { editor: Editor }).editor;
      if (status !== 'pending') await act(async () => dom.querySelector('img')!.dispatchEvent(new Event(status)));
      for (const inputType of ['deleteContentBackward', 'deleteContentForward']) {
        await act(async () => editor.commands.setNodeSelection(0));
        // Gboard reports the image selection to ProseMirror, then moves its DOM caret to the next paragraph.
        window.getSelection()!.collapse(dom.querySelector('p'), 0);
        const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
        await act(async () => {
          dom.dispatchEvent(event);
          expect(dom.querySelector('.composer-image')).not.toBeNull();
          await new Promise(requestAnimationFrame);
        });
        expect(event.defaultPrevented).toBe(true);
        expect(editor.getMarkdown()).toBe('保留文字');
        expect(dom.querySelector('.composer-image')).toBeNull();
        await act(async () => editor.commands.undo());
        expect(editor.getMarkdown()).toBe(markdown);
      }
    }
  );

  it.each(['deleteContentBackward', 'deleteContentForward'])(
    'deletes the adjacent image with %s while keeping the text caret and focus',
    async (inputType) => {
      const { host } = await mountRuntime({
        markdown: '![前图](https://example.com/one.png)\n\n文字\n\n![后图](https://example.com/two.png)'
      });
      const dom = host.querySelector<HTMLElement>('.composer-document')!;
      const editor = (dom as HTMLElement & { editor: Editor }).editor;
      await act(async () => editor.commands.setTextSelection(inputType === 'deleteContentBackward' ? 2 : 4));
      editor.view.focus();
      const blur = vi.spyOn(dom, 'blur');
      const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
      await act(async () => {
        dom.dispatchEvent(event);
        expect(dom.querySelectorAll('.composer-image')).toHaveLength(2);
        await new Promise(requestAnimationFrame);
      });
      expect(event.defaultPrevented).toBe(true);
      expect(dom.querySelectorAll('.composer-image')).toHaveLength(1);
      expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
      expect(blur).not.toHaveBeenCalled();
      expect(editor.view.hasFocus()).toBe(true);
      await act(async () => editor.commands.insertContent('继续'));
      expect(editor.getText()).toContain(inputType === 'deleteContentBackward' ? '继续文字' : '文字继续');
    }
  );

  it.each(['replace', 'read-only'])('cancels queued image deletion when the document changes to %s', async (change) => {
    const markdown = '![图片](https://example.com/image.png)';
    const { host } = await mountRuntime({ markdown });
    const dom = host.querySelector<HTMLElement>('.composer-document')!;
    const editor = (dom as HTMLElement & { editor: Editor }).editor;
    await act(async () => {
      editor.commands.setNodeSelection(0);
      dom.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'deleteContentBackward',
          bubbles: true,
          cancelable: true
        })
      );
      if (change === 'replace') editor.commands.setContent('新草稿', { contentType: 'markdown' });
      else editor.setEditable(false);
      await new Promise(requestAnimationFrame);
    });
    expect(editor.getMarkdown().trim()).toBe(change === 'replace' ? '新草稿' : markdown);
  });

  it('keeps mixed text and consecutive images valid after source conversion and another upload', async () => {
    const markdown =
      '前文\n![第一张](https://example.com/one.png)\n后文\n\n![第二张](https://example.com/two.png)\n![第三张](https://example.com/three.png)';
    const { host, send, postMessage, toolbarAction, toolbarState } = await mountRuntime({ markdown, mode: 'source' });
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    const editor = (host.querySelector('.composer-document') as HTMLElement & { editor: Editor }).editor;
    expect(() => editor.state.doc.check()).not.toThrow();
    await act(async () => editor.commands.setTextSelection(editor.state.doc.content.size - 1));
    await toolbarAction('upload-image');
    const request = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((event) => event.payload?.action === 'upload-image');
    await activateToolbarUpload(send, request);
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: request.payload.requestId,
        result: { markdown: '![第四张](https://example.com/four.png)' }
      }
    });
    expect(() => editor.state.doc.check()).not.toThrow();
    expect(host.querySelectorAll('.composer-image')).toHaveLength(4);
    expect(toolbarState().imageBusy).toBe(false);
    expect(editor.getText()).toContain('前文');
    expect(editor.getText()).toContain('后文');
  });

  it('turns an image gap into one text paragraph and preserves images through undo and mode switches', async () => {
    const markdown = '![第一张](https://example.com/one.png)\n\n![第二张](https://example.com/two.png)';
    const { host, send } = await mountRuntime({ markdown });
    const dom = host.querySelector<HTMLElement>('.composer-document')!;
    const editor = (dom as HTMLElement & { editor: Editor }).editor;
    await act(async () =>
      editor.view.dispatch(editor.state.tr.setSelection(new GapCursor(editor.state.doc.resolve(1))))
    );
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['image', 'paragraph', 'image', 'paragraph']);
    const withTextGap = editor.getMarkdown();
    expect(withTextGap.replace(/\n{3,}/g, '\n\n').trim()).toBe(markdown);
    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '两图之间' } });
    expect(dom.children[1]?.textContent).toBe('两图之间');
    await send({ type: 'COMMAND', payload: { name: 'undo' } });
    expect(editor.getMarkdown()).toBe(withTextGap);
    expect(dom.querySelectorAll('img')).toHaveLength(2);
    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    expect(editor.getMarkdown()).toBe(withTextGap);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['image', 'paragraph', 'image', 'paragraph']);
    expect(dom.querySelectorAll('img')).toHaveLength(2);
  });

  it.each(['nodeseek', 'linuxdo'] as const)('places typing after uploaded %s images', async (site) => {
    const { host, send, postMessage, toolbarAction } = await mountRuntime({ site });
    await toolbarAction('upload-image');
    const request = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((entry: { type: string }) => entry.type === 'REQUEST_HOST_ACTION');
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: request.payload.requestId,
        result: { markdown: '![第一张](https://example.com/one.png)\n\n![第二张](https://example.com/two.png)' }
      }
    });
    const dom = host.querySelector<HTMLElement>('.composer-document')!;
    const editor = (dom as HTMLElement & { editor: Editor }).editor;
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.selection.$from.nodeBefore).toBeNull();
    await send({ type: 'COMMAND', payload: { name: 'focus' } });
    const scrolls = vi.fn();
    editor.on('transaction', ({ transaction }) => {
      if (transaction.scrolledIntoView) scrolls();
    });
    await act(async () => resizeCallbacks.get(dom)?.());
    expect(scrolls).toHaveBeenCalledTimes(1);
    await act(async () => resizeCallbacks.get(document.documentElement)?.());
    expect(scrolls).toHaveBeenCalledTimes(2);
    dom.dispatchEvent(new Event('pointerdown'));
    await act(async () => resizeCallbacks.get(dom)?.());
    expect(scrolls).toHaveBeenCalledTimes(2);
    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '图片下方继续输入' } });
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['image', 'image', 'paragraph']);
    expect(dom.lastElementChild?.textContent).toBe('图片下方继续输入');
  });

  it.each([false, true])(
    'keeps typing after an uploaded image before existing content (replace first: %s)',
    async (replaceFirst) => {
      const { host, send, postMessage, toolbarAction } = await mountRuntime({
        markdown: `${replaceFirst ? '![替换图片](https://example.com/replace.png)' : '前文'}\n\n![原有图片](https://example.com/old.png)`
      });
      const dom = host.querySelector<HTMLElement>('.composer-document')!;
      const editor = (dom as HTMLElement & { editor: Editor }).editor;
      await act(async () => (replaceFirst ? editor.commands.setNodeSelection(0) : editor.commands.setTextSelection(3)));
      await toolbarAction('upload-image');
      const request = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((entry: { type: string }) => entry.type === 'REQUEST_HOST_ACTION');
      await send({
        type: 'COMMAND',
        payload: {
          name: 'host-action-result',
          requestId: request.payload.requestId,
          result: { markdown: '![上传图片](https://example.com/new.png)' }
        }
      });
      await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '继续输入' } });
      const nodes = editor.getJSON().content!;
      const newImageIndex = nodes.findIndex((node) => node.attrs?.src === 'https://example.com/new.png');
      expect(editor.state.doc.child(newImageIndex + 1).textContent).toBe('继续输入');
      expect(nodes[newImageIndex + 2]?.attrs?.src).toBe('https://example.com/old.png');
    }
  );

  it.each(['rich', 'source'] as const)(
    'returns from expressions before focusing the next %s editing mode',
    async (mode) => {
      const { host, send, toolbarAction } = await mountRuntime({
        site: 'nodeseek',
        mode,
        waitForFrame: false,
        markdown: '保留正文'
      });
      await toolbarAction('emoji');
      await send({ type: 'SET_MODE', payload: { mode: mode === 'rich' ? 'source' : 'rich' } });
      expect(host.querySelector<HTMLElement>('[data-expression-cache]')?.hidden).toBe(true);
      expect(host.querySelector('.ProseMirror')?.textContent).toBe('保留正文');
    }
  );
  it.each(['reply', 'private-message', 'create-topic'] as const)(
    'starts each sticker category at the top with pinned tabs in %s',
    async (intentKind) => {
      const { host, toolbarAction } = await mountRuntime({ site: 'nodeseek', intentKind, runtimeStyle: true });
      await toolbarAction('emoji');
      const panel = host.querySelector<HTMLElement>('[data-expression-cache="stickers"]')!;
      const body = panel.querySelector<HTMLElement>('.builder-body')!;
      const rail = panel.querySelector<HTMLElement>('.category-rail')!;
      const categories = rail.querySelectorAll<HTMLButtonElement>('button');
      const firstImage = panel.querySelector<HTMLImageElement>('.expression-grid:not([hidden]) img')!;
      await act(async () => firstImage.dispatchEvent(new Event('load')));
      body.scrollTop = 180;
      await act(async () => categories[1]!.click());
      expect(body.scrollTop).toBe(0);
      body.scrollTop = 120;
      await act(async () => categories[0]!.click());
      expect(body.scrollTop).toBe(0);
      expect(panel.querySelector('.expression-grid:not([hidden]) img')).toBe(firstImage);
      body.scrollTop = 60;
      await act(async () => categories[0]!.click());
      expect(body.scrollTop).toBe(60);
      expect(body.contains(rail)).toBe(false);
      expect(rail.closest('.builder-header')).not.toBeNull();
      expect(getComputedStyle(panel.querySelector('.builder-backdrop')!).position).toBe('absolute');
      expect(getComputedStyle(panel.querySelector('.builder-backdrop')!).maxHeight).toBe('none');
    }
  );

  it.each(
    (['nodeseek', 'linuxdo'] as const).flatMap((site) => (['rich', 'source'] as const).map((mode) => ({ site, mode })))
  )(
    'keeps the $site $mode expression panel and focus for consecutive insertions until explicitly closed',
    async ({ site, mode }) => {
      for (const intentKind of ['reply', 'create-topic', 'private-message'] as const) {
        const { host, send, postMessage, toolbarAction } = await mountRuntime({
          site,
          mode,
          intentKind,
          discourseEmoji: [
            { name: 'smile', url: 'https://linux.do/smile.png' },
            { name: 'smirk', url: 'https://linux.do/smirk.png' }
          ]
        });
        await toolbarAction('emoji');
        const panel = host.querySelector<HTMLElement>('[data-expression-cache]')!;
        const body = panel.querySelector<HTMLElement>('.builder-body')!;
        const search = panel.querySelector<HTMLInputElement>('input[type="search"]');
        if (search) {
          await act(async () => {
            search.focus();
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'smi');
            search.dispatchEvent(new Event('input', { bubbles: true }));
          });
        }
        const focus = document.activeElement;
        body.scrollTop = 120;
        const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.expression-grid:not([hidden]) button')].slice(
          0,
          2
        );
        const images = buttons.map((button) => button.querySelector('img')!);
        for (const image of images) await act(async () => image.dispatchEvent(new Event('load')));
        for (const button of buttons) {
          await act(async () => button.click());
          expect(panel.hidden).toBe(false);
          expect(document.activeElement).toBe(focus);
          expect(body.scrollTop).toBe(120);
          if (search) expect(search.value).toBe('smi');
          expect(
            postMessage.mock.calls
              .map(([raw]) => JSON.parse(String(raw)))
              .findLast((event) => event.type === 'PANEL_CHANGED').payload
          ).toMatchObject({ open: true, layout: 'expression' });
        }
        await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'consecutive-expressions' } });
        expect(
          postMessage.mock.calls
            .map(([raw]) => JSON.parse(String(raw)))
            .findLast((event) => event.payload?.requestId === 'consecutive-expressions').payload.snapshot.markdown
        ).toBe(
          site === 'linuxdo'
            ? ':smile::smirk:'
            : NODESEEK_STICKER_CATEGORIES[0]!.items
                .slice(0, 2)
                .map((item) => item.code)
                .join('')
        );
        await act(async () => panel.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click());
        expect(panel.hidden).toBe(true);
        await toolbarAction('emoji');
        expect(buttons.map((button) => button.querySelector('img'))).toEqual(images);
        expect(body.scrollTop).toBe(120);
      }
    }
  );

  it.each(['nodeseek', 'linuxdo'] as const)(
    'recovers failed %s expressions without inserting or replacing successful images',
    async (site) => {
      const { host, send, postMessage, toolbarAction } = await mountRuntime({
        site,
        markdown: 'draft',
        discourseEmoji: [
          { name: 'first', url: 'https://linux.do/first.png' },
          { name: 'second', url: 'https://linux.do/second.png' }
        ]
      });
      const open = () => toolbarAction('emoji');
      await open();
      const panel = host.querySelector<HTMLElement>('[data-expression-cache]')!;
      const buttons = panel.querySelectorAll<HTMLButtonElement>('.expression-grid:not([hidden]) button');
      const failedButton = buttons[0]!;
      const successButton = buttons[1]!;
      const failed = failedButton.querySelector('img')!;
      const success = successButton.querySelector('img')!;
      expect(failedButton.getAttribute('aria-busy')).toBe('true');
      expect(successButton.getAttribute('aria-busy')).toBe('true');
      const label = failedButton.getAttribute('aria-label')!;
      const body = panel.querySelector<HTMLElement>('.builder-body')!;
      body.scrollTop = 180;
      await act(async () => {
        success.dispatchEvent(new Event('load'));
        failed.dispatchEvent(new Event('error'));
      });
      expect(successButton.getAttribute('aria-busy')).toBe('false');
      expect(failedButton.getAttribute('aria-busy')).toBe('false');
      expect(failedButton.getAttribute('aria-label')).toBe(`${label}，加载失败，点击重试`);
      await act(async () => failedButton.click());
      const retried = failedButton.querySelector('img')!;
      expect(retried).not.toBe(failed);
      expect(retried.getAttribute('src')).toBe(failed.getAttribute('src'));
      expect(panel.hidden).toBe(false);
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'retry-does-not-insert' } });
      expect(
        postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.payload?.requestId === 'retry-does-not-insert').payload.snapshot.markdown
      ).toBe('draft');
      await act(async () => {
        failed.dispatchEvent(new Event('error'));
        retried.dispatchEvent(new Event('error'));
      });
      await act(async () => panel.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click());
      await open();
      const reopened = failedButton.querySelector('img')!;
      expect(reopened).not.toBe(retried);
      expect(successButton.querySelector('img')).toBe(success);
      expect(body.scrollTop).toBe(180);
      await act(async () => reopened.dispatchEvent(new Event('error')));
      expect(failedButton.querySelector('img')).toBe(reopened);
      await act(async () => failedButton.click());
      await act(async () => failedButton.querySelector('img')!.dispatchEvent(new Event('load')));
      await act(async () => failedButton.click());
      expect(panel.hidden).toBe(false);
    }
  );
  it.each([
    ...NODESEEK_STICKER_CATEGORIES.map(({ label, items }) => ({
      site: 'nodeseek' as const,
      category: label,
      images: items.map((item) => item.imageUrl)
    })),
    { site: 'linuxdo' as const, category: '', images: ['https://linux.do/first.png', 'https://linux.do/second.png'] }
  ])(
    'automatically retries visible $site $category expression images with backoff until they load',
    async ({ site, category, images }) => {
      const { host, send, postMessage, toolbarAction } = await mountRuntime({
        site,
        markdown: 'draft',
        waitForFrame: false,
        discourseEmoji: [
          { name: 'first', url: 'https://linux.do/first.png' },
          { name: 'second', url: 'https://linux.do/second.png' }
        ]
      });
      await toolbarAction('emoji');
      const panel = host.querySelector<HTMLElement>('[data-expression-cache]')!;
      if (category) {
        const categoryButton = Array.from(panel.querySelectorAll<HTMLButtonElement>('.category-rail button')).find(
          (button) => button.textContent === category
        )!;
        await act(async () => categoryButton.click());
      }
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const buttons = panel.querySelectorAll<HTMLButtonElement>('.expression-grid:not([hidden]) button');
      expect(Array.from(buttons, (item) => item.querySelector('img')!.getAttribute('src'))).toEqual(images);
      const button = buttons[0]!;
      const failedButtons = Array.from(buttons).filter((_, index) => index !== 1);
      const success = buttons[1]!.querySelector('img')!;
      const body = panel.querySelector<HTMLElement>('.builder-body')!;
      body.scrollTop = 180;
      await act(async () => success.dispatchEvent(new Event('load')));

      for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        const previous = failedButtons.map((item) => item.querySelector('img')!);
        await act(async () => previous.forEach((image) => image.dispatchEvent(new Event('error'))));
        await act(async () => vi.advanceTimersByTime(delay - 1));
        failedButtons.forEach((item, index) => expect(item.querySelector('img')).toBe(previous[index]));
        await act(async () => vi.advanceTimersByTime(1));
        const next = button.querySelector('img')!;
        failedButtons.forEach((item, index) => {
          const retried = item.querySelector('img')!;
          expect(retried).not.toBe(previous[index]);
          expect(retried.getAttribute('src')).toBe(previous[index]!.getAttribute('src'));
          expect(item.getAttribute('aria-busy')).toBe('true');
        });
        // A click during recovery must not insert an invisible expression.
        await act(async () => button.click());
        expect(panel.hidden).toBe(false);
        expect(button.querySelector('img')).toBe(next);
      }
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'automatic-retry-does-not-insert' } });
      expect(
        postMessage.mock.calls
          .map(([raw]) => JSON.parse(String(raw)))
          .findLast((event) => event.payload?.requestId === 'automatic-retry-does-not-insert').payload.snapshot.markdown
      ).toBe('draft');
      const loaded = button.querySelector('img')!;
      const recovered = failedButtons.map((item) => item.querySelector('img')!);
      await act(async () => recovered.forEach((image) => image.dispatchEvent(new Event('load'))));
      await act(async () => vi.advanceTimersByTime(60000));
      failedButtons.forEach((item, index) => {
        expect(item.querySelector('img')).toBe(recovered[index]);
        expect(item.getAttribute('aria-busy')).toBe('false');
      });
      expect(button.querySelector('img')).toBe(loaded);
      expect(buttons[1]!.querySelector('img')).toBe(success);
      expect(body.scrollTop).toBe(180);
      await act(async () => button.click());
      expect(panel.hidden).toBe(false);
    }
  );

  it.each(['nodeseek', 'linuxdo'] as const)(
    'cancels queued %s expression retries when the panel closes or the composer becomes inactive',
    async (site) => {
      const { host, send, toolbarAction, root } = await mountRuntime({
        site,
        waitForFrame: false,
        discourseEmoji: [{ name: 'first', url: 'https://linux.do/first.png' }]
      });
      await toolbarAction('emoji');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const panel = host.querySelector<HTMLElement>('[data-expression-cache]')!;
      const button = panel.querySelector<HTMLButtonElement>('.expression-grid:not([hidden]) button')!;
      const image = () => button.querySelector('img')!;
      for (const close of [
        () => act(async () => panel.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click()),
        () => send({ type: 'COMMAND', payload: { name: 'blur' } }),
        () => send({ type: 'SET_READ_ONLY', payload: { readOnly: true } })
      ]) {
        const pending = image();
        await act(async () => pending.dispatchEvent(new Event('error')));
        await close();
        await act(async () => vi.advanceTimersByTime(60000));
        expect(panel.hidden).toBe(true);
        expect(image()).toBe(pending);
        await send({ type: 'SET_READ_ONLY', payload: { readOnly: false } });
        await toolbarAction('emoji');
        const reopened = image();
        expect(reopened).not.toBe(pending);
        // Late callbacks and the old timer cannot reset the replacement attempt.
        await act(async () => pending.dispatchEvent(new Event('error')));
        await act(async () => vi.advanceTimersByTime(60000));
        expect(image()).toBe(reopened);
      }
      const pending = image();
      const schedule = vi.spyOn(window, 'setTimeout');
      const clear = vi.spyOn(window, 'clearTimeout');
      await act(async () => pending.dispatchEvent(new Event('error')));
      const retryTimerIndex = schedule.mock.calls.findLastIndex(([, delay]) => delay === 8000);
      expect(retryTimerIndex).toBeGreaterThanOrEqual(0);
      const retryTimer = schedule.mock.results[retryTimerIndex]!.value;
      await act(async () => root.unmount());
      expect(clear).toHaveBeenCalledWith(retryTimer);
      host.remove();
      await act(async () => vi.advanceTimersByTime(60000));
    }
  );

  it.each(['nodeseek', 'linuxdo'] as const)(
    'pauses failed %s expression retries while the WebView document is hidden',
    async (site) => {
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const { host, toolbarAction } = await mountRuntime({
        site,
        waitForFrame: false,
        discourseEmoji: [{ name: 'first', url: 'https://linux.do/first.png' }]
      });
      await toolbarAction('emoji');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const panel = host.querySelector<HTMLElement>('[data-expression-cache]')!;
      const button = panel.querySelector<HTMLButtonElement>('.expression-grid:not([hidden]) button')!;
      const failed = button.querySelector('img')!;
      await act(async () => failed.dispatchEvent(new Event('error')));
      visibility.mockReturnValue('hidden');
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => vi.advanceTimersByTime(60000));
      expect(button.querySelector('img')).toBe(failed);
      expect(panel.hidden).toBe(false);
      visibility.mockReturnValue('visible');
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      const resumed = button.querySelector('img')!;
      expect(resumed).not.toBe(failed);
      await act(async () => resumed.dispatchEvent(new Event('load')));
      await act(async () => vi.advanceTimersByTime(60000));
      expect(button.querySelector('img')).toBe(resumed);
    }
  );

  it('pauses failed sticker retries while another category is selected', async () => {
    const { host, toolbarAction } = await mountRuntime({ site: 'nodeseek', waitForFrame: false });
    await toolbarAction('emoji');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const panel = host.querySelector<HTMLElement>('[data-expression-cache]')!;
    const categories = panel.querySelectorAll<HTMLButtonElement>('.category-rail button');
    const button = panel.querySelector<HTMLButtonElement>('.expression-grid:not([hidden]) button')!;
    const failed = button.querySelector('img')!;
    await act(async () => failed.dispatchEvent(new Event('error')));
    await act(async () => categories[1]!.click());
    await act(async () => vi.advanceTimersByTime(60000));
    expect(button.querySelector('img')).toBe(failed);
    await act(async () => categories[0]!.click());
    const retry = button.querySelector('img')!;
    expect(retry).not.toBe(failed);
    await act(async () => retry.dispatchEvent(new Event('error')));
    await act(async () => vi.advanceTimersByTime(2000));
    expect(button.querySelector('img')).not.toBe(retry);
  });

  const editors: Editor[] = [];
  afterEach(async () => {
    editors.splice(0).forEach((editor) => editor.destroy());
    for (const { host, root } of mountedRuntimes.splice(0)) {
      if (!host.isConnected) continue;
      await act(async () => root.unmount());
      host.remove();
    }
    delete window.ReactNativeWebView;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.querySelectorAll('style[data-tiptap-style]').forEach((node) => node.remove());
    document.querySelectorAll('[data-editor-runtime-test-style]').forEach((node) => node.remove());
  });

  it('revalidates identical Markdown after account and pending-poll state changes', async () => {
    const markdown =
      '`literal`\n\n<!-- wz:nodeseek-poll:local1234 -->\n\nnsapp://stardust-receive?member_id=123&ref_id=100&diff=5&description=test&onetime=true';
    const { send, postMessage } = await mountRuntime({
      markdown,
      mode: 'source',
      site: 'nodeseek',
      nodeSeekMemberId: '123'
    });
    const snapshot = async (requestId: string) => {
      await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId } });
      return postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((entry) => entry.payload?.requestId === requestId).payload.snapshot.validationIssues;
    };
    expect(await snapshot('missing-sidecar')).toEqual([expect.objectContaining({ code: 'missing-poll-sidecar' })]);
    await send({
      type: 'INIT',
      payload: {
        site: 'nodeseek',
        intentKind: 'reply',
        markdown,
        mode: 'source',
        theme: TEST_THEME,
        nodeSeekMemberId: '456',
        pendingNodeSeekPolls: [
          {
            localId: 'local1234',
            fingerprint: '0123456789abcdef',
            title: '投票',
            multiple: false,
            isPublic: false,
            options: ['A', 'B']
          }
        ]
      }
    });
    expect(await snapshot('changed-account')).toEqual([
      expect.objectContaining({ code: 'stardust-receiver-mismatch' })
    ]);
    expect(await snapshot('repeated-account')).toEqual([
      expect.objectContaining({ code: 'stardust-receiver-mismatch' })
    ]);
  });

  it.each([
    ['[poll', 0, 'linuxdo-poll'],
    ['İ [DeTaIlS]broken', 2, 'linuxdo-details'],
    ['İİ [PoLl]broken', 3, 'linuxdo-poll']
  ])('keeps UTF-16 error positions in %s', async (markdown, from, code) => {
    const { send, postMessage } = await mountRuntime({ markdown: String(markdown), mode: 'source' });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'unicode-offset' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((entry) => entry.payload?.requestId === 'unicode-offset');
    expect(snapshot.payload.snapshot.validationIssues).toContainEqual(expect.objectContaining({ code, from }));
  });

  it.each(['[details]broken', '`[details]code`\n\n[details]broken'])(
    'reuses a complete code-range result for repeated snapshots of %s',
    async (markdown) => {
      const { send, postMessage } = await mountRuntime({ markdown, mode: 'source' });
      const parser = vi.spyOn(Object.getPrototypeOf(markdownLanguage().language.parser), 'parse');
      for (const requestId of ['first-check', 'second-check'])
        await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId } });
      const snapshots = postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .filter((entry) => /^(first|second)-check$/.test(entry.payload?.requestId || ''));
      expect(snapshots).toHaveLength(2);
      expect(snapshots[1].payload.snapshot.validationIssues).toEqual(snapshots[0].payload.snapshot.validationIssues);
      expect(parser.mock.calls.filter(([input]) => input === markdown)).toHaveLength(markdown.includes('`') ? 1 : 0);
    }
  );

  it.each([
    ['[spoiler]İİ[/spoiler]TAIL', '[spoiler]İİ[/spoiler]', 'TAIL'],
    ['[details]İ[/details]\nNEXT', '[details]İ[/details]', 'NEXT'],
    ['İ\n\n[details]x[/details]', '[details]x[/details]', 'İ']
  ])('keeps Unicode private blocks and adjacent editable text intact in %s', (markdown, raw, adjacent) => {
    const editor = new Editor({
      extensions: composerEditorExtensions(),
      content: markdown,
      contentType: 'markdown',
      injectCSS: false
    });
    editors.push(editor);
    const nodes = editor.getJSON().content || [];
    expect(nodes.find((node) => node.type === 'forumPrivateBlock')?.attrs?.raw.trimEnd()).toBe(raw);
    expect(
      nodes
        .filter((node) => node.type === 'paragraph')
        .flatMap((node) => node.content || [])
        .map((node) => ('text' in node ? node.text || '' : ''))
        .join('')
    ).toContain(adjacent);
    expect(editor.getMarkdown()).toContain(raw);
    if (raw === '[details]İ[/details]') {
      const html = document.createElement('div');
      html.innerHTML = editor.getHTML();
      expect(html.querySelector('.card-body')?.textContent).toBe('İ');
    }
  });

  it('round-trips GFM tables and protected site nodes as Markdown', () => {
    const markdown = [
      '正文前',
      '',
      'Emoji :grinning_face:',
      '',
      '| 名称 | 数量 |',
      '| :--- | ---: |',
      '| A\\|B | 2 |',
      '',
      '[poll type=multiple results=on_close min=1 max=2 public=true chartType=pie future="keep me"]',
      '# 标题',
      '* A',
      '* B',
      '[/poll]',
      '',
      'nsapp://stardust-receive?unknown=keep&member_id=42&ref_id=7&description=Pay&diff=5&onetime=true',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '++下划线++',
      '',
      '时间：[date=2026-08-25 time=17:00 timezone="Asia/Shanghai"]',
      '',
      '脚注[^note]',
      '',
      '[^note]: 保留脚注内容',
      '',
      '[future-block mode="keep"]',
      '未知正文',
      '[/future-block]',
      '',
      '正文后'
    ].join('\n');
    const editor = new Editor({
      extensions: composerEditorExtensions(),
      content: markdown,
      contentType: 'markdown',
      injectCSS: false
    });
    editors.push(editor);

    const output = editor.getMarkdown();
    expect(output).toMatch(/\| 名称\s+\| 数量\s+\|/);
    expect(output).toContain('Emoji :grinning_face:');
    expect(output).not.toContain(':grinning\\_face:');
    expect(output).toContain('| A\\|B');
    expect(output).toContain('future="keep me"');
    expect(output).toContain(
      'nsapp://stardust-receive?unknown=keep&member_id=42&ref_id=7&description=Pay&diff=5&onetime=true'
    );
    expect(output).toContain('```mermaid\ngraph TD\n  A --> B\n```');
    expect(output).toContain('++下划线++');
    expect(output).toContain('[date=2026-08-25 time=17:00 timezone="Asia/Shanghai"]');
    expect(output).toContain('脚注[^note]');
    expect(output).toContain('[^note]: 保留脚注内容');
    expect(output).toContain('[future-block mode="keep"]\n未知正文\n[/future-block]');
    expect(output.indexOf('正文前')).toBeLessThan(output.indexOf('[poll'));
    expect(output.indexOf('[poll')).toBeLessThan(output.indexOf('正文后'));

    const reparsed = new Editor({
      extensions: composerEditorExtensions(),
      content: output,
      contentType: 'markdown',
      injectCSS: false
    });
    editors.push(reparsed);
    expect(reparsed.getJSON()).toEqual(editor.getJSON());
  });

  it.each([
    ['inline code', '`[poll`'],
    ['fenced code', '```text\n[poll\n```'],
    ['indented code', '    [poll']
  ])('keeps private syntax inert inside %s', async (_name, markdown) => {
    const { postMessage, send } = await mountRuntime({ markdown, mode: 'source' });

    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'code-validation' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'code-validation'
      );

    expect(snapshot.payload.snapshot.validationIssues).toEqual([]);
  });

  it('preserves mixed-case validation offsets after repeated closed blocks', async () => {
    const prefix = '[DeTaIlS=x]body[/DETAILS]\n'.repeat(500) + '`[POLL`\n\n';
    const { postMessage, send } = await mountRuntime({ mode: 'source' });
    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: prefix + '[SpOiLeR' } });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'large-validation' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((entry) => entry.type === 'SNAPSHOT');
    expect(snapshot.payload.snapshot.validationIssues).toEqual([
      { code: 'linuxdo-spoiler', message: '[spoiler 缺少 [/spoiler]', from: prefix.length, to: prefix.length + 8 }
    ]);
  });

  it('keeps a legacy Stardust card readable but blocks publishing its invalid Ref', async () => {
    const markdown =
      'nsapp://stardust-receive?member_id=54874&ref_id=1&description=Pay+with+Stardust&diff=1&onetime=false';
    const { postMessage, send } = await mountRuntime({ markdown, mode: 'source', site: 'nodeseek' });

    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'legacy-stardust-ref' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'legacy-stardust-ref'
      );

    expect(snapshot.payload.snapshot.markdown).toContain('ref_id=1');
    expect(snapshot.payload.snapshot.validationIssues).toContainEqual(
      expect.objectContaining({ code: 'stardust-ref-invalid' })
    );
  });

  it('maps a pending source upload and rejects a mode switch without losing edits', async () => {
    const { postMessage, send, toolbarAction } = await mountRuntime({ markdown: '保留正文', mode: 'source' });

    await toolbarAction('upload-image');
    const uploadRequest = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { action?: string } }) =>
          entry.type === 'REQUEST_HOST_ACTION' && entry.payload?.action === 'upload-image'
      );
    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '用户输入' } });
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    await activateToolbarUpload(send, uploadRequest);
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: uploadRequest.payload.requestId,
        result: { markdown: '![上传图片](https://example.com/image.png)' }
      }
    });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'source-upload' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'source-upload'
      );

    expect(snapshot.payload.snapshot).toMatchObject({ mode: 'source' });
    expect(snapshot.payload.snapshot.markdown).toContain('用户输入');
    expect(snapshot.payload.snapshot.markdown).toContain('![上传图片](https://example.com/image.png)');
    expect(
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .find(
          (entry: { type: string; payload?: { code?: string } }) =>
            entry.type === 'ERROR' && entry.payload?.code === 'image-upload-pending'
        )
    ).toBeDefined();
  });

  it('inserts a LinuxDo template before its usage counter settles', async () => {
    const { host, postMessage, send, toolbarAction } = await mountRuntime({ markdown: '已有正文' });

    await toolbarAction('templates');
    const loadRequest = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { action?: string } }) =>
          entry.type === 'REQUEST_HOST_ACTION' && entry.payload?.action === 'load-linuxdo-templates'
      );
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: loadRequest.payload.requestId,
        result: { templates: [{ id: 'template-1', title: '测试模板', content: '模板正文' }] }
      }
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="动态模板"] .template-list button')?.click()
    );
    const usageRequest = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { action?: string } }) =>
          entry.type === 'REQUEST_HOST_ACTION' && entry.payload?.action === 'use-linuxdo-template'
      );
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'template-before-usage' } });
    const beforeUsage = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'template-before-usage'
      );

    expect(beforeUsage.payload.snapshot.markdown).toContain('模板正文');
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: usageRequest.payload.requestId, error: '计数失败' }
    });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'template-after-failure' } });
    const afterFailure = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'template-after-failure'
      );
    expect(afterFailure.payload.snapshot.markdown).toContain('模板正文');
    expect(
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .find(
          (entry: { type: string; payload?: { code?: string } }) =>
            entry.type === 'ERROR' && entry.payload?.code === 'template-usage-failed'
        )
    ).toBeDefined();
  });

  it('keeps a line-leading LinuxDo date in its dedicated inline node', () => {
    const raw = '[date=2026-08-26 time=12:00:00 timezone="Asia/Shanghai"]';
    const editor = new Editor({
      extensions: composerEditorExtensions(),
      content: raw,
      contentType: 'markdown',
      injectCSS: false
    });
    editors.push(editor);

    expect(editor.getJSON().content?.[0]?.content?.[0]?.type).toBe('linuxdoDate');
    const rendered = document.createElement('div');
    rendered.innerHTML = editor.getHTML();
    expect(rendered.textContent).toBe('日期 · 2026-08-26 12:00:00');
    expect(editor.getMarkdown()).toBe(raw);
  });

  it('keeps expression previews out of the Markdown document', () => {
    const editor = new Editor({
      extensions: composerEditorExtensions(),
      content: ':wink:',
      contentType: 'markdown',
      injectCSS: false
    });
    editors.push(editor);

    expect(editor.getJSON().content?.[0]?.content?.[0]).toEqual({
      type: 'forumExpression',
      attrs: { raw: ':wink:' }
    });
    expect(editor.getMarkdown()).toBe(':wink:');
  });

  it('reparses adjacent NodeSeek poll and Stardust markers as rich atoms', () => {
    const editor = new Editor({
      extensions: composerEditorExtensions(),
      injectCSS: false,
      content: {
        type: 'doc',
        content: [
          {
            type: 'pendingNodeSeekPoll',
            attrs: {
              localId: 'poll_roundtrip',
              title: 'Y',
              multiple: false,
              isPublic: false,
              options: JSON.stringify(['选项一', '选项二']),
              fingerprint: 'test',
              remoteId: ''
            }
          },
          {
            type: 'nodeSeekStardust',
            attrs: {
              receiverMemberId: '54874',
              amount: 1,
              refId: 100,
              description: 'Pay with Stardust',
              oneTime: false,
              rawMarker: '',
              modified: true
            }
          }
        ]
      }
    });
    editors.push(editor);

    const markdown = editor.getMarkdown();
    expect(markdown).toContain(' -->\n\nnsapp://stardust-receive?');
    vi.stubGlobal(
      'URL',
      vi.fn(() => {
        throw new Error('custom schemes are not parseable in this WebView');
      })
    );
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      'pendingNodeSeekPoll',
      'nodeSeekStardust',
      'paragraph'
    ]);
  });

  it('keeps source-inserted NodeSeek atoms after a terminal table across mode changes', async () => {
    const { host, postMessage, send, toolbarAction } = await mountRuntime({ mode: 'source', site: 'nodeseek' });
    await send({
      type: 'COMMAND',
      payload: {
        name: 'insert-markdown',
        markdown: '| 验收项 | 结果 |\n| --- | --- |\n| 表格 | 通过 |'
      }
    });

    await toolbarAction('poll');
    const pollTitle = host.querySelector<HTMLInputElement>('[aria-label="NodeSeek 投票"] input[aria-label="投票标题"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(pollTitle, '设备验收投票');
      pollTitle?.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector<HTMLButtonElement>('[aria-label="NodeSeek 投票"] .primary')?.click();
    });
    await toolbarAction('stardust');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Stardust 收款卡片"] .primary')?.click());

    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    expect(host.querySelector('[data-composer-node="pending-nodeseek-poll"]')).not.toBeNull();
    expect(host.querySelector('[data-composer-node="nodeseek-stardust"]')).not.toBeNull();
    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'source-node-atoms' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'source-node-atoms'
      );
    expect(snapshot.payload.snapshot.markdown).toMatch(/\| 表格\s+\| 通过\s+\|\n{2,}<!-- wz:nodeseek-poll:/);
    expect(snapshot.payload.snapshot.markdown).toContain('\n\nnsapp://stardust-receive?');
  });

  it('keeps a writable paragraph after a terminal table across mode changes', async () => {
    const markdown = '| 表头 1 | 表头 2 |\n| --- | ---: |\n| 内容 1 | 内容 2 |';
    const { host, postMessage, send } = await mountRuntime({ markdown, site: 'nodeseek' });
    const editor = host.querySelector<HTMLElement>('.composer-document')!;

    expect(editor.lastElementChild?.tagName).toBe('P');

    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    await act(async () => new Promise(requestAnimationFrame));
    expect(editor.lastElementChild?.tagName).toBe('P');

    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'terminal-table' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'terminal-table'
      );
    expect(snapshot.payload.snapshot.markdown).toContain('| 表头 1 | 表头 2 |');
    expect(snapshot.payload.snapshot.markdown).toContain('| 内容 1 | 内容 2 |');
  });

  it('keeps rich document synchronization out of the user undo history', async () => {
    const markdown = '| 表头 |\n| --- |\n| 内容 |';
    const { postMessage, send } = await mountRuntime({ markdown, site: 'nodeseek' });
    const latestState = () =>
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast((entry: { type: string }) => entry.type === 'STATE_CHANGED');
    const snapshot = (requestId: string) =>
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .findLast(
          (entry: { type: string; payload?: { requestId?: string } }) =>
            entry.type === 'SNAPSHOT' && entry.payload?.requestId === requestId
        ).payload.snapshot.markdown as string;

    expect(latestState().payload.canUndo).toBe(false);
    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    await act(async () => new Promise(requestAnimationFrame));
    expect(latestState().payload.canUndo).toBe(false);

    await send({ type: 'COMMAND', payload: { name: 'undo' } });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'rich-sync-undo' } });
    expect(snapshot('rich-sync-undo')).toMatch(/\|\s*内容\s*\|/);

    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '用户输入' } });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'rich-user-input' } });
    expect(snapshot('rich-user-input')).toContain('用户输入');
    await send({ type: 'COMMAND', payload: { name: 'undo' } });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'rich-user-undo' } });
    expect(snapshot('rich-user-undo')).not.toContain('用户输入');
    expect(snapshot('rich-user-undo')).toMatch(/\|\s*内容\s*\|/);
  });

  it('keeps the first remaining row as the mandatory GFM header', () => {
    const editor = new Editor({
      extensions: composerEditorExtensions(),
      content: '| Header A | Header B |\n| --- | --- |\n| Body A | Body B |',
      contentType: 'markdown',
      injectCSS: false
    });
    editors.push(editor);

    editor.commands.setTextSelection(3);
    editor.commands.deleteRow();

    expect(editor.getMarkdown().split('\n').find(Boolean)).toContain('Body A');
  });

  it('applies alignment to the complete GFM column', () => {
    const editor = new Editor({
      extensions: composerEditorExtensions(),
      content: '| H1 | H2 | H3 |\n| --- | --- | --- |\n| A1 | A2 | A3 |\n| B1 | B2 | B3 |',
      contentType: 'markdown',
      injectCSS: false
    });
    editors.push(editor);
    let thirdColumnPosition = 0;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === 'B3') thirdColumnPosition = position;
    });
    editor.commands.setTextSelection(thirdColumnPosition);

    setGfmColumnAlignment(editor, 'center');

    const alignments: unknown[] = [];
    editor.state.doc.firstChild?.forEach((row) => alignments.push(row.child(2).attrs.align));
    expect(alignments).toEqual(['center', 'center', 'center']);
    expect(editor.getMarkdown()).toContain('| --- | --- | :---: |');
  });

  it('rejects merged HTML tables before paste changes the document', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    expect(sanitizePastedHtml('<table><tr><td colspan="2">x</td></tr></table>')).toBe('');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(sanitizePastedHtml('<p onclick="evil()">safe<script>evil()</script></p>')).toBe('<p>safe</p>');
  });

  it('authorizes Tiptap styles and keeps the caret separator inline', async () => {
    const { host } = await mountRuntime({ runtimeStyle: true, site: 'nodeseek' });
    const separator = document.createElement('img');
    separator.className = 'ProseMirror-separator';
    host.querySelector('.composer-document')?.append(separator);

    expect(document.querySelector<HTMLStyleElement>('style[data-tiptap-style]')?.nonce).toBe('wz-composer-runtime');
    expect(getComputedStyle(separator).display).toBe('inline');
    expect(getComputedStyle(separator).marginTop).toBe('0px');
    expect(getComputedStyle(separator).marginBottom).toBe('0px');
  });

  it('runs NodeSeek business tools from native toolbar commands', async () => {
    const { host, postMessage, send, toolbarAction, toolbarState } = await mountRuntime({
      runtimeStyle: true,
      site: 'nodeseek',
      theme: { ...TEST_THEME, fontScale: 1.3 }
    });

    await toolbarAction('poll');
    const pollBuilder = host.querySelector<HTMLElement>('[role="dialog"][aria-label="NodeSeek 投票"]');
    expect(pollBuilder?.querySelectorAll('input[aria-label^="投票选项 "]')).toHaveLength(2);
    expect(pollBuilder?.querySelector<HTMLInputElement>('input[aria-label="投票选项 1"]')?.value).toBe('选项一');
    expect(pollBuilder?.querySelector<HTMLInputElement>('input[aria-label="投票选项 2"]')?.value).toBe('选项二');
    await act(async () => pollBuilder?.querySelector<HTMLButtonElement>('button[aria-label="添加投票选项"]')?.click());
    expect(pollBuilder?.querySelectorAll('input[aria-label^="投票选项 "]')).toHaveLength(3);
    await act(async () =>
      pollBuilder?.querySelector<HTMLButtonElement>('button[aria-label="删除投票选项 3"]')?.click()
    );
    expect(pollBuilder?.querySelectorAll('input[aria-label^="投票选项 "]')).toHaveLength(2);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="NodeSeek 投票"] .primary')?.click());
    expect(host.querySelector('[aria-label="NodeSeek 投票"] .error')?.textContent).toBe('请输入投票标题');
    await act(async () => {
      host
        .querySelector<HTMLInputElement>('[aria-label="NodeSeek 投票"] input[aria-label="投票标题"]')
        ?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelector('[aria-label="NodeSeek 投票"] .error')).toBeNull();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="NodeSeek 投票"] button[aria-label="关闭"]')?.click()
    );

    const editable = host.querySelector<HTMLElement>('.ProseMirror')!;
    await toolbarAction('heading-2');
    expect(host.querySelector('h2')).not.toBeNull();
    expect(document.activeElement).toBe(editable);
    expect(toolbarState().heading).toBe(2);

    await toolbarAction('link');
    const linkPopover = document.querySelector<HTMLElement>('[aria-label="链接设置"]');
    expect(linkPopover).not.toBeNull();
    const linkInput = linkPopover?.querySelector<HTMLInputElement>('input[type="url"]');
    linkInput?.focus();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(linkInput, 'not-a-url');
      linkInput?.dispatchEvent(new Event('input', { bubbles: true }));
      linkPopover?.querySelector<HTMLButtonElement>('button[aria-label="应用链接"]')?.click();
    });
    expect(linkPopover?.querySelector('.error')?.textContent).toBe('请输入完整的 http/https 链接');
    expect(linkInput?.getAttribute('aria-invalid')).toBe('true');
    expect(linkPopover?.querySelector('[role="alert"]')?.id).toBe(linkInput?.getAttribute('aria-describedby'));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(linkInput, 'https://example.com');
      linkInput?.dispatchEvent(new Event('input', { bubbles: true }));
      linkPopover?.querySelector<HTMLButtonElement>('button[aria-label="应用链接"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('a[href="https://example.com"]')?.textContent).toBe('链接文字');
    expect(document.querySelector('[aria-label="链接设置"]')).toBeNull();
    expect(document.activeElement).toBe(editable);

    await toolbarAction('ordered-list');
    expect(host.querySelector('ol')).not.toBeNull();
    expect(document.activeElement).toBe(editable);
    await send({ type: 'COMMAND', payload: { name: 'undo' } });
    expect(host.querySelector('ol')).toBeNull();
    await send({ type: 'COMMAND', payload: { name: 'redo' } });
    expect(host.querySelector('ol')).not.toBeNull();
    expect(host.querySelector('a[href="https://example.com"]')).not.toBeNull();

    editable.focus();
    expect(document.activeElement).toBe(editable);
    await send({ type: 'COMMAND', payload: { name: 'blur' } });
    expect(document.activeElement).not.toBe(editable);

    await toolbarAction('emoji');
    const stickerPanel = host.querySelector<HTMLElement>('[role="dialog"][aria-label="NodeSeek 贴纸"]');
    const stickerImage = stickerPanel?.querySelector<HTMLImageElement>('button[aria-label="ac01"] img');
    const acGrid = stickerImage?.closest<HTMLElement>('.expression-grid');
    const onionGrid = stickerPanel
      ?.querySelector<HTMLButtonElement>('button[aria-label="yct001"]')
      ?.closest<HTMLElement>('.expression-grid');
    expect(stickerPanel).not.toBeNull();
    expect(getComputedStyle(acGrid!).display).toBe('grid');
    expect(getComputedStyle(onionGrid!).display).toBe('none');
    await act(async () =>
      [...(stickerPanel?.querySelectorAll<HTMLButtonElement>('.category-rail button') ?? [])]
        .find((button) => button.textContent === '洋葱头')
        ?.click()
    );
    expect(getComputedStyle(acGrid!).display).toBe('none');
    expect(getComputedStyle(onionGrid!).display).toBe('grid');
    await act(async () =>
      [...(stickerPanel?.querySelectorAll<HTMLButtonElement>('.category-rail button') ?? [])]
        .find((button) => button.textContent === 'AC娘')
        ?.click()
    );
    const expressionFocus = document.activeElement;
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="ac01"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    const insertedSticker = host.querySelector<HTMLElement>('[data-composer-node="forum-expression"]');
    expect(insertedSticker?.querySelector('img')?.getAttribute('src')).toBe(
      'https://www.nodeseek.com/static/image/sticker/ac/01.png'
    );
    expect(document.activeElement).toBe(expressionFocus);
    expect(stickerPanel?.closest<HTMLElement>('[data-expression-cache]')?.hidden).toBe(false);
    const originalURL = URL;
    vi.stubGlobal(
      'URL',
      vi.fn(() => {
        throw new Error('custom schemes are not parseable in this WebView');
      })
    );
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await toolbarAction('stardust');
    random.mockRestore();
    const stardustBuilder = host.querySelector<HTMLElement>('[aria-label="Stardust 收款卡片"]');
    const refInput = [...(stardustBuilder?.querySelectorAll('label') ?? [])]
      .find((label) => label.textContent?.includes('Ref ID'))
      ?.querySelector<HTMLInputElement>('input');
    expect(refInput?.value).toBe('50000100');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(refInput, '123456');
      refInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Stardust 收款卡片"] .primary')?.click());
    vi.stubGlobal('URL', originalURL);
    const stardustCard = host.querySelector<HTMLElement>('[data-composer-node="nodeseek-stardust"]');
    expect(stardustCard?.textContent).toContain('1 Stardust 收款卡片');
    expect(stardustCard?.textContent).toContain('收款人 #54874 · Ref 123456');
    const elementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => stardustCard });
    await act(async () => {
      stardustCard?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 })
      );
      stardustCard?.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 })
      );
      await new Promise(requestAnimationFrame);
    });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: elementFromPoint });
    const editRandom = vi.spyOn(Math, 'random').mockReturnValue(0.75);
    await toolbarAction('stardust');
    editRandom.mockRestore();
    const editedRefInput = [
      ...(host.querySelector('[aria-label="Stardust 收款卡片"]')?.querySelectorAll('label') ?? [])
    ]
      .find((label) => label.textContent?.includes('Ref ID'))
      ?.querySelector<HTMLInputElement>('input');
    expect(editedRefInput?.value).toBe('123456');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Stardust 收款卡片"] button[aria-label="关闭"]')?.click()
    );
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'node-capabilities' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'node-capabilities'
      );
    expect(snapshot.payload.snapshot.markdown).toContain(':ac01:');
    expect(snapshot.payload.snapshot.markdown).toContain(
      'nsapp://stardust-receive?member_id=54874&ref_id=123456&description=Pay+with+Stardust&diff=1&onetime=false'
    );

    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    const sourceEditor = host.querySelector<HTMLElement>('.source-pane .cm-editor')!;
    const sourceContent = sourceEditor.querySelector<HTMLElement>('.cm-content')!;
    expect(document.activeElement).toBe(sourceContent);
    const codeMirrorStyle = [...document.querySelectorAll<HTMLStyleElement>('style')].find((style) =>
      style.textContent.includes('.cm-content')
    );
    expect(codeMirrorStyle?.nonce).toBe('wz-composer-runtime');

    await toolbarAction('emoji');
    const sourceExpressionFocus = document.activeElement;
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="ac02"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    expect(document.activeElement).toBe(sourceExpressionFocus);
    expect(sourceContent.textContent).toContain(':ac02:');

    await toolbarAction('ordered-list');
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'source-list' } });
    const sourceListSnapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'source-list'
      );
    expect(sourceListSnapshot.payload.snapshot.markdown).toMatch(/:ac02:\n\n1\. 列表项\n\n/);
    expect(document.activeElement).toBe(sourceContent);

    await toolbarAction('table');
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'source-gfm-table' } });
    const sourceTableSnapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'source-gfm-table'
      );
    expect(sourceTableSnapshot.payload.snapshot.markdown).toMatch(/\n\n\| 表头 1 \| 表头 2 \|/);
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    expect(host.querySelector('table')).not.toBeNull();

    await toolbarAction('emoji');
    expect(host.querySelector('[role="dialog"][aria-label="NodeSeek 贴纸"]')).toBe(stickerPanel);
    expect(stickerPanel?.querySelector<HTMLImageElement>('button[aria-label="ac01"] img')).toBe(stickerImage);
    await act(async () => stickerPanel?.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click());
  });

  it('keeps table commands contextual and the document strict GFM', async () => {
    const { host, postMessage, send, toolbarAction, toolbarState } = await mountRuntime({
      nodeSeekMemberId: null,
      runtimeStyle: true,
      site: 'nodeseek'
    });

    await toolbarAction('table');
    expect(host.querySelector('button[aria-label="表头"]')).toBeNull();
    expect(toolbarState().table).toBe(true);
    const editable = host.querySelector<HTMLElement>('.ProseMirror')!;
    expect(document.activeElement).toBe(editable);
    const tableActions = document.querySelector('[role="toolbar"][aria-label="表格操作"]');
    expect(tableActions).not.toBeNull();
    expect(host.querySelector('[role="dialog"][aria-label="表格操作"]')).toBeNull();
    expect(tableActions?.querySelector('button[aria-label="行操作"]')).not.toBeNull();
    expect(tableActions?.querySelector('button[aria-label="列操作"]')).not.toBeNull();
    expect(tableActions?.querySelector('button[aria-label="列对齐"]')).not.toBeNull();
    expect(tableActions?.querySelector('button[aria-label="删除整个表格"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="合并单元格"]')).toBeNull();
    expect(document.querySelector('button[aria-label="拆分单元格"]')).toBeNull();
    const selectTableMenuItem = async (triggerLabel: string, itemLabel: string) => {
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>(
            `[role="toolbar"][aria-label="表格操作"] button[aria-label="${triggerLabel}"]`
          )
          ?.click();
        await new Promise(requestAnimationFrame);
      });
      const item = document.querySelector<HTMLButtonElement>(
        `[role="menu"][aria-label="${triggerLabel}"] button[aria-label="${itemLabel}"]`
      );
      expect(item?.disabled).toBe(false);
      await act(async () => {
        item?.click();
        await new Promise(requestAnimationFrame);
      });
    };

    const tableCount = host.querySelectorAll('table').length;
    await toolbarAction('table');
    expect(host.querySelectorAll('table')).toHaveLength(tableCount);

    const rowCount = host.querySelectorAll('table tr').length;
    await selectTableMenuItem('行操作', '在下方插入');
    expect(host.querySelectorAll('table tr')).toHaveLength(rowCount + 1);
    expect(document.querySelector('[role="toolbar"][aria-label="表格操作"]')).toBe(tableActions);
    expect(document.activeElement).toBe(editable);
    await selectTableMenuItem('行操作', '删除当前行');
    expect(host.querySelectorAll('table tr')).toHaveLength(rowCount);
    await selectTableMenuItem('行操作', '在上方插入');
    expect(host.querySelectorAll('table tr')).toHaveLength(rowCount + 1);
    await selectTableMenuItem('行操作', '删除当前行');
    expect(host.querySelectorAll('table tr')).toHaveLength(rowCount);

    const columnCount = host.querySelectorAll('table tr:first-child > *').length;
    await selectTableMenuItem('列操作', '在右侧插入');
    expect(host.querySelectorAll('table tr:first-child > *')).toHaveLength(columnCount + 1);
    await selectTableMenuItem('列操作', '删除当前列');
    expect(host.querySelectorAll('table tr:first-child > *')).toHaveLength(columnCount);
    await selectTableMenuItem('列操作', '在左侧插入');
    expect(host.querySelectorAll('table tr:first-child > *')).toHaveLength(columnCount + 1);
    await selectTableMenuItem('列操作', '删除当前列');
    expect(host.querySelectorAll('table tr:first-child > *')).toHaveLength(columnCount);

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="toolbar"][aria-label="表格操作"] button[aria-label="列对齐"]')
        ?.click();
      await new Promise(requestAnimationFrame);
    });
    const alignmentMenu = document.querySelector('[role="menu"][aria-label="列对齐"]');
    expect(alignmentMenu?.querySelector('button[aria-label="左对齐"]')?.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      alignmentMenu?.querySelector<HTMLButtonElement>('button[aria-label="居中"]')?.click();
      await new Promise(requestAnimationFrame);
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'gfm-table' } })
        })
      );
    });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'gfm-table'
      );
    expect(snapshot.payload.snapshot.markdown).toContain(':---:');

    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    expect(document.querySelector('[role="toolbar"][aria-label="表格操作"]')).toBeNull();
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    expect(document.querySelector('[role="toolbar"][aria-label="表格操作"]')).not.toBeNull();

    await send({
      type: 'INIT',
      payload: {
        site: 'nodeseek',
        intentKind: 'reply',
        markdown: '',
        pendingNodeSeekPolls: [],
        mode: 'rich',
        discourseEmoji: [],
        theme: {
          dark: false,
          ink: '#111111',
          muted: '#666666',
          surface: '#ffffff',
          surface2: '#f5f5f5',
          line: '#dddddd',
          primary: '#1267d6',
          primarySoft: '#e8f2ff',
          danger: '#b3261e',
          fontScale: 1
        }
      }
    });
    expect(document.querySelector('[role="toolbar"][aria-label="表格操作"]')).toBeNull();
    expect(toolbarState().table).toBe(false);
    expect(host.querySelector('table')).toBeNull();
  });

  it('runs LinuxDo business tools from native toolbar commands', async () => {
    const { host, postMessage, send, toolbarAction } = await mountRuntime({
      markdown: 'draft :grinning_face:',
      runtimeStyle: true,
      theme: { ...TEST_THEME, fontScale: 1.3 }
    });
    const existingExpression = host.querySelector<HTMLElement>('[data-composer-node="forum-expression"]');
    expect(existingExpression?.querySelector('img')).toBeNull();

    await send({
      type: 'COMMAND',
      payload: {
        name: 'set-discourse-emoji',
        discourseEmoji: [{ name: 'grinning_face', url: 'https://linux.do/images/emoji/grinning-face.png' }]
      }
    });
    expect(host.querySelector('[data-composer-node="forum-expression"]')).toBe(existingExpression);
    expect(existingExpression?.querySelector('img')?.getAttribute('src')).toBe(
      'https://linux.do/images/emoji/grinning-face.png'
    );

    await toolbarAction('emoji');
    const emojiPanel = host.querySelector<HTMLElement>('[role="dialog"][aria-label="LinuxDo Emoji"]');
    const emojiImage = emojiPanel?.querySelector<HTMLImageElement>('button[aria-label="grinning face"] img');
    expect(emojiPanel).not.toBeNull();
    expect(emojiPanel?.querySelector<HTMLInputElement>('input[aria-label="搜索 Emoji"]')?.placeholder).toBe('搜索表情');
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="grinning face"]')?.click());
    expect(host.querySelector<HTMLElement>('[data-composer-node="forum-expression"] img')?.getAttribute('src')).toBe(
      'https://linux.do/images/emoji/grinning-face.png'
    );
    expect(host.querySelector('.composer-document')?.textContent).toContain('draft');
    expect(emojiPanel?.closest<HTMLElement>('[data-expression-cache]')?.hidden).toBe(false);
    await toolbarAction('poll');
    const linuxPollBuilder = host.querySelector<HTMLElement>('[role="dialog"][aria-label="LinuxDo 投票"]');
    expect(linuxPollBuilder?.querySelectorAll('input[aria-label^="投票选项 "]')).toHaveLength(2);
    await act(async () =>
      linuxPollBuilder?.querySelector<HTMLButtonElement>('button[aria-label="添加投票选项"]')?.click()
    );
    expect(linuxPollBuilder?.querySelectorAll('input[aria-label^="投票选项 "]')).toHaveLength(3);
    await act(async () =>
      linuxPollBuilder?.querySelector<HTMLButtonElement>('button[aria-label="删除投票选项 3"]')?.click()
    );
    expect(linuxPollBuilder?.querySelectorAll('input[aria-label^="投票选项 "]')).toHaveLength(2);
    await act(async () => linuxPollBuilder?.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click());

    await toolbarAction('table');
    expect(document.querySelector('[role="toolbar"][aria-label="表格操作"]')).not.toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="toolbar"][aria-label="表格操作"] button[aria-label="删除整个表格"]')
        ?.click();
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('table')).toBeNull();

    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'linuxdo-capabilities' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'linuxdo-capabilities'
      );
    expect(snapshot.payload.snapshot.markdown).toContain(':grinning_face:');

    await toolbarAction('private');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="LinuxDo 正文工具"] button[aria-label="硬换行"]')?.click()
    );
    expect(host.querySelector('.ProseMirror br')).not.toBeNull();
    expect(host.querySelector('.ProseMirror')?.textContent).not.toContain('\\');

    await toolbarAction('emoji');
    expect(host.querySelector('[role="dialog"][aria-label="LinuxDo Emoji"]')).toBe(emojiPanel);
    expect(emojiPanel?.querySelector<HTMLImageElement>('button[aria-label="grinning face"] img')).toBe(emojiImage);
    await act(async () => emojiPanel?.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click());
  });

  it('keeps adjacent private blocks and returns insertion to trailing text', async () => {
    const { host, postMessage, send, toolbarAction } = await mountRuntime();

    await toolbarAction('private');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('[aria-label="LinuxDo 正文工具"] button')]
        .find((button) => button.textContent === 'Details')
        ?.click()
    );
    await toolbarAction('private');
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('[aria-label="LinuxDo 正文工具"] button')]
        .find((button) => button.textContent === 'Spoiler')
        ?.click()
    );
    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '尾部文字' } });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'private-blocks' } });

    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'private-blocks'
      );
    expect(snapshot.payload.snapshot.markdown).toContain('[details="详情"]');
    expect(snapshot.payload.snapshot.markdown).toContain('[spoiler]');
    expect(snapshot.payload.snapshot.markdown).toContain('尾部文字');
    expect(host.querySelectorAll('[data-composer-node="forum-private-block"]')).toHaveLength(2);
  });

  it('excludes rich-to-source synchronization from CodeMirror undo', async () => {
    const { postMessage, send } = await mountRuntime({ markdown: '保留正文' });

    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    await send({ type: 'COMMAND', payload: { name: 'undo' } });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'source-undo' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'source-undo'
      );
    expect(snapshot.payload.snapshot.markdown).toBe('保留正文');

    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '新增' } });
    await send({ type: 'COMMAND', payload: { name: 'undo' } });
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'source-user-undo' } });
    const userUndoSnapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'source-user-undo'
      );
    expect(userUndoSnapshot.payload.snapshot.markdown).toBe('保留正文');
  });

  it('loads the searchable LinuxDo group chooser and derives a truthful poll card', async () => {
    const { host, postMessage, send, toolbarAction } = await mountRuntime();

    await toolbarAction('poll');
    const request = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { action?: string } }) =>
          entry.type === 'REQUEST_HOST_ACTION' && entry.payload?.action === 'load-linuxdo-poll-capabilities'
      );
    expect(request).toBeDefined();
    await send({
      type: 'COMMAND',
      payload: {
        name: 'host-action-result',
        requestId: request.payload.requestId,
        result: {
          groups: [
            { id: 10, name: 'staff', displayName: '管理人员' },
            { id: 11, name: 'trust_level_1', displayName: '信任级别 1' },
            { id: 12, name: 'designers', displayName: '设计团队' }
          ],
          canUseStaffResults: false,
          maxOptions: 2,
          defaultPublic: true,
          canCreate: true,
          minTrust: 1
        }
      }
    });

    const builder = host.querySelector<HTMLElement>('[role="dialog"][aria-label="LinuxDo 投票"]')!;
    expect(builder.querySelector('select')).toBeNull();
    expect(builder.querySelector<HTMLButtonElement>('button[aria-label="添加投票选项"]')?.disabled).toBe(true);
    await act(async () => builder.querySelector<HTMLButtonElement>('button[aria-label="展开高级设置"]')?.click());
    const groupTrigger = builder.querySelector<HTMLButtonElement>('button[aria-label="允许用户组"]');
    expect(groupTrigger).not.toBeNull();
    await act(async () => groupTrigger?.click());
    const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索允许用户组"]');
    expect(search).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, '信任');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const groupOption = document.querySelector<HTMLButtonElement>('button[aria-label="选择用户组 信任级别 1"]');
    expect(groupOption).not.toBeNull();
    expect(groupOption?.textContent).toContain('信任级别 1');
    await act(async () => groupOption?.click());
    const selectedGroup = builder.querySelector<HTMLButtonElement>('button[aria-label="移除用户组 信任级别 1"]');
    expect(selectedGroup).not.toBeNull();
    expect(groupTrigger?.textContent).toContain('信任级别 1');
    await act(async () => selectedGroup?.click());
    expect(builder.querySelector('button[aria-label="移除用户组 信任级别 1"]')).toBeNull();
    await act(async () => groupOption?.click());
    expect(document.querySelector('button[aria-label="仅 Staff"]')).toBeNull();

    const title = builder.querySelector<HTMLInputElement>('input[aria-label="投票标题"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(title, '真实标题');
      title?.dispatchEvent(new Event('input', { bubbles: true }));
      builder.querySelector<HTMLButtonElement>('.primary')?.click();
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('[data-composer-node="forum-private-block"]')?.textContent).toContain('真实标题');
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'linuxdo-poll' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'linuxdo-poll'
      );
    expect(snapshot.payload.snapshot.markdown).toContain('groups=trust_level_1');
    expect(snapshot.payload.snapshot.markdown).toContain('public=true');
    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    expect(host.querySelector('[data-composer-node="forum-private-block"]')?.textContent).toContain('真实标题');
    await toolbarAction('poll');
    expect(
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .filter(
          (entry: { type: string; payload?: { action?: string } }) =>
            entry.type === 'REQUEST_HOST_ACTION' && entry.payload?.action === 'load-linuxdo-poll-capabilities'
        )
    ).toHaveLength(1);
  });

  it('retries a failed LinuxDo group load without adding a lifecycle state machine', async () => {
    const { host, postMessage, send, toolbarAction } = await mountRuntime();
    await toolbarAction('poll');
    const firstRequest = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((entry: { type: string }) => entry.type === 'REQUEST_HOST_ACTION');
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: firstRequest.payload.requestId, error: '读取失败' }
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="LinuxDo 投票"] .inline-retry button')?.click()
    );
    expect(
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .filter(
          (entry: { type: string; payload?: { action?: string } }) =>
            entry.type === 'REQUEST_HOST_ACTION' && entry.payload?.action === 'load-linuxdo-poll-capabilities'
        )
    ).toHaveLength(2);
  });

  it('incrementally exposes the complete LinuxDo Emoji directory', async () => {
    const discourseEmoji = Array.from({ length: 250 }, (_, index) => ({
      name: `emoji_${String(index).padStart(3, '0')}`,
      url: `https://linux.do/images/emoji/${index}.png`
    }));
    const { host, toolbarAction } = await mountRuntime({ discourseEmoji });

    await toolbarAction('emoji');
    const panel = host.querySelector<HTMLElement>('[role="dialog"][aria-label="LinuxDo Emoji"]')!;
    const firstImage = panel.querySelector<HTMLImageElement>('button[aria-label="emoji 000"] img');
    expect(panel.querySelectorAll('.expression-grid .tiptap-button')).toHaveLength(120);
    await act(async () => {
      const scroller = panel.querySelector<HTMLElement>('.builder-body')!;
      Object.defineProperties(scroller, {
        clientHeight: { configurable: true, value: 400 },
        scrollHeight: { configurable: true, value: 800 },
        scrollTop: { configurable: true, value: 400 }
      });
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(panel.querySelectorAll('.expression-grid .tiptap-button')).toHaveLength(240);
    await act(async () => panel.querySelector<HTMLButtonElement>('button[aria-label="加载更多 Emoji"]')?.click());
    expect(panel.querySelectorAll('.expression-grid .tiptap-button')).toHaveLength(250);
    await act(async () => panel.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click());
    await toolbarAction('emoji');
    expect(panel.querySelector<HTMLImageElement>('button[aria-label="emoji 000"] img')).toBe(firstImage);

    const search = panel.querySelector<HTMLInputElement>('input[aria-label="搜索 Emoji"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'emoji_249');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(panel.querySelector('button[aria-label="emoji 249"]')).not.toBeNull();
  });
});
