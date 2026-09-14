import type { Fetcher } from '@/platform/network/request';
import { userPresent } from '@/platform/network/userPresence';
import {
  diagnosticTraceForRequest,
  diagnosticRequestFields,
  markDiagnosticStage
} from '@/platform/diagnostics/diagnostics';
import { LINUXDO_BASE_URL } from './protocol';

export function withLinuxDoPresence(fetcher: Fetcher): Fetcher {
  return (input, init) => {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return fetcher(input, init);
    }
    if (url.origin !== LINUXDO_BASE_URL || url.username || url.password) return fetcher(input, init);
    const headers = new Headers(init?.headers);
    if (headers.get('X-Requested-With') !== 'XMLHttpRequest') return fetcher(input, init);
    const hasDiscoursePresent = userPresent();
    if (hasDiscoursePresent) headers.set('Discourse-Present', 'true');
    else headers.delete('Discourse-Present');
    const trace = diagnosticTraceForRequest(init);
    if (trace)
      markDiagnosticStage(trace, 'transport', {
        ...diagnosticRequestFields(init),
        source: 'linuxdo',
        state: 'applied',
        hasDiscoursePresent
      });
    return fetcher(input, { ...init, headers });
  };
}
