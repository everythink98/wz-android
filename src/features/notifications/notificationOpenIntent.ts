import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

type Request = Readonly<{ source: NotificationSource; trace: DiagnosticTrace }>;
type Opening = { kind: 'none' } | { kind: 'dispatching' | 'waiting'; request: Request };

export function createNotificationOpenIntent() {
  let state: Opening = { kind: 'none' };
  let lastResponse = '';
  const owns = (request: Request) => state.kind !== 'none' && state.request === request;
  return {
    receive(key: string, request: Request) {
      if (key === lastResponse) return { kind: 'duplicate' as const };
      lastResponse = key;
      const previous = state.kind === 'none' ? undefined : state.request;
      state = { kind: 'dispatching', request };
      return { kind: 'accepted' as const, previous };
    },
    dispatchPending() {
      if (state.kind !== 'waiting') return undefined;
      const request = state.request;
      state = { kind: 'dispatching', request };
      return request;
    },
    waiting(request: Request) {
      if (!owns(request)) return false;
      state = { kind: 'waiting', request };
      return true;
    },
    opened(request: Request) {
      if (!owns(request)) return false;
      state = { kind: 'none' };
      return true;
    },
    cancel(request?: Request) {
      if (state.kind === 'none' || (request && state.request !== request)) return undefined;
      const previous = state.request;
      state = { kind: 'none' };
      return previous;
    },
    removedSources(sources: readonly NotificationSource[]) {
      if (state.kind === 'none' || !sources.includes(state.request.source)) return undefined;
      const previous = state.request;
      state = { kind: 'none' };
      return previous;
    }
  };
}
