import Anser from 'anser';
import type { HTMLElement } from 'node-html-parser';

import {
  absoluteUrl,
  decodeHtml,
  elementText,
  FORUM_LINK_CARD_TAG,
  FORUM_TERMINAL_REPORT_TAG,
  FORUM_TERMINAL_TAB_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG,
  isAllowedDataImageUrl,
  parseHtml,
  textContentFromHtml
} from './html';
import { bilibiliEmbedUrlFromUrl, nsEmbedFromUrl } from './videoEmbeds';
import { normalizeMediaReferrerPolicy } from './mediaReferrer';

function sanitizedUrlAttribute(name: 'href' | 'src', value: string, baseUrl: string) {
  const next = absoluteUrl(value, baseUrl);
  if (!next) {
    return undefined;
  }
  try {
    const protocol = new URL(next).protocol.toLowerCase();
    if (name === 'href' && (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:')) {
      return next;
    }
    if (name === 'src' && (protocol === 'http:' || protocol === 'https:' || isAllowedDataImageUrl(next))) {
      return next;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sanitizedHttpMediaUrl(value: unknown, baseUrl: string) {
  const next = absoluteUrl(value, baseUrl);
  if (!next) {
    return '';
  }
  try {
    const protocol = new URL(next).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:' ? next : '';
  } catch {
    return '';
  }
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
  root.querySelectorAll('*').forEach((node) => {
    if (node.hasAttribute('hidden') || inlineStyleHidesElement(node.getAttribute('style') || '')) {
      node.remove();
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

function removeForumImageMetadata(root: HTMLElement) {
  root.querySelectorAll('div').forEach((node) => {
    const text = decodeHtml(node.text).replace(/\s+/g, ' ').trim();
    const looksLikeImageMetadata =
      classTokens(node.getAttribute('class')).includes('meta') || imageMetadataPrefixPattern.test(text);
    if (
      !node.querySelector('img') &&
      looksLikeImageMetadata &&
      imageDimensionPattern.test(text) &&
      imageFileSizePattern.test(text)
    ) {
      node.remove();
    }
  });
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function referrerPolicyHtmlAttribute(name: string, value: unknown) {
  const policy = normalizeMediaReferrerPolicy(value);
  return policy ? ` ${name}="${policy}"` : '';
}

function oneboxText(node: HTMLElement | null | undefined, maxLength: number) {
  const text = textContentFromHtml(node?.innerHTML || node?.text || '');
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
  root.querySelectorAll('aside').forEach((node) => {
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
      node.remove();
      return;
    }
    const site = oneboxText(sourceLink, 80) || fallbackHost(href);
    const title = oneboxText(titleLink, 160) || site;
    const description = oneboxText(node.querySelector('article p') || node.querySelector('p'), 220);
    const thumbnail = firstClassedImage(node, 'thumbnail');
    const siteIcon = firstClassedImage(node, 'site-icon');
    const imageSrc = thumbnail ? sanitizedUrlAttribute('src', thumbnail.getAttribute('src') || '', baseUrl) || '' : '';
    const iconSrc = siteIcon ? sanitizedUrlAttribute('src', siteIcon.getAttribute('src') || '', baseUrl) || '' : '';
    node.replaceWith(
      `<${FORUM_LINK_CARD_TAG} href="${escapeHtmlAttribute(href)}" site="${escapeHtmlAttribute(site)}" title="${escapeHtmlAttribute(title)}" description="${escapeHtmlAttribute(description)}" image-src="${escapeHtmlAttribute(imageSrc)}" icon-src="${escapeHtmlAttribute(iconSrc)}"${referrerPolicyHtmlAttribute('image-referrerpolicy', thumbnail?.getAttribute('referrerpolicy'))}${referrerPolicyHtmlAttribute('icon-referrerpolicy', siteIcon?.getAttribute('referrerpolicy'))}></${FORUM_LINK_CARD_TAG}>`
    );
  });
}

function sanitizeIframes(root: HTMLElement, baseUrl: string) {
  root.querySelectorAll('iframe').forEach((node) => {
    const embed = nsEmbedFromUrl(node.getAttribute('src'), baseUrl);
    if (!embed) {
      node.remove();
      return;
    }
    if (embed.type === 'bilibili') {
      for (const name of Object.keys(node.attributes)) {
        node.removeAttribute(name);
      }
      node.setAttribute('src', embed.embedUrl);
      node.setAttribute('allowfullscreen', 'true');
      return;
    }
    node.replaceWith(
      `<a class="embed-link" href="${escapeHtmlAttribute(embed.sourceUrl)}">嵌入内容 · ${escapeHtmlAttribute(embed.displayDomain)}</a>`
    );
  });
}

function sanitizeNsVideoImages(root: HTMLElement, baseUrl: string) {
  root.querySelectorAll('img').forEach((node) => {
    const embedUrl = bilibiliEmbedUrlFromUrl(node.getAttribute('src'), baseUrl);
    if (!embedUrl) {
      return;
    }
    node.replaceWith(`<iframe src="${escapeHtmlAttribute(embedUrl)}" allowfullscreen="true"></iframe>`);
  });
}

function isNodeSeekHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'nodeseek.com' || host.endsWith('.nodeseek.com');
}

function nodeSeekStickerPngUrl(value: unknown, baseUrl: string) {
  const source = absoluteUrl(value, baseUrl);
  if (!source) {
    return '';
  }
  try {
    const url = new URL(source);
    if (!isNodeSeekHost(url.hostname) || !/^\/static\/image\/sticker\//i.test(url.pathname)) {
      return '';
    }
    if (!/\.(?:webm|mov|mp4)$/i.test(url.pathname)) {
      return '';
    }
    url.pathname = url.pathname.replace(/\.(?:webm|mov|mp4)$/i, '.png');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function nodeSeekStickerVideoUrl(value: unknown, baseUrl: string) {
  const source = absoluteUrl(value, baseUrl);
  if (!source) {
    return '';
  }
  try {
    const url = new URL(source);
    if (!isNodeSeekHost(url.hostname) || !/^\/static\/image\/sticker\//i.test(url.pathname)) {
      return '';
    }
    return /\.(?:webm|mov|mp4)$/i.test(url.pathname) ? url.toString() : '';
  } catch {
    return '';
  }
}

function safeStickerDimension(value: unknown, fallback = '100') {
  const text = String(value || '').trim();
  return /^\d{1,4}$/.test(text) ? text : fallback;
}

function sanitizeNodeSeekStickerVideos(root: HTMLElement, baseUrl: string) {
  root.querySelectorAll('video').forEach((node) => {
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
    node.replaceWith(
      `<${FORUM_VIDEO_STICKER_TAG} class="sticker" src="${escapeHtmlAttribute(stickerSrc)}" data-fallback-src="${escapeHtmlAttribute(fallbackUrl || '')}" alt="${escapeHtmlAttribute(alt)}" width="${width}" height="${height}"${referrerPolicyHtmlAttribute('referrerpolicy', node.getAttribute('referrerpolicy'))}></${FORUM_VIDEO_STICKER_TAG}>`
    );
  });
}

function videoSourceUrl(node: HTMLElement, baseUrl: string) {
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

function sanitizePlayableVideos(root: HTMLElement, baseUrl: string) {
  root.querySelectorAll('video').forEach((node) => {
    const src = videoSourceUrl(node, baseUrl);
    if (!src) {
      node.remove();
      return;
    }
    const poster = sanitizedUrlAttribute('src', node.getAttribute('poster') || '', baseUrl) || '';
    node.replaceWith(
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
  const lines = decodeHtml(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  const nonEmptyIndents = lines.filter((line) => line.trim()).map((line) => line.match(/^ */)?.[0].length || 0);
  const indent = nonEmptyIndents.length ? Math.min(...nonEmptyIndents) : 0;
  return indent ? lines.map((line) => line.slice(Math.min(indent, line.length))).join('\n') : lines.join('\n');
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
    ? xtermRows
        .querySelectorAll('.xterm-row')
        .map((row) => row.text)
        .join('\n')
    : source.text;
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
  if (!node || typeof node !== 'object') {
    return '';
  }
  const element = node as Partial<HTMLElement>;
  if (typeof element.getAttribute === 'function') {
    const html =
      Array.isArray(element.childNodes) && element.childNodes.length
        ? element.childNodes.map(xtermNodeHtml).join('')
        : terminalTextHtml(element.text || '');
    const style = elementTerminalStyle(element as HTMLElement);
    const styleAttr = terminalStyleAttribute(style);
    return html && styleAttr ? `<span${styleAttr}>${html}</span>` : html;
  }
  return terminalTextHtml(String((node as { text?: unknown }).text || ''));
}

function xtermRowsTerminalHtml(xtermRows: HTMLElement) {
  const rows = xtermRows.querySelectorAll('.xterm-row');
  if (!rows.length) {
    return '';
  }
  return terminalCodeBlockContentHtml(rows.map((row) => row.childNodes.map(xtermNodeHtml).join('')).join('<br />'));
}

function nodeSeekMagicTabContentHtml(body: HTMLElement) {
  const candidates = body.querySelectorAll('.terminal-container, .xterm-rows, pre, textarea');
  const candidateSet = new Set(candidates);
  const roots = candidates.filter((node) => {
    let parent = node.parentNode;
    while (parent && parent !== body) {
      if (candidateSet.has(parent)) return false;
      parent = parent.parentNode;
    }
    return true;
  });
  const meaningfulChildren = body.childNodes.filter((node) => Boolean(node.toString().trim()));
  if (!roots.length && meaningfulChildren.length === 1) {
    const onlyChild = meaningfulChildren[0] as HTMLElement;
    if (safeTagName(onlyChild) === 'code') roots.push(onlyChild);
  }
  roots.forEach((root) => {
    const xtermRows = root.matches('.xterm-rows') ? root : root.querySelector('.xterm-rows');
    if (xtermRows) {
      const replacement = xtermRowsTerminalHtml(xtermRows);
      if (replacement) xtermRows.replaceWith(replacement);
      if (root !== xtermRows) root.replaceWith(root.innerHTML);
      return;
    }
    if (root.matches('.terminal-container')) {
      const nestedTerminalRoots = root.querySelectorAll('pre, textarea');
      if (nestedTerminalRoots.length) {
        nestedTerminalRoots.forEach((nestedRoot) => {
          nestedRoot.replaceWith(terminalCodeBlockHtml(nodeSeekTerminalText(nestedRoot)));
        });
        root.replaceWith(root.innerHTML);
        return;
      }
    }
    const replacement = terminalCodeBlockHtml(nodeSeekTerminalText(root));
    if (replacement) root.replaceWith(replacement);
  });
  return body.innerHTML.trim();
}

function sanitizeNodeSeekMagicTabs(root: HTMLElement) {
  root.querySelectorAll('.nsk-magic-tabs').forEach((node) => {
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
      node.replaceWith(terminalReportHtml(sections));
    }
  });
}

function terminalTextFromAnsiCodeHtml(value: string) {
  return normalizeTerminalText(
    String(value || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<span\b[^>]*\bdata-ansicode=["']?27["']?[^>]*>\s*<\/span>/gi, '\x1B')
      .replace(/<span\b[^>]*\bdata-ansicode=["']?\d+["']?[^>]*>\s*<\/span>/gi, '')
      .replace(/<\/?span\b[^>]*>/gi, '')
      .replace(/<[^>]*>/g, '')
  );
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

const terminalSectionPattern =
  /<(?:p|div)\b[^>]*>\s*((?:💻|🎬|🌐|📍)[^<]{0,40})\s*<\/(?:p|div)>\s*<div class="forum-terminal-code">([\s\S]*?)<\/div>/g;

function sanitizeNodeSeekAnsiReportSectionsHtml(html: unknown) {
  const source = String(html || '');
  const matches = Array.from(source.matchAll(terminalSectionPattern));
  if (matches.length < 2) {
    return source;
  }
  const tabs = matches.map((match) =>
    terminalTabHtml(decodeHtml(match[1]).trim(), `<div class="forum-terminal-code">${match[2]}</div>`)
  );
  const first = matches[0];
  const last = matches[matches.length - 1];
  const start = first.index ?? 0;
  const end = (last.index ?? 0) + last[0].length;
  return `${source.slice(0, start)}${terminalReportHtml(tabs)}${source.slice(end)}`;
}

export function sanitizeContentHtml(html: unknown, baseUrl: string, transformRoot?: (root: HTMLElement) => void) {
  const root = parseHtml(sanitizeNodeSeekAnsiReportSectionsHtml(sanitizeNodeSeekAnsiCodeBlocksHtml(html)));
  removeHiddenContent(root);
  transformRoot?.(root);
  for (const selector of ['script', 'style', 'noscript']) {
    root.querySelectorAll(selector).forEach((node) => node.remove());
  }
  sanitizeNodeSeekMagicTabs(root);
  sanitizeNodeSeekStickerVideos(root, baseUrl);
  sanitizePlayableVideos(root, baseUrl);
  sanitizeIframes(root, baseUrl);
  sanitizeNsVideoImages(root, baseUrl);
  sanitizeDiscourseOneboxes(root, baseUrl);
  removeForumImageMetadata(root);
  root.querySelectorAll('*').forEach((node) => {
    const tagName = safeTagName(node);
    const attrs = { ...node.attributes };
    for (const [name, rawValue] of Object.entries(attrs)) {
      const lower = name.toLowerCase();
      const value = String(rawValue || '');
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
        const next =
          tagName === FORUM_VIDEO_TAG && lower === 'src'
            ? sanitizedHttpMediaUrl(value, baseUrl)
            : sanitizedUrlAttribute(lower === 'href' ? 'href' : 'src', value, baseUrl);
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
  return root.toString();
}
