import type { AccessRequirement } from './models';
import { isRecord, parsePositiveInteger, textContentFromHtml } from './html';
import { accessRequirementLevelValue } from './presentation';

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

const accessRequirementEmbeddedPermissionPattern = new RegExp(
  ACCESS_REQUIREMENT_EMBEDDED_PERMISSION_PATTERN_SOURCE,
  'i'
);

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
  const token = String(value || '')
    .trim()
    .toLowerCase();
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
