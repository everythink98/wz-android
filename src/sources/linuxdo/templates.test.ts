import { describe, expect, it, vi } from 'vitest';
import { fetchLinuxDoTemplates, normalizeLinuxDoTemplates, recordLinuxDoTemplateUse } from './templates';

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('LinuxDo templates', () => {
  it('normalizes only bounded template records', () => {
    expect(normalizeLinuxDoTemplates([{ id: 7, title: '回复模板', content: '**正文**' }, { id: 'x' }])).toEqual([
      { id: '7', title: '回复模板', content: '**正文**' }
    ]);
  });

  it('lists without CSRF and records use with the existing CSRF action client', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/session/csrf')
        ? json({ csrf: 'token' })
        : url.endsWith('/discourse_templates')
          ? json([{ id: 7, title: '模板', content: '正文' }])
          : json({ usage_count: 1 })
    );
    await expect(fetchLinuxDoTemplates({ fetcher, userAgent: 'ua' })).resolves.toEqual([
      { id: '7', title: '模板', content: '正文' }
    ]);
    await recordLinuxDoTemplateUse({ fetcher, id: '7', userAgent: 'ua' });

    const calls = fetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(calls.map(([url]) => url)).toEqual([
      'https://linux.do/discourse_templates',
      'https://linux.do/session/csrf',
      'https://linux.do/discourse_templates/7/use'
    ]);
    expect(calls[2]?.[1]?.headers).toMatchObject({ 'X-CSRF-Token': 'token' });
  });
});
