import { decodeHtml, isRecord, parseHtml } from '@/domain/forum/html';

export function parseLinuxDoRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return parseLinuxDoRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
}

export function linuxDoPreloadedData(html: string) {
  const root = parseHtml(html);
  // Script rawText preserves JSON entities; only attribute content needs decoding.
  const script = root.querySelector('script#data-preloaded[type="application/json"]');
  return parseLinuxDoRecord(
    script?.rawText ?? decodeHtml(root.querySelector('[data-preloaded]')?.getAttribute('data-preloaded') || '')
  );
}
