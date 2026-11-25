type MarkerState = { kind: 'pending' } | { kind: 'persisted' } | { kind: 'failed'; error: string };
export type AuthSurfacePreparation = ReturnType<typeof createAuthSurfacePreparation>;

export function createAuthSurfacePreparation(inheritedAdmission: boolean, promise: Promise<void>) {
  let marker: MarkerState = { kind: 'pending' };
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
    prepared() {
      if (marker.kind === 'pending') marker = { kind: 'persisted' };
    },
    failed(error: string) {
      if (marker.kind === 'pending') marker = { kind: 'failed', error };
    },
    persisted() {
      persistence = 'persisted';
    }
  };
}
