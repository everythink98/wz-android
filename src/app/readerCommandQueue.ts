import {
  applyReaderChange,
  createEmptyReaderState,
  projectReaderCommand,
  type ReaderChange,
  type ReaderCommand,
  type ReaderState,
  type ReaderStatus
} from '@/domain/reader/readerRecordState';

type Operation = { readonly command: ReaderCommand; owner: AbortSignal };

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
      project();
      return operation;
    },
    confirmed(change: ReaderChange) {
      committed = applyReaderChange(committed, change);
    },
    requireRestart() {
      status = 'restart-required';
    },
    settled(operation: Readonly<Operation>) {
      pending = pending.filter((item) => item !== operation);
      project();
    }
  };
}
