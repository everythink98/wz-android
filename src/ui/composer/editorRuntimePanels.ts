import type { ComposerToolbarState } from './structuredComposerBridge';

type Builder = ComposerToolbarState['builder'];
type PanelRequest = Readonly<{ target: Exclude<Builder, null>; generation: number }>;
type Handoff = { kind: 'idle' } | { kind: 'pending'; request: PanelRequest };
type Snapshot = Readonly<{ builder: Builder; pending: boolean }>;

export function createEditorRuntimePanels() {
  let presented: Builder = null;
  let handoff: Handoff = { kind: 'idle' };
  let snapshot: Snapshot = { builder: null, pending: false };
  return {
    get pending() {
      return handoff.kind === 'pending';
    },
    get snapshot() {
      const pending = handoff.kind === 'pending';
      if (snapshot.builder !== presented || snapshot.pending !== pending) snapshot = { builder: presented, pending };
      return snapshot;
    },
    begin(target: Exclude<Builder, null>, generation: number): PanelRequest | null {
      if (handoff.kind === 'pending') return null;
      const request = { target, generation };
      handoff = { kind: 'pending', request };
      return request;
    },
    settle(request: PanelRequest, generation: number) {
      if (handoff.kind !== 'pending' || handoff.request !== request || request.generation !== generation) return false;
      handoff = { kind: 'idle' };
      return true;
    },
    present(target: Exclude<Builder, null>) {
      presented = target;
    },
    cancelPending() {
      handoff = { kind: 'idle' };
    },
    close() {
      handoff = { kind: 'idle' };
      presented = null;
    }
  };
}
