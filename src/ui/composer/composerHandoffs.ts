export type ComposerImageHandoff = Readonly<{ uploadId: string; epoch: number }>;
type Panel = { kind: 'idle' } | { kind: 'claimed' | 'waiting'; request: object };
type Image = { kind: 'idle' } | { kind: 'current' | 'invalidated'; request: ComposerImageHandoff };
type Snapshot = Readonly<{ imagePending: boolean; panelPending: boolean }>;

export function createComposerHandoffs() {
  let panel: Panel = { kind: 'idle' };
  let image: Image = { kind: 'idle' };
  let snapshot: Snapshot = { imagePending: false, panelPending: false };
  return {
    get panel() {
      return panel.kind === 'idle' ? null : panel.request;
    },
    get image() {
      return image.kind === 'idle' ? null : image.request;
    },
    get snapshot() {
      const imagePending = image.kind !== 'idle';
      const panelPending = panel.kind === 'waiting';
      if (snapshot.imagePending !== imagePending || snapshot.panelPending !== panelPending)
        snapshot = { imagePending, panelPending };
      return snapshot;
    },
    claimPanel() {
      const request = {};
      panel = { kind: 'claimed', request };
      return request;
    },
    waitForPanel(request: object) {
      if (panel.kind !== 'idle' && panel.request === request) panel = { kind: 'waiting', request };
    },
    releasePanel(request: object) {
      if (panel.kind !== 'idle' && panel.request === request) panel = { kind: 'idle' };
    },
    invalidatePanel() {
      panel = { kind: 'idle' };
    },
    claimImage(uploadId: string, epoch: number) {
      const request = { uploadId, epoch };
      image = { kind: 'current', request };
      return request;
    },
    ownsImage(request: ComposerImageHandoff) {
      return image.kind === 'current' && image.request === request;
    },
    invalidateImage() {
      if (image.kind === 'current') image = { kind: 'invalidated', request: image.request };
    },
    releaseImage(request: ComposerImageHandoff) {
      if (image.kind !== 'idle' && image.request === request) image = { kind: 'idle' };
    }
  };
}
