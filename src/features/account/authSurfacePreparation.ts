import type { AccountSessionSnapshot } from '@/domain/session/siteSessionState';

type MarkerState = { kind: 'pending' } | { kind: 'persisted' } | { kind: 'failed'; error: string };
type IdentityState = { kind: 'unchecked' } | { kind: 'confirmed'; snapshot: AccountSessionSnapshot };
export type AuthSurfacePreparation = ReturnType<typeof createAuthSurfacePreparation>;

export function createAuthSurfacePreparation(inheritedAdmission: boolean, promise: Promise<void>) {
  let marker: MarkerState = { kind: 'pending' };
  let identity: IdentityState = { kind: 'unchecked' };
  let persistence: 'pending' | 'persisted' = 'pending';

  return {
    get promise() {
      return promise;
    },
    get ready() {
      return inheritedAdmission || marker.kind === 'persisted';
    },
    get error() {
      return marker.kind === 'failed' ? marker.error : '';
    },
    get pending() {
      return persistence === 'pending';
    },
    get confirmed() {
      return identity.kind === 'confirmed' ? identity.snapshot : undefined;
    },
    prepared() {
      if (marker.kind === 'pending') marker = { kind: 'persisted' };
    },
    failed(error: string) {
      if (marker.kind === 'pending') marker = { kind: 'failed', error };
    },
    confirm(snapshot: AccountSessionSnapshot | undefined) {
      identity = snapshot ? { kind: 'confirmed', snapshot } : { kind: 'unchecked' };
    },
    persisted() {
      persistence = 'persisted';
    }
  };
}
