import { describe, expect, it, vi } from 'vitest';
import {
  beginAuthSurface,
  closeOtherAuthSurfaces,
  createAuthSurfaceRegistry,
  finishAuthSurface,
  hasOpenAuthSurfaceForSource
} from './authSurfaceCoordinator';

describe('auth surface coordinator', () => {
  it('[REG-ACCOUNT-031] reconciles a surface exactly once across every logical close path', () => {
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

  it('[REG-ACCOUNT-031] keeps an inactive linux.do WebView mounted as the same logical surface', () => {
    const registry = createAuthSurfaceRegistry();
    const ticket = beginAuthSurface(registry, {
      source: 'linuxdo',
      surface: 'linuxdo-login',
      identityKey: 'linuxdo:7',
      sessionEpoch: 2
    });

    expect(registry.active['linuxdo-login']).toEqual(ticket);
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

  it('[REG-WRITE-023] exposes an open surface as a source-scoped write barrier', () => {
    const registry = createAuthSurfaceRegistry();
    beginAuthSurface(registry, {
      source: 'nodeseek',
      surface: 'nodeimage-auth',
      identityKey: 'nodeseek:17',
      sessionEpoch: 4
    });

    expect(hasOpenAuthSurfaceForSource(registry, 'nodeseek')).toBe(true);
    expect(hasOpenAuthSurfaceForSource(registry, 'linuxdo')).toBe(false);
  });

  it('[REG-ACCOUNT-031] reuses an authoritative recovery result instead of probing twice', () => {
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

  it('[REG-ACCOUNT-031] closes every other logical surface with switch-surface before opening a new one', () => {
    const handlers = {
      'linuxdo-login': vi.fn(),
      'nodeimage-auth': vi.fn(),
      'nodeseek-login': vi.fn(),
      'yaohuo-login': vi.fn()
    };

    closeOtherAuthSurfaces('yaohuo-login', handlers);

    expect(handlers['linuxdo-login']).toHaveBeenCalledOnce();
    expect(handlers['linuxdo-login']).toHaveBeenCalledWith('switch-surface');
    expect(handlers['nodeimage-auth']).toHaveBeenCalledWith('switch-surface');
    expect(handlers['nodeseek-login']).toHaveBeenCalledWith('switch-surface');
    expect(handlers['yaohuo-login']).not.toHaveBeenCalled();
  });
});
