import { describe, expect, it } from 'vitest';
import { buildSyncHeaders, normalizeServerUrl } from './syncClient';

describe('sync client helpers', () => {
  it('normalizes server urls without trailing slashes', () => {
    expect(normalizeServerUrl(' http://192.168.1.23:3000/ ')).toBe('http://192.168.1.23:3000');
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
});
