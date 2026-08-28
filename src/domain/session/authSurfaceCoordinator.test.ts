import { describe, expect, it, vi } from 'vitest';
import {
  beginAuthSurface,
  closeOtherAuthSurfaces,
  createAuthSurfaceRegistry,
  finishAuthSurface,
  hasAuthSurfaceBarrierForSource,
  isAuthSurfaceVisible,
  releaseAuthSurface,
  showAuthSurface
} from './authSurfaceCoordinator';

describe('auth surface coordinator', () => {
  it('reconciles a surface exactly once across every logical close path', () => {
    const reasons = [
      'close-button',
      'hardware-back',
      'navigation-away',
      'switch-surface',
      'cancel',
      'success'
    ] as const;

    for (const reason of reasons) {
      const registry = createAuthSurfaceRegistry();
      const ticket = beginAuthSurface(registry, {
        source: 'nodeseek',
        surface: 'nodeseek-login',
        identityKey: 'nodeseek:17',
        sessionEpoch: 4
      });
      const closed = finishAuthSurface(registry, 'nodeseek-login', reason);

      expect(closed).toEqual({
        ...ticket,
        closeReason: reason,
        shouldReconcile: true
      });
      expect(finishAuthSurface(registry, 'nodeseek-login', reason)).toBeNull();
    }
  });

  it('keeps an inactive linux.do WebView mounted as the same logical surface', () => {
    const registry = createAuthSurfaceRegistry();
    const ticket = beginAuthSurface(registry, {
      source: 'linuxdo',
      surface: 'linuxdo-login',
      identityKey: 'linuxdo:7',
      sessionEpoch: 2
    });

    expect(registry.active['linuxdo-login']).toEqual({ ...ticket, phase: 'open' });
    expect(
      beginAuthSurface(registry, {
        source: 'linuxdo',
        surface: 'linuxdo-login',
        identityKey: 'linuxdo:7',
        sessionEpoch: 2
      })
    ).toEqual(ticket);
    expect(registry.generation).toBe(1);
  });

  it('exposes an open surface as a source-scoped write barrier', () => {
    const registry = createAuthSurfaceRegistry();
    beginAuthSurface(registry, {
      source: 'nodeseek',
      surface: 'nodeimage-auth',
      identityKey: 'nodeseek:17',
      sessionEpoch: 4
    });

    expect(hasAuthSurfaceBarrierForSource(registry, 'nodeseek')).toBe(true);
    expect(hasAuthSurfaceBarrierForSource(registry, 'linuxdo')).toBe(false);
  });

  it('retains the source barrier while close reconciliation is unresolved', () => {
    const registry = createAuthSurfaceRegistry();
    const ticket = beginAuthSurface(registry, {
      source: 'nodeseek',
      surface: 'nodeseek-login',
      identityKey: 'nodeseek:17',
      sessionEpoch: 4
    });

    expect(finishAuthSurface(registry, 'nodeseek-login', 'close-button', true)).toMatchObject({
      shouldReconcile: true
    });
    expect(isAuthSurfaceVisible(registry, 'nodeseek-login')).toBe(false);
    expect(registry.active['nodeseek-login']?.phase).toBe('reconciling');
    expect(hasAuthSurfaceBarrierForSource(registry, 'nodeseek')).toBe(true);

    releaseAuthSurface(registry, 'nodeseek-login', ticket.generation);
    expect(hasAuthSurfaceBarrierForSource(registry, 'nodeseek')).toBe(false);
  });

  it('reuses an authoritative recovery result instead of probing twice', () => {
    const registry = createAuthSurfaceRegistry();
    beginAuthSurface(registry, {
      source: 'linuxdo',
      surface: 'linuxdo-login',
      identityKey: 'linuxdo:7',
      sessionEpoch: 1
    });

    expect(finishAuthSurface(registry, 'linuxdo-login', 'authoritative-recovery')).toMatchObject({
      shouldReconcile: false
    });
  });

  it('closes a disabled source surface without starting reconciliation', () => {
    const registry = createAuthSurfaceRegistry();
    beginAuthSurface(registry, {
      source: 'nodeseek',
      surface: 'nodeseek-login',
      identityKey: 'nodeseek:17',
      sessionEpoch: 4
    });

    expect(finishAuthSurface(registry, 'nodeseek-login', 'source-disabled')).toMatchObject({
      shouldReconcile: false
    });
  });

  it('closes every other logical surface with switch-surface before opening a new one', () => {
    const close = vi.fn();

    closeOtherAuthSurfaces('yaohuo-login', close);

    expect(close).toHaveBeenCalledTimes(3);
    expect(close).toHaveBeenCalledWith('linuxdo-login', 'switch-surface');
    expect(close).toHaveBeenCalledWith('nodeimage-auth', 'switch-surface');
    expect(close).toHaveBeenCalledWith('nodeseek-login', 'switch-surface');
    expect(close).not.toHaveBeenCalledWith('yaohuo-login', 'switch-surface');
  });

  it('keeps read recovery visible without creating an Account barrier', () => {
    const registry = createAuthSurfaceRegistry();

    showAuthSurface(registry, 'linuxdo-login');

    expect(isAuthSurfaceVisible(registry, 'linuxdo-login')).toBe(true);
    expect(hasAuthSurfaceBarrierForSource(registry, 'linuxdo')).toBe(false);
    expect(finishAuthSurface(registry, 'linuxdo-login', 'authoritative-recovery')).toBeNull();
    expect(isAuthSurfaceVisible(registry, 'linuxdo-login')).toBe(false);
  });

  it('allows one visible surface while older close barriers reconcile', () => {
    const registry = createAuthSurfaceRegistry();
    beginAuthSurface(registry, {
      source: 'nodeseek',
      surface: 'nodeseek-login',
      identityKey: 'nodeseek:17',
      sessionEpoch: 4
    });

    closeOtherAuthSurfaces('yaohuo-login', (surface, reason) => {
      finishAuthSurface(registry, surface, reason, true);
    });
    beginAuthSurface(registry, {
      source: 'yaohuo',
      surface: 'yaohuo-login',
      identityKey: 'yaohuo:9',
      sessionEpoch: 2
    });

    expect(registry.visible).toBe('yaohuo-login');
    expect(registry.active['nodeseek-login']?.phase).toBe('reconciling');
    expect(registry.active['yaohuo-login']?.phase).toBe('open');
    expect(hasAuthSurfaceBarrierForSource(registry, 'nodeseek')).toBe(true);
    expect(hasAuthSurfaceBarrierForSource(registry, 'yaohuo')).toBe(true);
  });

  it('reopening a reconciling surface gives the new owner a fresh generation', () => {
    const registry = createAuthSurfaceRegistry();
    const first = beginAuthSurface(registry, {
      source: 'nodeseek',
      surface: 'nodeseek-login',
      identityKey: 'nodeseek:17',
      sessionEpoch: 4
    });
    finishAuthSurface(registry, 'nodeseek-login', 'close-button', true);

    const second = beginAuthSurface(registry, {
      source: 'nodeseek',
      surface: 'nodeseek-login',
      identityKey: 'nodeseek:17',
      sessionEpoch: 4
    });
    releaseAuthSurface(registry, 'nodeseek-login', first.generation);

    expect(second.generation).toBe(first.generation + 1);
    expect(registry.active['nodeseek-login']).toEqual({ ...second, phase: 'open' });
    expect(isAuthSurfaceVisible(registry, 'nodeseek-login')).toBe(true);
  });
});
