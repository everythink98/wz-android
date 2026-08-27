import { describe, expect, it, vi } from 'vitest';
import { fetchLinuxDoPollCapabilities, normalizeLinuxDoPollCapabilities } from './pollCapabilities';

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('LinuxDo poll capabilities', () => {
  it('keeps bounded site groups, excludes everyone and reads the current staff permission', () => {
    expect(
      normalizeLinuxDoPollCapabilities(
        {
          groups: [
            { id: 0, name: 'everyone' },
            { id: 10, name: 'trust_level_1', display_name: '信任级别 1' },
            { id: 11, name: 'designers', display_name: '', full_name: '设计团队' },
            { id: 'bad', name: 'ignored' }
          ]
        },
        { current_user: { staff: true } }
      )
    ).toEqual({
      groups: [
        { id: 10, name: 'trust_level_1', displayName: '信任级别 1' },
        { id: 11, name: 'designers', displayName: '设计团队' }
      ],
      canUseStaffResults: true
    });
  });

  it('loads site and current-session facts through the existing LinuxDo action client', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/site.json')
        ? json({ groups: [{ id: 10, name: 'trust_level_1', display_name: '信任级别 1' }] })
        : json({ current_user: { staff: false } })
    );

    await expect(fetchLinuxDoPollCapabilities({ fetcher, userAgent: 'ua' })).resolves.toEqual({
      groups: [{ id: 10, name: 'trust_level_1', displayName: '信任级别 1' }],
      canUseStaffResults: false
    });
    expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual([
      'https://linux.do/session/current.json',
      'https://linux.do/site.json'
    ]);
  });
});
