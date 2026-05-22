import { mergeReaderData, sanitizeReaderData, sanitizeReaderDataForSync, type ReaderData } from './readerData';

const SENSITIVE_KEY_PATTERN = /(cookie|token|password|secret|authorization|session|sid|sidyaohuo|csrf)/i;

function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSensitive);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    next[key] = stripSensitive(item);
  }
  return next;
}

export function exportReaderBackupJson(value: unknown) {
  const clean = sanitizeReaderData(stripSensitive(value));
  return JSON.stringify(sanitizeReaderDataForSync(clean), null, 2);
}

export function importReaderBackupJson(local: ReaderData, json: string) {
  const parsed = JSON.parse(json);
  return mergeReaderData(local, sanitizeReaderData(stripSensitive(parsed)));
}
