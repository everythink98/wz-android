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

export type ClosedAuthSurfaceTicket = AuthSurfaceTicket & {
  closeReason: AuthSurfaceCloseReason;
  shouldReconcile: boolean;
};

export type AuthSurfaceRegistry = {
  generation: number;
  active: Partial<Record<AuthSurface, AuthSurfaceTicket>>;
};

export type AuthSurfaceCloseHandlers = Record<AuthSurface, (reason: AuthSurfaceCloseReason) => void>;

const AUTH_SURFACES: readonly AuthSurface[] = ['linuxdo-login', 'nodeimage-auth', 'nodeseek-login', 'yaohuo-login'];

export function createAuthSurfaceRegistry(): AuthSurfaceRegistry {
  return { generation: 0, active: {} };
}

export function closeOtherAuthSurfaces(openingSurface: AuthSurface, handlers: AuthSurfaceCloseHandlers) {
  for (const surface of AUTH_SURFACES) {
    if (surface !== openingSurface) {
      handlers[surface]('switch-surface');
    }
  }
}

export function beginAuthSurface(registry: AuthSurfaceRegistry, input: Omit<AuthSurfaceTicket, 'generation'>) {
  const active = registry.active[input.surface];
  if (active) {
    return active;
  }
  const ticket = {
    ...input,
    generation: registry.generation + 1
  };
  registry.generation = ticket.generation;
  registry.active[input.surface] = ticket;
  return ticket;
}

export function finishAuthSurface(
  registry: AuthSurfaceRegistry,
  surface: AuthSurface,
  closeReason: AuthSurfaceCloseReason,
  retainWhileReconciling = false
): ClosedAuthSurfaceTicket | null {
  const ticket = registry.active[surface];
  if (!ticket) {
    return null;
  }
  const closed = {
    ...ticket,
    closeReason,
    shouldReconcile: closeReason !== 'authoritative-recovery' && closeReason !== 'source-disabled'
  };
  if (!retainWhileReconciling || !closed.shouldReconcile) delete registry.active[surface];
  return closed;
}

export function releaseAuthSurface(registry: AuthSurfaceRegistry, surface: AuthSurface, generation: number) {
  if (registry.active[surface]?.generation === generation) delete registry.active[surface];
}

export function hasOpenAuthSurfaceForSource(registry: AuthSurfaceRegistry, source: SessionSite) {
  return Object.values(registry.active).some((ticket) => ticket?.source === source);
}
