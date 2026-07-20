import { Buffer } from 'buffer';
import type { ImageURISource } from 'react-native';
import { normalizeImagePreviewUrl } from './htmlImages';
import { fetchWithTimeout, type Fetcher } from './request';

const COMPATIBLE_IMAGE_CACHE_LIMIT = 32;
const MAX_COMPATIBLE_SVG_BYTES = 1024 * 1024;
const COMPATIBLE_SVG_TIMEOUT_MS = 10_000;

const compatibleImageSourceCache = new Map<string, ImageURISource>();
const compatibleImageSourceRequests = new Map<string, Promise<ImageURISource | null>>();

export function compatibleImageRequestIdentity(source: ImageURISource) {
  const uri = normalizeImagePreviewUrl(source.uri || '');
  const headers = Object.entries(source.headers || {})
    .map(([name, value]) => [name.toLowerCase(), String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return [uri, ...headers.map(([name, value]) => `${name}:${value}`)].join('\u0000');
}

export function cachedCompatibleImageSource(source: ImageURISource) {
  return compatibleImageSourceCache.get(compatibleImageRequestIdentity(source)) || null;
}

export function recoverCompatibleSvgImageSource(
  source: ImageURISource,
  fetcher: Fetcher = fetch
): Promise<ImageURISource | null> {
  const identity = compatibleImageRequestIdentity(source);
  const cached = compatibleImageSourceCache.get(identity);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = compatibleImageSourceRequests.get(identity);
  if (pending) {
    return pending;
  }
  const request = loadCompatibleSvgImageSource(source, fetcher)
    .then((fallbackSource) => {
      if (fallbackSource) {
        rememberCompatibleImageSource(identity, fallbackSource);
      }
      return fallbackSource;
    })
    .finally(() => {
      compatibleImageSourceRequests.delete(identity);
    });
  compatibleImageSourceRequests.set(identity, request);
  return request;
}

async function loadCompatibleSvgImageSource(source: ImageURISource, fetcher: Fetcher) {
  const uri = normalizeImagePreviewUrl(source.uri || '');
  if (!/^https?:\/\//i.test(uri)) {
    return null;
  }
  const response = await fetchWithTimeout(uri, {
    headers: {
      ...(source.headers || {}),
      Accept: 'image/svg+xml,image/*,*/*;q=0.8'
    }
  }, {
    fetcher,
    timeoutMs: COMPATIBLE_SVG_TIMEOUT_MS
  });
  if (!response.ok || !isSvgContentType(response.headers.get('content-type'))) {
    return null;
  }
  const contentLength = positiveHeaderNumber(response.headers.get('content-length'));
  if (contentLength > MAX_COMPATIBLE_SVG_BYTES) {
    return null;
  }
  const svg = await response.text();
  if (!/<svg[\s>]/i.test(svg) || Buffer.byteLength(svg, 'utf8') > MAX_COMPATIBLE_SVG_BYTES) {
    return null;
  }
  const compatibleSvg = stripSvgLinkElements(svg);
  const dimensions = svgIntrinsicDimensions(compatibleSvg);
  return {
    ...(dimensions || {}),
    uri: `data:image/svg+xml;base64,${Buffer.from(compatibleSvg, 'utf8').toString('base64')}`
  } satisfies ImageURISource;
}

export function svgIntrinsicDimensions(svg: string) {
  const match = /<svg(?=[\s>])/i.exec(svg);
  if (!match) {
    return null;
  }
  const end = quotedTagEnd(svg, match.index);
  if (end < 0) {
    return null;
  }
  const openingTag = svg.slice(match.index, end + 1);
  let width = positiveSvgDimension(svgAttribute(openingTag, 'width'));
  let height = positiveSvgDimension(svgAttribute(openingTag, 'height'));
  const viewBox = (svgAttribute(openingTag, 'viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    width ||= viewBox[2];
    height ||= viewBox[3];
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

export function stripSvgLinkElements(svg: string) {
  let result = '';
  let cursor = 0;
  while (cursor < svg.length) {
    const opening = svg.slice(cursor).match(/^<a(?=[\s/>])/i);
    const closing = svg.slice(cursor).match(/^<\/a(?=[\s>])/i);
    if (!opening && !closing) {
      result += svg[cursor];
      cursor += 1;
      continue;
    }
    const end = quotedTagEnd(svg, cursor);
    if (end < 0) {
      return svg;
    }
    cursor = end + 1;
  }
  return result;
}

function quotedTagEnd(value: string, start: number) {
  let quote = '';
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') {
      return index;
    }
  }
  return -1;
}

function svgAttribute(openingTag: string, name: string) {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = openingTag.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function positiveSvgDimension(value: string) {
  const normalized = value.trim();
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(normalized)) {
    return 0;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function rememberCompatibleImageSource(identity: string, source: ImageURISource) {
  if (compatibleImageSourceCache.size >= COMPATIBLE_IMAGE_CACHE_LIMIT) {
    const oldestIdentity = compatibleImageSourceCache.keys().next().value;
    if (oldestIdentity) {
      compatibleImageSourceCache.delete(oldestIdentity);
    }
  }
  compatibleImageSourceCache.set(identity, source);
}

function isSvgContentType(value: string | null) {
  return /(?:^|;|\s)(?:image|application)\/svg\+xml(?:;|\s|$)/i.test(value || '');
}

function positiveHeaderNumber(value: string | null) {
  const parsed = value ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
