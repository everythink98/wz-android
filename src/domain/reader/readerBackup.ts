import { readReaderBackupContent, sanitizeReaderData } from './readerData';
import { isRecord } from '@/domain/forum/html';
import { sourceCatalog } from '@/domain/forum/sourceCatalog';

const SENSITIVE_KEY_PATTERN = /(cookie|token|password|secret|authorization|session|sid|sidyaohuo|csrf|proxy)/i;
export const MAX_BACKUP_JSON_BYTES = 5 * 1024 * 1024;
const MAX_BACKUP_OBJECT_DEPTH = 32;
const BACKUP_TOO_LARGE_MESSAGE = '备份文件过大，不能超过 5 MiB。';

export function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function stripSensitive(value: unknown, depth = 0, path = ''): unknown {
  if (depth > MAX_BACKUP_OBJECT_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitive(item, depth + 1, `${path}[]`)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const next: Record<string, unknown> = {};
  const recordMap = /^(?:deletedRecords\.)?(?:favorites|history|followedUsers)$/.test(path);
  for (const [key, item] of Object.entries(value)) {
    const separator = key.indexOf(':');
    const recordKey =
      recordMap && separator > 0 && separator < key.length - 1 && Object.hasOwn(sourceCatalog, key.slice(0, separator));
    if (!recordKey && SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    const clean = stripSensitive(item, depth + 1, path ? `${path}.${key}` : key);
    if (clean !== undefined) {
      next[key] = clean;
    }
  }
  return next;
}

export function exportReaderBackupJson(value: unknown) {
  const clean = sanitizeReaderData(stripSensitive(value));
  const json = JSON.stringify(clean);
  assertBackupJsonSize(json);
  return json;
}

export function assertBackupJsonSize(size: number | string | null | undefined) {
  if (typeof size === 'string') {
    // Each UTF-16 code unit accounts for one to three UTF-8 bytes, including surrogate pairs.
    if (size.length * 3 <= MAX_BACKUP_JSON_BYTES) return;
    size = size.length > MAX_BACKUP_JSON_BYTES ? size.length : utf8ByteLength(size);
  }
  if (typeof size === 'number' && size > MAX_BACKUP_JSON_BYTES) {
    throw new Error(BACKUP_TOO_LARGE_MESSAGE);
  }
}

export function parseReaderBackupJson(json: string) {
  assertBackupJsonSize(json);
  const parsed: unknown = JSON.parse(json);
  const incompatible = '备份格式不兼容，请使用当前 Android 版本导出的 JSON。';
  if (!isRecord(parsed)) throw new Error(incompatible);
  const hasRecords = ['favorites', 'history', 'followedUsers', 'deletedRecords'].some((key) =>
    Object.hasOwn(parsed, key)
  );
  if ((!hasRecords || parsed.settings !== undefined) && !isRecord(parsed.settings)) throw new Error(incompatible);
  try {
    return { kind: hasRecords ? 'records' : 'settings', ...readReaderBackupContent(stripSensitive(parsed)) } as const;
  } catch {
    throw new Error(incompatible);
  }
}
