export interface ImagePreviewList {
  urls: string[];
  index: number;
}

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

export function normalizeImagePreviewUrl(url: string, serverUrl: string): string {
  const clean = decodeHtmlAttribute(url).trim();
  if (/^(?:https?:|data:)/i.test(clean)) {
    return clean;
  }
  if (clean.startsWith('//')) {
    return `https:${clean}`;
  }
  const base = (serverUrl.trim() || 'http://10.0.2.2:3000').replace(/\/+$/, '');
  if (clean.startsWith('/')) {
    return `${base}${clean}`;
  }
  return clean;
}

export function createImagePreviewList({
  tappedUrl,
  htmlParts,
  serverUrl
}: {
  tappedUrl: string;
  htmlParts: string[];
  serverUrl: string;
}): ImagePreviewList {
  const tapped = normalizeImagePreviewUrl(tappedUrl, serverUrl);
  const urls = uniqueStrings([
    ...htmlParts.flatMap((html) => extractImageUrlsFromHtml(html).map((url) => normalizeImagePreviewUrl(url, serverUrl))),
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
