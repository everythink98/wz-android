import { parse, type HTMLElement } from 'node-html-parser';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

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

export function toIsoString(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  let time = Number.NaN;
  if (typeof value === 'number') {
    time = value > 10_000_000_000 ? value : value * 1000;
  } else if (typeof value === 'string') {
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value}Z`
      : value.replace(' ', 'T');
    time = Date.parse(normalized);
  }
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export function decodeHtml(value: unknown) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)));
}

export function textContentFromHtml(value: unknown) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function textExcerpt(value: unknown, maxLength = 120) {
  const text = textContentFromHtml(value);
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function parseHtml(value: unknown) {
  return parse(String(value || ''), {
    blockTextElements: {
      script: true,
      noscript: true,
      style: true,
      pre: true
    }
  });
}

export function sanitizeContentHtml(html: unknown, baseUrl: string) {
  const root = parseHtml(html);
  for (const selector of ['script', 'style', 'iframe', 'noscript']) {
    root.querySelectorAll(selector).forEach((node) => node.remove());
  }
  root.querySelectorAll('*').forEach((node) => {
    const attrs = { ...node.attributes };
    for (const [name, rawValue] of Object.entries(attrs)) {
      const lower = name.toLowerCase();
      const value = String(rawValue || '');
      if (lower.startsWith('on') || lower === 'style') {
        node.removeAttribute(name);
        continue;
      }
      if ((lower === 'href' || lower === 'src') && /^javascript:/i.test(value.trim())) {
        node.removeAttribute(name);
        continue;
      }
      if (lower === 'href' || lower === 'src') {
        const next = absoluteUrl(value, baseUrl);
        if (next) {
          node.setAttribute(name, next);
        }
      }
    }
  });
  return root.toString();
}

export function parsePositiveInteger(value: unknown) {
  const match = String(value || '').replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function sortTopicsByTime<T extends { lastReplyAt?: string; createdAt: string }>(items: T[]) {
  return [...items].sort((left, right) => (
    Date.parse(right.lastReplyAt || right.createdAt || '') - Date.parse(left.lastReplyAt || left.createdAt || '')
  ));
}

export function accessRequirementFromText(value: unknown) {
  const text = String(value || '');
  if (/登录|login|sign in/i.test(text)) {
    return { type: 'login' as const, label: '需登录', detail: textContentFromHtml(text).slice(0, 80) };
  }
  if (/等级|level|trust level/i.test(text)) {
    return { type: 'level' as const, label: '需等级', detail: textContentFromHtml(text).slice(0, 80) };
  }
  if (/权限|permission|private|forbidden/i.test(text)) {
    return { type: 'permission' as const, label: '需权限', detail: textContentFromHtml(text).slice(0, 80) };
  }
  return undefined;
}

export function accessRequirementFromObject(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  const text = JSON.stringify(value);
  return accessRequirementFromText(text);
}

export function elementText(element: HTMLElement | null | undefined) {
  return decodeHtml(element?.text || '').replace(/\s+/g, ' ').trim();
}
