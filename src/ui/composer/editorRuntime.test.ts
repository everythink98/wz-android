import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Editor } from '@tiptap/core';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ComposerEditorRuntime,
  composerEditorExtensions,
  sanitizePastedHtml,
  setGfmColumnAlignment,
  tableMenuViewportPadding
} from './editorRuntime';

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
  markdown = '',
  mode = 'rich',
  nodeSeekMemberId,
  runtimeStyle = false,
  site = 'linuxdo',
  theme = TEST_THEME,
  waitForFrame = true
}: {
  discourseEmoji?: { name: string; url: string }[];
  markdown?: string;
  mode?: 'rich' | 'source';
  nodeSeekMemberId?: string | null;
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
  const send = async (message: unknown) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
      if (waitForFrame) await new Promise(requestAnimationFrame);
    });
  };
  await act(async () => root.render(createElement(ComposerEditorRuntime)));
  await send({
    type: 'INIT',
    payload: {
      site,
      intentKind: 'reply',
      markdown,
      pendingNodeSeekPolls: [],
      mode,
      ...(site === 'nodeseek' && nodeSeekMemberId !== null ? { nodeSeekMemberId: nodeSeekMemberId || '54874' } : {}),
      discourseEmoji,
      theme
    }
  });
  return { host, postMessage, root, send };
}

describe('Composer editor runtime codec', () => {
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
      extensions: composerEditorExtensions,
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
      extensions: composerEditorExtensions,
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
    const { host, postMessage, root, send } = await mountRuntime({ markdown, mode: 'source' });

    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'code-validation' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'code-validation'
      );

    expect(snapshot.payload.snapshot.validationIssues).toEqual([]);
    await act(async () => root.unmount());
    host.remove();
  });

  it('still rejects active private syntax outside code', async () => {
    const { host, postMessage, root, send } = await mountRuntime({ markdown: '[poll', mode: 'source' });

    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'active-validation' } });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'active-validation'
      );

    expect(snapshot.payload.snapshot.validationIssues).toContainEqual(
      expect.objectContaining({ code: 'linuxdo-poll' })
    );
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps a legacy Stardust card readable but blocks publishing its invalid Ref', async () => {
    const markdown =
      'nsapp://stardust-receive?member_id=54874&ref_id=1&description=Pay+with+Stardust&diff=1&onetime=false';
    const { host, postMessage, root, send } = await mountRuntime({ markdown, mode: 'source', site: 'nodeseek' });

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
    await act(async () => root.unmount());
    host.remove();
  });

  it('maps a pending source upload and rejects a mode switch without losing edits', async () => {
    const { host, postMessage, root, send } = await mountRuntime({ markdown: '保留正文', mode: 'source' });

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="图片"]')?.click());
    const uploadRequest = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { action?: string } }) =>
          entry.type === 'REQUEST_HOST_ACTION' && entry.payload?.action === 'upload-image'
      );
    await send({ type: 'COMMAND', payload: { name: 'insert-markdown', markdown: '用户输入' } });
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
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

    await act(async () => root.unmount());
    host.remove();
  });

  it('inserts a LinuxDo template before its usage counter settles', async () => {
    const { host, postMessage, root, send } = await mountRuntime({ markdown: '已有正文' });

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="动态模板"]')?.click());
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

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps a line-leading LinuxDo date in its dedicated inline node', () => {
    const raw = '[date=2026-08-26 time=12:00:00 timezone="Asia/Shanghai"]';
    const editor = new Editor({
      extensions: composerEditorExtensions,
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
      extensions: composerEditorExtensions,
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
      extensions: composerEditorExtensions,
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
    const { host, postMessage, root, send } = await mountRuntime({ mode: 'source', site: 'nodeseek' });
    await send({
      type: 'COMMAND',
      payload: {
        name: 'insert-markdown',
        markdown: '| 验收项 | 结果 |\n| --- | --- |\n| 表格 | 通过 |'
      }
    });

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="投票"]')?.click());
    const pollTitle = host.querySelector<HTMLInputElement>('[aria-label="NodeSeek 投票"] input[aria-label="投票标题"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(pollTitle, '设备验收投票');
      pollTitle?.dispatchEvent(new Event('input', { bubbles: true }));
      host.querySelector<HTMLButtonElement>('[aria-label="NodeSeek 投票"] .primary')?.click();
    });
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Stardust 收款"]')?.click());
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

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps a writable paragraph after a terminal table across mode changes', async () => {
    const markdown = '| 表头 1 | 表头 2 |\n| --- | ---: |\n| 内容 1 | 内容 2 |';
    const { host, postMessage, root, send } = await mountRuntime({ markdown, site: 'nodeseek' });
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

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps rich document synchronization out of the user undo history', async () => {
    const markdown = '| 表头 |\n| --- |\n| 内容 |';
    const { host, postMessage, root, send } = await mountRuntime({ markdown, site: 'nodeseek' });
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

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the first remaining row as the mandatory GFM header', () => {
    const editor = new Editor({
      extensions: composerEditorExtensions,
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
      extensions: composerEditorExtensions,
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

  it('reserves the sticky toolbar when positioning table actions', () => {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar-stack';
    toolbar.getBoundingClientRect = () => ({
      bottom: 72,
      height: 72,
      left: 0,
      right: 360,
      top: 0,
      width: 360,
      x: 0,
      y: 0,
      toJSON: () => ({})
    });
    document.body.append(toolbar);

    expect(tableMenuViewportPadding()).toEqual({ top: 80, right: 8, bottom: 8, left: 8 });
    toolbar.remove();
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

  it('renders NodeSeek business tools on the shared scrolling toolbar', async () => {
    const { host, postMessage, root } = await mountRuntime({
      runtimeStyle: true,
      site: 'nodeseek',
      theme: { ...TEST_THEME, fontScale: 1.3 }
    });

    const commonToolbar = host.querySelector('[aria-label="回复常用工具栏"]');
    const labels = [...host.querySelectorAll<HTMLButtonElement>('.toolbar-shell button')].map((button) =>
      button.getAttribute('aria-label')
    );
    expect(labels).not.toContain('插入');
    expect(labels).toEqual(
      expect.arrayContaining(['删除线', '列表选项', '代码块', '分隔线', '表格', '投票', 'Stardust 收款'])
    );
    expect(labels).not.toContain('下划线');
    expect(labels).not.toEqual(expect.arrayContaining(['有序列表', '任务列表']));
    expect(host.querySelector('select[aria-label="段落与标题"]')).toBeNull();
    expect(getComputedStyle(host.querySelector<HTMLButtonElement>('button[aria-label="表情"]')!).minHeight).toBe(
      '48px'
    );

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="投票"]')?.click());
    const pollBuilder = host.querySelector<HTMLElement>('[role="dialog"][aria-label="NodeSeek 投票"]');
    expect(pollBuilder?.querySelector('textarea')).toBeNull();
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
    const headingButton = host.querySelector<HTMLButtonElement>('button[aria-label="段落与标题"]');
    expect(headingButton?.textContent).toContain('正文');
    const headingMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    expect(headingButton?.dispatchEvent(headingMouseDown)).toBe(false);
    expect(headingMouseDown.defaultPrevented).toBe(true);
    let headingPointerDown: Event | undefined;
    await act(async () => {
      headingPointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperty(headingPointerDown, 'pointerType', { value: 'touch' });
      Object.defineProperty(headingPointerDown, 'button', { value: 0 });
      Object.defineProperty(headingPointerDown, 'ctrlKey', { value: false });
      expect(headingButton?.dispatchEvent(headingPointerDown)).toBe(true);
      headingButton?.click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    expect(headingPointerDown?.defaultPrevented).toBe(false);
    const headingMenu = document.querySelector('[role="menu"][aria-label="段落与标题选项"]');
    expect(headingMenu).not.toBeNull();
    expect(headingMenu?.closest('[role="dialog"]')).toBeNull();
    await act(async () => {
      headingMenu?.querySelector<HTMLButtonElement>('button[aria-label="标题 2"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('h2')).not.toBeNull();
    expect(document.activeElement).toBe(editable);
    expect(headingButton?.textContent).toContain('标题 2');
    expect(host.querySelector('[role="menu"][aria-label="段落与标题选项"]')).toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="链接"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    const linkPopover = document.querySelector<HTMLElement>('[aria-label="链接设置"]');
    expect(linkPopover).not.toBeNull();
    expect(host.querySelector('[role="dialog"][aria-label="插入链接"]')).toBeNull();
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

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="列表选项"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    const listMenu = document.querySelector('[role="menu"][aria-label="列表选项"]');
    expect(listMenu).not.toBeNull();
    expect(host.querySelector('[role="dialog"][aria-label="列表选项"]')).toBeNull();
    await act(async () => {
      listMenu?.querySelector<HTMLButtonElement>('button[aria-label="有序列表"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('ol')).not.toBeNull();
    expect(document.activeElement).toBe(editable);
    expect(host.querySelector('[aria-label="回复常用工具栏"]')).toBe(commonToolbar);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'COMMAND', payload: { name: 'undo' } }) })
      );
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('ol')).toBeNull();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'COMMAND', payload: { name: 'redo' } }) })
      );
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('ol')).not.toBeNull();
    expect(host.querySelector('a[href="https://example.com"]')).not.toBeNull();

    editable.focus();
    expect(document.activeElement).toBe(editable);
    const touchPointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(touchPointerDown, 'pointerType', { value: 'touch' });
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="粗体"]')?.dispatchEvent(touchPointerDown)).toBe(
      true
    );
    expect(touchPointerDown.defaultPrevented).toBe(false);
    const mousePointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(mousePointerDown, 'pointerType', { value: 'mouse' });
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="粗体"]')?.dispatchEvent(mousePointerDown)).toBe(
      false
    );
    expect(mousePointerDown.defaultPrevented).toBe(true);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'COMMAND', payload: { name: 'blur' } }) })
      );
      await new Promise(requestAnimationFrame);
    });
    expect(document.activeElement).not.toBe(editable);

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="表情"]')?.click());
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
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="ac01"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    const insertedSticker = host.querySelector<HTMLElement>('[data-composer-node="forum-expression"]');
    expect(insertedSticker?.querySelector('img')?.getAttribute('src')).toBe(
      'https://www.nodeseek.com/static/image/sticker/ac/01.png'
    );
    expect.soft(document.activeElement).toBe(editable);
    expect(stickerPanel?.closest<HTMLElement>('[data-expression-cache]')?.hidden).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="图片"]')?.click());
    const uploadRequest = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast((entry: { type: string }) => entry.type === 'REQUEST_HOST_ACTION');
    expect(uploadRequest.payload.action).toBe('upload-image');
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'COMMAND',
            payload: {
              name: 'host-action-result',
              requestId: uploadRequest.payload.requestId,
              result: { markdown: '![上传图片](https://example.com/image.png)' }
            }
          })
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector('img[src="https://example.com/image.png"]')).not.toBeNull();
    vi.stubGlobal(
      'URL',
      vi.fn(() => {
        throw new Error('custom schemes are not parseable in this WebView');
      })
    );
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Stardust 收款"]')?.click());
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
    vi.unstubAllGlobals();
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
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Stardust 收款"]')?.click());
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
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'node-capabilities' } })
        })
      );
    });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'node-capabilities'
      );
    expect(snapshot.payload.snapshot.markdown).toContain(':ac01:');
    expect(snapshot.payload.snapshot.markdown).toContain('![上传图片](https://example.com/image.png)');
    expect(snapshot.payload.snapshot.markdown).toContain(
      'nsapp://stardust-receive?member_id=54874&ref_id=123456&description=Pay+with+Stardust&diff=1&onetime=false'
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'SET_MODE', payload: { mode: 'source' } }) })
      );
      await new Promise(requestAnimationFrame);
    });
    const sourceEditor = host.querySelector<HTMLElement>('.source-pane .cm-editor')!;
    const sourceContent = sourceEditor.querySelector<HTMLElement>('.cm-content')!;
    expect(document.activeElement).toBe(sourceContent);
    const codeMirrorStyle = [...document.querySelectorAll<HTMLStyleElement>('style')].find((style) =>
      style.textContent.includes('.cm-content')
    );
    expect(codeMirrorStyle?.nonce).toBe('wz-composer-runtime');

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="表情"]')?.click());
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="ac02"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    expect(document.activeElement).toBe(sourceContent);
    expect(sourceContent.textContent).toContain(':ac02:');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="列表选项"]')?.click();
      await new Promise(requestAnimationFrame);
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="menu"][aria-label="列表选项"] button[aria-label="有序列表"]')
        ?.click();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'source-list' } })
        })
      );
    });
    const sourceListSnapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'source-list'
      );
    expect(sourceListSnapshot.payload.snapshot.markdown).toMatch(/:ac02:\n\n1\. 列表项\n\n/);
    expect(document.activeElement).toBe(sourceContent);

    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="表格"]')?.click();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'source-gfm-table' } })
        })
      );
    });
    const sourceTableSnapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'source-gfm-table'
      );
    expect(sourceTableSnapshot.payload.snapshot.markdown).toMatch(/\n\n\| 表头 1 \| 表头 2 \|/);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'SET_MODE', payload: { mode: 'rich' } }) })
      );
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('table')).not.toBeNull();

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="表情"]')?.click());
    expect(host.querySelector('[role="dialog"][aria-label="NodeSeek 贴纸"]')).toBe(stickerPanel);
    expect(stickerPanel?.querySelector<HTMLImageElement>('button[aria-label="ac01"] img')).toBe(stickerImage);
    await act(async () => stickerPanel?.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click());

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps table commands contextual and the document strict GFM', async () => {
    const { host, postMessage, root } = await mountRuntime({
      nodeSeekMemberId: null,
      runtimeStyle: true,
      site: 'nodeseek'
    });

    const toolbar = host.querySelector('[aria-label="回复常用工具栏"]');
    const tableButton = toolbar?.querySelector<HTMLButtonElement>('button[aria-label="表格"]');
    await act(async () => {
      tableButton?.click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });

    expect(host.querySelector('button[aria-label="表头"]')).toBeNull();
    expect(host.querySelector('[aria-label="回复常用工具栏"]')).toBe(toolbar);
    expect(tableButton?.getAttribute('aria-pressed')).toBe('true');
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
    await act(async () => {
      tableButton?.click();
      await new Promise(requestAnimationFrame);
    });
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

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'SET_MODE', payload: { mode: 'source' } }) })
      );
      await new Promise(requestAnimationFrame);
    });
    expect(document.querySelector('[role="toolbar"][aria-label="表格操作"]')).toBeNull();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ type: 'SET_MODE', payload: { mode: 'rich' } }) })
      );
      await new Promise(requestAnimationFrame);
    });
    expect(document.querySelector('[role="toolbar"][aria-label="表格操作"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
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
          })
        })
      );
      await new Promise(requestAnimationFrame);
    });
    expect(document.querySelector('[role="toolbar"][aria-label="表格操作"]')).toBeNull();
    expect(host.querySelector('[role="toolbar"][aria-label="回复常用工具栏"]')).not.toBeNull();
    expect(host.querySelector('table')).toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });

  it('renders LinuxDo business tools on the same common UI', async () => {
    const { host, postMessage, root } = await mountRuntime({
      markdown: 'draft :grinning_face:',
      runtimeStyle: true,
      theme: { ...TEST_THEME, fontScale: 1.3 }
    });
    const existingExpression = host.querySelector<HTMLElement>('[data-composer-node="forum-expression"]');
    expect(existingExpression?.querySelector('img')).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'COMMAND',
            payload: {
              name: 'set-discourse-emoji',
              discourseEmoji: [{ name: 'grinning_face', url: 'https://linux.do/images/emoji/grinning-face.png' }]
            }
          })
        })
      );
    });
    expect(host.querySelector('[data-composer-node="forum-expression"]')).toBe(existingExpression);
    expect(existingExpression?.querySelector('img')?.getAttribute('src')).toBe(
      'https://linux.do/images/emoji/grinning-face.png'
    );

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="表情"]')?.click());
    const emojiPanel = host.querySelector<HTMLElement>('[role="dialog"][aria-label="LinuxDo Emoji"]');
    const emojiImage = emojiPanel?.querySelector<HTMLImageElement>('button[aria-label="grinning face"] img');
    expect(emojiPanel).not.toBeNull();
    expect(emojiPanel?.querySelector<HTMLInputElement>('input[aria-label="搜索 Emoji"]')?.placeholder).toBe(
      '搜索 Emoji'
    );
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="grinning face"]')?.click());
    expect(host.querySelector<HTMLElement>('[data-composer-node="forum-expression"] img')?.getAttribute('src')).toBe(
      'https://linux.do/images/emoji/grinning-face.png'
    );
    expect(host.querySelector('.composer-document')?.textContent).toContain('draft');
    expect(emojiPanel?.closest<HTMLElement>('[data-expression-cache]')?.hidden).toBe(true);
    const labels = [...host.querySelectorAll<HTMLButtonElement>('.toolbar-shell button')].map((button) =>
      button.getAttribute('aria-label')
    );
    expect(labels).toEqual(
      expect.arrayContaining(['删除线', '下划线', '段落与标题', '列表选项', '链接', '投票', '正文工具', '动态模板'])
    );
    expect(labels).not.toEqual(expect.arrayContaining(['有序列表', '任务列表']));
    expect(labels).not.toContain('Stardust 收款');
    expect(labels).not.toContain('插入');

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="投票"]')?.click());
    const linuxPollBuilder = host.querySelector<HTMLElement>('[role="dialog"][aria-label="LinuxDo 投票"]');
    expect(linuxPollBuilder?.querySelector('textarea')).toBeNull();
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

    const sharedToolbar = host.querySelector('[aria-label="回复常用工具栏"]');
    await act(async () => {
      sharedToolbar?.querySelector<HTMLButtonElement>('button[aria-label="表格"]')?.click();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('[aria-label="回复常用工具栏"]')).toBe(sharedToolbar);
    expect(document.querySelector('[role="toolbar"][aria-label="表格操作"]')).not.toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[role="toolbar"][aria-label="表格操作"] button[aria-label="删除整个表格"]')
        ?.click();
      await new Promise(requestAnimationFrame);
    });
    expect(host.querySelector('table')).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'linuxdo-capabilities' } })
        })
      );
    });
    const snapshot = postMessage.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .findLast(
        (entry: { type: string; payload?: { requestId?: string } }) =>
          entry.type === 'SNAPSHOT' && entry.payload?.requestId === 'linuxdo-capabilities'
      );
    expect(snapshot.payload.snapshot.markdown).toContain(':grinning_face:');

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="正文工具"]')?.click());
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="LinuxDo 正文工具"] button[aria-label="硬换行"]')?.click()
    );
    expect(host.querySelector('.ProseMirror br')).not.toBeNull();
    expect(host.querySelector('.ProseMirror')?.textContent).not.toContain('\\');

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="表情"]')?.click());
    expect(host.querySelector('[role="dialog"][aria-label="LinuxDo Emoji"]')).toBe(emojiPanel);
    expect(emojiPanel?.querySelector<HTMLImageElement>('button[aria-label="grinning face"] img')).toBe(emojiImage);
    await act(async () => emojiPanel?.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click());

    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps adjacent private blocks and returns insertion to trailing text', async () => {
    const { host, postMessage, root, send } = await mountRuntime();

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="正文工具"]')?.click());
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('[aria-label="LinuxDo 正文工具"] button')]
        .find((button) => button.textContent === 'Details')
        ?.click()
    );
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="正文工具"]')?.click());
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

    await act(async () => root.unmount());
    host.remove();
  });

  it('excludes rich-to-source synchronization from CodeMirror undo', async () => {
    const { host, postMessage, root, send } = await mountRuntime({ markdown: '保留正文' });

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

    await act(async () => root.unmount());
    host.remove();
  });

  it('loads the searchable LinuxDo group chooser and derives a truthful poll card', async () => {
    const { host, postMessage, root, send } = await mountRuntime();

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="投票"]')?.click());
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
          canUseStaffResults: false
        }
      }
    });

    const builder = host.querySelector<HTMLElement>('[role="dialog"][aria-label="LinuxDo 投票"]')!;
    expect(builder.querySelector('select')).toBeNull();
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
    await send({ type: 'SET_MODE', payload: { mode: 'source' } });
    await send({ type: 'SET_MODE', payload: { mode: 'rich' } });
    expect(host.querySelector('[data-composer-node="forum-private-block"]')?.textContent).toContain('真实标题');
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="投票"]')?.click());
    expect(
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .filter(
          (entry: { type: string; payload?: { action?: string } }) =>
            entry.type === 'REQUEST_HOST_ACTION' && entry.payload?.action === 'load-linuxdo-poll-capabilities'
        )
    ).toHaveLength(1);

    await act(async () => root.unmount());
    host.remove();
  });

  it('retries a failed LinuxDo group load without adding a lifecycle state machine', async () => {
    const { host, postMessage, root, send } = await mountRuntime();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="投票"]')?.click());
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
        .filter((entry: { type: string }) => entry.type === 'REQUEST_HOST_ACTION')
    ).toHaveLength(2);

    await act(async () => root.unmount());
    host.remove();
  });

  it('incrementally exposes the complete LinuxDo Emoji directory', async () => {
    const discourseEmoji = Array.from({ length: 250 }, (_, index) => ({
      name: `emoji_${String(index).padStart(3, '0')}`,
      url: `https://linux.do/images/emoji/${index}.png`
    }));
    const { host, root } = await mountRuntime({ discourseEmoji });

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="表情"]')?.click());
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
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="表情"]')?.click());
    expect(panel.querySelector<HTMLImageElement>('button[aria-label="emoji 000"] img')).toBe(firstImage);

    const search = panel.querySelector<HTMLInputElement>('input[aria-label="搜索 Emoji"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'emoji_249');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(panel.querySelector('button[aria-label="emoji 249"]')).not.toBeNull();

    await act(async () => root.unmount());
    host.remove();
  });
});
