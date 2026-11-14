type Ticket = Readonly<{ scope: string; intent: object }>;
type Admission = { kind: 'inactive' } | { kind: 'active'; scope: string };

export function createSearchRecoveryOwner() {
  let admission: Admission = { kind: 'inactive' };
  let intent = {};
  const seen = new WeakSet<object>();
  return {
    observe(scope: string | null) {
      const previous = admission.kind === 'active' ? admission.scope : null;
      if (scope !== previous) intent = {};
      admission = scope === null ? { kind: 'inactive' } : { kind: 'active', scope };
    },
    newIntent() {
      intent = {};
    },
    capture(): Ticket | null {
      return admission.kind === 'active' ? { scope: admission.scope, intent } : null;
    },
    current(ticket: Ticket | null) {
      return Boolean(
        ticket && admission.kind === 'active' && ticket.scope === admission.scope && ticket.intent === intent
      );
    },
    accept(result: object) {
      if (seen.has(result)) return false;
      seen.add(result);
      return true;
    },
    remember(result: object) {
      seen.add(result);
    }
  };
}
