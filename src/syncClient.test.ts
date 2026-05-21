import { describe, expect, it, vi } from 'vitest';
import { buildSyncHeaders, normalizeServerUrl, readReaderData, writeReaderData } from './syncClient';

describe('sync client helpers', () => {
  it('normalizes server urls without trailing slashes', () => {
    expect(normalizeServerUrl(' http://192.168.1.23:3000/ ')).toBe('http://192.168.1.23:3000');
  });

  it('allows http only for local Android development server addresses', () => {
    expect(normalizeServerUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(normalizeServerUrl('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000');
    expect(normalizeServerUrl('http://10.0.2.2:3000/')).toBe('http://10.0.2.2:3000');
    expect(normalizeServerUrl('http://10.1.2.3:3000/')).toBe('http://10.1.2.3:3000');
    expect(normalizeServerUrl('http://172.16.0.2:3000/')).toBe('http://172.16.0.2:3000');
    expect(normalizeServerUrl('http://172.31.255.254:3000/')).toBe('http://172.31.255.254:3000');
    expect(normalizeServerUrl('http://192.168.1.23:3000/')).toBe('http://192.168.1.23:3000');
  });

  it('requires https for public server addresses', () => {
    expect(() => normalizeServerUrl('http://8.8.8.8:3000')).toThrow('公网服务器地址必须使用 https');
    expect(() => normalizeServerUrl('http://example.com:3000')).toThrow('公网服务器地址必须使用 https');
    expect(normalizeServerUrl('https://example.com/')).toBe('https://example.com');
  });

  it('rejects empty server urls', () => {
    expect(() => normalizeServerUrl('  ')).toThrow('请输入服务器地址');
  });

  it('builds sync headers from a sync code', () => {
    expect(buildSyncHeaders(' abc123 ')).toEqual({
      'content-type': 'application/json',
      'x-sync-code': 'abc123'
    });
  });

  it('rejects empty sync codes', () => {
    expect(() => buildSyncHeaders('')).toThrow('请输入同步码');
  });

  it('passes cancellation signals to sync reads and writes', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ version: 1 })));

    await readReaderData('http://127.0.0.1:3000', 'code', { fetcher, signal: controller.signal });
    await writeReaderData('http://127.0.0.1:3000', 'code', { version: 1 }, { fetcher, signal: controller.signal });

    expect(fetcher).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3000/api/sync/reader-data', expect.objectContaining({
      signal: expect.any(AbortSignal)
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3000/api/sync/reader-data', expect.objectContaining({
      method: 'PUT',
      signal: expect.any(AbortSignal)
    }));
  });
});
