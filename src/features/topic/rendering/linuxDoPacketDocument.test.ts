import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'node-html-parser';
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
    { viewer: 'Reader', session: 'reader', personal: true },
    { viewer: 'Reader', session: 'somebody-else', personal: false },
    { viewer: 'Reader', session: null, personal: false },
    { viewer: '', session: 'reader', personal: false }
  ])(
    'shows a personal image only for the matching account ($viewer / $session)',
    async ({ viewer, session, personal }) => {
      const page = packetCoverDocument(cover, viewer);
      const doc = parse(page.html);
      const img = doc.querySelector('img')!;
      const image = {
        src: '',
        dataset: { cover: img.getAttribute('data-cover'), viewer: img.getAttribute('data-viewer') }
      };
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
      await runInNewContext(doc.querySelector('script')!.rawText, {
        document: { querySelector: () => image },
        fetch: fetcher,
        AbortController,
        setTimeout,
        clearTimeout,
        URL: { createObjectURL: () => 'blob:public-image' },
        window: { ReactNativeWebView: { postMessage: vi.fn() } }
      });
      expect(image.src).toBe(personal ? cover : 'blob:public-image');
      expect(fetcher).toHaveBeenCalledTimes((viewer ? 1 : 0) + (personal ? 0 : 1));
    }
  );
});
