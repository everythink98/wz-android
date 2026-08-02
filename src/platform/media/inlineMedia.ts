import {
  escapeQuotedHtmlTagDelimiters,
  FORUM_VIDEO_STICKER_TAG,
  parseHtml,
  textContentFromHtml
} from '@/domain/forum/html';
import { isNodeSeekHost, normalizeImagePreviewUrl } from './imageRequestSource';
import {
  attributeValue,
  DISPLAY_CANDIDATE_KIND_ATTR,
  fallbackBodyImageSource,
  imageAttributesFromText,
  imagePreviewEntryFromImage,
  INLINE_EMOJI_MAX_SIZE,
  isForumAvatarImageAttributes,
  isForumStickerImageAttributes,
  isInlineForumImageAttributes,
  isV2exEmbeddedImageAttributes,
  ORIGINAL_IMAGE_SOURCE_ATTR,
  parseImageDimension,
  safeTagName,
  type ParsedImageNode
} from './imagePreviewCatalog';

export const FORUM_STICKER_TAG = 'forum-sticker';

export const FORUM_STICKER_ROW_TAG = 'forum-sticker-row';

export const FORUM_INLINE_MEDIA_LINE_TAG = 'forum-inline-media-line';

export const INLINE_FORUM_IMAGE_TAG = 'forum-inline-image';

const FORUM_STICKER_MEDIA_PATTERN = new RegExp(`<${FORUM_STICKER_TAG}\\b|<${FORUM_VIDEO_STICKER_TAG}\\b`, 'i');

const FORUM_VIDEO_STICKER_ELEMENT_PATTERN = new RegExp(
  `<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>[\\s\\S]*?<\\/${FORUM_VIDEO_STICKER_TAG}>`,
  'gi'
);

const FORUM_VIDEO_STICKER_OPEN_PATTERN = new RegExp(`<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>`, 'gi');

const STICKER_ROW_ATTR = 'data-forum-sticker-row';

const INLINE_STICKER_DEFAULT_SIZE = 48;

const INLINE_STICKER_MAX_SIZE = 64;

const STICKER_ROW_DEFAULT_SIZE = 100;

const STICKER_ROW_MAX_SIZE = 160;

const STICKER_ROW_CONTENT_WIDTH_RATIO = 0.55;

const STICKER_ROW_DISPLAY_MAX_SIZE = 100;

export function shouldMarkLoadedImageInline(
  attributes: Record<string, string | undefined>,
  width: number,
  height: number
) {
  const maxDimension = Math.max(safeImageDimension(width), safeImageDimension(height));
  return maxDimension > 0 && maxDimension <= INLINE_EMOJI_MAX_SIZE && isV2exEmbeddedImageAttributes(attributes);
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

export function inlineForumImageDisplaySize(
  attributes: Record<string, string | undefined>,
  scale = 1,
  contentWidth = 0
) {
  const width = parseImageDimension(attributeValue(attributes, 'width'));
  const height = parseImageDimension(attributeValue(attributes, 'height'));
  const isSticker = isForumStickerImageAttributes(attributes);
  const isStickerRow = /^true$/i.test(attributeValue(attributes, STICKER_ROW_ATTR));
  const knownDimensions = knownForumStickerSourceDimensions(attributes);
  const fallbackSize = isSticker ? (isStickerRow ? STICKER_ROW_DEFAULT_SIZE : INLINE_STICKER_DEFAULT_SIZE) : 20;
  let displayWidth =
    width ||
    (height && knownDimensions ? (height * knownDimensions.width) / knownDimensions.height : 0) ||
    knownDimensions?.width ||
    height ||
    fallbackSize;
  let displayHeight =
    height ||
    (width && knownDimensions ? (width * knownDimensions.height) / knownDimensions.width : 0) ||
    knownDimensions?.height ||
    width ||
    fallbackSize;
  const maxSize = isSticker
    ? isStickerRow
      ? STICKER_ROW_MAX_SIZE
      : INLINE_STICKER_MAX_SIZE
    : isInlineForumImageAttributes(attributes)
      ? INLINE_EMOJI_MAX_SIZE
      : INLINE_STICKER_MAX_SIZE;
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
    const rowMaxSize = Math.max(64, contentWidth * STICKER_ROW_CONTENT_WIDTH_RATIO);
    const rowMaxDimension = Math.min(STICKER_ROW_DISPLAY_MAX_SIZE, rowMaxSize);
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

export function inlineForumImageAlignmentStyle(
  attributes: Record<string, string | undefined>,
  scale = 1,
  lineHeight = 0
) {
  if (!isInlineForumImageAttributes(attributes)) {
    return {};
  }
  const safeScale = safeImageScale(scale);
  const displaySize = inlineForumImageDisplaySize(attributes, safeScale);
  const resolvedLineHeight =
    Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : Math.round(16 * safeScale * 1.62);
  const translateY = Math.max(0, Math.round((resolvedLineHeight - displaySize.height) / 2));
  const classNames = (attributes.class || '').split(/\s+/);
  const isAvatar =
    classNames.includes('avatar') ||
    classNames.includes('user-avatar') ||
    /\/user_avatar\//i.test(attributes.src || '');
  return {
    ...(isAvatar ? { marginRight: Math.round(6 * safeScale) } : {}),
    ...(translateY > 0 ? { transform: [{ translateY }] } : {})
  };
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

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphHasTextOutsideImages(html: string) {
  const withoutImages = escapeQuotedHtmlTagDelimiters(html).replace(/<img\b[^>]*>/gi, ' ');
  return textContentFromHtml(withoutImages).length > 0;
}

function quoteTitleTextNode(title: ParsedImageNode) {
  return (
    title.querySelectorAll?.('div').find((node) => {
      const className = String(node.attributes?.class || '');
      return /(^|\s)quote-title__text-content(\s|$)/i.test(className);
    }) || title
  );
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
  const match =
    clean.match(/(?:^|\/)user_avatar\/(?:[^/?#]+\/)?([^/?#]+)\/\d+(?:\/|$)/i) ||
    clean.match(/(?:^|\/)letter_avatar\/([^/?#]+)\/\d+(?:\/|$)/i);
  return match ? decodePathSegment(match[1]).trim() : '';
}

function quoteTitleAvatarUsername(title: ParsedImageNode) {
  const avatar = title.querySelectorAll?.('img').find((node) => isForumAvatarImageAttributes(node.attributes));
  return avatar ? usernameFromForumAvatarUrl(attributeValue(avatar.attributes, 'src')) : '';
}

function addQuoteTitleUsername(aside: ParsedImageNode, title: ParsedImageNode) {
  const username =
    attributeValue(aside.attributes, 'data-username') ||
    attributeValue(aside.attributes, 'data-display-name') ||
    quoteTitleAvatarUsername(title);
  if (!username) {
    return;
  }
  const target = quoteTitleTextNode(title);
  const titleText = textContentFromHtml(target.innerHTML || '').trim();
  if (
    titleText.toLowerCase().startsWith(`${username.toLowerCase()}:`) ||
    /quote-title__username/i.test(target.innerHTML || '')
  ) {
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
  const images = directOnly ? directChildImages(container) : container.querySelectorAll?.('img') || [];
  const flowableImages = images.filter((image) => shouldFlowImage(image.attributes));
  if (!flowableImages.length) {
    return;
  }
  if (
    !paragraphHasTextOutsideImages(container.innerHTML || '') &&
    !flowableImages.every((image) => isInlineForumImageAttributes(image.attributes))
  ) {
    return;
  }
  flowableImages.forEach((image) => {
    if (isInsideLightboxImage(image)) {
      return;
    }
    const label =
      attributeValue(image.attributes, 'alt') ||
      attributeValue(image.attributes, 'title') ||
      attributeValue(image.attributes, 'src') ||
      'image';
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
  const normalizedHtml = escapeQuotedHtmlTagDelimiters(html);
  const pieces = normalizedHtml
    .split(/<br\s*\/?>/i)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const sourcePieces = pieces.length ? pieces : [normalizedHtml.trim()].filter(Boolean);
  let changed = false;
  const result = sourcePieces
    .map((piece) => {
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
    })
    .join('');
  return changed ? result : '';
}

function splitLargeStickerMediaFromTextHtml(html: string) {
  const result: string[] = [];
  const rowItems: string[] = [];
  const mediaPattern = new RegExp(
    `(<${FORUM_VIDEO_STICKER_TAG}\\b[^>]*>[\\s\\S]*?<\\/${FORUM_VIDEO_STICKER_TAG}>|<img\\b[^>]*>)`,
    'gi'
  );
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
  const explicitDimension = Math.max(width, height);
  if (explicitDimension) {
    return explicitDimension > INLINE_EMOJI_MAX_SIZE && explicitDimension <= INLINE_STICKER_MAX_SIZE;
  }
  const knownDimensions = knownForumStickerSourceDimensions(attributes);
  const maxDimension = Math.max(knownDimensions?.width || 0, knownDimensions?.height || 0, INLINE_STICKER_DEFAULT_SIZE);
  return maxDimension > INLINE_EMOJI_MAX_SIZE;
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
  return Math.max(width, height) > INLINE_STICKER_MAX_SIZE;
}

function isStickerMediaOnlyHtml(html: string) {
  const withoutStickerMedia = removeStickerMediaHtml(html);
  return (
    withoutStickerMedia.hasSticker &&
    textContentFromHtml(withoutStickerMedia.html).trim() === '' &&
    !/<img\b/i.test(withoutStickerMedia.html) &&
    !FORUM_STICKER_MEDIA_PATTERN.test(withoutStickerMedia.html)
  );
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
      const label =
        attributeValue(attributes, 'alt') ||
        attributeValue(attributes, 'title') ||
        attributeValue(attributes, 'src') ||
        'sticker';
      const rowAttributes = stickerRowAttributesText(attributesText);
      return `<${FORUM_STICKER_TAG}${rowAttributes ? ` ${rowAttributes}` : ''}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
    });
}

function stickerImageHtml(attributesText: string, attributes: Record<string, string | undefined>) {
  const label =
    attributeValue(attributes, 'alt') ||
    attributeValue(attributes, 'title') ||
    attributeValue(attributes, 'src') ||
    'sticker';
  const clean = attributesText
    .trim()
    .replace(/\/\s*$/, '')
    .trim();
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
  ]
    .filter(Boolean)
    .join(' ');
}

function stickerRowAttributesText(value: string) {
  const clean = value
    .trim()
    .replace(/\/\s*$/, '')
    .trim();
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
    const displaySource = fallbackBodyImageSource(image.attributes);
    const originalUri = imagePreviewEntryFromImage(image)?.item.originalUri;
    if (originalUri && originalUri !== displaySource?.uri) {
      if (typeof image.setAttribute === 'function') {
        image.setAttribute(ORIGINAL_IMAGE_SOURCE_ATTR, originalUri);
      } else {
        image.attributes[ORIGINAL_IMAGE_SOURCE_ATTR] = originalUri;
      }
    }
    if (displaySource?.uri && attributeValue(image.attributes, 'src') !== displaySource.uri) {
      if (typeof image.setAttribute === 'function') {
        image.setAttribute(DISPLAY_CANDIDATE_KIND_ATTR, displaySource.candidateKind);
        image.setAttribute('src', displaySource.uri);
      } else {
        image.attributes[DISPLAY_CANDIDATE_KIND_ATTR] = displaySource.candidateKind;
        image.attributes.src = displaySource.uri;
      }
    }
  });
}

function directChildImages(container: { childNodes?: unknown[] }) {
  return (container.childNodes || []).filter((child): child is ParsedImageNode => safeTagName(child) === 'img');
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
    if (
      (tagName === 'a' && /(^|\s)lightbox(\s|$)/i.test(className)) ||
      /(^|\s)lightbox-wrapper(\s|$)/i.test(className)
    ) {
      return true;
    }
    current = element.parentNode || element.parent;
  }
  return false;
}

function knownForumStickerSourceDimensions(attributes: Record<string, string | undefined>) {
  const path =
    nodeSeekStaticImagePath(attributeValue(attributes, 'src')) ||
    nodeSeekStaticImagePath(attributeValue(attributes, 'data-fallback-src'));
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

function safeImageDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function safeImageScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
