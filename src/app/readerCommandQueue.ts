import {
  applyReaderChange,
  createEmptyReaderState,
  projectReaderCommand,
  readerCollections,
  readerCommandChange,
  type ReaderChange,
  type ReaderCommand,
  type ReaderState,
  type ReaderStatus
} from '@/domain/reader/readerRecordState';

type Operation = { readonly command: ReaderCommand; owner: AbortSignal };

function confirmsProjection(base: ReaderState, command: ReaderCommand, change: ReaderChange) {
  const expected = readerCommandChange(base, command);
  // A record's title or timestamp can change without changing its membership.
  const membership = change.membership.filter(
    (item) => Object.hasOwn(base[item.collection], item.key) !== item.present
  );
  if (membership.length !== expected.membership.length) return false;
  if (
    !membership.every((item, i) => {
      const other = expected.membership[i]!;
      return item.collection === other.collection && item.key === other.key && item.present === other.present;
    })
  )
    return false;
  if (
    !readerCollections.every(
      (key) => (change.counts[key] ?? base.counts[key]) === (expected.counts[key] ?? base.counts[key])
    )
  )
    return false;
  const settings = change.settings ?? base.settings;
  const projectedSettings = expected.settings ?? base.settings;
  return settings === projectedSettings || JSON.stringify(settings) === JSON.stringify(projectedSettings);
}

export function createReaderCommandQueue() {
  let lifetime = new AbortController();
  let status: ReaderStatus = 'loading';
  let committed = createEmptyReaderState();
  let pending: Operation[] = [];
  let projection = committed;
  let snapshot: Readonly<{ data: ReaderState; status: ReaderStatus }> = { data: projection, status };
  const project = () => {
    projection = pending.reduce((data, operation) => projectReaderCommand(data, operation.command), committed);
  };
  const dataRef = {
    get current() {
      return projection;
    }
  };
  return {
    dataRef,
    get signal() {
      return lifetime.signal;
    },
    get active() {
      return !lifetime.signal.aborted;
    },
    get status() {
      return status;
    },
    get snapshot() {
      if (snapshot.data !== projection || snapshot.status !== status) snapshot = { data: projection, status };
      return snapshot;
    },
    attached() {
      if (lifetime.signal.aborted) lifetime = new AbortController();
      for (const operation of pending) operation.owner = lifetime.signal;
      return lifetime;
    },
    current(owner: AbortSignal) {
      return !owner.aborted && lifetime.signal === owner;
    },
    restored(data: ReaderState, nextStatus: 'ready' | 'recovery') {
      if (status === 'restart-required') return;
      committed = data;
      status = nextStatus;
      project();
    },
    enqueue(command: ReaderCommand): Readonly<Operation> | null {
      if (lifetime.signal.aborted || status !== 'ready') return null;
      const operation: Operation = { command, owner: lifetime.signal };
      pending.push(operation);
      projection = projectReaderCommand(projection, command);
      return operation;
    },
    requireRestart() {
      status = 'restart-required';
    },
    settled(operation: Readonly<Operation>, change?: ReaderChange) {
      const previous = projection;
      const matches = change && pending[0] === operation && confirmsProjection(committed, operation.command, change);
      pending = pending.filter((item) => item !== operation);
      if (change) committed = matches && !pending.length ? projection : applyReaderChange(committed, change);
      if (!matches) project();
      return projection !== previous;
    }
  };
}
