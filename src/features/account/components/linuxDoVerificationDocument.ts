export const LINUXDO_CHALLENGE_URL = 'https://cdk.linux.do/';
const CHALLENGE_ORIGIN = LINUXDO_CHALLENGE_URL.slice(0, -1);
const RETURN_URL = LINUXDO_CHALLENGE_URL + 'login';

type Stage = 'account' | 'challenge' | 'returning';
type DocumentLocation = { kind: 'empty' } | { kind: 'observed'; url: string };
type DocumentFailure = { kind: 'none' } | { kind: 'failed'; url: string };
type Renderer = 'usable' | 'remount-required';
type Receipt = 'challenge-entry' | 'challenge-return' | 'ignored-message';
type ChallengeMessage = 'unrelated' | 'returned' | 'ignored' | 'ignored-first';
type PageSnapshot = Readonly<{ stage: Stage; needsRemount: boolean }>;

export function createLinuxDoVerificationDocument(initialChallenge: boolean) {
  let stage: Stage = initialChallenge ? 'challenge' : 'account';
  let location: DocumentLocation = { kind: 'empty' };
  let failure: DocumentFailure = { kind: 'none' };
  let renderer: Renderer = 'usable';
  let observedVisibility: 'hidden' | 'visible' = 'hidden';
  const receipts = new Set<Receipt>();
  let snapshot: PageSnapshot = { stage, needsRemount: false };
  const documentUrl = () => (location.kind === 'observed' ? location.url : '');
  const failedUrl = () => (failure.kind === 'failed' ? failure.url : null);

  return {
    get documentUrl() {
      return documentUrl();
    },
    get snapshot() {
      const needsRemount = renderer === 'remount-required';
      if (snapshot.stage !== stage || snapshot.needsRemount !== needsRemount) snapshot = { stage, needsRemount };
      return snapshot;
    },
    observeVisibility(visible: boolean, dedicated: boolean, loginFormMode: boolean) {
      if (!visible || loginFormMode || observedVisibility === 'hidden')
        stage = visible && dedicated && !loginFormMode ? 'challenge' : 'account';
      observedVisibility = visible ? 'visible' : 'hidden';
    },
    resetDocument() {
      location = { kind: 'empty' };
      failure = { kind: 'none' };
      receipts.clear();
      renderer = 'usable';
    },
    showChallenge() {
      stage = 'challenge';
    },
    started(url: string, loading: boolean, committedStage: Stage) {
      const earlyHttpError = failedUrl() === url && documentUrl() !== url;
      if (!earlyHttpError && (documentUrl() !== url || loading)) failure = { kind: 'none' };
      location = { kind: 'observed', url };
      if (loading) receipts.delete('ignored-message');
      const logChallengeEntry = committedStage === 'challenge' && !receipts.has('challenge-entry');
      if (logChallengeEntry) receipts.add('challenge-entry');
      renderer = 'usable';
      return { logChallengeEntry, clearError: !failedUrl() };
    },
    finished(url: string, syntheticError: boolean) {
      return failedUrl() === url || syntheticError;
    },
    failed(url: string) {
      failure = { kind: 'failed', url };
    },
    requireRemount() {
      renderer = 'remount-required';
    },
    challengeMessage(raw: string, url: string, committedStage: Stage): ChallengeMessage {
      if (committedStage !== 'challenge' && url !== CHALLENGE_ORIGIN && !url.startsWith(LINUXDO_CHALLENGE_URL))
        return 'unrelated';
      if (
        committedStage === 'challenge' &&
        !receipts.has('challenge-return') &&
        documentUrl() === RETURN_URL &&
        (url === CHALLENGE_ORIGIN || url === RETURN_URL)
      ) {
        try {
          const message = JSON.parse(raw);
          const prefix = RETURN_URL + ':';
          const timeOrigin =
            typeof message.documentKey === 'string' && message.documentKey.startsWith(prefix)
              ? Number(message.documentKey.slice(prefix.length))
              : 0;
          if (
            message.type === 'linuxdo-webview' &&
            message.hasChallengeMarker === false &&
            Number.isFinite(timeOrigin) &&
            timeOrigin > 0 &&
            failedUrl() !== RETURN_URL
          ) {
            receipts.add('challenge-return');
            stage = 'returning';
            return 'returned';
          }
        } catch {
          // Foreign page messages never enter account state.
        }
      }
      if (receipts.has('ignored-message')) return 'ignored';
      receipts.add('ignored-message');
      return 'ignored-first';
    }
  };
}
