import { describe, expect, it } from 'vitest';

import { bilibiliEmbedUrlFromUrl, nsEmbedFromUrl, shouldAllowBilibiliWebViewNavigation } from './videoEmbeds';

describe('NodeSeek video embeds', () => {
  it('builds Bilibili player URLs from NodeSeek-supported video links', () => {
    expect(bilibiliEmbedUrlFromUrl('https://www.bilibili.com/video/BV1GUdgBdESz/?p=2')).toBe(
      'https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz&p=2'
    );
    expect(bilibiliEmbedUrlFromUrl('https://m.bilibili.com/video/av123456')).toBe(
      'https://player.bilibili.com/player.html?aid=123456'
    );
  });

  it('keeps Bilibili player URLs and does not promote unconfirmed video hosts', () => {
    expect(nsEmbedFromUrl('//player.bilibili.com/player.html?bvid=BV1GUdgBdESz')).toEqual({
      type: 'bilibili',
      sourceUrl: 'https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz',
      embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz'
    });
    expect(bilibiliEmbedUrlFromUrl('https://b23.tv/demo')).toBeUndefined();
    expect(bilibiliEmbedUrlFromUrl('https://www.youtube.com/watch?v=demo')).toBeUndefined();
    expect(bilibiliEmbedUrlFromUrl('https://player.bilibili.com/player.html?foo=bar')).toBeUndefined();
  });

  it('allows only Bilibili player navigation inside the embedded WebView', () => {
    expect(shouldAllowBilibiliWebViewNavigation('about:blank')).toBe(true);
    expect(shouldAllowBilibiliWebViewNavigation('https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz')).toBe(
      true
    );
    expect(
      shouldAllowBilibiliWebViewNavigation(
        'https://www.bilibili.com/blackboard/webplayer/mbplayer.html?autoplay=0&high_quality=1&bvid=BV1TE411h7vY&page=1'
      )
    ).toBe(true);
    expect(shouldAllowBilibiliWebViewNavigation('https://www.bilibili.com/video/BV1GUdgBdESz')).toBe(false);
    expect(shouldAllowBilibiliWebViewNavigation('https://example.com/ad')).toBe(false);
    expect(shouldAllowBilibiliWebViewNavigation('javascript:alert(1)')).toBe(false);
  });
});
