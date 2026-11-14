type Panel = 'face' | 'format' | null;
type Request = Readonly<{ target: Exclude<Panel, null> }>;
type Work = { kind: 'idle' } | { kind: 'waiting'; request: Request };
type Snapshot = Readonly<{ panel: Panel; pending: boolean }>;

export function createYaohuoComposerPanels() {
  let panel: Panel = null;
  let work: Work = { kind: 'idle' };
  let snapshot: Snapshot = { panel, pending: false };
  const owns = (request: Request) => work.kind === 'waiting' && work.request === request;
  return {
    owns,
    get pending() {
      return work.kind === 'waiting';
    },
    get snapshot() {
      const pending = work.kind === 'waiting';
      if (snapshot.panel !== panel || snapshot.pending !== pending) snapshot = { panel, pending };
      return snapshot;
    },
    begin(target: Exclude<Panel, null>) {
      if (work.kind === 'waiting') return null;
      const request = { target };
      work = { kind: 'waiting', request };
      return request;
    },
    opened(request: Request) {
      if (owns(request)) panel = request.target;
    },
    cancelPending() {
      work = { kind: 'idle' };
    },
    close() {
      work = { kind: 'idle' };
      panel = null;
    },
    dismissFaces() {
      if (panel === 'face') panel = null;
    }
  };
}
