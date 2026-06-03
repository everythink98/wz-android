import { parse, type HTMLElement } from 'node-html-parser';
import type { AccessRequirement } from './types';

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
    const text = value.trim();
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text}Z`
      : text.replace(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}:?\d{2})?$/, (_match, date, clock, zone = '') => (
        `${date}T${clock}${zone}`
      ));
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
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)));
}

export function textContentFromHtml(value: unknown) {
  return decodeHtml(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
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

export function isAllowedDataImageUrl(value: unknown) {
  return /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[\s\S]+$/i.test(String(value || '').trim());
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
    const looksLikeImageMetadata = classTokens(node.getAttribute('class')).includes('meta') || imageMetadataPrefixPattern.test(text);
    if (!node.querySelector('img') && looksLikeImageMetadata && imageDimensionPattern.test(text) && imageFileSizePattern.test(text)) {
      node.remove();
    }
  });
}

export function sanitizeContentHtml(html: unknown, baseUrl: string) {
  const root = parseHtml(html);
  for (const selector of ['script', 'style', 'iframe', 'noscript']) {
    root.querySelectorAll(selector).forEach((node) => node.remove());
  }
  removeForumImageMetadata(root);
  root.querySelectorAll('*').forEach((node) => {
    const attrs = { ...node.attributes };
    for (const [name, rawValue] of Object.entries(attrs)) {
      const lower = name.toLowerCase();
      const value = String(rawValue || '');
      if (lower.startsWith('on') || lower === 'style') {
        node.removeAttribute(name);
        continue;
      }
      if (lower === 'href' || lower === 'src') {
        const next = sanitizedUrlAttribute(lower, value, baseUrl);
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

export function parsePositiveInteger(value: unknown) {
  const match = String(value || '').replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function sortTopicsByTime<T extends { lastReplyAt?: string; createdAt: string }>(items: T[]) {
  return [...items].sort((left, right) => (
    Date.parse(right.lastReplyAt || right.createdAt || '') - Date.parse(left.lastReplyAt || left.createdAt || '')
  ));
}

export function sortTopicsByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort((left, right) => (
    Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '')
  ));
}

export function accessRequirementFromText(value: unknown) {
  const text = textContentFromHtml(value);
  if (/请先\s*登录|需要\s*登录|登录后(?:可|才|才能)?(?:查看|访问|回复|阅读)|未登录|login required|sign in (?:to|required)|log in (?:to|required)|must be logged in|you need to (?:log in|sign in)/i.test(text)) {
    return { type: 'login' as const, label: '需登录', detail: textContentFromHtml(text).slice(0, 80) };
  }
  if (/需要[^。；\n]{0,20}(?:等级|trust level)|(?:等级|trust level)[^。；\n]{0,20}(?:不足|要求|required|才能|才可|以上)|requires?[^.]{0,30}trust level|minimum trust level|must be (?:at least )?trust level/i.test(text)) {
    return { type: 'level' as const, label: '需等级', detail: textContentFromHtml(text).slice(0, 80) };
  }
  if (/权限不足|没有权限|无权(?:查看|访问|阅读)|无访问权限|permission denied|forbidden|private topic|not authorized|you do not have permission|you don't have permission/i.test(text)) {
    return { type: 'permission' as const, label: '需权限', detail: textContentFromHtml(text).slice(0, 80) };
  }
  return undefined;
}

function accessRequirementFromToken(value: unknown): AccessRequirement | undefined {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'login' || token === 'required_login' || token === 'login_required') {
    return { type: 'login', label: '需登录' };
  }
  if (token === 'level' || token === 'trust_level' || token === 'required_level') {
    return { type: 'level', label: '需等级' };
  }
  if (token === 'permission' || token === 'private' || token === 'restricted' || token === 'forbidden') {
    return { type: 'permission', label: '需权限' };
  }
  return undefined;
}

function normalizeAccessRequirement(value: unknown): AccessRequirement | undefined {
  if (typeof value === 'string') {
    return accessRequirementFromToken(value) || accessRequirementFromText(value);
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const type = value.type;
  const label = value.label;
  return (type === 'login' || type === 'level' || type === 'permission') && typeof label === 'string'
    ? { type, label, detail: typeof value.detail === 'string' ? value.detail : undefined }
    : undefined;
}

export function accessRequirementFromObject(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  const direct = normalizeAccessRequirement(value.accessRequirement)
    || normalizeAccessRequirement(value.access_requirement);
  if (direct) {
    return direct;
  }
  for (const key of ['loginRequired', 'login_required', 'requiresLogin', 'requires_login']) {
    if (value[key] === true) {
      return { type: 'login' as const, label: '需登录' };
    }
  }
  for (const key of ['read_restricted', 'restricted', 'private']) {
    if (value[key] === true) {
      return { type: 'permission' as const, label: '需权限' };
    }
  }
  for (const key of [
    'accessRequirement',
    'access_requirement',
    'accessRequirementText',
    'access_requirement_text',
    'accessReason',
    'access_reason',
    'restrictedReason',
    'restricted_reason',
    'restriction',
    'requiredAccess',
    'required_access',
    'message',
    'error'
  ]) {
    if (typeof value[key] === 'string') {
      const accessRequirement = accessRequirementFromToken(value[key]) || accessRequirementFromText(value[key]);
      if (accessRequirement) {
        return accessRequirement;
      }
    }
  }
  for (const key of ['requiredTrustLevel', 'required_trust_level', 'minimumTrustLevel', 'minimum_trust_level', 'minTrustLevel', 'min_trust_level']) {
    if (typeof value[key] === 'number' && value[key] > 0) {
      return { type: 'level' as const, label: '需等级', detail: `trust level ${value[key]}` };
    }
  }
  return undefined;
}

export function elementText(element: HTMLElement | null | undefined) {
  return decodeHtml(element?.text || '').replace(/\s+/g, ' ').trim();
}
