import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { diagnosticUserAgentHash } from './userAgent';

type UserAgentReaderState =
  { kind: 'cold' } | { kind: 'reading'; task: Promise<string> } | { kind: 'ready'; value: string };

export function createDefaultWebViewUserAgentReader(read: () => Promise<unknown>): () => Promise<string> {
  let state: UserAgentReaderState = { kind: 'cold' };
  return () => {
    if (state.kind === 'ready') return Promise.resolve(state.value);
    if (state.kind === 'reading') return state.task;
    const trace = beginDiagnosticTrace('webview', 'read-user-agent', { state: 'start', userAgentSource: 'default' });
    const task: Promise<string> = Promise.resolve()
      .then(read)
      .then((value) => {
        if (typeof value !== 'string') throw new Error('默认浏览器身份读取失败');
        const userAgent = value.replace(/\s+/g, ' ').trim();
        if (!userAgent) throw new Error('默认浏览器身份读取失败');
        state = { kind: 'ready', value: userAgent };
        finishDiagnosticTrace(trace, 'success', {
          state: 'ready',
          userAgentSource: 'default',
          userAgentHash: diagnosticUserAgentHash(userAgent)
        });
        return userAgent;
      })
      .catch((error) => {
        finishDiagnosticTrace(trace, 'failure', { reason: 'identity_unavailable', userAgentSource: 'default' });
        throw error;
      })
      .finally(() => {
        // Intent diagnostics may reenter, so completion clears the shared reading slot.
        if (state.kind === 'reading') state = { kind: 'cold' };
      });
    state = { kind: 'reading', task };
    return task;
  };
}
