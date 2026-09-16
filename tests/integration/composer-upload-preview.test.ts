import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { discourseImageUrlFromUploadResponse } from '@/sources/discourse/actionRequest';
import { replyImageMarkupForSource } from '@/sources/imageUpload';
import { ComposerEditorRuntime } from '@/ui/composer/editorRuntime';
import { resolveLinuxDoUpload } from '@/sources/linuxdo/uploadUrls';

it('carries an upload response through Markdown to the real Composer image view', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const postMessage = vi.fn();
  window.ReactNativeWebView = { postMessage };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const markdown = replyImageMarkupForSource(
    'linuxdo',
    discourseImageUrlFromUploadResponse({ short_url: 'upload://abc123.png' }, 'https://linux.do', 'linux.do'),
    'photo'
  );
  const send = async (message: unknown) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    });
  try {
    await act(async () => root.render(createElement(ComposerEditorRuntime)));
    await send({
      type: 'INIT',
      payload: {
        site: 'linuxdo',
        intentKind: 'reply',
        markdown,
        pendingNodeSeekPolls: [],
        mode: 'rich',
        discourseEmoji: [],
        theme: {
          dark: false,
          ink: '#111',
          muted: '#666',
          surface: '#fff',
          surface2: '#eee',
          line: '#ddd',
          primary: '#1677ff',
          primarySoft: '#eef',
          danger: '#f00',
          fontScale: 1
        }
      }
    });
    const lookup = postMessage.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .find((event) => event.payload?.action === 'resolve-linuxdo-upload');
    expect(lookup?.payload.data).toEqual({ shortUrl: 'upload://abc123.png' });
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/session/csrf')) return new Response(JSON.stringify({ csrf: 'test-csrf' }));
      expect(input).toBe('https://linux.do/uploads/lookup-urls');
      expect(JSON.parse(String(init?.body))).toEqual({ short_urls: ['upload://abc123.png'] });
      return new Response(
        JSON.stringify([{ short_url: 'upload://abc123.png', url: 'https://cdn3.ldstatic.com/original/example.png' }])
      );
    });
    const url = await resolveLinuxDoUpload({
      shortUrl: lookup.payload.data.shortUrl,
      fetcher,
      userAgent: 'test-agent'
    });
    await send({
      type: 'COMMAND',
      payload: { name: 'host-action-result', requestId: lookup.payload.requestId, result: { url } }
    });
    expect(host.querySelector<HTMLImageElement>('.composer-image img')!.src).toBe(
      'https://cdn3.ldstatic.com/original/example.png'
    );
    await send({ type: 'REQUEST_SNAPSHOT', payload: { requestId: 'preview' } });
    expect(
      postMessage.mock.calls
        .map(([raw]) => JSON.parse(raw))
        .findLast((event) => event.payload?.requestId === 'preview')
        .payload.snapshot.markdown.trim()
    ).toBe(markdown);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    delete window.ReactNativeWebView;
    vi.unstubAllGlobals();
  }
});

it('rejects malformed short URLs and unsafe or unrelated lookup results', async () => {
  const fetcher = vi.fn(
    async (input: string) =>
      new Response(
        JSON.stringify(
          input.endsWith('/session/csrf')
            ? { csrf: 'test' }
            : [{ short_url: 'upload://abc.png', url: 'javascript:alert(1)' }]
        )
      )
  );
  await expect(
    resolveLinuxDoUpload({ shortUrl: 'https://other.test/image.png', fetcher, userAgent: '' })
  ).rejects.toThrow('图片短地址');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(resolveLinuxDoUpload({ shortUrl: 'upload://abc.png', fetcher, userAgent: '' })).rejects.toThrow(
    '显示地址'
  );
  await expect(resolveLinuxDoUpload({ shortUrl: 'upload://different.png', fetcher, userAgent: '' })).rejects.toThrow(
    '显示地址'
  );
});
