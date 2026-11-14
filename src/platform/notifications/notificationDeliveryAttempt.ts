type Attempt =
  | { phase: 'staged'; identifier: string }
  | { phase: 'recording'; identifier: string }
  | { phase: 'recorded'; identifier: string; rollback(): Promise<unknown> };
type Compensation = { kind: 'retain' | 'dismiss' } | { kind: 'rollback'; rollback(): Promise<unknown> };

export function createNotificationDeliveryAttempt(identifier: string) {
  let state: Attempt = { phase: 'staged', identifier };
  return {
    get identifier() {
      return state.identifier;
    },
    get committed() {
      return state.phase === 'recorded';
    },
    presented(identifier: string) {
      if (state.phase === 'staged') state = { phase: 'staged', identifier };
    },
    recording() {
      if (state.phase === 'staged') state = { phase: 'recording', identifier: state.identifier };
    },
    recorded(rollback: () => Promise<unknown>) {
      if (state.phase === 'recording') state = { phase: 'recorded', identifier: state.identifier, rollback };
    },
    compensation(deadline: boolean): Compensation {
      switch (state.phase) {
        case 'staged':
          return { kind: 'dismiss' };
        case 'recording':
          return deadline ? { kind: 'retain' } : { kind: 'dismiss' };
        case 'recorded':
          return deadline ? { kind: 'retain' } : { kind: 'rollback', rollback: state.rollback };
        default: {
          const exhaustive: never = state;
          return exhaustive;
        }
      }
    }
  };
}
