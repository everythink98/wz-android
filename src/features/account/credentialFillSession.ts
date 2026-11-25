import type { AccountCredentialFillAttempt } from '@/domain/session/accountCenter';
import type { CredentialSite } from '@/domain/session/sessionContracts';
import type { WebView, WebViewMessageEvent } from 'react-native-webview';
import type { CredentialFillTraceState } from './credentialDiagnostics';

export type LoginFormMessageHandler = (
  event: WebViewMessageEvent,
  readDocument: () => Pick<WebView, 'injectJavaScript'> | null
) => boolean;

type Fill = Readonly<CredentialFillTraceState & { owner: AbortSignal }>;
type Trace = { kind: 'settled' } | { kind: 'active'; fill: Fill; adopt: (owner: AbortSignal) => void };
type FillSession =
  | { kind: 'closed' }
  | { kind: 'open'; attempt: AccountCredentialFillAttempt; form: 'pending' | 'consumed'; trace: Trace };
type FillSnapshot = Readonly<{
  attempt: AccountCredentialFillAttempt | null;
  pendingSite: CredentialSite | null;
}>;

export function createCredentialFillSession() {
  let state: FillSession = { kind: 'closed' };
  let snapshot: FillSnapshot = { attempt: null, pendingSite: null };
  return {
    get site() {
      return state.kind === 'open' ? state.attempt.site : null;
    },
    get active(): Fill | null {
      return state.kind === 'open' && state.trace.kind === 'active' ? state.trace.fill : null;
    },
    get pendingSite() {
      return state.kind === 'open' && state.form === 'pending' ? state.attempt.site : null;
    },
    get snapshot() {
      const attempt = state.kind === 'open' ? state.attempt : null;
      const pendingSite = state.kind === 'open' && state.form === 'pending' ? state.attempt.site : null;
      if (snapshot.attempt !== attempt || snapshot.pendingSite !== pendingSite) snapshot = { attempt, pendingSite };
      return snapshot;
    },
    begin(input: CredentialFillTraceState & { owner: AbortSignal }) {
      let owner = input.owner;
      const fill: Fill = {
        site: input.site,
        attempt: input.attempt,
        trace: input.trace,
        get owner() {
          return owner;
        }
      };
      state = {
        kind: 'open',
        attempt: { site: input.site, attempt: input.attempt },
        form: 'pending',
        trace: {
          kind: 'active',
          fill,
          adopt: (next) => {
            owner = next;
          }
        }
      };
    },
    finishTrace(fill: Fill) {
      if (state.kind === 'open' && state.trace.kind === 'active' && state.trace.fill === fill)
        state = { ...state, trace: { kind: 'settled' } };
    },
    consumeForm(site: CredentialSite) {
      if (state.kind === 'open' && state.attempt.site === site && state.form === 'pending')
        state = { ...state, form: 'consumed' };
    },
    close(site: CredentialSite) {
      if (state.kind === 'open' && state.attempt.site === site) state = { kind: 'closed' };
    },
    adopt(owner: AbortSignal) {
      if (state.kind === 'open' && state.trace.kind === 'active') state.trace.adopt(owner);
    }
  };
}
