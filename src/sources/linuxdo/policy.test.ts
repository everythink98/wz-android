import { describe, expect, it, vi } from 'vitest';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import { setLinuxDoPolicyAcceptance } from './policy';

const policy: DiscoursePostPolicy = {
  postId: '777',
  version: '3',
  acceptLabel: '已阅读',
  revokeLabel: '取消确认',
  accepted: false,
  revoked: false,
  canAccept: true,
  canRevoke: true
};

describe('linux.do policy acceptance', () => {
  it.each([true, false])(
    'uses the original policy endpoint and confirms only a success envelope for accepted=%s',
    async (accepted) => {
      const fetcher = vi.fn(async (url: string, _init?: RequestInit) =>
        Response.json(new URL(url).pathname === '/session/csrf' ? { csrf: 'fixture' } : { success: 'OK' })
      );
      await expect(setLinuxDoPolicyAcceptance({ policy, accepted, fetcher })).resolves.toEqual({ confirmed: true });
      expect(
        fetcher.mock.calls.map(([url, init]) => [new URL(url).pathname, init?.method || 'GET', init?.body])
      ).toEqual([
        ['/session/csrf', 'GET', undefined],
        [accepted ? '/policy/accept' : '/policy/unaccept', 'PUT', 'post_id=777']
      ]);
    }
  );
  it.each([{}, { success: false }, { success: 'unknown' }])(
    'retains uncertainty for a non-confirming HTTP 200 body',
    async (body) => {
      const fetcher = async (url: string) =>
        Response.json(new URL(url).pathname === '/session/csrf' ? { csrf: 'fixture' } : body);
      await expect(setLinuxDoPolicyAcceptance({ policy, accepted: true, fetcher })).resolves.toMatchObject({
        confirmed: false
      });
    }
  );
  it('sends nothing when the server did not grant the selected action', async () => {
    const fetcher = vi.fn();
    await expect(
      setLinuxDoPolicyAcceptance({ policy: { ...policy, canAccept: false }, accepted: true, fetcher })
    ).rejects.toThrow('原站');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
