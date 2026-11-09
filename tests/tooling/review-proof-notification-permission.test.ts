import { describe, expect, it, vi } from 'vitest';
import { withProofNotificationPermission } from '../../scripts/review-proof-notification-permission.mjs';

const pkg = 'com.wz.reader';
const permission = 'android.permission.POST_NOTIFICATIONS';

function fixture(granted = true) {
  const adb = vi.fn((...args: string[]) => {
    if (args[1] === 'dumpsys') return `${permission}: granted=${granted}`;
    return '';
  });
  return { adb, pkg };
}

describe('review proof notification permission', () => {
  it.each([true, false])('restores the %s baseline after consuming one grant request', async (granted) => {
    const device = fixture(granted);
    await withProofNotificationPermission(device, async (grant) => {
      grant();
      grant();
    });

    expect(device.adb.mock.calls).toEqual([
      ['shell', 'dumpsys', 'package', pkg],
      ['shell', 'pm', 'revoke', pkg, permission],
      ['shell', 'pm', 'grant', pkg, permission],
      ['shell', 'am', 'force-stop', pkg],
      ['shell', 'pm', granted ? 'grant' : 'revoke', pkg, permission]
    ]);
  });

  it('requires a known permission baseline before any mutation or business work', async () => {
    const device = fixture();
    device.adb.mockReturnValue('');
    const run = vi.fn().mockResolvedValue(undefined);

    await expect(withProofNotificationPermission(device, run)).rejects.toThrow('permission baseline');
    expect(run).not.toHaveBeenCalled();
    expect(device.adb.mock.calls).toEqual([['shell', 'dumpsys', 'package', pkg]]);
  });

  it('restores permission and preserves the business failure', async () => {
    const device = fixture();
    const failure = new Error('business failed');
    await expect(
      withProofNotificationPermission(device, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(device.adb.mock.calls.at(-1)).toEqual(['shell', 'pm', 'grant', pkg, permission]);
  });

  it('restores permission even when stopping the proof app fails', async () => {
    const device = fixture();
    const failure = new Error('stop failed');
    device.adb.mockImplementation((...args) => {
      if (args[1] === 'dumpsys') return `${permission}: granted=true`;
      if (args[1] === 'am') throw failure;
      return '';
    });

    await expect(withProofNotificationPermission(device, async () => {})).rejects.toBe(failure);
    expect(device.adb.mock.calls.at(-1)).toEqual(['shell', 'pm', 'grant', pkg, permission]);
  });

  it('keeps a falsy business failure alongside a permission restoration failure', async () => {
    const device = fixture();
    const restoration = new Error('restore failed');
    device.adb.mockImplementation((...args) => {
      if (args[1] === 'dumpsys') return `${permission}: granted=true`;
      if (args[2] === 'grant') throw restoration;
      return '';
    });

    await expect(
      withProofNotificationPermission(device, async () => {
        throw 0;
      })
    ).rejects.toMatchObject({ errors: [0, restoration] });
  });

  it.each([undefined, null, false, 0, ''])('retains business %s when cleanup throws false', async (business) => {
    const device = fixture();
    device.adb.mockImplementation((...args) => {
      if (args[1] === 'dumpsys') return `${permission}: granted=true`;
      if (args[2] === 'grant') throw false;
      return '';
    });

    await expect(
      withProofNotificationPermission(device, async () => {
        throw business;
      })
    ).rejects.toMatchObject({ errors: [business, false] });
  });

  it('retires an unconsumed grant request before restoring the baseline', async () => {
    const device = fixture(false);
    let grant = () => {};
    await withProofNotificationPermission(device, async (request) => {
      grant = request;
    });
    const calls = [...device.adb.mock.calls];

    grant();

    expect(device.adb.mock.calls).toEqual(calls);
    expect(calls.at(-1)).toEqual(['shell', 'pm', 'revoke', pkg, permission]);
  });

  it('attempts both cleanup actions and retains all three original failures', async () => {
    const device = fixture();
    const business = new Error('business failed');
    const stop = new Error('stop failed');
    const restore = new Error('restore failed');
    device.adb.mockImplementation((...args) => {
      if (args[1] === 'dumpsys') return `${permission}: granted=true`;
      if (args[1] === 'am') throw stop;
      if (args[2] === 'grant') throw restore;
      return '';
    });

    await expect(
      withProofNotificationPermission(device, async () => {
        throw business;
      })
    ).rejects.toMatchObject({ errors: [business, stop, restore] });
  });

  it('restores permission after the initial revoke fails', async () => {
    const device = fixture();
    const failure = new Error('revoke failed');
    device.adb.mockImplementation((...args) => {
      if (args[1] === 'dumpsys') return `${permission}: granted=true`;
      if (args[2] === 'revoke') throw failure;
      return '';
    });
    const run = vi.fn().mockResolvedValue(undefined);

    await expect(withProofNotificationPermission(device, run)).rejects.toBe(failure);
    expect(run).not.toHaveBeenCalled();
    expect(device.adb.mock.calls.at(-1)).toEqual(['shell', 'pm', 'grant', pkg, permission]);
  });
});
