import { parse, type HTMLElement } from 'node-html-parser';
import { accessRequirementLevelValue } from './appUtils';
import { bilibiliEmbedUrlFromUrl, nsEmbedFromUrl } from './nsVideoEmbeds';
import type { AccessRequirement } from './types';

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
      : text.replace(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}:?\d{2})?$/, (_match, date, clock, zone = '') => (
        `${date}T${clock}${zone || defaultTimezone}`
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
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex) => htmlEntityCodePoint(entity, Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (entity, code) => htmlEntityCodePoint(entity, Number.parseInt(code, 10)));
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

const safeCssColorPattern = /^(?:#[0-9a-f]{3,8}|rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;
const safeCssColorKeywords = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black', 'blanchedalmond',
  'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue',
  'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey',
  'darkkhaki', 'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue',
  'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred',
  'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
  'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
  'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip',
  'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown',
  'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue',
  'slateblue', 'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle',
  'tomato', 'transparent', 'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen'
]);

function safeCssColor(value: string) {
  const clean = value.replace(/\s*!important\s*$/i, '').trim();
  return safeCssColorPattern.test(clean) || safeCssColorKeywords.has(clean.toLowerCase()) ? clean : '';
}

function sanitizedStyleAttribute(value: string) {
  for (const declaration of value.split(';')) {
    const separatorIndex = declaration.indexOf(':');
    if (separatorIndex < 0) {
      continue;
    }
    const name = declaration.slice(0, separatorIndex).trim().toLowerCase();
    if (name !== 'color') {
      continue;
    }
    const color = safeCssColor(declaration.slice(separatorIndex + 1));
    if (color) {
      return `color: ${color}`;
    }
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

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
    node.replaceWith(`<a class="embed-link" href="${escapeHtmlAttribute(embed.sourceUrl)}">嵌入内容 · ${escapeHtmlAttribute(embed.displayDomain)}</a>`);
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

export function sanitizeContentHtml(html: unknown, baseUrl: string) {
  const root = parseHtml(html);
  for (const selector of ['script', 'style', 'noscript']) {
    root.querySelectorAll(selector).forEach((node) => node.remove());
  }
  sanitizeIframes(root, baseUrl);
  sanitizeNsVideoImages(root, baseUrl);
  removeForumImageMetadata(root);
  root.querySelectorAll('*').forEach((node) => {
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

function accessRequirementFromLevel(value: unknown) {
  const level = parsePositiveInteger(value);
  return level > 0 ? { type: 'level' as const, label: '需等级', detail: `Lv${level}` } : undefined;
}

function accessRequirementDetail(text: string, match: RegExpMatchArray) {
  const start = Math.max(0, (match.index ?? 0) - 12);
  return textContentFromHtml(text.slice(start, start + 112)).slice(0, 80);
}

const ACCESS_REQUIREMENT_LEVEL_PATTERN_SOURCE = String.raw`需要[^。；\n]{0,40}(?:等级|trust level|lv\s*\d+)|需要[^。；\n]{0,40}\d+\s*级[^。；\n]{0,24}(?:查看|阅读|才能|才可|以上|可见)|(?:等级|trust level|lv\s*\d+)[^。；\n]{0,40}(?:不足|要求|required|才能|才可|以上)|requires?[^.]{0,40}(?:trust\s+level|level\s*(?:of\s+|[:：#-]\s*)?\d+)|minimum (?:trust\s+level|level\s*(?:of\s+|[:：#-]\s*)?\d+)|must be (?:at least )?(?:trust\s+level|level\s*(?:of\s+|[:：#-]\s*)?\d+)`;
const ACCESS_REQUIREMENT_LOGIN_PATTERN_SOURCE = String.raw`请先\s*登录|需要\s*登录|登录后(?:可|才|才能)?(?:查看|访问|回复|阅读|可见)|未登录|login required|sign in (?:to|required)|log in (?:to|required)|must be logged in|you need to (?:log in|sign in)`;
const ACCESS_REQUIREMENT_PERMISSION_PATTERN_SOURCE = String.raw`本帖已经被用户设为私有，您没有阅读权限|权限不足|权限不够|没有权限|暂无权限|无权限|无权(?:查看|访问|阅读)|无访问权限|当前用户组不可(?:查看|访问|阅读)|游客不可见|permission denied|access denied|insufficient privileges|not allowed|not permitted|forbidden|(?:private|restricted)\s+(?:topic|category)|(?:this\s+)?(?:topic|category)\s+is\s+(?:private|restricted)\.?|you are not permitted|not authorized|you do not have permission|you don't have permission`;
export const ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE = [
  ACCESS_REQUIREMENT_LEVEL_PATTERN_SOURCE,
  ACCESS_REQUIREMENT_LOGIN_PATTERN_SOURCE,
  ACCESS_REQUIREMENT_PERMISSION_PATTERN_SOURCE
].join('|');
const ACCESS_REQUIREMENT_EMBEDDED_PERMISSION_PATTERN_SOURCE = String.raw`本帖已经被用户设为私有，您没有阅读权限|权限不足|权限不够|没有权限|暂无权限|无权限|无权(?:查看|访问|阅读)|无访问权限|当前用户组不可(?:查看|访问|阅读)|游客不可见|permission denied|access denied|insufficient privileges|not allowed|not permitted|forbidden|this\s+topic\s+is\s+(?:private|restricted)\.?|you are not permitted|not authorized|you do not have permission|you don't have permission`;

const accessRequirementLevelPattern = new RegExp(ACCESS_REQUIREMENT_LEVEL_PATTERN_SOURCE, 'i');
const accessRequirementLoginPattern = new RegExp(ACCESS_REQUIREMENT_LOGIN_PATTERN_SOURCE, 'i');
const accessRequirementPermissionPattern = new RegExp(ACCESS_REQUIREMENT_PERMISSION_PATTERN_SOURCE, 'i');
const accessRequirementNoticeStartPattern = new RegExp(`^(?:${ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE})`, 'i');
const accessRequirementEmbeddedPermissionPattern = new RegExp(ACCESS_REQUIREMENT_EMBEDDED_PERMISSION_PATTERN_SOURCE, 'i');

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
  const levelMatch = text.match(accessRequirementLevelPattern);
  if (levelMatch) {
    return { type: 'level' as const, label: '需等级', detail: accessRequirementDetail(text, levelMatch) };
  }
  const loginMatch = text.match(accessRequirementLoginPattern);
  if (loginMatch) {
    return { type: 'login' as const, label: '需登录', detail: accessRequirementDetail(text, loginMatch) };
  }
  const permissionMatch = text.match(accessRequirementPermissionPattern);
  if (permissionMatch) {
    return { type: 'permission' as const, label: '需权限', detail: accessRequirementDetail(text, permissionMatch) };
  }
  return undefined;
}

export function accessRequirementFromNoticeText(
  value: unknown,
  { maxLength = 240, requireStart = false }: { maxLength?: number; requireStart?: boolean } = {}
) {
  const text = textContentFromHtml(value).replace(/\s+/g, ' ').trim();
  if (!text || text.length > maxLength) {
    return undefined;
  }
  if (requireStart && !accessRequirementNoticeStartPattern.test(text)) {
    const permissionMatch = text.match(accessRequirementEmbeddedPermissionPattern);
    if (permissionMatch) {
      return accessRequirementFromText(permissionMatch[0]);
    }
    return undefined;
  }
  return accessRequirementFromText(text);
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
  if ((type !== 'login' && type !== 'level' && type !== 'permission') || typeof label !== 'string') {
    return undefined;
  }
  const detail = typeof value.detail === 'string' ? value.detail : undefined;
  const detected = detail ? accessRequirementFromText(detail) : undefined;
  return detected?.type === 'level' ? detected : { type, label, detail };
}

function accessRequirementRank(value?: AccessRequirement) {
  if (!value) {
    return 0;
  }
  if (value.type === 'level') {
    return 3;
  }
  if (value.type === 'permission') {
    return 2;
  }
  return 1;
}

function preferredAccessRequirement(current: AccessRequirement | undefined, candidate: AccessRequirement | undefined) {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  const currentRank = accessRequirementRank(current);
  const candidateRank = accessRequirementRank(candidate);
  if (candidateRank > currentRank) {
    return candidate;
  }
  if (candidateRank < currentRank) {
    return current;
  }
  if (current.type === 'level' && candidate.type === 'level') {
    const currentLevel = accessRequirementLevelValue(current);
    const candidateLevel = accessRequirementLevelValue(candidate);
    if (candidateLevel !== currentLevel) {
      if (!currentLevel) {
        return candidateLevel ? candidate : current;
      }
      if (!candidateLevel) {
        return current;
      }
      return candidateLevel > currentLevel ? candidate : current;
    }
  }
  if (candidate.type === 'level' && candidate.detail && candidate.detail !== current.detail) {
    return candidate;
  }
  return current;
}

export function accessRequirementFromObject(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  let detected = preferredAccessRequirement(
    normalizeAccessRequirement(value.accessRequirement),
    normalizeAccessRequirement(value.access_requirement)
  );
  for (const key of ['loginRequired', 'login_required', 'requiresLogin', 'requires_login']) {
    if (value[key] === true) {
      detected = preferredAccessRequirement(detected, { type: 'login' as const, label: '需登录' });
    }
  }
  for (const key of ['read_restricted', 'restricted', 'private']) {
    if (value[key] === true) {
      detected = preferredAccessRequirement(detected, { type: 'permission' as const, label: '需权限' });
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
        detected = preferredAccessRequirement(detected, accessRequirement);
      }
    }
  }
  for (const key of [
    'requiredTrustLevel',
    'required_trust_level',
    'minimumTrustLevel',
    'minimum_trust_level',
    'minTrustLevel',
    'min_trust_level',
    'requiredLevel',
    'required_level',
    'minimumLevel',
    'minimum_level',
    'minLevel',
    'min_level',
    'levelRequired',
    'level_required',
    'readLevel',
    'read_level',
    'requiredReadLevel',
    'required_read_level',
    'minimumReadLevel',
    'minimum_read_level',
    'minReadLevel',
    'min_read_level',
    'viewLevel',
    'view_level',
    'requiredViewLevel',
    'required_view_level',
    'accessLevel',
    'access_level'
  ]) {
    if (typeof value[key] === 'number' && value[key] > 0) {
      detected = preferredAccessRequirement(detected, accessRequirementFromLevel(value[key]));
    }
    if (typeof value[key] === 'string') {
      const accessRequirement = accessRequirementFromLevel(value[key]);
      if (accessRequirement) {
        detected = preferredAccessRequirement(detected, accessRequirement);
      }
    }
  }
  return detected;
}

export function elementText(element: HTMLElement | null | undefined) {
  return decodeHtml(element?.text || '').replace(/\s+/g, ' ').trim();
}
