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

export function inlineForumImageDisplaySize(attributes: Record<string, string | undefined>, scale = 1) {
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  let displayWidth = width || height || 20;
  let displayHeight = height || width || 20;
  const maxSize = 64;
  const minSize = 12;
  const maxDimension = Math.max(displayWidth, displayHeight);
  if (maxDimension > maxSize) {
    const ratio = maxSize / maxDimension;
    displayWidth *= ratio;
    displayHeight *= ratio;
  }
  const minDimension = Math.max(displayWidth, displayHeight);
  if (minDimension < minSize) {
    const ratio = minSize / Math.max(minDimension, 1);
    displayWidth *= ratio;
    displayHeight *= ratio;
  }
  const safeScale = safeImageScale(scale);
  return {
    width: Math.round(displayWidth * safeScale),
    height: Math.round(displayHeight * safeScale)
  };
}

export function inlineForumImageAlignmentStyle(attributes: Record<string, string | undefined>, scale = 1, lineHeight = 0) {
  if (!isInlineForumImageAttributes(attributes)) {
    return {};
  }
  const safeScale = safeImageScale(scale);
  const displaySize = inlineForumImageDisplaySize(attributes, safeScale);
  const resolvedLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : Math.round(16 * safeScale * 1.62);
  const translateY = Math.max(0, Math.round((resolvedLineHeight - displaySize.height) / 2));
  return translateY > 0 ? { transform: [{ translateY }] } : {};
}

export function flowInlineImagesInMixedParagraphs(html: string) {
  try {
    const root = parseHtml(html);
    root.querySelectorAll('p').forEach((paragraph) => {
      flowImagesInMixedContainer(paragraph);
    });
    flowQuoteTitleAvatars(root);
    flowImagesInMixedContainer(root, true);
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

type ParsedImageNode = {
  tagName: string;
  attributes: Record<string, string | undefined>;
  innerHTML?: string;
  set_content?: (content: string) => void;
  querySelectorAll?: (selector: string) => ParsedImageNode[];
  parentNode?: unknown;
  parent?: unknown;
};

function flowQuoteTitleAvatars(root: { querySelectorAll?: (selector: string) => ParsedImageNode[] }) {
  root.querySelectorAll?.('aside').forEach((aside) => {
    const className = String(aside.attributes?.class || '');
    if (!/(^|\s)quote(\s|$)/i.test(className)) {
      return;
    }
    aside.querySelectorAll?.('div').forEach((container) => {
      const containerClass = String(container.attributes?.class || '');
      if (/(^|\s)quote-title__text-content(\s|$)/i.test(containerClass)) {
        container.tagName = 'span';
      }
      if (/(^|\s)title(\s|$)/i.test(containerClass)) {
        flowImagesInMixedContainer(container, true, isForumAvatarImageAttributes);
      }
    });
  });
}

function flowImagesInMixedContainer(
  container: { innerHTML?: string; querySelectorAll?: (selector: string) => ParsedImageNode[]; childNodes?: unknown[] },
  directOnly = false,
  shouldFlowImage: (attributes: Record<string, string | undefined>) => boolean = () => true
) {
  const images = directOnly ? directChildImages(container) : (container.querySelectorAll?.('img') || []);
  const flowableImages = images.filter((image) => shouldFlowImage(image.attributes));
  if (!flowableImages.length || !paragraphHasTextOutsideImages(container.innerHTML || '')) {
    return;
  }
  flowableImages.forEach((image) => {
    if (isInsideLightboxImage(image)) {
      return;
    }
    const label = attributeValue(image.attributes, 'alt') || attributeValue(image.attributes, 'title') || attributeValue(image.attributes, 'src') || 'image';
    image.tagName = INLINE_FORUM_IMAGE_TAG;
    if (typeof image.set_content === 'function') {
      image.set_content(label);
    } else {
      image.innerHTML = label;
    }
  });
}

function directChildImages(container: { childNodes?: unknown[] }) {
  return (container.childNodes || []).filter((child): child is ParsedImageNode => (
    safeTagName(child) === 'img'
  ));
}

function isInsideLightboxImage(image: { parentNode?: unknown; parent?: unknown }) {
  let current = image.parentNode || image.parent;
  while (current && typeof current === 'object') {
    const element = current as {
      tagName?: string;
      rawTagName?: string | null;
      classNames?: string;
      attributes?: Record<string, string | undefined>;
      parentNode?: unknown;
      parent?: unknown;
    };
    const tagName = safeTagName(element);
    const className = String(element.classNames || element.attributes?.class || '');
    if ((tagName === 'a' && /(^|\s)lightbox(\s|$)/i.test(className)) || /(^|\s)lightbox-wrapper(\s|$)/i.test(className)) {
      return true;
    }
    current = element.parentNode || element.parent;
  }
  return false;
}

function safeTagName(value: unknown) {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const element = value as { rawTagName?: string | null; tagName?: string };
  return String(element.rawTagName || element.tagName || '').toLowerCase();
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
  const classMarksAvatar = /(^|\s)(avatar|user-avatar)(\s|$)/i.test(className);
  const urlMarksEmoji = isInlineForumImageUrl(src);
  const urlMarksAvatar = /(^|\/)user_avatar\//i.test(src);
  const titleMarksEmoji = /^:[a-z0-9_+.-]+:$/i.test(title);
  const altMarksEmoji = /^:[a-z0-9_+.-]+:$/i.test(alt);
  const hasEmojiMarker = classMarksEmoji || urlMarksEmoji || /^emoji$/i.test(role) || titleMarksEmoji || altMarksEmoji;
  return (hasEmojiMarker && (hasSmallSize || !width || !height || classMarksEmoji || urlMarksEmoji))
    || ((classMarksAvatar || urlMarksAvatar) && hasSmallSize);
}

function isForumAvatarImageAttributes(attributes: Record<string, string | undefined>) {
  const className = attributeValue(attributes, 'class');
  const src = attributeValue(attributes, 'src');
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const hasSmallSize = (width > 0 && width <= 64) || (height > 0 && height <= 64);
  return hasSmallSize && (/(^|\s)(avatar|user-avatar)(\s|$)/i.test(className) || /(^|\/)user_avatar\//i.test(src));
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

function safeImageScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function isKnownForumImageHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return IMAGE_REQUEST_HEADER_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

function isNodeSeekHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'nodeseek.com' || normalized.endsWith('.nodeseek.com');
}
