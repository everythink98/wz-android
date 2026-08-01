import { describe, expect, it, vi } from 'vitest';
import {
  ensureWritableSessionTicket,
  validateWritableSessionTicket,
  WritableSessionBlockedError,
  type WritableSessionSnapshot
} from './writableSessionGate';

const confirmed: WritableSessionSnapshot = {
  source: 'nodeseek',
  authenticated: true,
  authSurfaceOpen: false,
  identityKey: 'nodeseek:42',
  identityTrust: 'confirmed',
  sessionEpoch: 3
};

describe('writable session gate', () => {
  it('[REG-WRITE-023] does not probe a clean confirmed session', async () => {
    const reconcile = vi.fn();

    await expect(ensureWritableSessionTicket(() => confirmed, reconcile)).resolves.toEqual({
      source: 'nodeseek',
      identityKey: 'nodeseek:42',
      sessionEpoch: 3
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('[REG-WRITE-023] only issues a ticket after a dirty session reconciles to the same identity', async () => {
    let snapshot: WritableSessionSnapshot = { ...confirmed, identityTrust: 'pending' };
    const reconcile = vi.fn(async () => {
      snapshot = confirmed;
      return { status: 'same' as const };
    });

    await expect(ensureWritableSessionTicket(() => snapshot, reconcile)).resolves.toEqual({
      source: 'nodeseek',
      identityKey: 'nodeseek:42',
      sessionEpoch: 3
    });
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it.each(['changed', 'anonymous', 'unknown', 'stale'] as const)(
    '[REG-WRITE-023] rejects %s without issuing a stale identity ticket',
    async (status) => {
      const snapshot = { ...confirmed, identityTrust: 'pending' as const };
      await expect(
        ensureWritableSessionTicket(
          () => snapshot,
          async () => ({ status })
        )
      ).rejects.toBeInstanceOf(WritableSessionBlockedError);
    }
  );

  it('[REG-WRITE-023] invalidates a ticket before upload or transport when identity state changes', () => {
    const ticket = {
      source: 'nodeseek' as const,
      identityKey: 'nodeseek:42',
      sessionEpoch: 3
    };

    expect(validateWritableSessionTicket(ticket, confirmed)).toBe(true);
    expect(validateWritableSessionTicket(ticket, { ...confirmed, sessionEpoch: 4 })).toBe(false);
    expect(validateWritableSessionTicket(ticket, { ...confirmed, identityKey: 'nodeseek:84' })).toBe(false);
    expect(validateWritableSessionTicket(ticket, { ...confirmed, identityTrust: 'pending' })).toBe(false);
    expect(validateWritableSessionTicket(ticket, { ...confirmed, authSurfaceOpen: true })).toBe(false);
  });

  it('[REG-WRITE-023] reports an unchanged anonymous reconciliation as login-required', async () => {
    const anonymous: WritableSessionSnapshot = {
      ...confirmed,
      authenticated: false,
      identityKey: 'nodeseek:anonymous',
      identityTrust: 'pending'
    };
    await expect(
      ensureWritableSessionTicket(
        () => anonymous,
        async () => ({ status: 'same' })
      )
    ).rejects.toMatchObject({ reason: 'login_required' });
  });
});
