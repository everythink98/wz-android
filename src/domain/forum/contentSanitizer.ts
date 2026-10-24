import Anser from 'anser';
import { TextNode, HTMLElement } from 'node-html-parser';

import {
  decodeHtml,
  createForumTextIndex,
  elementText,
  forumNodeText,
  escapeHtmlAttribute,
  escapeHtmlText,
  FORUM_AUDIO_TAG,
  FORUM_LINK_CARD_TAG,
  FORUM_TERMINAL_REPORT_TAG,
  FORUM_TERMINAL_TAB_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG,
  isAllowedDataImageUrl,
  parseForumContentHtml,
  transformForumElements,
  type ForumTextSegment,
  type ForumTextTape
} from './html';
import { isNodeSeekHost } from './sourceCatalog';
import { bilibiliEmbedUrlFromUrl, nsEmbedFromUrl } from './videoEmbeds';
import { normalizeMediaReferrerPolicy } from './mediaReferrer';
import { FORUM_BOUNDED_INLINE_IMAGE_ATTRIBUTE, FORUM_FLOW_IMAGE_CONTEXT_ATTRIBUTE } from './forumContentMedia';

function parsedAbsoluteUrl(value: unknown, baseUrl?: string) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return new URL(text, baseUrl);
  } catch {
    return null;
  }
}

function sanitizedUrlAttribute(name: 'href' | 'src', value: string, baseUrl?: string) {
  const url = parsedAbsoluteUrl(value, baseUrl);
  if (!url) return undefined;
  const next = url.toString();
  const protocol = url.protocol.toLowerCase();
  if (name === 'href' && (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:')) {
    return next;
  }
  if (name === 'src' && (protocol === 'http:' || protocol === 'https:' || isAllowedDataImageUrl(next))) return next;
  return undefined;
}

function sanitizedHttpMediaUrl(value: unknown, baseUrl?: string) {
  const url = parsedAbsoluteUrl(value, baseUrl);
  if (!url) return '';
  const protocol = url.protocol.toLowerCase();
  return protocol === 'http:' || protocol === 'https:' ? url.toString() : '';
}

function decodedCloudflareEmail(value: string) {
  if (!/^(?:[0-9a-f]{2}){2,}$/i.test(value)) return undefined;
  const mask = Number.parseInt(value.slice(0, 2), 16);
  let encoded = '';
  for (let index = 2; index < value.length; index += 2) {
    const byte = Number.parseInt(value.slice(index, index + 2), 16) ^ mask;
    encoded += `%${byte.toString(16).padStart(2, '0')}`;
  }
  try {
    return decodeHtml(decodeURIComponent(encoded));
  } catch {
    return undefined;
  }
}

function restoreCloudflareEmails(root: HTMLElement, baseUrl: string) {
  for (const node of root.querySelectorAll('a[href*="/cdn-cgi/l/email-protection#"]')) {
    const url = parsedAbsoluteUrl(node.getAttribute('href'), baseUrl);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.pathname !== '/cdn-cgi/l/email-protection') continue;
    const email = decodedCloudflareEmail(url.hash.slice(1));
    if (email !== undefined) node.setAttribute('href', `mailto:${email}`);
  }
  transformForumElements(root, root.querySelectorAll('.__cf_email__[data-cfemail]'), (node) => {
    const email = decodedCloudflareEmail(node.getAttribute('data-cfemail') || '');
    if (email !== undefined) return [new TextNode(escapeHtmlText(email))];
  });
}

const safeCssColorPattern =
  /^(?:#[0-9a-f]{3,8}|rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;

const safeCssColorKeywords = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'transparent',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen'
]);

function safeCssColor(value: string) {
  const clean = value.replace(/\s*!important\s*$/i, '').trim();
  return safeCssColorPattern.test(clean) || safeCssColorKeywords.has(clean.toLowerCase()) ? clean : '';
}

function sanitizedStyleAttribute(value: string) {
  const declarations: string[] = [];
  for (const declaration of value.split(';')) {
    const separatorIndex = declaration.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }
    const name = declaration.slice(0, separatorIndex).trim().toLowerCase();
    if (name === 'text-align') {
      const alignment = declaration
        .slice(separatorIndex + 1)
        .replace(/\s*!important\s*$/i, '')
        .trim()
        .toLowerCase();
      if (alignment === 'left' || alignment === 'center' || alignment === 'right') {
        declarations.push(`${name}: ${alignment}`);
      }
      continue;
    }
    if (name !== 'color' && name !== 'background-color') {
      continue;
    }
    const color = safeCssColor(declaration.slice(separatorIndex + 1));
    if (color) {
      declarations.push(`${name}: ${color}`);
    }
  }
  return declarations.length ? declarations.join('; ') : undefined;
}

function inlineStyleHidesElement(value: string) {
  return value.split(';').some((declaration) => {
    const separatorIndex = declaration.indexOf(':');
    if (separatorIndex < 0) return false;
    const name = declaration.slice(0, separatorIndex).trim().toLowerCase();
    const nextValue = declaration
      .slice(separatorIndex + 1)
      .replace(/\s*!important\s*$/i, '')
      .trim()
      .toLowerCase();
    return name === 'display' && nextValue === 'none';
  });
}

function removeHiddenContent(root: HTMLElement) {
  transformForumElements(root, root.querySelectorAll('*'), (node) => {
    if (node.hasAttribute('hidden') || inlineStyleHidesElement(node.getAttribute('style') || '')) {
      return [];
    }
  });
}

const imageDimensionPattern = /\d{2,5}\s*[x×]\s*\d{2,5}\b/i;

const imageFileSizePattern = /\b\d+(?:\.\d+)?\s*(?:bytes?|[KMGT]?B)\b/i;

const imageMetadataPrefixPattern = /^(?:图片|image)\s*\d{2,5}\s*[x×]/i;

function classTokens(value: string | undefined) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean);
}

type ImageMetadataText = {
  prefix: string;
  suffix: string;
  full?: string;
  dimension: boolean;
  fileSize: boolean;
};

// Six digits distinguish the dimension limit (five) while retaining arbitrary-length file sizes.
// Whitespace and digit runs are compacted only for matching; the DOM content is never changed.
function compactImageMetadataText(text: string) {
  return text.replace(/\s+/g, ' ').replace(/\d{7,}/g, (digits) => digits.slice(0, 6));
}

function imageMetadataText(text: string): ImageMetadataText {
  const compact = compactImageMetadataText(text);
  const surrounded = `_${compact}_`;
  return {
    prefix: compact.slice(0, 32),
    suffix: compact.slice(-32),
    full: compact.length <= 64 ? compact : undefined,
    // Matches at either endpoint are provisional: a neighboring word character can invalidate \b.
    dimension: imageDimensionPattern.test(surrounded),
    fileSize: imageFileSizePattern.test(surrounded)
  };
}

function mergeImageMetadataText(left: ImageMetadataText, right: ImageMetadataText): ImageMetadataText {
  if (left.full !== undefined && right.full !== undefined) return imageMetadataText(left.full + right.full);
  const boundary = imageMetadataText(left.suffix + right.prefix);
  return {
    prefix: left.full === undefined ? left.prefix : compactImageMetadataText(left.full + right.prefix).slice(0, 32),
    suffix: right.full === undefined ? right.suffix : compactImageMetadataText(left.suffix + right.full).slice(-32),
    dimension: left.dimension || right.dimension || boundary.dimension,
    fileSize: left.fileSize || right.fileSize || boundary.fileSize
  };
}

function imageMetadataTextIndex(text: string) {
  const blockSize = 128;
  let size = 1;
  while (size * blockSize < text.length) size *= 2;
  const empty = imageMetadataText('');
  const tree: ImageMetadataText[] = Array.from({ length: size * 2 }, () => empty);
  for (let block = 0; block * blockSize < text.length; block++) {
    tree[size + block] = imageMetadataText(text.slice(block * blockSize, (block + 1) * blockSize));
  }
  for (let node = size - 1; node; node--) tree[node] = mergeImageMetadataText(tree[node * 2], tree[node * 2 + 1]);
  const cached = new Map<string, ImageMetadataText>();
  return (start: number, end: number) => {
    const key = `${start}:${end}`;
    const existing = cached.get(key);
    if (existing) return existing;
    let left = imageMetadataText(text.slice(start, Math.min(end, (Math.floor(start / blockSize) + 1) * blockSize)));
    let right = empty;
    let first = Math.floor(start / blockSize) + 1;
    const last = Math.floor(end / blockSize);
    if (first <= last) {
      right = imageMetadataText(text.slice(last * blockSize, end));
      first += size;
      let after = last + size;
      while (first < after) {
        if (first & 1) left = mergeImageMetadataText(left, tree[first++]);
        if (after & 1) right = mergeImageMetadataText(tree[--after], right);
        first >>>= 1;
        after >>>= 1;
      }
    }
    const result = mergeImageMetadataText(left, right);
    cached.set(key, result);
    return result;
  };
}

function removeForumImageMetadata(root: HTMLElement) {
  const candidates: { node: HTMLElement; imageStart: number; hasImage: boolean }[] = [];
  const pending: { node: HTMLElement; candidate?: (typeof candidates)[number]; exit: boolean }[] = [
    { node: root, exit: false }
  ];
  let images = 0;
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    if (entry.exit) {
      if (entry.candidate) entry.candidate.hasImage = images > entry.candidate.imageStart;
      continue;
    }
    const tag = entry.node.rawTagName?.toLowerCase();
    if (tag === 'img') images++;
    const candidate = tag === 'div' ? { node: entry.node, imageStart: images, hasImage: false } : undefined;
    if (candidate) candidates.push(candidate);
    pending.push({ ...entry, candidate, exit: true });
    for (let index = entry.node.childNodes.length - 1; index >= 0; index--) {
      const child = entry.node.childNodes[index];
      if (child instanceof HTMLElement) pending.push({ node: child, exit: false });
    }
  }
  const text = createForumTextIndex(root);
  const tapeQueries = new Map<ForumTextTape, ReturnType<typeof imageMetadataTextIndex>>();
  function segmentSummary(segment: ForumTextSegment) {
    let query = tapeQueries.get(segment.tape);
    if (!query) {
      query = imageMetadataTextIndex(segment.tape.text);
      tapeQueries.set(segment.tape, query);
    }
    return query(segment.start, segment.end);
  }
  const imageByNode = new Map(candidates.map(({ node, hasImage }) => [node, hasImage]));
  transformForumElements(
    root,
    candidates.map(({ node }) => node),
    (node) => {
      if (imageByNode.get(node)) return;
      const range = text.range(node);
      const summary = range.reduce(
        (result, segment) => mergeImageMetadataText(result, segmentSummary(segment)),
        imageMetadataText('')
      );
      const looksLikeImageMetadata =
        classTokens(node.getAttribute('class')).includes('meta') ||
        imageMetadataPrefixPattern.test(summary.prefix.trimStart());
      const prefix = summary.full ?? `${summary.prefix}_`;
      const suffix = summary.full ?? `_${summary.suffix}`;
      if (
        looksLikeImageMetadata &&
        (summary.dimension || imageDimensionPattern.test(prefix) || imageDimensionPattern.test(suffix)) &&
        (summary.fileSize || imageFileSizePattern.test(prefix) || imageFileSizePattern.test(suffix))
      )
        return [];
    }
  );
}

function replacementNodes(html: string) {
  const nodes = parseForumContentHtml(html).childNodes;
  return nodes.length ? nodes : [new TextNode(html)];
}

function referrerPolicyHtmlAttribute(name: string, value: unknown) {
  const policy = normalizeMediaReferrerPolicy(value);
  return policy ? ` ${name}="${policy}"` : '';
}

function oneboxText(node: HTMLElement | null | undefined, maxLength: number) {
  const text = elementText(node);
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function firstClassedImage(node: HTMLElement, className: string) {
  return node.querySelectorAll('img').find((image) => classTokens(image.getAttribute('class')).includes(className));
}

function fallbackHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function sanitizeDiscourseOneboxes(root: HTMLElement, baseUrl: string) {
  transformForumElements(root, root.querySelectorAll('aside'), (node) => {
    if (!classTokens(node.getAttribute('class')).includes('onebox')) {
      return;
    }
    const links = node.querySelectorAll('a');
    const sourceLink = node.querySelector('header a') || links[0];
    const titleLink = node.querySelector('h3 a') || links[1] || sourceLink;
    const rawHref =
      node.getAttribute('data-onebox-src') || titleLink?.getAttribute('href') || sourceLink?.getAttribute('href') || '';
    const href = sanitizedUrlAttribute('href', rawHref, baseUrl);
    if (!href) {
      return [];
    }
    const site = oneboxText(sourceLink, 80) || fallbackHost(href);
    const title = oneboxText(titleLink, 160) || site;
    const description = oneboxText(node.querySelector('article p') || node.querySelector('p'), 220);
    const thumbnail = firstClassedImage(node, 'thumbnail');
    const siteIcon = firstClassedImage(node, 'site-icon');
    const imageSrc = thumbnail ? sanitizedUrlAttribute('src', thumbnail.getAttribute('src') || '', baseUrl) || '' : '';
    const iconSrc = siteIcon ? sanitizedUrlAttribute('src', siteIcon.getAttribute('src') || '', baseUrl) || '' : '';
    return replacementNodes(
      `<${FORUM_LINK_CARD_TAG} href="${escapeHtmlAttribute(href)}" site="${escapeHtmlAttribute(site)}" title="${escapeHtmlAttribute(title)}" description="${escapeHtmlAttribute(description)}" image-src="${escapeHtmlAttribute(imageSrc)}" icon-src="${escapeHtmlAttribute(iconSrc)}"${referrerPolicyHtmlAttribute('image-referrerpolicy', thumbnail?.getAttribute('referrerpolicy'))}${referrerPolicyHtmlAttribute('icon-referrerpolicy', siteIcon?.getAttribute('referrerpolicy'))}></${FORUM_LINK_CARD_TAG}>`
    );
  });
}

function sanitizeIframes(root: HTMLElement, baseUrl: string) {
  transformForumElements(root, root.querySelectorAll('iframe'), (node) => {
    const embed = nsEmbedFromUrl(node.getAttribute('src'), baseUrl);
    if (!embed) {
      return [];
    }
    if (embed.type === 'bilibili') {
      for (const name of Object.keys(node.attributes)) {
        node.removeAttribute(name);
      }
      node.setAttribute('src', embed.embedUrl);
      node.setAttribute('allowfullscreen', 'true');
      return;
    }
    return replacementNodes(
      `<a class="embed-link" href="${escapeHtmlAttribute(embed.sourceUrl)}">嵌入内容 · ${escapeHtmlAttribute(embed.displayDomain)}</a>`
    );
  });
}

function sanitizeNsVideoImages(root: HTMLElement, baseUrl: string) {
  transformForumElements(root, root.querySelectorAll('img'), (node) => {
    const src = node.getAttribute('src');
    if (!/bilibili\.com/i.test(src || '')) return;
    const embedUrl = bilibiliEmbedUrlFromUrl(src, baseUrl);
    if (!embedUrl) {
      return;
    }
    return replacementNodes(`<iframe src="${escapeHtmlAttribute(embedUrl)}" allowfullscreen="true"></iframe>`);
  });
}

function nodeSeekStickerPngUrl(value: unknown, baseUrl: string) {
  const url = parsedAbsoluteUrl(value, baseUrl);
  if (!url || !isNodeSeekHost(url.hostname) || !/^\/static\/image\/sticker\//i.test(url.pathname)) {
    return '';
  }
  if (!/\.(?:webm|mov|mp4)$/i.test(url.pathname)) return '';
  url.pathname = url.pathname.replace(/\.(?:webm|mov|mp4)$/i, '.png');
  url.search = '';
  url.hash = '';
  return url.toString();
}

function nodeSeekStickerVideoUrl(value: unknown, baseUrl: string) {
  const url = parsedAbsoluteUrl(value, baseUrl);
  if (!url || !isNodeSeekHost(url.hostname) || !/^\/static\/image\/sticker\//i.test(url.pathname)) {
    return '';
  }
  return /\.(?:webm|mov|mp4)$/i.test(url.pathname) ? url.toString() : '';
}

function safeStickerDimension(value: unknown, fallback = '100') {
  const text = String(value || '').trim();
  return /^\d{1,4}$/.test(text) ? text : fallback;
}

function sanitizeNodeSeekStickerVideos(root: HTMLElement, baseUrl: string) {
  transformForumElements(root, root.querySelectorAll('video'), (node) => {
    if (!classTokens(node.getAttribute('class')).includes('sticker')) {
      return;
    }
    const sourceNodes = node.querySelectorAll('source');
    const videoUrl = sourceNodes
      .map((source) => nodeSeekStickerVideoUrl(source.getAttribute('src'), baseUrl))
      .find(Boolean);
    const fallbackUrl = sourceNodes
      .map((source) => nodeSeekStickerPngUrl(source.getAttribute('src'), baseUrl))
      .find(Boolean);
    if (!videoUrl && !fallbackUrl) {
      return;
    }
    const width = safeStickerDimension(node.getAttribute('width'));
    const height = safeStickerDimension(node.getAttribute('height'));
    const alt = String(node.getAttribute('alt') || node.getAttribute('title') || 'sticker');
    const stickerSrc = videoUrl || fallbackUrl || '';
    return replacementNodes(
      `<${FORUM_VIDEO_STICKER_TAG} class="sticker" src="${escapeHtmlAttribute(stickerSrc)}" data-fallback-src="${escapeHtmlAttribute(fallbackUrl || '')}" alt="${escapeHtmlAttribute(alt)}" width="${width}" height="${height}"${referrerPolicyHtmlAttribute('referrerpolicy', node.getAttribute('referrerpolicy'))}></${FORUM_VIDEO_STICKER_TAG}>`
    );
  });
}

function mediaSourceUrl(node: HTMLElement, baseUrl: string) {
  const candidates = [
    node.getAttribute('src'),
    ...node.querySelectorAll('source').map((source) => source.getAttribute('src'))
  ];
  return candidates.map((value) => sanitizedHttpMediaUrl(value, baseUrl)).find(Boolean) || '';
}

function safeTagName(node: HTMLElement) {
  const record = node as unknown as { rawTagName?: string; tagName?: string };
  return String(record.rawTagName || record.tagName || '').toLowerCase();
}

function sanitizePlayableAudio(root: HTMLElement, baseUrl: string) {
  transformForumElements(root, root.querySelectorAll('audio'), (node) => {
    const src = mediaSourceUrl(node, baseUrl);
    transformForumElements(node, node.querySelectorAll('source'), () => []);
    const fallbackHtml = node.innerHTML.trim();
    if (!src) {
      return fallbackHtml ? replacementNodes(fallbackHtml) : [];
    }
    const fallback = fallbackHtml || `<a href="${escapeHtmlAttribute(src)}">打开音频</a>`;
    return replacementNodes(
      `<${FORUM_AUDIO_TAG} src="${escapeHtmlAttribute(src)}"${referrerPolicyHtmlAttribute('referrerpolicy', node.getAttribute('referrerpolicy'))}>${fallback}</${FORUM_AUDIO_TAG}>`
    );
  });
}

function sanitizePlayableVideos(root: HTMLElement, baseUrl: string) {
  transformForumElements(root, root.querySelectorAll('video'), (node) => {
    const src = mediaSourceUrl(node, baseUrl);
    if (!src) {
      return [];
    }
    const poster = sanitizedUrlAttribute('src', node.getAttribute('poster') || '', baseUrl) || '';
    return replacementNodes(
      `<${FORUM_VIDEO_TAG} src="${escapeHtmlAttribute(src)}"${poster ? ` poster="${escapeHtmlAttribute(poster)}"` : ''}${referrerPolicyHtmlAttribute('referrerpolicy', node.getAttribute('referrerpolicy'))}></${FORUM_VIDEO_TAG}>`
    );
  });
}

const xtermColorSteps = [0, 95, 135, 175, 215, 255];

const xtermAnsiColors = [
  '#9ca3af',
  '#f87171',
  '#34d399',
  '#fbbf24',
  '#60a5fa',
  '#c084fc',
  '#22d3ee',
  '#e5e7eb',
  '#6b7280',
  '#fca5a5',
  '#86efac',
  '#fde68a',
  '#93c5fd',
  '#d8b4fe',
  '#67e8f9',
  '#f9fafb'
];

function normalizeTerminalText(value: string) {
  const lines = value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  let indent = Infinity;
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (line.trim()) indent = Math.min(indent, line.match(/^ */)?.[0].length || 0);
  }
  return lines
    .slice(start, end)
    .map((line) => line.slice(Math.min(indent, line.length)))
    .join('\n');
}

function terminalTextHtml(value: string) {
  return escapeHtmlText(value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').replace(/\t/g, '    '))
    .replace(/ /g, '&nbsp;')
    .replace(/\n/g, '<br />');
}

function anserEntryStyle(entry: Anser.AnserJsonEntry) {
  const color = entry.fg_truecolor || entry.fg;
  const backgroundColor = entry.bg_truecolor || entry.bg;
  return {
    ...(color ? { color: `rgb(${color})` } : {}),
    ...(backgroundColor ? { backgroundColor: `rgb(${backgroundColor})` } : {})
  };
}

function ansiTerminalHtml(value: string) {
  return Anser.ansiToJson(value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '').replace(/\t/g, '    '), {
    remove_empty: true
  })
    .map((entry) => {
      const html = terminalTextHtml(entry.content);
      const styleAttr = terminalStyleAttribute(anserEntryStyle(entry));
      return html && styleAttr ? `<span${styleAttr}>${html}</span>` : html;
    })
    .join('');
}

function terminalCodeBlockHtml(value: string) {
  return `<div class="forum-terminal-code">${ansiTerminalHtml(value)}</div>`;
}

function terminalCodeBlockContentHtml(contentHtml: string) {
  return `<div class="forum-terminal-code">${contentHtml}</div>`;
}

function terminalTabHtml(title: string, contentHtml: string) {
  return `<${FORUM_TERMINAL_TAB_TAG} title="${escapeHtmlAttribute(title)}">${contentHtml}</${FORUM_TERMINAL_TAB_TAG}>`;
}

function terminalReportHtml(sections: string[]) {
  return `<${FORUM_TERMINAL_REPORT_TAG}>${sections.join('')}</${FORUM_TERMINAL_REPORT_TAG}>`;
}

function xtermRowsInOrder(node: HTMLElement) {
  const markedRows = node.querySelectorAll('.xterm-row');
  return markedRows.length ? markedRows : node.children;
}

function nodeSeekTerminalText(node: HTMLElement) {
  const xtermRows = node.querySelector('.xterm-rows');
  const source =
    xtermRows ||
    node.querySelector('.terminal-container') ||
    node.querySelector('pre') ||
    node.querySelector('code') ||
    node.querySelector('textarea') ||
    node;
  const text = xtermRows
    ? xtermRowsInOrder(xtermRows)
        .map((row) => forumNodeText(row))
        .join('\n')
    : forumNodeText(source);
  return normalizeTerminalText(text || '');
}

function rgbHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue]
    .map((value) =>
      Math.max(0, Math.min(255, value || 0))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

function xtermColor(index: number) {
  if (xtermAnsiColors[index]) {
    return xtermAnsiColors[index];
  }
  if (index >= 16 && index <= 231) {
    const offset = index - 16;
    return rgbHex(
      xtermColorSteps[Math.floor(offset / 36)],
      xtermColorSteps[Math.floor((offset % 36) / 6)],
      xtermColorSteps[offset % 6]
    );
  }
  if (index >= 232 && index <= 255) {
    const value = 8 + (index - 232) * 10;
    return rgbHex(value, value, value);
  }
  return '';
}

function xtermClassStyle(className: string | undefined) {
  const style: { backgroundColor?: string; color?: string } = {};
  for (const token of classTokens(className)) {
    const foregroundIndex = Number.parseInt(token.match(/^xterm-fg-(\d+)$/)?.[1] || '', 10);
    if (Number.isFinite(foregroundIndex)) {
      const color = xtermColor(foregroundIndex);
      if (color) {
        style.color = color;
      }
    }
    const backgroundIndex = Number.parseInt(token.match(/^xterm-bg-(\d+)$/)?.[1] || '', 10);
    if (Number.isFinite(backgroundIndex)) {
      const color = xtermColor(backgroundIndex);
      if (color) {
        style.backgroundColor = color;
      }
    }
  }
  return style;
}

function sanitizedTerminalStyle(value: string) {
  const style: { backgroundColor?: string; color?: string } = {};
  for (const declaration of value.split(';')) {
    const separatorIndex = declaration.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }
    const name = declaration.slice(0, separatorIndex).trim().toLowerCase();
    if (name !== 'color' && name !== 'background-color') {
      continue;
    }
    const color = safeCssColor(declaration.slice(separatorIndex + 1));
    if (!color) {
      continue;
    }
    if (name === 'color') {
      style.color = color;
    } else {
      style.backgroundColor = color;
    }
  }
  return style;
}

function terminalStyleAttribute(style: { backgroundColor?: string; color?: string }) {
  const declarations = [
    style.color ? `color: ${style.color}` : '',
    style.backgroundColor ? `background-color: ${style.backgroundColor}` : ''
  ].filter(Boolean);
  return declarations.length ? ` style="${declarations.join('; ')}"` : '';
}

function elementTerminalStyle(node: HTMLElement) {
  return {
    ...xtermClassStyle(node.getAttribute('class')),
    ...sanitizedTerminalStyle(node.getAttribute('style') || '')
  };
}

function xtermNodeHtml(node: unknown): string {
  const parts: string[] = [];
  const pending: ({ node: unknown } | { openingIndex: number })[] = [{ node }];
  for (let current = pending.pop(); current; current = pending.pop()) {
    if ('openingIndex' in current) {
      if (parts.length > current.openingIndex + 1) parts.push('</span>');
      else parts.pop();
      continue;
    }
    if (!current.node || typeof current.node !== 'object') continue;
    const element = current.node as Partial<HTMLElement>;
    if (typeof element.getAttribute === 'function') {
      const styleAttr = terminalStyleAttribute(elementTerminalStyle(element as HTMLElement));
      if (Array.isArray(element.childNodes) && element.childNodes.length) {
        if (styleAttr) {
          const openingIndex = parts.length;
          parts.push(`<span${styleAttr}>`);
          pending.push({ openingIndex });
        }
        for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
          pending.push({ node: element.childNodes[index] });
        }
      } else {
        const html = terminalTextHtml(
          current.node instanceof HTMLElement ? forumNodeText(current.node) : element.text || ''
        );
        if (html) parts.push(styleAttr ? `<span${styleAttr}>${html}</span>` : html);
      }
    } else {
      const html = terminalTextHtml(
        current.node instanceof TextNode
          ? forumNodeText(current.node)
          : String((current.node as { text?: unknown }).text || '')
      );
      if (html) parts.push(html);
    }
  }
  return parts.join('');
}

function xtermRowsTerminalHtml(xtermRows: HTMLElement) {
  const rows = xtermRowsInOrder(xtermRows);
  if (!rows.length) {
    return '';
  }
  return terminalCodeBlockContentHtml(rows.map((row) => row.childNodes.map(xtermNodeHtml).join('')).join('<br />'));
}

function nodeSeekMagicTabContentHtml(body: HTMLElement) {
  const roots = body.querySelectorAll('.terminal-container, .xterm-rows, pre, textarea');
  const meaningfulChildren = body.childNodes.filter((node) => Boolean(node.toString().trim()));
  if (!roots.length && meaningfulChildren.length === 1) {
    const onlyChild = meaningfulChildren[0] as HTMLElement;
    if (safeTagName(onlyChild) === 'code') roots.push(onlyChild);
  }
  transformForumElements(body, roots, (root) => {
    const xtermRows = root.matches('.xterm-rows') ? root : root.querySelector('.xterm-rows');
    if (xtermRows) {
      const replacement = xtermRowsTerminalHtml(xtermRows);
      if (root === xtermRows) return replacement ? replacementNodes(replacement) : undefined;
      if (replacement) transformForumElements(root, [xtermRows], () => replacementNodes(replacement));
      if (root !== xtermRows) return replacementNodes(root.innerHTML);
      return;
    }
    if (root.matches('.terminal-container')) {
      const nestedTerminalRoots = root.querySelectorAll('pre, textarea');
      if (nestedTerminalRoots.length) {
        transformForumElements(root, nestedTerminalRoots, (nestedRoot) =>
          replacementNodes(terminalCodeBlockHtml(nodeSeekTerminalText(nestedRoot)))
        );
        return replacementNodes(root.innerHTML);
      }
    }
    const replacement = terminalCodeBlockHtml(nodeSeekTerminalText(root));
    if (replacement) return replacementNodes(replacement);
  });
  return body.innerHTML.trim();
}

function sanitizeNodeSeekMagicTabs(root: HTMLElement) {
  transformForumElements(root, root.querySelectorAll('.nsk-magic-tabs'), (node) => {
    const titles = node.querySelectorAll('.nsk-magic-tab-title');
    const bodies = node.querySelectorAll('.nsk-magic-tab-body');
    const sections = titles
      .map((titleNode, index) => {
        const title = elementText(titleNode);
        const body = bodies[index];
        const contentHtml = body ? nodeSeekMagicTabContentHtml(body) : '';
        if (!title && !contentHtml) {
          return '';
        }
        return terminalTabHtml(title, contentHtml);
      })
      .filter(Boolean);
    if (sections.length) {
      return replacementNodes(terminalReportHtml(sections));
    }
  });
}

function terminalTextFromAnsiCodeHtml(value: string) {
  const root = parseForumContentHtml(value);
  transformForumElements(root, root.querySelectorAll('span[data-ansicode]'), (node) => {
    const code = node.getAttribute('data-ansicode') || '';
    if (/^\d+$/.test(code) && node.childNodes.every((child) => child instanceof TextNode && !child.rawText.trim()))
      return code === '27' ? [new TextNode('\x1B')] : [];
  });
  return normalizeTerminalText(forumNodeText(root));
}

function sanitizeNodeSeekAnsiCodeBlocksHtml(html: unknown) {
  const source = String(html || '');
  return source
    .replace(/<pre\b[^>]*>\s*<code\b(?=[^>]*\blanguage-ansi\b)[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_match, body) =>
      terminalCodeBlockHtml(terminalTextFromAnsiCodeHtml(body))
    )
    .replace(/<code\b(?=[^>]*\blanguage-ansi\b)[^>]*>([\s\S]*?)<\/code>/gi, (_match, body) =>
      terminalCodeBlockHtml(terminalTextFromAnsiCodeHtml(body))
    );
}

function sanitizeNodeSeekAnsiReportSections(root: HTMLElement) {
  const replacements = new Map<HTMLElement, ReturnType<typeof replacementNodes>>();
  for (const parent of [root, ...root.querySelectorAll('*')]) {
    const siblings = parent.childNodes.filter((node) => !(node instanceof TextNode && !node.textContent.trim()));
    for (let index = 0; index < siblings.length;) {
      const sections: { heading: HTMLElement; code: HTMLElement }[] = [];
      while (index + 1 < siblings.length) {
        const heading = siblings[index] as HTMLElement;
        const code = siblings[index + 1] as HTMLElement;
        if (
          !['p', 'div'].includes(safeTagName(heading)) ||
          !heading.childNodes.every((node) => node instanceof TextNode) ||
          !/^(?:💻|🎬|🌐|📍)[\s\S]{0,40}$/u.test(elementText(heading)) ||
          safeTagName(code) !== 'div' ||
          !code.classList.contains('forum-terminal-code')
        )
          break;
        sections.push({ heading, code });
        index += 2;
      }
      if (sections.length >= 2) {
        replacements.set(
          sections[0].heading,
          replacementNodes(
            terminalReportHtml(
              sections.map(({ heading, code }) => terminalTabHtml(elementText(heading), code.toString()))
            )
          )
        );
        sections.forEach(({ heading, code }, sectionIndex) => {
          if (sectionIndex) replacements.set(heading, []);
          replacements.set(code, []);
        });
      }
      if (!sections.length) index++;
    }
  }
  transformForumElements(root, [...replacements.keys()], (node) => replacements.get(node));
}

function removeAutoClosedLightboxParagraphs(root: HTMLElement, markup: string) {
  if (!markup.includes('lightbox-wrapper')) return;
  const shells: HTMLElement[] = [];
  const parents = new Set(root.querySelectorAll('.lightbox-wrapper').map((node) => node.parentNode));
  for (const parent of parents) {
    if (!parent) continue;
    let previous: HTMLElement | undefined;
    for (const node of parent.childNodes) {
      if (node instanceof TextNode && /^[\t\n\f\r ]*$/.test(node.rawText)) continue;
      if (
        node instanceof HTMLElement &&
        node.tagName === 'DIV' &&
        node.classList.contains('lightbox-wrapper') &&
        previous?.tagName === 'P' &&
        previous.childNodes.every((child) => child instanceof TextNode && /^[\t\n\f\r ]*$/.test(child.rawText)) &&
        // Auto-closed p ranges contain only the opener; authored empty paragraphs keep their closing tag.
        /^<p[\t\n\f\r ]*>$/i.test(markup.slice(...previous.range))
      ) {
        shells.push(previous);
      }
      previous = node instanceof HTMLElement ? node : undefined;
    }
  }
  if (shells.length) transformForumElements(root, shells, () => []);
}

export function sanitizeContentHtmlWithRoot(
  html: unknown,
  baseUrl: string,
  transformRoot?: (root: HTMLElement) => void
) {
  const normalizedHtml = sanitizeNodeSeekAnsiCodeBlocksHtml(html);
  const root = parseForumContentHtml(normalizedHtml);
  removeAutoClosedLightboxParagraphs(root, normalizedHtml);
  removeHiddenContent(root);
  sanitizeNodeSeekAnsiReportSections(root);
  transformRoot?.(root);
  const markup = root.toString().toLowerCase();
  for (const selector of ['script', 'style', 'noscript']) {
    if (markup.includes(`<${selector}`)) transformForumElements(root, root.querySelectorAll(selector), () => []);
  }
  if (markup.includes('data-cfemail') || markup.includes('/cdn-cgi/l/email-protection#')) {
    restoreCloudflareEmails(root, baseUrl);
  }
  if (markup.includes('nsk-magic-tabs')) sanitizeNodeSeekMagicTabs(root);
  if (markup.includes('<video')) {
    sanitizeNodeSeekStickerVideos(root, baseUrl);
    sanitizePlayableVideos(root, baseUrl);
  }
  if (markup.includes('<audio')) sanitizePlayableAudio(root, baseUrl);
  if (markup.includes('<iframe')) sanitizeIframes(root, baseUrl);
  if (markup.includes('bilibili.com')) sanitizeNsVideoImages(root, baseUrl);
  if (markup.includes('<aside')) sanitizeDiscourseOneboxes(root, baseUrl);
  if (markup.includes('<div')) removeForumImageMetadata(root);
  // Validate the base once; fully qualified HTTP URLs still use the standard URL parser.
  const absoluteAttributeBase = parsedAbsoluteUrl(baseUrl, baseUrl) ? undefined : baseUrl;
  root.querySelectorAll('*').forEach((node) => {
    const tagName = safeTagName(node);
    for (const [name, rawValue] of Object.entries(node.attributes)) {
      const lower = name.toLowerCase();
      const value = String(rawValue || '');
      if (
        lower === FORUM_BOUNDED_INLINE_IMAGE_ATTRIBUTE ||
        lower === FORUM_FLOW_IMAGE_CONTEXT_ATTRIBUTE ||
        lower === 'data-forum-inline-sized'
      ) {
        node.removeAttribute(name);
        continue;
      }
      if (lower.startsWith('on')) {
        node.removeAttribute(name);
        continue;
      }
      if (lower === 'style') {
        const next = sanitizedStyleAttribute(value);
        if (next) {
          node.setAttribute(name, next);
        } else {
          node.removeAttribute(name);
        }
        continue;
      }
      if (lower === 'referrerpolicy' || lower === 'image-referrerpolicy' || lower === 'icon-referrerpolicy') {
        const next = normalizeMediaReferrerPolicy(value);
        if (next) {
          node.removeAttribute(name);
          node.setAttribute(lower, next);
        } else {
          node.removeAttribute(name);
        }
        continue;
      }
      if (
        lower === 'href' ||
        lower === 'src' ||
        lower === 'data-fallback-src' ||
        lower === 'image-src' ||
        lower === 'icon-src'
      ) {
        const attributeBase = /^https?:\/\//i.test(value) ? absoluteAttributeBase : baseUrl;
        const next =
          (tagName === FORUM_AUDIO_TAG || tagName === FORUM_VIDEO_TAG) && lower === 'src'
            ? sanitizedHttpMediaUrl(value, attributeBase)
            : sanitizedUrlAttribute(lower === 'href' ? 'href' : 'src', value, attributeBase);
        if (next) {
          node.setAttribute(name, next);
        } else {
          node.removeAttribute(name);
        }
        continue;
      }
      if (lower === 'poster') {
        const next = tagName === FORUM_VIDEO_TAG ? sanitizedUrlAttribute('src', value, baseUrl) : undefined;
        if (next) {
          node.setAttribute(name, next);
        } else {
          node.removeAttribute(name);
        }
      }
    }
  });
  const contentHtml = root.toString();
  return { contentHtml, root };
}

export function sanitizeContentHtml(html: unknown, baseUrl: string, transformRoot?: (root: HTMLElement) => void) {
  return sanitizeContentHtmlWithRoot(html, baseUrl, transformRoot).contentHtml;
}
