import { MAX_COMPOSER_MARKDOWN_LENGTH } from '@/domain/forum/structuredComposer';
import type { Fetcher } from '@/platform/network/request';
import { runLinuxDoAction } from './actionClient';

export type LinuxDoTemplate = { id: string; title: string; content: string };

export function normalizeLinuxDoTemplates(value: unknown): LinuxDoTemplate[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).templates)
      ? ((value as Record<string, unknown>).templates as unknown[])
      : [];
  return rows.slice(0, 1000).flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    const id = String(record.id || '').trim();
    const title = String(record.title || '').trim();
    const content = typeof record.content === 'string' ? record.content : '';
    return /^\d+$/.test(id) && title && content.length <= MAX_COMPOSER_MARKDOWN_LENGTH
      ? [{ id, title: title.slice(0, 500), content }]
      : [];
  });
}

export async function fetchLinuxDoTemplates({
  fetcher,
  signal,
  userAgent
}: {
  fetcher: Fetcher;
  signal?: AbortSignal;
  userAgent: string;
}) {
  return normalizeLinuxDoTemplates(
    await runLinuxDoAction({
      fetcher,
      signal,
      userAgent,
      request: { path: '/discourse_templates', method: 'GET', headers: {} }
    })
  );
}

export async function recordLinuxDoTemplateUse({
  fetcher,
  id,
  signal,
  userAgent
}: {
  fetcher: Fetcher;
  id: string;
  signal?: AbortSignal;
  userAgent: string;
}) {
  const cleanId = id.trim();
  if (!/^\d+$/.test(cleanId)) throw new Error('模板 id 不正确');
  await runLinuxDoAction({
    fetcher,
    signal,
    userAgent,
    request: { path: `/discourse_templates/${encodeURIComponent(cleanId)}/use`, method: 'POST', headers: {} }
  });
}
