import { FORUM_VIDEO_STICKER_TAG, isAllowedDataImageUrl, parseHtml, textContentFromHtml } from './localHtml';
import { DEFAULT_NODESEEK_ANDROID_USER_AGENT } from './nodeseekCookies';

export interface ImagePreviewList {
  urls: string[];
  index: number;
}

export interface ImagePreviewCatalog {
  urls: string[];
  previewUrlBySourceUrl: Record<string, string>;
}

export const FORUM_STICKER_TAG = 'forum-sticker';
export const FORUM_STICKER_ROW_TAG = 'forum-sticker-row';
export const FORUM_INLINE_MEDIA_LINE_TAG = 'forum-inline-media-line';
export const INLINE_FORUM_IMAGE_TAG = 'forum-inline-image';

const FORUM_STICKER_MEDIA_PATTERN = new RegExp(`<${FORUM_STICKER_TAG}\\b|<${FORUM_VIDEO_STICKER_TAG}\\b`, 'i');
const FORUM_VIDEO_STICKER_ELEMENT_PATTERN = new RegExp(`<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>[\\s\\S]*?<\\/${FORUM_VIDEO_STICKER_TAG}>`, 'gi');
const FORUM_VIDEO_STICKER_OPEN_PATTERN = new RegExp(`<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>`, 'gi');
const STICKER_ROW_ATTR = 'data-forum-sticker-row';
const INLINE_EMOJI_MAX_SIZE = 24;
const INLINE_STICKER_DEFAULT_SIZE = 48;
const INLINE_STICKER_MAX_SIZE = 64;
const STICKER_ROW_DEFAULT_SIZE = 100;
const STICKER_ROW_MAX_SIZE = 160;
const STICKER_ROW_CONTENT_WIDTH_RATIO = 0.55;

const IMAGE_REQUEST_HEADER_HOSTS = [
  'v2ex.com',
  'linux.do',
  'nodeseek.com',
  '111666.best'
];

export function extractImageUrlsFromHtml(html: string): string[] {
  return extractImagePreviewEntriesFromHtml(html).map((entry) => entry.previewUrl);
}

function extractImagePreviewEntriesFromHtml(html: string): ImagePreviewEntry[] {
  try {
    const root = parseHtml(html);
    return root.querySelectorAll('img')
      .filter((image) => !isInlineForumImageAttributes(image.attributes))
      .map((image) => imagePreviewEntryFromImage(image))
      .filter((entry): entry is ImagePreviewEntry => Boolean(entry));
  } catch {
    const entries: ImagePreviewEntry[] = [];
    const imagePattern = /<img\b([^>]*)>/gi;
    let match = imagePattern.exec(html);
    while (match) {
      const attributes = imageAttributesFromText(match[1] || '');
      const entry = !isInlineForumImageAttributes(attributes) ? imagePreviewEntryFromAttributes(attributes) : null;
      if (entry) {
        entries.push(entry);
      }
      match = imagePattern.exec(html);
    }
    return entries;
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
    return isAllowedDataImageUrl(clean);
  }
  if (/[/?&]api\/image-proxy(?:[/?#&=]|$)/i.test(clean) || /\/api\/image-proxy(?:[?#/]|$)/i.test(clean)) {
    return true;
  }
  return /\.(?:apng|avif|bmp|gif|heic|heif|jpe?g|png|webp)(?:[?#].*)?$/i.test(clean);
}

export function isInlineForumImage(attributes: Record<string, string | undefined>) {
  return isInlineForumImageAttributes(attributes);
}

export function markInlineSizedImageHtml(html: string, url: string) {
  const target = normalizeImagePreviewUrl(url);
  if (!target) {
    return html;
  }
  try {
    const root = parseHtml(html);
    let changed = false;
    root.querySelectorAll('img').forEach((image) => {
      const src = attributeValue(image.attributes, 'src');
      if (normalizeImagePreviewUrl(src) !== target) {
        return;
      }
      if (typeof image.setAttribute === 'function') {
        image.setAttribute('data-forum-inline-sized', 'true');
      } else {
        image.attributes['data-forum-inline-sized'] = 'true';
      }
      changed = true;
    });
    return changed ? root.toString() : html;
  } catch {
    return html;
  }
}

export function inlineForumImageDisplaySize(attributes: Record<string, string | undefined>, scale = 1, contentWidth = 0) {
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const isSticker = isForumStickerImageAttributes(attributes);
  const isStickerRow = /^true$/i.test(attributeValue(attributes, STICKER_ROW_ATTR));
  const knownDimensions = knownForumStickerSourceDimensions(attributes);
  const fallbackSize = isSticker ? (isStickerRow ? STICKER_ROW_DEFAULT_SIZE : INLINE_STICKER_DEFAULT_SIZE) : 20;
  let displayWidth = width || (height && knownDimensions ? height * knownDimensions.width / knownDimensions.height : 0) || knownDimensions?.width || height || fallbackSize;
  let displayHeight = height || (width && knownDimensions ? width * knownDimensions.height / knownDimensions.width : 0) || knownDimensions?.height || width || fallbackSize;
  const maxSize = isSticker
    ? (isStickerRow ? STICKER_ROW_MAX_SIZE : INLINE_STICKER_MAX_SIZE)
    : isInlineForumImageAttributes(attributes) ? INLINE_EMOJI_MAX_SIZE : INLINE_STICKER_MAX_SIZE;
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
  displayWidth *= safeScale;
  displayHeight *= safeScale;
  if (isStickerRow && Number.isFinite(contentWidth) && contentWidth > 0) {
    const rowMaxSize = Math.max(64 * safeScale, contentWidth * STICKER_ROW_CONTENT_WIDTH_RATIO);
    const rowMaxDimension = Math.min(STICKER_ROW_MAX_SIZE * safeScale, rowMaxSize);
    const rowDimension = Math.max(displayWidth, displayHeight);
    if (rowDimension > rowMaxDimension) {
      const ratio = rowMaxDimension / rowDimension;
      displayWidth *= ratio;
      displayHeight *= ratio;
    }
  }
  return {
    width: Math.round(displayWidth),
    height: Math.round(displayHeight)
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
  if (!/<(?:aside|img)\b/i.test(html) && !FORUM_STICKER_MEDIA_PATTERN.test(html)) {
    return html;
  }
  try {
    const root = parseHtml(html);
    upgradeBlockImageSources(root);
    upgradeForumStickerMedia(root);
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

export function imageRequestHeadersForUrl(url: unknown, nodeSeekCookieHeader = '', nodeSeekUserAgent = DEFAULT_NODESEEK_ANDROID_USER_AGENT): Record<string, string> | undefined {
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
      headers['User-Agent'] = String(nodeSeekUserAgent || '').trim() || DEFAULT_NODESEEK_ANDROID_USER_AGENT;
      const cookieHeader = String(nodeSeekCookieHeader || '').trim();
      if (cookieHeader && !isPublicNodeSeekStaticMedia(parsed)) {
        headers.Cookie = cookieHeader;
      }
    }
    return headers;
  } catch {
    return undefined;
  }
}

export function imageSourceFromUrl(url: string, source?: unknown, nodeSeekCookieHeader = '', nodeSeekUserAgent = DEFAULT_NODESEEK_ANDROID_USER_AGENT) {
  const clean = normalizeImagePreviewUrl(url);
  const base: Record<string, unknown> = source && typeof source === 'object' && !Array.isArray(source)
    ? { ...(source as Record<string, unknown>), uri: clean }
    : { uri: clean };
  const headers = imageRequestHeadersForUrl(clean, nodeSeekCookieHeader, nodeSeekUserAgent);
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
  const match = clean.match(/^data:image\/(png|jpe?g|gif|webp|avif);base64,([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  const type = match[1].toLowerCase();
  const extension = type === 'jpeg' ? 'jpg' : type.split('+')[0];
  const base64 = match[2].trim();
  return base64 ? { base64, extension } : null;
}

export function createImagePreviewCatalog(htmlParts: string[]): ImagePreviewCatalog {
  const previewUrlBySourceUrl: Record<string, string> = {};
  const entries = htmlParts.flatMap(extractImagePreviewEntriesFromHtml);
  const urls = uniqueStrings(entries.map((entry) => normalizeImagePreviewUrl(entry.previewUrl)));
  entries.forEach((entry) => {
    const previewUrl = normalizeImagePreviewUrl(entry.previewUrl);
    [previewUrl, ...entry.sourceUrls].forEach((url) => {
      const normalized = normalizeImagePreviewUrl(url);
      if (normalized) {
        previewUrlBySourceUrl[normalized] = previewUrl;
      }
    });
  });
  return { urls, previewUrlBySourceUrl };
}

export function imagePreviewListFromCatalog(catalog: ImagePreviewCatalog, tappedUrl: string): ImagePreviewList {
  const tapped = normalizeImagePreviewUrl(tappedUrl);
  const tappedPreviewUrl = catalog.previewUrlBySourceUrl[tapped] || tapped;
  const urls = uniqueStrings([
    ...catalog.urls,
    ...(tappedPreviewUrl && !isInlineForumImageUrl(tappedPreviewUrl) ? [tappedPreviewUrl] : [])
  ]);
  const index = Math.max(0, urls.findIndex((url) => url === tappedPreviewUrl));
  return { urls, index };
}

export function visibleImagePreviewThumbnails(urls: string[], index: number, radius = 6) {
  const start = Math.max(0, index - radius);
  const end = Math.min(urls.length, index + radius + 1);
  return urls.slice(start, end).map((url, offset) => ({ url, index: start + offset }));
}

type ImagePreviewEntry = {
  previewUrl: string;
  sourceUrls: string[];
};

function imagePreviewEntryFromImage(image: ParsedImageNode): ImagePreviewEntry | null {
  return imagePreviewEntryFromAttributes(image.attributes, lightboxHrefForImage(image));
}

function imagePreviewEntryFromAttributes(attributes: Record<string, string | undefined>, linkedUrl = ''): ImagePreviewEntry | null {
  const sourceUrls = uniqueStrings([
    linkedUrl,
    ...srcsetImageUrls(attributeValue(attributes, 'srcset')),
    attributeValue(attributes, 'data-original'),
    attributeValue(attributes, 'data-src'),
    attributeValue(attributes, 'src')
  ].filter(isAllowedPreviewImageSource));
  const previewUrl = firstAllowedPreviewImageSource([
    linkedUrl,
    bestSrcsetImageUrl(attributeValue(attributes, 'srcset')),
    attributeValue(attributes, 'data-original'),
    attributeValue(attributes, 'data-src'),
    attributeValue(attributes, 'src')
  ]);
  return previewUrl ? { previewUrl, sourceUrls } : null;
}

function isAllowedPreviewImageSource(url: string) {
  const clean = decodeHtmlAttribute(url).trim();
  return Boolean(clean)
    && (isHttpOrHttpsUrl(clean) || clean.startsWith('/') || clean.startsWith('//') || isPreviewableImageUrl(clean))
    && (!/^data:image\//i.test(clean) || isAllowedDataImageUrl(clean));
}

function firstAllowedPreviewImageSource(urls: string[]) {
  return urls.map((url) => decodeHtmlAttribute(url).trim()).find(isAllowedPreviewImageSource) || '';
}

function splitSrcsetCandidates(srcset: string) {
  const candidates: string[] = [];
  let current = '';
  let dataUrlCommaSeen = false;
  for (const char of String(srcset || '')) {
    if (char === ',') {
      if (current.trim().toLowerCase().startsWith('data:') && !dataUrlCommaSeen) {
        current += char;
        dataUrlCommaSeen = true;
        continue;
      }
      candidates.push(current);
      current = '';
      dataUrlCommaSeen = false;
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    candidates.push(current);
  }
  return candidates;
}

function srcsetImageUrls(srcset: string) {
  return splitSrcsetCandidates(srcset)
    .map((candidate) => decodeHtmlAttribute(candidate.trim().split(/\s+/)[0] || '').trim())
    .filter(isAllowedPreviewImageSource);
}

function bestSrcsetImageUrl(srcset: string) {
  let bestUrl = '';
  let bestScore = -1;
  splitSrcsetCandidates(srcset).forEach((candidate, index) => {
    const parts = candidate.trim().split(/\s+/);
    const url = decodeHtmlAttribute(parts.shift() || '').trim();
    if (!isAllowedPreviewImageSource(url)) {
      return;
    }
    const descriptor = parts[0] || '';
    const width = descriptor.match(/^(\d+(?:\.\d+)?)w$/i);
    const density = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
    const score = width ? Number(width[1]) : density ? Number(density[1]) * 100 : index;
    if (score >= bestScore) {
      bestUrl = url;
      bestScore = score;
    }
  });
  return bestUrl;
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

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  setAttribute?: (name: string, value: string) => void;
  replaceWith?: (content: string) => void;
  querySelectorAll?: (selector: string) => ParsedImageNode[];
  parentNode?: unknown;
  parent?: unknown;
};

function quoteTitleTextNode(title: ParsedImageNode) {
  return title.querySelectorAll?.('div').find((node) => {
    const className = String(node.attributes?.class || '');
    return /(^|\s)quote-title__text-content(\s|$)/i.test(className);
  }) || title;
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function usernameFromForumAvatarUrl(value: string) {
  const clean = value.trim();
  const match = clean.match(/(?:^|\/)user_avatar\/(?:[^/?#]+\/)?([^/?#]+)\/\d+(?:\/|$)/i)
    || clean.match(/(?:^|\/)letter_avatar\/([^/?#]+)\/\d+(?:\/|$)/i);
  return match ? decodePathSegment(match[1]).trim() : '';
}

function quoteTitleAvatarUsername(title: ParsedImageNode) {
  const avatar = title.querySelectorAll?.('img').find((node) => isForumAvatarImageAttributes(node.attributes));
  return avatar ? usernameFromForumAvatarUrl(attributeValue(avatar.attributes, 'src')) : '';
}

function addQuoteTitleUsername(aside: ParsedImageNode, title: ParsedImageNode) {
  const username = attributeValue(aside.attributes, 'data-username') || attributeValue(aside.attributes, 'data-display-name') || quoteTitleAvatarUsername(title);
  if (!username) {
    return;
  }
  const target = quoteTitleTextNode(title);
  const titleText = textContentFromHtml(target.innerHTML || '').trim();
  if (titleText.toLowerCase().startsWith(`${username.toLowerCase()}:`) || /quote-title__username/i.test(target.innerHTML || '')) {
    return;
  }
  target.innerHTML = `<strong class="quote-title__username">${escapeHtmlText(username)}</strong><span class="quote-title__separator"> · </span>${target.innerHTML || ''}`;
}

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
        addQuoteTitleUsername(aside, container);
        flowImagesInMixedContainer(container, true, isForumAvatarImageAttributes);
      }
    });
  });
}

function flowImagesInMixedContainer(
  container: { innerHTML?: string; querySelectorAll?: (selector: string) => ParsedImageNode[]; childNodes?: unknown[] },
  directOnly = false,
  shouldFlowImage: (attributes: Record<string, string | undefined>) => boolean = isInlineForumImageAttributes
) {
  const images = directOnly ? directChildImages(container) : (container.querySelectorAll?.('img') || []);
  const flowableImages = images.filter((image) => shouldFlowImage(image.attributes));
  if (!flowableImages.length) {
    return;
  }
  if (!paragraphHasTextOutsideImages(container.innerHTML || '') && !flowableImages.every((image) => isInlineForumImageAttributes(image.attributes))) {
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

function upgradeForumStickerMedia(root: { querySelectorAll?: (selector: string) => ParsedImageNode[] }) {
  root.querySelectorAll?.('p').forEach((paragraph) => {
    const html = paragraph.innerHTML || '';
    if (!/<img\b/i.test(html) && !FORUM_STICKER_MEDIA_PATTERN.test(html)) {
      return;
    }
    const replacementHtml = stickerRowHtmlFromParagraph(html);
    if (replacementHtml && typeof paragraph.replaceWith === 'function') {
      paragraph.replaceWith(replacementHtml);
    }
  });
}

function stickerRowHtmlFromParagraph(html: string) {
  const pieces = html.split(/<br\s*\/?>/i)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const sourcePieces = pieces.length ? pieces : [html.trim()].filter(Boolean);
  let changed = false;
  const result = sourcePieces.map((piece) => {
    if (isStickerMediaOnlyHtml(piece)) {
      changed = true;
      return `<${FORUM_STICKER_ROW_TAG}>${stickerRowMediaHtml(piece)}</${FORUM_STICKER_ROW_TAG}>`;
    }
    const splitHtml = splitLargeStickerMediaFromTextHtml(piece);
    if (splitHtml) {
      changed = true;
      return splitHtml;
    }
    const inlineMediaLineHtml = inlineStickerMediaLineHtml(piece);
    if (inlineMediaLineHtml) {
      changed = true;
      return inlineMediaLineHtml;
    }
    const inlineHtml = inlineMixedStickerMediaHtml(piece);
    if (inlineHtml !== piece) {
      changed = true;
    }
    return `<p>${inlineHtml}</p>`;
  }).join('');
  return changed ? result : '';
}

function splitLargeStickerMediaFromTextHtml(html: string) {
  const result: string[] = [];
  const rowItems: string[] = [];
  const mediaPattern = new RegExp(`(<${FORUM_VIDEO_STICKER_TAG}\\b[^>]*>[\\s\\S]*?<\\/${FORUM_VIDEO_STICKER_TAG}>|<img\\b[^>]*>)`, 'gi');
  let inlineBuffer = '';
  let cursor = 0;
  let changed = false;

  const flushRowItems = () => {
    if (!rowItems.length) {
      return;
    }
    result.push(`<${FORUM_STICKER_ROW_TAG}>${rowItems.join(' ')}</${FORUM_STICKER_ROW_TAG}>`);
    rowItems.length = 0;
  };
  const flushInlineBuffer = () => {
    const inlineHtml = inlineMixedStickerMediaHtml(inlineBuffer).trim();
    inlineBuffer = '';
    if (!inlineHtml) {
      return;
    }
    flushRowItems();
    result.push(`<p>${inlineHtml}</p>`);
  };

  let match = mediaPattern.exec(html);
  while (match) {
    inlineBuffer += html.slice(cursor, match.index);
    const mediaHtml = match[0];
    const attributes = stickerMediaAttributesFromHtml(mediaHtml);
    if (shouldSplitStickerMediaElementFromText(mediaHtml, attributes)) {
      flushInlineBuffer();
      rowItems.push(stickerRowMediaHtml(mediaHtml).trim());
      changed = true;
    } else {
      inlineBuffer += mediaHtml;
    }
    cursor = mediaPattern.lastIndex;
    match = mediaPattern.exec(html);
  }
  inlineBuffer += html.slice(cursor);
  flushInlineBuffer();
  flushRowItems();
  return changed ? result.join('') : '';
}

function inlineStickerMediaLineHtml(html: string) {
  let changed = false;
  const lineHtml = html.replace(/<img\b([^>]*)>/gi, (match, attributesText: string) => {
    const attributes = imageAttributesFromText(attributesText);
    if (!shouldWrapStickerMediaInOwnLine(attributes)) {
      return match;
    }
    changed = true;
    return stickerImageHtml(attributesText, attributes);
  });
  return changed ? `<${FORUM_INLINE_MEDIA_LINE_TAG}>${lineHtml}</${FORUM_INLINE_MEDIA_LINE_TAG}>` : '';
}

function shouldWrapStickerMediaInOwnLine(attributes: Record<string, string | undefined>) {
  if (!isForumStickerImageAttributes(attributes)) {
    return false;
  }
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const knownDimensions = knownForumStickerSourceDimensions(attributes);
  const explicitDimension = Math.max(width, height);
  const maxDimension = explicitDimension || Math.max(knownDimensions?.width || 0, knownDimensions?.height || 0, INLINE_STICKER_DEFAULT_SIZE);
  return maxDimension > INLINE_EMOJI_MAX_SIZE && maxDimension <= INLINE_STICKER_MAX_SIZE;
}

function stickerMediaAttributesFromHtml(html: string) {
  const videoMatch = html.match(new RegExp(`^<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>`, 'i'));
  const imageMatch = html.match(/^<img\b([^>]*)>/i);
  return imageAttributesFromText(videoMatch?.[1] || imageMatch?.[1] || '');
}

function shouldSplitStickerMediaElementFromText(html: string, attributes: Record<string, string | undefined>) {
  const isVideoSticker = new RegExp(`^<${FORUM_VIDEO_STICKER_TAG}\\b`, 'i').test(html);
  if (isVideoSticker) {
    return shouldSplitStickerMediaFromText(attributes);
  }
  return isForumStickerImageAttributes(attributes) && shouldSplitStickerMediaFromText(attributes);
}

function shouldSplitStickerMediaFromText(attributes: Record<string, string | undefined>) {
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  if (Math.max(width, height) > INLINE_STICKER_MAX_SIZE) {
    return true;
  }
  if (width || height) {
    return false;
  }
  const knownDimensions = knownForumStickerSourceDimensions(attributes);
  return knownDimensions ? Math.max(knownDimensions.width, knownDimensions.height) > INLINE_STICKER_MAX_SIZE : false;
}

function isStickerMediaOnlyHtml(html: string) {
  const withoutStickerMedia = removeStickerMediaHtml(html);
  return withoutStickerMedia.hasSticker
    && textContentFromHtml(withoutStickerMedia.html).trim() === ''
    && !/<img\b/i.test(withoutStickerMedia.html)
    && !FORUM_STICKER_MEDIA_PATTERN.test(withoutStickerMedia.html);
}

function removeStickerMediaHtml(html: string) {
  let hasSticker = false;
  const withoutVideoStickers = html.replace(FORUM_VIDEO_STICKER_ELEMENT_PATTERN, () => {
    hasSticker = true;
    return ' ';
  });
  const withoutStickerImages = withoutVideoStickers.replace(/<img\b([^>]*)>/gi, (match, attributesText: string) => {
    const attributes = imageAttributesFromText(attributesText);
    if (!isForumStickerImageAttributes(attributes)) {
      return match;
    }
    hasSticker = true;
    return ' ';
  });
  return { hasSticker, html: withoutStickerImages };
}

function stickerRowMediaHtml(html: string) {
  return html
    .replace(FORUM_VIDEO_STICKER_OPEN_PATTERN, (_match, attributesText: string) => {
      const attributes = stickerRowAttributesText(attributesText);
      return `<${FORUM_VIDEO_STICKER_TAG}${attributes ? ` ${attributes}` : ''}>`;
    })
    .replace(/<img\b([^>]*)>/gi, (match, attributesText: string) => {
      const attributes = imageAttributesFromText(attributesText);
      if (!isForumStickerImageAttributes(attributes)) {
        return match;
      }
      const label = attributeValue(attributes, 'alt') || attributeValue(attributes, 'title') || attributeValue(attributes, 'src') || 'sticker';
      const rowAttributes = stickerRowAttributesText(attributesText);
      return `<${FORUM_STICKER_TAG}${rowAttributes ? ` ${rowAttributes}` : ''}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
    });
}

function stickerImageHtml(attributesText: string, attributes: Record<string, string | undefined>) {
  const label = attributeValue(attributes, 'alt') || attributeValue(attributes, 'title') || attributeValue(attributes, 'src') || 'sticker';
  const clean = attributesText.trim().replace(/\/\s*$/, '').trim();
  return `<${FORUM_STICKER_TAG}${clean ? ` ${clean}` : ''}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
}

function inlineMixedStickerMediaHtml(html: string) {
  return html.replace(FORUM_VIDEO_STICKER_ELEMENT_PATTERN, (match, attributesText: string) => {
    const attributes = imageAttributesFromText(attributesText);
    const fallbackSrc = attributeValue(attributes, 'data-fallback-src');
    if (!fallbackSrc) {
      return match;
    }
    const label = attributeValue(attributes, 'alt') || attributeValue(attributes, 'title') || fallbackSrc || 'sticker';
    const stickerAttributes = stickerFallbackAttributesText(attributes, fallbackSrc);
    return `<${FORUM_STICKER_TAG}${stickerAttributes ? ` ${stickerAttributes}` : ''}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
  });
}

function stickerFallbackAttributesText(attributes: Record<string, string | undefined>, src: string) {
  const names = ['class', 'alt', 'title', 'width', 'height'];
  return [
    `src="${escapeHtmlText(src)}"`,
    ...names.map((name) => {
      const value = attributeValue(attributes, name);
      return value ? `${name}="${escapeHtmlText(value)}"` : '';
    })
  ].filter(Boolean).join(' ');
}

function stickerRowAttributesText(value: string) {
  const clean = value.trim().replace(/\/\s*$/, '').trim();
  if (new RegExp(`(^|\\s)${STICKER_ROW_ATTR}\\s*=`, 'i').test(clean)) {
    return clean;
  }
  return [clean, `${STICKER_ROW_ATTR}="true"`].filter(Boolean).join(' ');
}

function upgradeBlockImageSources(root: { querySelectorAll?: (selector: string) => ParsedImageNode[] }) {
  root.querySelectorAll?.('img').forEach((image) => {
    if (isInlineForumImageAttributes(image.attributes)) {
      return;
    }
    const entry = imagePreviewEntryFromImage(image);
    if (entry?.previewUrl) {
      if (typeof image.setAttribute === 'function') {
        image.setAttribute('src', entry.previewUrl);
      } else {
        image.attributes.src = entry.previewUrl;
      }
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

function lightboxHrefForImage(image: { parentNode?: unknown; parent?: unknown }) {
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
    if (tagName === 'a' && /(^|\s)lightbox(\s|$)/i.test(className)) {
      return attributeValue(element.attributes || {}, 'href');
    }
    if (/(^|\s)lightbox-wrapper(\s|$)/i.test(className)) {
      return '';
    }
    current = element.parentNode || element.parent;
  }
  return '';
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
  const classMarksSticker = /(^|\s)sticker(\s|$)/i.test(className);
  const classMarksAvatar = /(^|\s)(avatar|user-avatar)(\s|$)/i.test(className);
  const runtimeMarksInlineSized = /^true$/i.test(attributeValue(attributes, 'data-forum-inline-sized'));
  const urlMarksEmoji = isInlineForumImageUrl(src);
  const urlMarksAvatar = /(^|\/)user_avatar\//i.test(src);
  const titleMarksEmoji = isForumEmojiLabel(title);
  const altMarksEmoji = isForumEmojiLabel(alt);
  const labelMarksSticker = isForumStickerImageAttributes(attributes);
  const hasEmojiMarker = classMarksEmoji || classMarksSticker || urlMarksEmoji || /^emoji$/i.test(role) || titleMarksEmoji || altMarksEmoji;
  return runtimeMarksInlineSized
    || labelMarksSticker
    || (hasEmojiMarker && (hasSmallSize || !width || !height || classMarksEmoji || urlMarksEmoji))
    || ((classMarksAvatar || urlMarksAvatar) && hasSmallSize);
}

function isForumStickerImageAttributes(attributes: Record<string, string | undefined>) {
  const className = attributeValue(attributes, 'class');
  return /(^|\s)sticker(\s|$)/i.test(className)
    || isForumStickerLabel(attributeValue(attributes, 'title'))
    || isForumStickerLabel(attributeValue(attributes, 'alt'));
}

function knownForumStickerSourceDimensions(attributes: Record<string, string | undefined>) {
  const path = nodeSeekStaticImagePath(attributeValue(attributes, 'src')) || nodeSeekStaticImagePath(attributeValue(attributes, 'data-fallback-src'));
  if (!path) {
    return null;
  }
  if (/^\/static\/image\/sticker\/ac\//i.test(path)) {
    return { width: 150, height: 130 };
  }
  if (/^\/static\/image\/sticker\/emoji\//i.test(path)) {
    return { width: 100, height: 100 };
  }
  if (/^\/static\/image\/sticker\/xhj\//i.test(path)) {
    return { width: 48, height: 48 };
  }
  if (/^\/static\/image\/smiley\/xhj\d{3}\.(?:png|gif|webp|apng)$/i.test(path)) {
    return { width: 120, height: 99 };
  }
  return null;
}

function nodeSeekStaticImagePath(value: string) {
  const clean = value.trim();
  if (!clean) {
    return '';
  }
  try {
    const parsed = new URL(clean, 'https://www.nodeseek.com');
    if (!isNodeSeekHost(parsed.hostname)) {
      return '';
    }
    return parsed.pathname;
  } catch {
    return clean.startsWith('/static/image/') ? clean.split(/[?#]/)[0] : '';
  }
}

function isForumEmojiLabel(value: string) {
  return /^:[a-z0-9_+.-]+:$/i.test(value) || isForumStickerLabel(value);
}

function isForumStickerLabel(value: string) {
  return /^xhj\d{3}$/i.test(value.trim());
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
  const markers = new Set(['emoji', 'emojis', 'emoticon', 'emoticons', 'emotion', 'emotions', 'face', 'faces', 'smiley', 'smilies', 'twemoji']);
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

function isPublicNodeSeekStaticMedia(url: URL) {
  return isNodeSeekHost(url.hostname) && /^\/static\/image\//i.test(url.pathname);
}
