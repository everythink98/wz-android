import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { diagnosticUserAgentHash } from './linuxDoUserAgent';

export function createDefaultWebViewUserAgentReader(read: () => Promise<unknown>): () => Promise<string> {
  let cached: string | undefined;
  let pending: Promise<string> | undefined;
  return () => {
    if (cached !== undefined) return Promise.resolve(cached);
    if (pending) return pending;
    const trace = beginDiagnosticTrace('webview', 'read-user-agent', { state: 'start', userAgentSource: 'default' });
    pending = Promise.resolve()
      .then(read)
      .then((value) => {
        if (typeof value !== 'string') throw new Error('默认浏览器身份读取失败');
        const userAgent = value.replace(/\s+/g, ' ').trim();
        if (!userAgent) throw new Error('默认浏览器身份读取失败');
        cached = userAgent;
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
        pending = undefined;
      });
    return pending;
  };
}
