import { parse, type HTMLElement } from 'node-html-parser';

export const FORUM_VIDEO_TAG = 'forum-video';

export const FORUM_VIDEO_STICKER_TAG = 'forum-video-sticker';

export const FORUM_LINK_CARD_TAG = 'forum-link-card';

export const FORUM_TERMINAL_REPORT_TAG = 'forum-terminal-report';

export const FORUM_TERMINAL_TAB_TAG = 'forum-terminal-tab';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function htmlEntityCodePoint(entity: string, codePoint: number) {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return entity;
  }
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

export function absoluteUrl(value: unknown, baseUrl: string) {
  const text = String(value || '').trim();
  if (!text) {
    return undefined;
  }
  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return undefined;
  }
}

export function toIsoString(value: unknown, defaultTimezone = '') {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  let time = Number.NaN;
  if (typeof value === 'number') {
    time = value > 10_000_000_000 ? value : value * 1000;
  } else if (typeof value === 'string') {
    const text = value.trim();
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text}Z`
      : text.replace(
          /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2})?$/,
          (_match, year, month, day, hour, minute, second = '', zone = '') =>
            `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}${second ? `:${second}` : ''}${zone || defaultTimezone}`
        );
    time = Date.parse(normalized);
  }
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export function decodeHtml(value: unknown) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (entity, name) => {
    const key = String(name).toLowerCase();
    if (key.startsWith('#x')) {
      return htmlEntityCodePoint(entity, Number.parseInt(key.slice(2), 16));
    }
    if (key.startsWith('#')) {
      return htmlEntityCodePoint(entity, Number.parseInt(key.slice(1), 10));
    }
    return NAMED_HTML_ENTITIES[key] || entity;
  });
}

export function escapeQuotedHtmlTagDelimiters(value: unknown) {
  let inTag = false;
  let quote = '';
  let result = '';
  for (const char of String(value || '')) {
    if (!inTag) {
      inTag = char === '<';
      result += char;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
        result += char;
      } else {
        result += char === '>' ? '&gt;' : char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      inTag = false;
    }
    result += char;
  }
  return result;
}

export function textContentFromHtml(value: unknown) {
  return decodeHtml(
    escapeQuotedHtmlTagDelimiters(value)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function textExcerpt(value: unknown, maxLength = 120) {
  const text = textContentFromHtml(value);
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function parseHtml(value: unknown, { parsePreContent = false }: { parsePreContent?: boolean } = {}) {
  return parse(String(value || ''), {
    blockTextElements: {
      script: true,
      noscript: true,
      style: true,
      ...(!parsePreContent ? { pre: true } : {})
    }
  });
}

export function hasRenderableHtmlContent(value: unknown) {
  if (textContentFromHtml(value)) {
    return true;
  }
  try {
    return Boolean(
      parseHtml(value).querySelector(
        `img, iframe, video, ${FORUM_VIDEO_TAG}, ${FORUM_VIDEO_STICKER_TAG}, ${FORUM_LINK_CARD_TAG}, ${FORUM_TERMINAL_REPORT_TAG}`
      )
    );
  } catch {
    return new RegExp(
      `<(?:img|iframe|video|${FORUM_VIDEO_TAG}|${FORUM_VIDEO_STICKER_TAG}|${FORUM_LINK_CARD_TAG}|${FORUM_TERMINAL_REPORT_TAG})\\b`,
      'i'
    ).test(String(value || ''));
  }
}

export function isAllowedDataImageUrl(value: unknown) {
  return /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[\s\S]+$/i.test(String(value || '').trim());
}

export function parsePositiveInteger(value: unknown) {
  const match = String(value || '')
    .replace(/,/g, '')
    .match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function sortTopicsByTime<T extends { lastReplyAt?: string; createdAt: string }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      Date.parse(right.lastReplyAt || right.createdAt || '') - Date.parse(left.lastReplyAt || left.createdAt || '')
  );
}

export function sortTopicsByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''));
}

export function elementText(element: HTMLElement | null | undefined) {
  return decodeHtml(element?.text || '')
    .replace(/\s+/g, ' ')
    .trim();
}
