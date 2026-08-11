import {
  decodeHtml,
  escapeQuotedHtmlTagDelimiters,
  FORUM_VIDEO_STICKER_TAG,
  isAllowedDataImageUrl,
  parseHtml,
  textContentFromHtml
} from './html';

export const FORUM_STICKER_TAG = 'forum-sticker';
export const FORUM_STICKER_ROW_TAG = 'forum-sticker-row';
export const FORUM_INLINE_MEDIA_LINE_TAG = 'forum-inline-media-line';
export const INLINE_FORUM_IMAGE_TAG = 'forum-inline-image';
export const FORUM_DYNAMIC_INLINE_IMAGE_TAG = 'forum-dynamic-inline-image';
export const FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE = 'data-wz-dynamic-inline-image';
export const DISPLAY_CANDIDATE_KIND_ATTR = 'data-forum-display-candidate-kind';
export const ORIGINAL_IMAGE_SOURCE_ATTR = 'data-forum-original-src';
export const INLINE_EMOJI_MAX_SIZE = 24;

export type DynamicInlineImageDescriptor = {
  id: string;
  url: string;
};

export type ParsedForumImageNode = {
  tagName: string;
  rawTagName?: string | null;
  attributes: Record<string, string | undefined>;
  classNames?: string;
  innerHTML?: string;
  set_content?: (content: string) => void;
  setAttribute?: (name: string, value: string) => void;
  removeAttribute?: (name: string) => void;
  replaceWith?: (content: string) => void;
  querySelectorAll?: (selector: string) => ParsedForumImageNode[];
  childNodes?: unknown[];
  parentNode?: unknown;
  parent?: unknown;
};

type ForumContentMediaRoot = ReturnType<typeof parseHtml>;

const STICKER_ROW_ATTR = 'data-forum-sticker-row';
const INLINE_STICKER_MAX_SIZE = 64;
const FORUM_STICKER_MEDIA_PATTERN = new RegExp(`<${FORUM_STICKER_TAG}\\b|<${FORUM_VIDEO_STICKER_TAG}\\b`, 'i');
const FORUM_VIDEO_STICKER_ELEMENT_PATTERN = new RegExp(
  `<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>[\\s\\S]*?<\\/${FORUM_VIDEO_STICKER_TAG}>`,
  'gi'
);
const FORUM_VIDEO_STICKER_OPEN_PATTERN = new RegExp(`<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>`, 'gi');

export function normalizeForumContentMediaNodes(
  root: ForumContentMediaRoot,
  { dynamicV2exImages = false }: { dynamicV2exImages?: boolean } = {}
) {
  scrubForgedDynamicInlineImages(root);
  upgradeBlockImageSources(root);
  upgradeForumStickerMedia(root);
  root.querySelectorAll('p').forEach((paragraph) => {
    flowImagesInMixedContainer(paragraph as ParsedForumImageNode);
  });
  flowQuoteTitleAvatars(root);
  flowImagesInMixedContainer(root as unknown as ParsedForumImageNode, true);
  return dynamicV2exImages ? markDynamicV2exInlineImageNodes(root) : [];
}

export function normalizeForumStickerMediaHtml(html: string) {
  if (!/<img\b/i.test(html) && !FORUM_STICKER_MEDIA_PATTERN.test(html)) return html;
  try {
    const root = parseHtml(html);
    return upgradeForumStickerMedia(root) ? root.toString() : html;
  } catch {
    return html;
  }
}

export function forumImageAttributeValue(attributes: Record<string, string | undefined>, name: string) {
  return String(attributes[name] || attributes[name.toLowerCase()] || '').trim();
}

export function parseForumImageDimension(value: string) {
  const match = value.match(/^\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

export function forumImageAttributesFromText(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match = pattern.exec(value);
  while (match) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] || match[3] || match[4] || '');
    match = pattern.exec(value);
  }
  return attributes;
}

export function forumImageTagName(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const element = value as { rawTagName?: string | null; tagName?: string };
  return String(element.rawTagName || element.tagName || '').toLowerCase();
}

export function isV2exEmbeddedForumImage(attributes: Record<string, string | undefined>) {
  return /(^|\s)embedded_image(\s|$)/i.test(forumImageAttributeValue(attributes, 'class'));
}

export function isForumStickerImage(attributes: Record<string, string | undefined>) {
  const className = forumImageAttributeValue(attributes, 'class');
  return (
    /(^|\s)sticker(\s|$)/i.test(className) ||
    isForumStickerLabel(forumImageAttributeValue(attributes, 'title')) ||
    isForumStickerLabel(forumImageAttributeValue(attributes, 'alt'))
  );
}

export function isInlineForumImage(attributes: Record<string, string | undefined>) {
  const className = forumImageAttributeValue(attributes, 'class');
  const src = forumImageAttributeValue(attributes, 'src');
  const title = forumImageAttributeValue(attributes, 'title');
  const alt = forumImageAttributeValue(attributes, 'alt');
  const role = forumImageAttributeValue(attributes, 'role');
  const width = parseForumImageDimension(forumImageAttributeValue(attributes, 'width'));
  const height = parseForumImageDimension(forumImageAttributeValue(attributes, 'height'));
  const hasSmallSize = (width > 0 && width <= 64) || (height > 0 && height <= 64);
  const hasTinyExplicitSize = width > 0 && height > 0 && Math.max(width, height) <= INLINE_EMOJI_MAX_SIZE;
  const classMarksEmoji = /(^|\s)(emoji|emoticon|smiley|twemoji)(\s|$)/i.test(className);
  const classMarksSticker = /(^|\s)sticker(\s|$)/i.test(className);
  const classMarksAvatar = /(^|\s)(avatar|user-avatar)(\s|$)/i.test(className);
  const runtimeMarksInlineSized = /^true$/i.test(forumImageAttributeValue(attributes, 'data-forum-inline-sized'));
  const urlMarksEmoji = isInlineForumImageUrl(src);
  const urlMarksAvatar = /(^|\/)user_avatar\//i.test(src);
  const titleMarksEmoji = isForumEmojiLabel(title);
  const altMarksEmoji = isForumEmojiLabel(alt);
  const labelMarksSticker = isForumStickerImage(attributes);
  const hasEmojiMarker =
    classMarksEmoji || classMarksSticker || urlMarksEmoji || /^emoji$/i.test(role) || titleMarksEmoji || altMarksEmoji;
  return (
    runtimeMarksInlineSized ||
    labelMarksSticker ||
    (isV2exEmbeddedForumImage(attributes) && hasTinyExplicitSize) ||
    (hasEmojiMarker && (hasSmallSize || !width || !height || classMarksEmoji || urlMarksEmoji)) ||
    ((classMarksAvatar || urlMarksAvatar) && hasSmallSize)
  );
}

export function isForumAvatarImage(attributes: Record<string, string | undefined>) {
  const className = forumImageAttributeValue(attributes, 'class');
  const src = forumImageAttributeValue(attributes, 'src');
  const width = parseForumImageDimension(forumImageAttributeValue(attributes, 'width'));
  const height = parseForumImageDimension(forumImageAttributeValue(attributes, 'height'));
  const hasSmallSize = (width > 0 && width <= 64) || (height > 0 && height <= 64);
  return hasSmallSize && (/(^|\s)(avatar|user-avatar)(\s|$)/i.test(className) || /(^|\/)user_avatar\//i.test(src));
}

function scrubForgedDynamicInlineImages(root: ForumContentMediaRoot) {
  root.querySelectorAll(FORUM_DYNAMIC_INLINE_IMAGE_TAG).forEach((node) => {
    node.tagName = 'span';
    node.removeAttribute(FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE);
  });
  root.querySelectorAll(`[${FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE}]`).forEach((node) => {
    node.removeAttribute(FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE);
  });
}

function markDynamicV2exInlineImageNodes(root: ForumContentMediaRoot) {
  const descriptors: DynamicInlineImageDescriptor[] = [];
  root.querySelectorAll('img').forEach((image) => {
    if (!isV2exEmbeddedForumImage(image.attributes) || isInsideLightboxImage(image)) return;
    const url = normalizeForumImageUrl(forumImageAttributeValue(image.attributes, 'src'));
    if (!url) return;
    const id = String(descriptors.length);
    const label =
      forumImageAttributeValue(image.attributes, 'alt') ||
      forumImageAttributeValue(image.attributes, 'title') ||
      forumImageAttributeValue(image.attributes, 'src') ||
      'image';
    image.tagName = FORUM_DYNAMIC_INLINE_IMAGE_TAG;
    image.setAttribute(FORUM_DYNAMIC_INLINE_IMAGE_ID_ATTRIBUTE, id);
    image.set_content(label);
    descriptors.push({ id, url });
  });
  return descriptors;
}

function upgradeBlockImageSources(root: ForumContentMediaRoot) {
  root.querySelectorAll('img').forEach((image) => {
    if (isInlineForumImage(image.attributes)) return;
    const displaySource = fallbackForumBodyImageSource(image.attributes);
    const originalUri = originalForumImageSource(image);
    if (originalUri && originalUri !== displaySource?.uri) image.setAttribute(ORIGINAL_IMAGE_SOURCE_ATTR, originalUri);
    if (displaySource?.uri && forumImageAttributeValue(image.attributes, 'src') !== displaySource.uri) {
      image.setAttribute(DISPLAY_CANDIDATE_KIND_ATTR, displaySource.candidateKind);
      image.setAttribute('src', displaySource.uri);
    }
  });
}

function fallbackForumBodyImageSource(attributes: Record<string, string | undefined>) {
  const src = normalizeForumImageUrl(forumImageAttributeValue(attributes, 'src'));
  if (isAllowedActiveForumImageSource(src) && !isKnownPlaceholderForumImageUrl(src)) {
    const preservedKind = (['data-src', 'data-original'] as const).find(
      (candidateKind) =>
        forumImageAttributeValue(attributes, DISPLAY_CANDIDATE_KIND_ATTR) === candidateKind &&
        normalizeForumImageUrl(forumImageAttributeValue(attributes, candidateKind)) === src
    );
    return { uri: src, candidateKind: preservedKind || ('src' as const) };
  }
  for (const candidateKind of ['data-src', 'data-original'] as const) {
    const uri = normalizeForumImageUrl(forumImageAttributeValue(attributes, candidateKind));
    if (isAllowedActiveForumImageSource(uri) && !isKnownPlaceholderForumImageUrl(uri)) return { uri, candidateKind };
  }
  return null;
}

function originalForumImageSource(image: ParsedForumImageNode) {
  const linkedUrl = lightboxHrefForForumImage(image);
  return firstAllowedForumImageSource([
    linkedUrl,
    forumImageAttributeValue(image.attributes, 'data-original'),
    bestForumSrcsetImageUrl(forumImageAttributeValue(image.attributes, 'srcset')),
    forumImageAttributeValue(image.attributes, 'data-src'),
    forumImageAttributeValue(image.attributes, 'src')
  ]);
}

function firstAllowedForumImageSource(values: string[]) {
  return (
    values
      .map(normalizeForumImageUrl)
      .find((value) => isAllowedActiveForumImageSource(value) && !isKnownPlaceholderForumImageUrl(value)) || ''
  );
}

function bestForumSrcsetImageUrl(srcset: string) {
  let bestUrl = '';
  let bestScore = -1;
  splitForumSrcsetCandidates(srcset).forEach((candidate, index) => {
    const parts = candidate.trim().split(/\s+/);
    const url = String(parts.shift() || '').trim();
    if (!isAllowedActiveForumImageSource(url)) return;
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

function splitForumSrcsetCandidates(srcset: string) {
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
  if (current.trim()) candidates.push(current);
  return candidates;
}

function normalizeForumImageUrl(value: string) {
  const clean = String(value || '').trim();
  return clean.startsWith('//') ? `https:${clean}` : clean;
}

function isAllowedActiveForumImageSource(value: string) {
  const clean = normalizeForumImageUrl(value);
  if (isAllowedDataImageUrl(clean)) return true;
  try {
    const protocol = new URL(clean).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isKnownPlaceholderForumImageUrl(value: string) {
  const clean = normalizeForumImageUrl(value);
  if (
    /^data:image\/gif;base64,R0lGODlhAQABA/i.test(clean) ||
    /^data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB/i.test(clean)
  ) {
    return true;
  }
  try {
    const basename = new URL(clean).pathname.split('/').pop() || '';
    return /^(?:blank|spacer|transparent)(?:[-_.@].*)?\.(?:gif|png|webp)$/i.test(basename);
  } catch {
    return false;
  }
}

function lightboxHrefForForumImage(image: ParsedForumImageNode) {
  let current = image.parentNode || image.parent;
  while (current && typeof current === 'object') {
    const element = current as ParsedForumImageNode;
    const tagName = forumImageTagName(element);
    const className = String(element.classNames || element.attributes?.class || '');
    if (tagName === 'a' && /(^|\s)lightbox(\s|$)/i.test(className)) {
      return forumImageAttributeValue(element.attributes || {}, 'href');
    }
    if (/(^|\s)lightbox-wrapper(\s|$)/i.test(className)) return '';
    current = element.parentNode || element.parent;
  }
  return '';
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

function quoteTitleTextNode(title: ParsedForumImageNode) {
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

function quoteTitleAvatarUsername(title: ParsedForumImageNode) {
  const avatar = title.querySelectorAll?.('img').find((node) => isForumAvatarImage(node.attributes));
  return avatar ? usernameFromForumAvatarUrl(forumImageAttributeValue(avatar.attributes, 'src')) : '';
}

function addQuoteTitleUsername(aside: ParsedForumImageNode, title: ParsedForumImageNode) {
  const username =
    forumImageAttributeValue(aside.attributes, 'data-username') ||
    forumImageAttributeValue(aside.attributes, 'data-display-name') ||
    quoteTitleAvatarUsername(title);
  if (!username) return;
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

function flowQuoteTitleAvatars(root: { querySelectorAll?: (selector: string) => ParsedForumImageNode[] }) {
  root.querySelectorAll?.('aside').forEach((aside) => {
    const className = String(aside.attributes?.class || '');
    if (!/(^|\s)quote(\s|$)/i.test(className)) return;
    aside.querySelectorAll?.('div').forEach((container) => {
      const containerClass = String(container.attributes?.class || '');
      if (/(^|\s)quote-title__text-content(\s|$)/i.test(containerClass)) container.tagName = 'span';
      if (/(^|\s)title(\s|$)/i.test(containerClass)) {
        addQuoteTitleUsername(aside, container);
        flowImagesInMixedContainer(container, true, isForumAvatarImage);
      }
    });
  });
}

function flowImagesInMixedContainer(
  container: ParsedForumImageNode,
  directOnly = false,
  shouldFlowImage: (attributes: Record<string, string | undefined>) => boolean = isInlineForumImage
) {
  const images = directOnly ? directChildImages(container) : container.querySelectorAll?.('img') || [];
  const flowableImages = images.filter((image) => shouldFlowImage(image.attributes));
  if (!flowableImages.length) return;
  if (
    !paragraphHasTextOutsideImages(container.innerHTML || '') &&
    !flowableImages.every((image) => isInlineForumImage(image.attributes))
  ) {
    return;
  }
  flowableImages.forEach((image) => {
    if (isInsideLightboxImage(image)) return;
    const label =
      forumImageAttributeValue(image.attributes, 'alt') ||
      forumImageAttributeValue(image.attributes, 'title') ||
      forumImageAttributeValue(image.attributes, 'src') ||
      'image';
    image.tagName = INLINE_FORUM_IMAGE_TAG;
    if (typeof image.set_content === 'function') image.set_content(label);
    else image.innerHTML = label;
  });
}

function upgradeForumStickerMedia(root: { querySelectorAll?: (selector: string) => ParsedForumImageNode[] }) {
  let changed = false;
  root.querySelectorAll?.('p').forEach((paragraph) => {
    const html = paragraph.innerHTML || '';
    if (!/<img\b/i.test(html) && !FORUM_STICKER_MEDIA_PATTERN.test(html)) return;
    const replacementHtml = stickerRowHtmlFromParagraph(html);
    if (replacementHtml && typeof paragraph.replaceWith === 'function') {
      paragraph.replaceWith(replacementHtml);
      changed = true;
    }
  });
  return changed;
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
      if (inlineHtml !== piece) changed = true;
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
    if (!rowItems.length) return;
    result.push(`<${FORUM_STICKER_ROW_TAG}>${rowItems.join(' ')}</${FORUM_STICKER_ROW_TAG}>`);
    rowItems.length = 0;
  };
  const flushInlineBuffer = () => {
    const inlineHtml = inlineMixedStickerMediaHtml(inlineBuffer).trim();
    inlineBuffer = '';
    if (!inlineHtml) return;
    flushRowItems();
    result.push(inlineStickerMediaLineHtml(inlineHtml) || `<p>${inlineHtml}</p>`);
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
    const attributes = forumImageAttributesFromText(attributesText);
    if (!shouldWrapStickerMediaInOwnLine(attributes)) return match;
    changed = true;
    return stickerImageHtml(attributesText, attributes);
  });
  return changed ? `<${FORUM_INLINE_MEDIA_LINE_TAG}>${lineHtml}</${FORUM_INLINE_MEDIA_LINE_TAG}>` : '';
}

function shouldWrapStickerMediaInOwnLine(attributes: Record<string, string | undefined>) {
  if (!isForumStickerImage(attributes)) return false;
  const width = parseForumImageDimension(forumImageAttributeValue(attributes, 'width'));
  const height = parseForumImageDimension(forumImageAttributeValue(attributes, 'height'));
  const explicitDimension = Math.max(width, height);
  if (explicitDimension)
    return explicitDimension > INLINE_EMOJI_MAX_SIZE && explicitDimension <= INLINE_STICKER_MAX_SIZE;
  const knownDimensions = knownForumStickerSourceDimensions(attributes);
  return Math.max(knownDimensions?.width || 0, knownDimensions?.height || 0, 48) > INLINE_EMOJI_MAX_SIZE;
}

function stickerMediaAttributesFromHtml(html: string) {
  const videoMatch = html.match(new RegExp(`^<${FORUM_VIDEO_STICKER_TAG}\\b([^>]*)>`, 'i'));
  const imageMatch = html.match(/^<img\b([^>]*)>/i);
  return forumImageAttributesFromText(videoMatch?.[1] || imageMatch?.[1] || '');
}

function shouldSplitStickerMediaElementFromText(html: string, attributes: Record<string, string | undefined>) {
  return (
    (new RegExp(`^<${FORUM_VIDEO_STICKER_TAG}\\b`, 'i').test(html) || isForumStickerImage(attributes)) &&
    shouldSplitStickerMediaFromText(attributes)
  );
}

function shouldSplitStickerMediaFromText(attributes: Record<string, string | undefined>) {
  const width = parseForumImageDimension(forumImageAttributeValue(attributes, 'width'));
  const height = parseForumImageDimension(forumImageAttributeValue(attributes, 'height'));
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
    if (!isForumStickerImage(forumImageAttributesFromText(attributesText))) return match;
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
      const attributes = forumImageAttributesFromText(attributesText);
      if (!isForumStickerImage(attributes)) return match;
      const label =
        forumImageAttributeValue(attributes, 'alt') ||
        forumImageAttributeValue(attributes, 'title') ||
        forumImageAttributeValue(attributes, 'src') ||
        'sticker';
      const rowAttributes = stickerRowAttributesText(attributesText);
      return `<${FORUM_STICKER_TAG}${rowAttributes ? ` ${rowAttributes}` : ''}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
    });
}

function stickerImageHtml(attributesText: string, attributes: Record<string, string | undefined>) {
  const label =
    forumImageAttributeValue(attributes, 'alt') ||
    forumImageAttributeValue(attributes, 'title') ||
    forumImageAttributeValue(attributes, 'src') ||
    'sticker';
  const clean = attributesText
    .trim()
    .replace(/\/\s*$/, '')
    .trim();
  return `<${FORUM_STICKER_TAG}${clean ? ` ${clean}` : ''}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
}

function inlineMixedStickerMediaHtml(html: string) {
  return html.replace(FORUM_VIDEO_STICKER_ELEMENT_PATTERN, (match, attributesText: string) => {
    const attributes = forumImageAttributesFromText(attributesText);
    const fallbackSrc = forumImageAttributeValue(attributes, 'data-fallback-src');
    if (!fallbackSrc) return match;
    const label =
      forumImageAttributeValue(attributes, 'alt') ||
      forumImageAttributeValue(attributes, 'title') ||
      fallbackSrc ||
      'sticker';
    return `<${FORUM_STICKER_TAG} ${stickerFallbackAttributesText(attributes, fallbackSrc)}>${escapeHtmlText(label)}</${FORUM_STICKER_TAG}>`;
  });
}

function stickerFallbackAttributesText(attributes: Record<string, string | undefined>, src: string) {
  const names = ['class', 'alt', 'title', 'width', 'height'];
  return [
    `src="${escapeHtmlText(src)}"`,
    ...names.map((name) => {
      const value = forumImageAttributeValue(attributes, name);
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
  if (new RegExp(`(^|\\s)${STICKER_ROW_ATTR}\\s*=`, 'i').test(clean)) return clean;
  return [clean, `${STICKER_ROW_ATTR}="true"`].filter(Boolean).join(' ');
}

function directChildImages(container: { childNodes?: unknown[] }) {
  return (container.childNodes || []).filter(
    (child): child is ParsedForumImageNode => forumImageTagName(child) === 'img'
  );
}

function isInsideLightboxImage(image: { parentNode?: unknown; parent?: unknown }) {
  let current = image.parentNode || image.parent;
  while (current && typeof current === 'object') {
    const element = current as ParsedForumImageNode;
    const tagName = forumImageTagName(element);
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

export function knownForumStickerSourceDimensions(attributes: Record<string, string | undefined>) {
  const path =
    nodeSeekStaticImagePath(forumImageAttributeValue(attributes, 'src')) ||
    nodeSeekStaticImagePath(forumImageAttributeValue(attributes, 'data-fallback-src'));
  if (!path) return null;
  if (/^\/static\/image\/sticker\/ac\//i.test(path)) return { width: 150, height: 130 };
  if (/^\/static\/image\/sticker\/emoji\//i.test(path)) return { width: 100, height: 100 };
  if (/^\/static\/image\/smiley\/xhj\d{3}\.(?:png|gif|webp|apng)$/i.test(path)) return { width: 120, height: 99 };
  return null;
}

function nodeSeekStaticImagePath(value: string) {
  const clean = value.trim();
  if (!clean) return '';
  try {
    const parsed = new URL(clean, 'https://www.nodeseek.com');
    const host = parsed.hostname.toLowerCase();
    return host === 'nodeseek.com' || host.endsWith('.nodeseek.com') ? parsed.pathname : '';
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

export function isInlineForumImageUrl(url: string) {
  const markers = new Set([
    'emoji',
    'emojis',
    'emoticon',
    'emoticons',
    'emotion',
    'emotions',
    'face',
    'faces',
    'smiley',
    'smilies',
    'twemoji'
  ]);
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase().includes('twemoji')) return true;
    return parsed.pathname.split('/').some((part) => markers.has(part.toLowerCase()));
  } catch {
    return url
      .split(/[?#]/)[0]
      .split('/')
      .some((part) => markers.has(part.toLowerCase()));
  }
}
