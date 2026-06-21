export type NsVideoEmbed =
  | { type: 'bilibili'; sourceUrl: string; embedUrl: string }
  | { type: 'iframeLink'; sourceUrl: string; displayDomain: string };

const BILIBILI_PLAYER_HOST = 'player.bilibili.com';
const BILIBILI_VIDEO_HOSTS = new Set(['www.bilibili.com', 'm.bilibili.com', 'bilibili.com']);

function safeUrl(value: unknown, baseUrl = 'https://www.nodeseek.com/') {
  const text = String(value || '').trim();
  if (!text) {
    return undefined;
  }
  try {
    return new URL(text.startsWith('//') ? `https:${text}` : text, baseUrl);
  } catch {
    return undefined;
  }
}

function videoIdFromPath(pathname: string) {
  const match = pathname.match(/\/video\/((?:BV[0-9A-Za-z]+)|(?:av\d+))/i);
  return match?.[1];
}

function hasBilibiliPlayerId(url: URL) {
  const bvid = url.searchParams.get('bvid') || '';
  const aid = url.searchParams.get('aid') || '';
  return /^BV[0-9A-Za-z]+$/i.test(bvid) || /^\d+$/.test(aid);
}

export function bilibiliEmbedUrlFromUrl(value: unknown, baseUrl = 'https://www.nodeseek.com/') {
  const url = safeUrl(value, baseUrl);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (host === BILIBILI_PLAYER_HOST && url.pathname === '/player.html') {
    return hasBilibiliPlayerId(url) ? url.toString() : undefined;
  }
  if (!BILIBILI_VIDEO_HOSTS.has(host)) {
    return undefined;
  }
  const id = videoIdFromPath(url.pathname);
  if (!id) {
    return undefined;
  }
  const player = new URL('https://player.bilibili.com/player.html');
  if (/^BV/i.test(id)) {
    player.searchParams.set('bvid', id);
  } else {
    player.searchParams.set('aid', id.slice(2));
  }
  const page = url.searchParams.get('p');
  if (page) {
    player.searchParams.set('p', page);
  }
  return player.toString();
}

export function nsEmbedFromUrl(value: unknown, baseUrl = 'https://www.nodeseek.com/'): NsVideoEmbed | undefined {
  const url = safeUrl(value, baseUrl);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return undefined;
  }
  const sourceUrl = url.toString();
  const embedUrl = bilibiliEmbedUrlFromUrl(sourceUrl, baseUrl);
  if (embedUrl) {
    return { type: 'bilibili', sourceUrl, embedUrl };
  }
  return { type: 'iframeLink', sourceUrl, displayDomain: url.hostname };
}

export function shouldAllowBilibiliWebViewNavigation(value: unknown) {
  const text = String(value || '').trim();
  if (text === 'about:blank') {
    return true;
  }
  const url = safeUrl(text, 'https://player.bilibili.com/');
  return Boolean(
    url
    && url.protocol === 'https:'
    && url.hostname.toLowerCase() === BILIBILI_PLAYER_HOST
    && url.pathname === '/player.html'
    && hasBilibiliPlayerId(url)
  );
}
