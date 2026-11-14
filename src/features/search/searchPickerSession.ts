type Input = Readonly<{ value: string }>;
type Surface = { kind: 'closed' } | { kind: 'open'; identity: object };
type Submission = { kind: 'waiting' } | { kind: 'submitted'; value: string };
type Snapshot = Readonly<{ visible: boolean; query: string; submitted: string | null }>;
type Ticket = Readonly<{ opening: object; input: Input; query: string }>;

export function createSearchPickerSession(kind: 'tags' | 'users') {
  let input: Input = { value: '' };
  let surface: Surface = { kind: 'closed' };
  let submission: Submission = { kind: 'waiting' };
  let snapshot: Snapshot = { visible: false, query: '', submitted: null };
  return {
    get snapshot() {
      const visible = surface.kind === 'open';
      const submitted = submission.kind === 'submitted' ? submission.value : null;
      if (snapshot.visible !== visible || snapshot.query !== input.value || snapshot.submitted !== submitted)
        snapshot = { visible, query: input.value, submitted };
      return snapshot;
    },
    open() {
      if (surface.kind === 'open' && input.value === '') return;
      if (surface.kind === 'closed') surface = { kind: 'open', identity: {} };
      input = { value: '' };
      submission = { kind: 'waiting' };
    },
    close() {
      surface = { kind: 'closed' };
      submission = { kind: 'waiting' };
    },
    edit(value: string) {
      if (input.value === value) return;
      input = { value };
      submission = { kind: 'waiting' };
    },
    debounce(): Ticket | null {
      submission = { kind: 'waiting' };
      if (surface.kind !== 'open') return null;
      const query = kind === 'users' ? input.value.trim() : input.value;
      if (kind === 'users' && !query) return null;
      return { opening: surface.identity, input, query };
    },
    submitted(ticket: Ticket) {
      if (surface.kind !== 'open' || surface.identity !== ticket.opening || input !== ticket.input) return;
      submission = { kind: 'submitted', value: ticket.query };
    }
  };
}
