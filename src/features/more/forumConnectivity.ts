import { sourceCatalog, type Source } from '@/domain/forum/sourceCatalog';
import { beginDiagnosticTrace, finishDiagnosticTrace, withDiagnosticFetcher } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { FORUM_READ_COOKIE_POLICY_HEADER } from '@/platform/network/browserFetchIntent';
import {
  canContainCloudflareChallengePage,
  isCloudflareChallengeResponse
} from '@/platform/network/cloudflareChallenge';
import { DEFAULT_REQUEST_TIMEOUT_MS, withAbortableTimeout, type Fetcher } from '@/platform/network/request';
import { isNodeSeekChallengeResponse } from '@/sources/nodeseek/protocol';

export async function checkForumConnectivity(source: Source, fetcher: Fetcher, signal: AbortSignal) {
  const url = new URL(sourceCatalog[source].baseUrl);
  const started = Date.now();
  const trace = beginDiagnosticTrace('network', 'test', { source });
  try {
    const { response, challenge } = await withAbortableTimeout(
      async (signal) => {
        const response = await withDiagnosticFetcher(trace, fetcher)(url.href, {
          credentials: 'omit',
          headers: {
            Accept: 'text/html',
            'Cache-Control': 'no-cache, no-store',
            [FORUM_READ_COOKIE_POLICY_HEADER]: 'omit'
          },
          signal
        });
        let challenge = isCloudflareChallengeResponse(response);
        if (!challenge && canContainCloudflareChallengePage(response.headers)) {
          const html = await response.text();
          challenge =
            source === 'nodeseek'
              ? isNodeSeekChallengeResponse(response, html, url.href)
              : isCloudflareChallengeResponse({
                  status: response.status,
                  headers: response.headers,
                  bodyText: html.slice(0, 65536)
                });
        }
        return { response, challenge };
      },
      { signal, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS }
    );
    const destination = new URL(response.url || url.href);
    const onSite =
      destination.protocol === 'https:' &&
      destination.hostname.replace(/^www[.]/, '') === url.hostname.replace(/^www[.]/, '');
    const reason = !onSite
      ? 'invalid_response'
      : challenge
        ? 'verification_required'
        : !response.ok
          ? 'http_error'
          : undefined;
    const latencyMs = Date.now() - started;
    const outcome = reason === 'verification_required' ? 'blocked' : reason ? 'failure' : 'success';
    finishDiagnosticTrace(trace, outcome, { source, status: response.status, latencyMs, reason });
    const message =
      reason === 'invalid_response' ? '已转到其他网站' : challenge ? '需网站验证' : reason ? '站点返回错误' : '可访问';
    return { message: `${message} · HTTP ${response.status}`, latencyMs, failed: outcome === 'failure' };
  } catch (error) {
    const reason = normalizeDiagnosticReason(error);
    const latencyMs = Date.now() - started;
    finishDiagnosticTrace(trace, signal.aborted ? 'canceled' : 'failure', { source, reason, latencyMs });
    return { message: reason === 'timeout' ? '连接超时' : '连接失败', latencyMs, failed: true };
  }
}
