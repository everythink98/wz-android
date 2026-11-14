import { CancelledError } from '@tanstack/react-query';

type CookiePreparation = {
  owner: AbortSignal;
  generation: number;
  promise: Promise<void>;
};
type MountReceipt = { phase: 'unmounted' } | { phase: 'mounted'; waiters: Set<() => void> };

export function createLinuxDoCookieHandoff() {
  let mount: MountReceipt = { phase: 'unmounted' };
  let preparation: CookiePreparation | null = null;
  let handoff: Promise<void> | null = null;
  let credit: Promise<void> | null = null;
  const releaseWaiters = () => {
    if (mount.phase !== 'mounted') return;
    const waiters = [...mount.waiters];
    mount.waiters.clear();
    waiters.forEach((resolve) => resolve());
  };
  const awaitUnmount = () =>
    mount.phase === 'unmounted'
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          if (mount.phase === 'mounted') mount.waiters.add(resolve);
        });

  return {
    awaitUnmount,
    observeMount(mounted: boolean) {
      if (mounted) {
        if (mount.phase === 'unmounted') mount = { phase: 'mounted', waiters: new Set() };
      } else {
        releaseWaiters();
        mount = { phase: 'unmounted' };
      }
    },
    prepare({
      owner,
      generation,
      marker,
      ownerIsCurrent,
      apply
    }: {
      owner: AbortSignal;
      generation: number;
      marker?: Promise<void>;
      ownerIsCurrent: (owner: AbortSignal) => boolean;
      apply: (generation: number) => Promise<void>;
    }) {
      handoff = null;
      const next: CookiePreparation = {
        owner,
        generation,
        promise: Promise.resolve(marker).then(() => {
          if (next.owner.aborted || !ownerIsCurrent(next.owner) || preparation !== next) throw new CancelledError();
          return apply(next.generation);
        })
      };
      preparation = next;
      void next.promise
        .finally(() => {
          if (preparation === next) preparation = null;
        })
        .catch(() => undefined);
      return next.promise;
    },
    adoptPreparation(previousOwner: AbortSignal, nextOwner: AbortSignal) {
      if (preparation?.owner === previousOwner) preparation.owner = nextOwner;
    },
    close(generation: number, apply: (generation: number) => Promise<void>) {
      if (handoff) return handoff;
      const next = Promise.all([awaitUnmount(), preparation?.promise]).then(() => {
        if (handoff !== next) throw new CancelledError();
        return apply(generation);
      });
      handoff = next;
      void next.catch(() => {
        if (handoff === next) handoff = null;
      });
      return next;
    },
    cancelHandoff() {
      const nativeOwned = handoff !== null;
      handoff = null;
      return nativeOwned;
    },
    reconcileCredit(operation: () => Promise<void>) {
      const next = Promise.resolve(handoff).then(operation);
      credit = next;
      void next
        .catch(() => undefined)
        .finally(() => {
          if (credit === next) credit = null;
        });
    },
    async settled() {
      await Promise.all([handoff, credit]);
    },
    release() {
      handoff = null;
      credit = null;
      releaseWaiters();
    }
  };
}
