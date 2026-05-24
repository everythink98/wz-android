import { parseHtml, textContentFromHtml } from './localHtml';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from './nodeseekCookies';

export interface ImagePreviewList {
  urls: string[];
  index: number;
}

export const INLINE_FORUM_IMAGE_TAG = 'forum-inline-image';

const IMAGE_REQUEST_HEADER_HOSTS = [
  'v2ex.com',
  'linux.do',
  'nodeseek.com',
  '111666.best'
];

export function extractImageUrlsFromHtml(html: string): string[] {
  try {
    const root = parseHtml(html);
    return root.querySelectorAll('img')
      .filter((image) => !isInlineForumImageAttributes(image.attributes))
      .map((image) => decodeHtmlAttribute(image.getAttribute('src') || '').trim())
      .filter(Boolean);
  } catch {
    const urls: string[] = [];
    const imagePattern = /<img\b([^>]*)>/gi;
    let match = imagePattern.exec(html);
    while (match) {
      const attributes = imageAttributesFromText(match[1] || '');
      const src = decodeHtmlAttribute(attributes.src || '').trim();
      if (src && !isInlineForumImageAttributes(attributes)) {
        urls.push(src);
      }
      match = imagePattern.exec(html);
    }
    return urls;
  }
}

export function isPreviewableImageUrl(url: unknown): boolean {
  const clean = decodeHtmlAttribute(url).trim();
  if (!clean) {
    return false;
  }
  if (isInlineForumImageUrl(clean)) {
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

export function isInlineForumImage(attributes: Record<string, string | undefined>) {
  return isInlineForumImageAttributes(attributes);
}

export function flowInlineImagesInMixedParagraphs(html: string) {
  try {
    const root = parseHtml(html);
    root.querySelectorAll('p').forEach((paragraph) => {
      const images = paragraph.querySelectorAll('img');
      if (!images.length || !paragraphHasTextOutsideImages(paragraph.innerHTML)) {
        return;
      }
      images.forEach((image) => {
        image.tagName = INLINE_FORUM_IMAGE_TAG;
      });
    });
    return root.toString();
  } catch {
    return html;
  }
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
    const headers: Record<string, string> = {
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      Referer: parsed.origin
    };
    if (isNodeSeekHost(parsed.hostname)) {
      headers['User-Agent'] = DEFAULT_NODESEEK_ANDROID_USER_AGENT;
    }
    return headers;
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
    ...(tapped && !isInlineForumImageUrl(tapped) ? [tapped] : [])
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

function imageAttributesFromText(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = pattern.exec(value);
  while (match) {
    attributes[match[1].toLowerCase()] = match[2] || match[3] || match[4] || '';
    match = pattern.exec(value);
  }
  return attributes;
}

function paragraphHasTextOutsideImages(html: string) {
  const withoutImages = html.replace(/<img\b[^>]*>/gi, ' ');
  return textContentFromHtml(withoutImages).length > 0;
}

function attributeValue(attributes: Record<string, string | undefined>, name: string) {
  return decodeHtmlAttribute(attributes[name] || attributes[name.toLowerCase()] || '').trim();
}

function isInlineForumImageAttributes(attributes: Record<string, string | undefined>) {
  const className = attributeValue(attributes, 'class');
  const src = attributeValue(attributes, 'src');
  const title = attributeValue(attributes, 'title');
  const alt = attributeValue(attributes, 'alt');
  const role = attributeValue(attributes, 'role');
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const hasSmallSize = (width > 0 && width <= 64) || (height > 0 && height <= 64);
  const classMarksEmoji = /(^|\s)(emoji|emoticon|smiley|twemoji)(\s|$)/i.test(className);
  const urlMarksEmoji = isInlineForumImageUrl(src);
  const titleMarksEmoji = /^:[a-z0-9_+.-]+:$/i.test(title);
  const altMarksEmoji = /^:[a-z0-9_+.-]+:$/i.test(alt);
  const hasEmojiMarker = classMarksEmoji || urlMarksEmoji || /^emoji$/i.test(role) || titleMarksEmoji || altMarksEmoji;
  return hasEmojiMarker && (hasSmallSize || !width || !height || classMarksEmoji || urlMarksEmoji);
}

function isInlineForumImageUrl(url: string) {
  const markers = new Set(['emoji', 'emojis', 'emoticon', 'emoticons', 'smiley', 'smilies', 'twemoji']);
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase().includes('twemoji')) {
      return true;
    }
    return parsed.pathname.split('/').some((part) => markers.has(part.toLowerCase()));
  } catch {
    return url.split(/[?#]/)[0].split('/').some((part) => markers.has(part.toLowerCase()));
  }
}

function parseImageDimension(value: string) {
  const match = value.match(/^\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function isKnownForumImageHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return IMAGE_REQUEST_HEADER_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

function isNodeSeekHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'nodeseek.com' || normalized.endsWith('.nodeseek.com');
}
