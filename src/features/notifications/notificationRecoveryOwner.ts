type Ticket = Readonly<{ controller: AbortController }>;
type Recovery = { kind: 'idle' } | { kind: 'preparing' | 'settled'; ticket: Ticket };

export function createNotificationRecoveryOwner() {
  let state: Recovery = { kind: 'idle' };
  return {
    get pending() {
      return state.kind === 'preparing';
    },
    begin() {
      if (state.kind === 'preparing') return null;
      if (state.kind !== 'idle') state.ticket.controller.abort();
      const ticket = { controller: new AbortController() };
      state = { kind: 'preparing', ticket };
      return ticket;
    },
    current(ticket: Ticket) {
      return state.kind !== 'idle' && state.ticket === ticket && !ticket.controller.signal.aborted;
    },
    settled(ticket: Ticket) {
      if (state.kind !== 'idle' && state.ticket === ticket) state = { kind: 'settled', ticket };
    },
    cancel() {
      if (state.kind !== 'idle') state.ticket.controller.abort();
      state = { kind: 'idle' };
    }
  };
}
