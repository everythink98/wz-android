import type { AccountSessionSnapshot } from '@/domain/session/siteSessionState';

type MarkerState = { kind: 'pending' } | { kind: 'persisted' } | { kind: 'failed'; error: string };
type IdentityState = { kind: 'unchecked' } | { kind: 'confirmed'; snapshot: AccountSessionSnapshot };
type PreparationEvent =
  | { type: 'prepared' }
  | { type: 'failed'; error: string }
  | { type: 'confirm'; snapshot: AccountSessionSnapshot | undefined }
  | { type: 'persisted' };

export type AuthSurfacePreparation = ReturnType<typeof createAuthSurfacePreparation>;

export function createAuthSurfacePreparation(inheritedAdmission: boolean, promise: Promise<void>) {
  let marker: MarkerState = { kind: 'pending' };
  let identity: IdentityState = { kind: 'unchecked' };
  let persistence: 'pending' | 'persisted' = 'pending';

  const apply = (event: PreparationEvent) => {
    switch (event.type) {
      case 'prepared':
        if (marker.kind === 'pending') marker = { kind: 'persisted' };
        return;
      case 'failed':
        if (marker.kind === 'pending') marker = { kind: 'failed', error: event.error };
        return;
      case 'confirm':
        identity = event.snapshot ? { kind: 'confirmed', snapshot: event.snapshot } : { kind: 'unchecked' };
        return;
      case 'persisted':
        persistence = 'persisted';
        return;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  };

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
      apply({ type: 'prepared' });
    },
    failed(error: string) {
      apply({ type: 'failed', error });
    },
    confirm(snapshot: AccountSessionSnapshot | undefined) {
      apply({ type: 'confirm', snapshot });
    },
    persisted() {
      apply({ type: 'persisted' });
    }
  };
}
