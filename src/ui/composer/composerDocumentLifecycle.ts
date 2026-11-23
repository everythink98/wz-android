type Initialization =
  { kind: 'unrequested' } | { kind: 'pending' | 'timed-out'; admission: 'new' | 'retained' } | { kind: 'ready' };

type DocumentSnapshot = Readonly<{
  modeLoaded: boolean;
  webLoaded: boolean;
  ready: boolean;
  rendererGone: boolean;
  initializationTimedOut: boolean;
}>;

export type ComposerDocumentEvent =
  | 'mode-loading'
  | 'mode-loaded'
  | 'web-loaded'
  | 'initialize'
  | 'ready'
  | 'initialization-timeout'
  | 'renderer-gone'
  | 'reload';

export function createComposerDocumentLifecycle(initialModeKnown: boolean) {
  let preference: 'loading' | 'loaded' = 'loading';
  let webDocument: 'loading' | 'loaded' = 'loading';
  let renderer: 'present' | 'gone' = 'present';
  let initialization: Initialization = initialModeKnown
    ? { kind: 'pending', admission: 'new' }
    : { kind: 'unrequested' };
  const admitted = () =>
    initialization.kind === 'ready' ||
    ((initialization.kind === 'pending' || initialization.kind === 'timed-out') &&
      initialization.admission === 'retained');
  const project = (): DocumentSnapshot => ({
    modeLoaded: preference === 'loaded',
    webLoaded: webDocument === 'loaded',
    ready: admitted(),
    rendererGone: renderer === 'gone',
    initializationTimedOut: initialization.kind === 'timed-out'
  });
  let snapshot = project();

  return {
    get snapshot() {
      return snapshot;
    },
    get initializing() {
      return initialization.kind === 'pending' || initialization.kind === 'timed-out';
    },
    get waitingForReady() {
      return initialization.kind === 'pending';
    },
    apply(event: ComposerDocumentEvent) {
      switch (event) {
        case 'mode-loading':
          preference = 'loading';
          break;
        case 'mode-loaded':
          preference = 'loaded';
          break;
        case 'web-loaded':
          webDocument = 'loaded';
          break;
        case 'initialize':
          initialization = { kind: 'pending', admission: admitted() ? 'retained' : 'new' };
          break;
        case 'ready':
          initialization = { kind: 'ready' };
          renderer = 'present';
          break;
        case 'initialization-timeout':
          if (initialization.kind === 'pending') initialization = { ...initialization, kind: 'timed-out' };
          break;
        case 'renderer-gone':
          initialization = { kind: 'unrequested' };
          renderer = 'gone';
          break;
        case 'reload':
          initialization = { kind: 'unrequested' };
          renderer = 'present';
          webDocument = 'loading';
          break;
        default: {
          const exhaustive: never = event;
          return exhaustive;
        }
      }
      const next = project();
      if (
        next.modeLoaded !== snapshot.modeLoaded ||
        next.webLoaded !== snapshot.webLoaded ||
        next.ready !== snapshot.ready ||
        next.rendererGone !== snapshot.rendererGone ||
        next.initializationTimedOut !== snapshot.initializationTimedOut
      )
        snapshot = next;
      return snapshot;
    }
  };
}
