import { describe, expect, it, vi } from 'vitest';
import { createStagedProofFiles } from '../../scripts/staged-proof-files.mjs';

function stage(files: string[], remove: (file: string) => void) {
  const lease = createStagedProofFiles(remove);
  files.forEach((file) => lease.register(file));
  return lease;
}

describe('staged device proof file release', () => {
  it('attempts every owned file even after an earlier removal fails', () => {
    const error = new Error('first removal failed');
    const remove = vi.fn((file: string) => {
      if (file === '/sdcard/Download/owned-first.json') throw error;
    });

    const lease = stage(['/sdcard/Download/owned-first.json', '/sdcard/Download/owned-second.json'], remove);
    expect(() => lease.release()).toThrow(error);

    expect(remove.mock.calls).toEqual([['/sdcard/Download/owned-first.json'], ['/sdcard/Download/owned-second.json']]);
    expect(lease.unconfirmedFiles()).toEqual(['/sdcard/Download/owned-first.json']);
  });

  it('preserves every removal failure after attempting all remaining files', () => {
    const first = new Error('first removal failed');
    const last = new Error('last removal failed');
    const remove = vi.fn((file: string) => {
      if (file === 'first') throw first;
      if (file === 'last') throw last;
    });

    let failure: unknown;
    try {
      stage(['first', 'middle', 'last'], remove).release();
    } catch (error) {
      failure = error;
    }
    if (!(failure instanceof AggregateError)) throw new Error('Missing cleanup failure');
    expect(failure.errors).toEqual([first, last]);
    expect(remove.mock.calls).toEqual([['first'], ['middle'], ['last']]);
  });

  it('releases registered files once and rejects registration after release', () => {
    const remove = vi.fn();
    const lease = stage(['first', 'last'], remove);
    expect(lease.release()).toBeUndefined();
    lease.release();
    expect(remove.mock.calls).toEqual([['first'], ['last']]);
    expect(lease.unconfirmedFiles()).toEqual([]);
    expect(() => lease.register('late')).toThrow('closed');
  });

  it('retains cleanup failure and does not repeat file effects on another release', () => {
    const error = new Error('remove failed');
    const remove = vi.fn(() => {
      throw error;
    });
    const lease = stage(['first'], remove);
    expect(() => lease.release()).toThrow(error);
    expect(() => lease.release()).toThrow(error);
    expect(() => lease.register('late')).toThrow('closed');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(lease.unconfirmedFiles()).toEqual(['first']);
  });

  it('does not admit more files or a second cleanup while removal is running', () => {
    let reenter: () => void = () => {
      throw new Error('Lease has not been staged');
    };
    const remove = vi.fn(() => reenter());
    const lease = stage(['first'], remove);
    reenter = () => {
      expect(() => lease.register('late')).toThrow('closed');
      expect(() => lease.release()).toThrow('already running');
    };
    lease.release();
    expect(remove).toHaveBeenCalledExactlyOnceWith('first');
    expect(lease.unconfirmedFiles()).toEqual([]);
  });

  it.each([undefined, 0, false, new Error('replay failed')])(
    'preserves a replay failure of %s together with cleanup failure',
    (error) => {
      const cleanup = new Error('cleanup failed');
      const lease = stage(['first'], () => {
        throw cleanup;
      });
      let failure: unknown;
      try {
        lease.release({ kind: 'failed', error });
      } catch (caught) {
        failure = caught;
      }
      if (!(failure instanceof AggregateError)) throw new Error('Missing combined failure');
      expect(failure.errors).toEqual([error, cleanup]);
    }
  );
});
