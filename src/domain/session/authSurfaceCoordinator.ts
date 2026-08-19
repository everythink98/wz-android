import type { SessionSite } from './siteSessionState';

export type AuthSurface = 'linuxdo-login' | 'nodeimage-auth' | 'nodeseek-login' | 'yaohuo-login';

export type AuthSurfaceCloseReason =
  | 'authoritative-recovery'
  | 'cancel'
  | 'close-button'
  | 'hardware-back'
  | 'navigation-away'
  | 'source-disabled'
  | 'success'
  | 'switch-surface';

export type AuthSurfaceTicket = {
  source: SessionSite;
  surface: AuthSurface;
  generation: number;
  identityKey: string;
  sessionEpoch: number;
};

export type AuthSurfaceLifecycle = AuthSurfaceTicket & {
  phase: 'open' | 'reconciling';
};

export type ClosedAuthSurfaceTicket = AuthSurfaceTicket & {
  closeReason: AuthSurfaceCloseReason;
  shouldReconcile: boolean;
};

export type AuthSurfaceRegistry = {
  generation: number;
  active: Partial<Record<AuthSurface, AuthSurfaceLifecycle>>;
  visible: AuthSurface | null;
};

const AUTH_SURFACES: readonly AuthSurface[] = ['linuxdo-login', 'nodeimage-auth', 'nodeseek-login', 'yaohuo-login'];

export function createAuthSurfaceRegistry(): AuthSurfaceRegistry {
  return { generation: 0, active: {}, visible: null };
}

export function showAuthSurface(registry: AuthSurfaceRegistry, surface: AuthSurface) {
  registry.visible = surface;
}

export function closeOtherAuthSurfaces(
  openingSurface: AuthSurface,
  close: (surface: AuthSurface, reason: AuthSurfaceCloseReason) => void
) {
  for (const surface of AUTH_SURFACES) {
    if (surface !== openingSurface) close(surface, 'switch-surface');
  }
}

export function isAuthSurfaceVisible(registry: AuthSurfaceRegistry, surface: AuthSurface) {
  return registry.visible === surface;
}

export function beginAuthSurface(
  registry: AuthSurfaceRegistry,
  input: Omit<AuthSurfaceTicket, 'generation'>
): AuthSurfaceTicket {
  const active = registry.active[input.surface];
  if (active?.phase === 'open') {
    showAuthSurface(registry, input.surface);
    const { phase: _phase, ...ticket } = active;
    return ticket;
  }
  const ticket = {
    ...input,
    generation: registry.generation + 1
  };
  registry.generation = ticket.generation;
  registry.active[input.surface] = { ...ticket, phase: 'open' };
  showAuthSurface(registry, input.surface);
  return ticket;
}

export function finishAuthSurface(
  registry: AuthSurfaceRegistry,
  surface: AuthSurface,
  closeReason: AuthSurfaceCloseReason,
  retainWhileReconciling = false
): ClosedAuthSurfaceTicket | null {
  if (registry.visible === surface) registry.visible = null;
  const lifecycle = registry.active[surface];
  if (!lifecycle || lifecycle.phase !== 'open') {
    return null;
  }
  const { phase: _phase, ...ticket } = lifecycle;
  const closed = {
    ...ticket,
    closeReason,
    shouldReconcile: closeReason !== 'authoritative-recovery' && closeReason !== 'source-disabled'
  };
  if (retainWhileReconciling && closed.shouldReconcile) {
    registry.active[surface] = { ...lifecycle, phase: 'reconciling' };
  } else {
    delete registry.active[surface];
  }
  return closed;
}

export function releaseAuthSurface(registry: AuthSurfaceRegistry, surface: AuthSurface, generation: number) {
  const lifecycle = registry.active[surface];
  if (lifecycle?.generation !== generation || lifecycle.phase !== 'reconciling') return false;
  delete registry.active[surface];
  return true;
}

export function hasAuthSurfaceBarrierForSource(registry: AuthSurfaceRegistry, source: SessionSite) {
  return Object.values(registry.active).some((ticket) => ticket?.source === source);
}
