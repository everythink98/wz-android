import { mergeReaderData, readerDataVersion, sanitizeReaderData, type ReaderData } from './readerData';

const SENSITIVE_KEY_PATTERN = /(cookie|token|password|secret|authorization|session|sid|sidyaohuo|csrf)/i;
export const MAX_BACKUP_JSON_CHARS = 10 * 1024 * 1024;
const MAX_BACKUP_OBJECT_DEPTH = 32;
const BACKUP_TOO_LARGE_MESSAGE = '备份文件过大，请减少历史记录后重新导入。';

function stripSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_BACKUP_OBJECT_DEPTH) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stripSensitive(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    const clean = stripSensitive(item, depth + 1);
    if (clean !== undefined) {
      next[key] = clean;
    }
  }
  return next;
}

export function exportReaderBackupJson(value: unknown) {
  const clean = sanitizeReaderData(stripSensitive(value));
  return JSON.stringify(clean, null, 2);
}

export function assertBackupJsonSize(size: number | null | undefined) {
  if (typeof size === 'number' && size > MAX_BACKUP_JSON_CHARS) {
    throw new Error(BACKUP_TOO_LARGE_MESSAGE);
  }
}

export function importReaderBackupJson(local: ReaderData, json: string) {
  assertBackupJsonSize(json.length);
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== readerDataVersion) {
    throw new Error('备份格式不兼容，请使用当前 Android 版本导出的 JSON。');
  }
  return mergeReaderData(local, stripSensitive(parsed));
}
