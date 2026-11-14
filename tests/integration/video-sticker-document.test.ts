// @vitest-environment node
import { JSDOM } from 'jsdom';
import * as ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { videoStickerBrowserHtml } from '@/features/topic/rendering/videoStickerDocument';

function productionStickerScript() {
  const html = videoStickerBrowserHtml(
    'https://www.nodeseek.com/static/image/sticker/fixture.webm',
    'https://www.nodeseek.com',
    'origin'
  );
  const document = new JSDOM(html, { runScripts: 'outside-only' });
  try {
    const script = document.window.document.querySelector('script[nonce="wz-video-sticker"]')?.textContent;
    if (!script) throw new Error('Production video document has no script');
    return { html, script };
  } finally {
    document.window.close();
  }
}

const production = productionStickerScript();
const documents: JSDOM[] = [];
afterEach(() => {
  for (const document of documents.splice(0)) document.window.close();
});

function runDocument(script = production.script, initialReady = 0) {
  const document = new JSDOM(production.html, {
    url: 'https://www.nodeseek.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  documents.push(document);
  const page = document.window;
  const video = page.document.querySelector('video');
  if (!video) throw new Error('Production document has no video');
  const messages: string[] = [];
  const frames: FrameRequestCallback[] = [];
  let buffered: [number, number][] = [];
  let ready = initialReady;
  // Only decode readiness/TimeRanges and frame delivery cross the browser boundary.
  Object.defineProperty(video, 'readyState', { get: () => ready });
  Object.defineProperty(video, 'buffered', {
    get: () => ({ length: buffered.length, end: (index: number) => buffered[index]?.[1] ?? Number.NaN })
  });
  video.play = async () => undefined;
  video.pause = () => undefined;
  Object.defineProperty(page, 'ReactNativeWebView', {
    value: {
      postMessage(message: unknown) {
        if (typeof message !== 'string') throw new Error('Non-string bridge message');
        messages.push(message);
      }
    }
  });
  page.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  page.eval(script);
  return {
    messages,
    progress(value: [number, number][]) {
      buffered = value;
      video.dispatchEvent(new page.Event('progress'));
    },
    loaded() {
      ready = 2;
      video.dispatchEvent(new page.Event('loadeddata'));
    },
    error() {
      video.dispatchEvent(new page.Event('error'));
    },
    frame() {
      for (const callback of frames.splice(0)) callback(0);
    }
  };
}

function withoutGuard(script: string, name: string, index: number) {
  const source = ts.createSourceFile('sticker.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let body: ts.Block | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === name &&
      node.initializer &&
      ts.isArrowFunction(node.initializer) &&
      ts.isBlock(node.initializer.body)
    )
      body = node.initializer.body;
    ts.forEachChild(node, visit);
  };
  visit(source);
  const guard = body?.statements.filter(ts.isIfStatement)[index];
  if (!guard || !ts.isReturnStatement(guard.thenStatement)) throw new Error('Expected the production return guard');
  return script.slice(0, guard.getStart(source)) + script.slice(guard.end);
}

describe('production video sticker document protocol', () => {
  it('claims one two-frame READY across initial readiness and repeated DOM loadeddata events', () => {
    const page = runDocument(production.script, 2);
    page.loaded();
    page.loaded();
    page.progress([[0, 8]]);
    expect(page.messages).toEqual([]);
    page.frame();
    expect(page.messages).toEqual([]);
    page.frame();
    page.frame();
    expect(page.messages).toEqual(['wz-video-sticker-ready']);
  });

  it('reports only finite strictly increasing buffered watermarks from real DOM progress events', () => {
    const page = runDocument();
    page.progress([[0, 2]]);
    page.progress([[0, 2]]);
    page.progress([[0, 1]]);
    page.progress([[0, Number.NaN]]);
    page.progress([[0, Number.POSITIVE_INFINITY]]);
    page.progress([
      [0, 1],
      [3, 6]
    ]);
    expect(page.messages).toEqual(['wz-video-sticker-progress:3', 'wz-video-sticker-progress:7']);
  });

  it('keeps a media ERROR independent from a READY that has already claimed its frame callbacks', () => {
    const page = runDocument();
    page.loaded();
    page.error();
    page.error();
    page.frame();
    page.frame();
    expect(page.messages).toEqual(['wz-video-sticker-error', 'wz-video-sticker-ready']);
  });

  it.each([
    { handler: 'ready', guard: 0, initialReady: 2, message: 'wz-video-sticker-ready' },
    { handler: 'progress', guard: 1, initialReady: 0, message: 'wz-video-sticker-progress:3' }
  ])('detects loss of the production $handler guard through the same DOM path', (control) => {
    const page = runDocument(withoutGuard(production.script, control.handler, control.guard), control.initialReady);
    if (control.handler === 'ready') {
      page.loaded();
      page.frame();
      page.frame();
    } else {
      page.progress([[0, 2]]);
      page.progress([[0, 2]]);
    }
    expect(page.messages).toEqual([control.message, control.message]);
  });
});
