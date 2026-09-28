// @vitest-environment jsdom
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { ComposerEditorRuntime } from '@/ui/composer/editorRuntime';
import type { ComposerHostMessage } from '@/ui/composer/structuredComposerBridge';

const mounted: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = [];
const geometryDescriptors = (
  [
    [Range.prototype, 'getClientRects'],
    [Range.prototype, 'getBoundingClientRect'],
    [Text.prototype, 'getBoundingClientRect']
  ] as const
).map(([target, key]) => ({ target, key, descriptor: Object.getOwnPropertyDescriptor(target, key) }));
const theme = {
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

afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(async () => root.unmount());
    host.remove();
  }
  delete window.ReactNativeWebView;
  document.querySelectorAll('style[data-tiptap-style]').forEach((node) => node.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const { target, key, descriptor } of geometryDescriptors) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
});

// Real Tiptap/CodeMirror and bridge serialization; jsdom does not decode images or measure native frames.
describe('composer DOM and bridge pressure', () => {
  it.each(
    (['nodeseek', 'linuxdo'] as const).flatMap((site) =>
      (['rich', 'source'] as const).flatMap((mode) => [0, 256].map((images) => ({ site, mode, images })))
    )
  )(
    'preserves 128 KiB and $images image references over 100 $site/$mode snapshots',
    async ({ site, mode, images }) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      );
      const rect = () => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({})
      });
      Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: rect });
      Object.defineProperty(Text.prototype, 'getBoundingClientRect', { configurable: true, value: rect });
      const imageMarkdown = Array.from(
        { length: images },
        (_, index) => `![image-${index}](https://editor-stress.invalid/image-${index}.png)`
      ).join('\n\n');
      const markdown = `${imageMarkdown}${images ? '\n\n' : ''}${('a'.repeat(480) + '\n\n').repeat(280)}`.slice(
        0,
        128 * 1024
      );
      const outgoing: string[] = [];
      window.ReactNativeWebView = { postMessage: (raw) => outgoing.push(raw) };
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      mounted.push({ host, root });
      const send = (message: ComposerHostMessage) =>
        window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
      const initializeStarted = performance.now();
      await act(async () => root.render(createElement(ComposerEditorRuntime)));
      await act(async () => {
        send({
          type: 'INIT',
          payload: {
            documentEpoch: 7,
            site,
            intentKind: 'reply',
            markdown,
            pendingNodeSeekPolls: [],
            mode,
            discourseEmoji: [],
            nodeSeekMemberId: '123',
            theme
          }
        });
      });
      const initializeMs = performance.now() - initializeStarted;
      expect(outgoing.map((raw) => JSON.parse(raw))).toContainEqual({
        type: 'READY',
        payload: { documentEpoch: 7, revision: 0 }
      });
      const richDocument = host.querySelector('.composer-document') as HTMLElement & { editor: Editor };
      expect(richDocument.querySelectorAll('img')).toHaveLength(images);
      const serialization = vi.spyOn(richDocument.editor, 'getMarkdown');
      outgoing.length = 0;
      const durations: number[] = [];
      await act(async () => {
        for (let index = 0; index < 100; index++) {
          const start = performance.now();
          send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: `stress-${index}` } });
          durations.push(performance.now() - start);
        }
      });
      const snapshots = outgoing.map((raw) => JSON.parse(raw)).filter((message) => message.type === 'SNAPSHOT');
      expect(snapshots).toHaveLength(100);
      for (const [index, message] of snapshots.entries()) {
        expect(message.payload).toMatchObject({
          documentEpoch: 7,
          requestId: `stress-${index}`,
          snapshot: { revision: 0, mode, isEmpty: false, validationIssues: [], pendingNodeSeekPolls: [] }
        });
        expect(message.payload.snapshot.markdown.trim()).toBe(markdown.trim());
      }
      const sorted = [...durations].sort((left, right) => left - right);
      console.info(
        JSON.stringify({
          benchmark: 'composer-dom-snapshots',
          node: process.version,
          site,
          mode,
          images,
          draftCharacters: markdown.length,
          initializeMs: Number(initializeMs.toFixed(2)),
          samples: durations.length,
          snapshotMedianMs: Number(sorted[50]!.toFixed(2)),
          snapshotP95Ms: Number(sorted[94]!.toFixed(2)),
          snapshotTotalMs: Number(durations.reduce((sum, duration) => sum + duration, 0).toFixed(2)),
          richSerializations: serialization.mock.calls.length,
          bridgeBytes: outgoing.reduce((sum, raw) => sum + Buffer.byteLength(raw), 0)
        })
      );
    },
    30_000
  );
});
