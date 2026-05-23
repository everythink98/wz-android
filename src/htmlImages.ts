export interface ImagePreviewList {
  urls: string[];
  index: number;
}

const IMAGE_REQUEST_HEADER_HOSTS = [
  'v2ex.com',
  'linux.do',
  'nodeseek.com',
  '111666.best'
];

export function extractImageUrlsFromHtml(html: string): string[] {
  const urls: string[] = [];
  const imagePattern = /<img\b[^>]*\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/gi;
  let match = imagePattern.exec(html);
  while (match) {
    const src = decodeHtmlAttribute(match[1] || match[2] || match[3] || '').trim();
    if (src) {
      urls.push(src);
    }
    match = imagePattern.exec(html);
  }
  return urls;
}

export function isPreviewableImageUrl(url: unknown): boolean {
  const clean = decodeHtmlAttribute(url).trim();
  if (!clean) {
    return false;
  }
  if (/^data:image\//i.test(clean)) {
    return true;
  }
  if (/[/?&]api\/image-proxy(?:[/?#&=]|$)/i.test(clean) || /\/api\/image-proxy(?:[?#/]|$)/i.test(clean)) {
    return true;
  }
  return /\.(?:apng|avif|bmp|gif|heic|heif|jpe?g|png|webp)(?:[?#].*)?$/i.test(clean);
}

export function isHttpOrHttpsUrl(url: unknown): boolean {
  const clean = decodeHtmlAttribute(url).trim();
  if (!clean) {
    return false;
  }
  try {
    const protocol = new URL(clean).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeImagePreviewUrl(url: string): string {
  const clean = decodeHtmlAttribute(url).trim();
  if (/^(?:https?:|data:)/i.test(clean)) {
    return clean;
  }
  if (clean.startsWith('//')) {
    return `https:${clean}`;
  }
  return clean;
}

export function imageRequestHeadersForUrl(url: unknown): Record<string, string> | undefined {
  const clean = normalizeImagePreviewUrl(decodeHtmlAttribute(url));
  try {
    const parsed = new URL(clean);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isKnownForumImageHost(parsed.hostname)) {
      return undefined;
    }
    return {
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      Referer: parsed.origin
    };
  } catch {
    return undefined;
  }
}

export function imageSourceFromUrl(url: string, source?: unknown) {
  const clean = normalizeImagePreviewUrl(url);
  const base: Record<string, unknown> = source && typeof source === 'object' && !Array.isArray(source)
    ? { ...(source as Record<string, unknown>), uri: clean }
    : { uri: clean };
  const headers = imageRequestHeadersForUrl(clean);
  if (!headers) {
    return base;
  }
  return {
    ...base,
    headers: {
      ...((base.headers && typeof base.headers === 'object' && !Array.isArray(base.headers)) ? base.headers : {}),
      ...headers
    }
  };
}

export function dataImageFileFromUrl(url: unknown): { base64: string; extension: string } | null {
  const clean = decodeHtmlAttribute(url).trim();
  const match = clean.match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  const type = match[1].toLowerCase();
  const extension = type === 'jpeg' ? 'jpg' : type.split('+')[0];
  const base64 = match[2].trim();
  return base64 ? { base64, extension } : null;
}

export function createImagePreviewList({
  tappedUrl,
  htmlParts
}: {
  tappedUrl: string;
  htmlParts: string[];
}): ImagePreviewList {
  const tapped = normalizeImagePreviewUrl(tappedUrl);
  const urls = uniqueStrings([
    ...htmlParts.flatMap((html) => extractImageUrlsFromHtml(html).map((url) => normalizeImagePreviewUrl(url))),
    tapped
  ]);
  const index = Math.max(0, urls.findIndex((url) => url === tapped));
  return { urls, index };
}

function decodeHtmlAttribute(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)));
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (item && !seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}

function isKnownForumImageHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return IMAGE_REQUEST_HEADER_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}
