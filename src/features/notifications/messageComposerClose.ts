type Opening = Readonly<{ key: string }>;
type Request = Readonly<{ opening: Opening }>;
type Closing = { kind: 'idle' } | { kind: 'snapshotting' | 'closed'; request: Request };

export function createMessageComposerClose(visible: boolean, key: string) {
  let opening: Opening = { key };
  let observedVisible = visible;
  let observation: 'attached' | 'detached' = 'attached';
  let closing: Closing = { kind: 'idle' };
  return {
    get opening() {
      return opening;
    },
    attach() {
      observation = 'attached';
    },
    detach() {
      observation = 'detached';
    },
    observe(nextVisible: boolean, nextKey: string) {
      if (opening.key !== nextKey || (nextVisible && !observedVisible)) {
        opening = { key: nextKey };
        closing = { kind: 'idle' };
      }
      observedVisible = nextVisible;
    },
    claim(observedOpening: Opening) {
      if (observation === 'detached' || observedOpening !== opening || closing.kind !== 'idle') return null;
      const request = { opening };
      closing = { kind: 'snapshotting', request };
      return request;
    },
    settled(request: Request) {
      if (
        observation === 'detached' ||
        request.opening !== opening ||
        closing.kind !== 'snapshotting' ||
        closing.request !== request
      )
        return false;
      closing = { kind: 'closed', request };
      return true;
    }
  };
}
