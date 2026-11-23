type PaymentOutcome = 'submitted' | 'canceled' | 'failed' | 'unknown';
type PaymentPhase = 'idle' | 'paying' | 'unknown' | 'paid';

export function createStardustPayments() {
  const phases = new Map<string, Exclude<PaymentPhase, 'idle'>>();
  const listeners = new Set<() => void>();
  const publish = (key: string, phase: PaymentPhase) => {
    if (phase === 'idle') phases.delete(key);
    else phases.set(key, phase);
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    phase: (key: string): PaymentPhase => phases.get(key) ?? 'idle',
    async pay(key: string, oneTime: boolean, send: () => Promise<PaymentOutcome>) {
      if (phases.has(key)) return undefined;
      publish(key, 'paying');
      let outcome: PaymentOutcome | undefined;
      try {
        outcome = await send();
        return outcome;
      } finally {
        publish(key, outcome === 'unknown' ? 'unknown' : outcome === 'submitted' && oneTime ? 'paid' : 'idle');
      }
    }
  };
}
