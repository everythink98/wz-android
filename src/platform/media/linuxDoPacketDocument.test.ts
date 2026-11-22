import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { allowLinuxDoPacketNavigation, isLinuxDoPacketCover, isLinuxDoPacketPage } from '@/domain/forum/linuxDoPacket';
import { packetCoverDocument } from './linuxDoPacketDocument';

const page = 'https://hb.lafi.sh/🧧/' + '🍎'.repeat(13) + '☕';
const cover = new URL(page + '/🖼️.svg?tz=Asia%2FShanghai').href;

describe('Linux Do packet covers', () => {
  it('recognizes the published image and page without accepting lookalike origins or encoded path separators', () => {
    expect(isLinuxDoPacketCover(cover)).toBe(true);
    expect(isLinuxDoPacketCover(page + '/🖼.svg')).toBe(true);
    expect(isLinuxDoPacketPage(page)).toBe(true);
    expect(isLinuxDoPacketPage('https://hb.lafi.sh/')).toBe(true);
    for (const bad of [
      cover.replace('hb.lafi.sh', 'hb.lafi.sh.example'),
      cover.replace('https:', 'http:'),
      cover.replace('hb.', 'reader@hb.'),
      cover.replace('/%F0%9F%96%BC', '%2Fa/%F0%9F%96%BC')
    ]) {
      expect(isLinuxDoPacketCover(bad)).toBe(false);
    }
    expect(allowLinuxDoPacketNavigation('https://connect.linux.do/oauth2/authorize')).toBe(true);
    expect(allowLinuxDoPacketNavigation('https://linux.do.example/login')).toBe(false);
    expect(allowLinuxDoPacketNavigation('intent://unknown')).toBe(false);
    expect(allowLinuxDoPacketNavigation('blob:https://hb.lafi.sh/opaque')).toBe(false);
  });

  it.each([
    { viewer: 'Reader', session: 'reader', personal: true, imageEvent: 'load' },
    { viewer: 'Reader', session: 'somebody-else', personal: false, imageEvent: 'load' },
    { viewer: 'Reader', session: null, personal: false, imageEvent: 'load' },
    { viewer: '', session: 'reader', personal: false, imageEvent: 'load' },
    { viewer: 'Reader', session: 'reader', personal: true, imageEvent: 'error' }
  ])(
    'reveals the cover only after a successful image load ($viewer / $session / $imageEvent)',
    async ({ viewer, session, personal, imageEvent }) => {
      const page = packetCoverDocument(cover, viewer);
      const { window } = new JSDOM(page.html, { url: page.baseUrl });
      const { document } = window;
      const image = document.querySelector('img')!;
      const isVisible = () => {
        const style = window.getComputedStyle(image);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      const postMessage = vi.fn();
      const fetcher = vi.fn(async (url: string, init: RequestInit) => {
        expect(init.cache).toBe('no-store');
        if (url === '/api/session') {
          expect(init.credentials).toBe('same-origin');
          return Response.json({ user: session ? { username: session } : null });
        }
        expect(url).toBe(cover);
        expect(init.credentials).toBe('omit');
        return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
      });
      try {
        expect(isVisible()).toBe(false);
        await runInNewContext(document.querySelector('script')!.textContent, {
          document,
          fetch: fetcher,
          AbortController,
          setTimeout,
          clearTimeout,
          URL: { createObjectURL: () => 'blob:public-image' },
          window: { ReactNativeWebView: { postMessage } }
        });
        expect(image.src).toBe(personal ? cover : 'blob:public-image');
        expect(fetcher).toHaveBeenCalledTimes((viewer ? 1 : 0) + (personal ? 0 : 1));
        expect(isVisible()).toBe(false);
        expect(postMessage).not.toHaveBeenCalled();
        image.dispatchEvent(new window.Event(imageEvent));
        expect(isVisible()).toBe(imageEvent === 'load');
        expect(postMessage).toHaveBeenCalledExactlyOnceWith(imageEvent === 'load' ? 'displayed' : 'error');
      } finally {
        window.close();
      }
    }
  );
  it('keeps the displayed cover until its replacement loads and drops a private cover after an account change', async () => {
    const page = packetCoverDocument(cover, 'reader');
    const { window } = new JSDOM(page.html, { url: page.baseUrl });
    const document = window.document;
    const first = document.querySelector('img')!;
    const created = vi.spyOn(document, 'createElement');
    const postMessage = vi.fn();
    let account = 'reader';
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.cache).toBe('no-store');
      if (url === '/api/session') return Response.json({ user: { username: account } });
      expect(init.credentials).toBe(account === 'reader' ? 'same-origin' : 'omit');
      return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
    });
    let blob = 0;
    const urls = { createObjectURL: () => `blob:cover-${++blob}`, revokeObjectURL: vi.fn() };
    try {
      await runInNewContext(document.querySelector('script')!.textContent, {
        document,
        fetch: fetcher,
        AbortController,
        setTimeout,
        clearTimeout,
        URL: urls,
        window: { ReactNativeWebView: { postMessage } }
      });
      first.dispatchEvent(new window.Event('load'));
      for (const username of ['reader', 'another']) {
        account = username;
        const previous = document.querySelector('img')!;
        document.dispatchEvent(new window.MessageEvent('message', { data: 'refresh' }));
        await vi.waitFor(() => expect(blob).toBe(username === 'reader' ? 1 : 2));
        expect(document.querySelector('img') === previous).toBe(true);
        expect(previous.hidden).toBe(username !== 'reader');
        const next = created.mock.results.at(-1)?.value as HTMLImageElement;
        next.dispatchEvent(new window.Event('load'));
        expect(document.querySelector('img') === next).toBe(true);
        expect(next.hidden).toBe(false);
      }
      expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1');
    } finally {
      window.close();
    }
  });
});
