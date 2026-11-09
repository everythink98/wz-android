type ProofEnvironmentLease<T> =
  | { phase: 'held'; originalFetch: typeof globalThis.fetch; snapshot: T }
  | { phase: 'released'; restoration: Promise<void> };

type ProofEnvironmentOwnership = { phase: 'free' } | { phase: 'owned'; owner: symbol };
let ownership: ProofEnvironmentOwnership = { phase: 'free' };

export type ReviewProofFailure = { kind: 'none' } | { kind: 'failed'; error: unknown };

export async function finishReviewProofEnvironment(
  environment: { release: () => Promise<void> },
  failure: ReviewProofFailure
) {
  try {
    await environment.release();
  } catch (error) {
    if (failure.kind === 'failed')
      throw new AggregateError([failure.error, error], 'Proof execution and environment restoration failed');
    throw error;
  }
}

export async function acquireReviewProofEnvironment<T>(
  capture: () => Promise<T>,
  restore: (snapshot: T) => Promise<void>
) {
  if (ownership.phase !== 'free') throw new Error('Review proof environment already owned');
  const owner = Symbol('review-proof-environment');
  ownership = { phase: 'owned', owner };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Uncontrolled network denied by isolated proof');
  };
  let snapshot: T;
  try {
    snapshot = await capture();
  } catch (error) {
    globalThis.fetch = originalFetch;
    ownership = { phase: 'free' };
    throw error;
  }
  let lease: ProofEnvironmentLease<T> = { phase: 'held', originalFetch, snapshot };
  return {
    release: () => {
      if (lease.phase === 'released') return lease.restoration;
      const held = lease;
      const restoration = Promise.resolve()
        .then(() => restore(held.snapshot))
        .finally(() => {
          if (ownership.phase === 'owned' && ownership.owner === owner) ownership = { phase: 'free' };
        });
      lease = { phase: 'released', restoration };
      globalThis.fetch = held.originalFetch;
      return restoration;
    }
  };
}
