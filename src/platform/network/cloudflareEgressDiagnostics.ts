import { beginDiagnosticTrace, finishDiagnosticTrace, withDiagnosticFetcher } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';
import type { Fetcher } from './request';

const TRACE_URL = 'https://linux.do/cdn-cgi/trace';
const DEADLINE_MS = 5000;
const BODY_LIMIT = 4096;
const MESSAGE_TYPE = 'linuxdo-egress-probe';
type ProbeResult = 'success' | 'http-error' | 'network-error' | 'invalid-response' | 'timeout' | 'canceled';
type ProbeFailure =
  | 'none'
  | 'document-mismatch'
  | 'bridge-unavailable'
  | 'redirect'
  | 'oversize'
  | 'trace-format'
  | 'transport'
  | 'body-read'
  | 'http-status'
  | 'deadline'
  | 'canceled';
type ProbeCancelReason = 'check' | 'close' | 'navigation' | 'refresh' | 'background' | 'webview-error' | 'unmount';
type Protocol = 'http/1.0' | 'http/1.1' | 'h2' | 'h3' | 'unknown';
type Sample = {
  result: ProbeResult;
  failure: ProbeFailure;
  durationMs?: number;
  status?: number;
  ip?: string;
  protocol?: Protocol;
  family?: 'ipv4' | 'ipv6';
};

function address(value: unknown): Pick<Sample, 'ip' | 'family'> | null {
  if (typeof value !== 'string' || value.length > 45) return null;
  if (
    /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value) &&
    value.split('.').every((part) => Number(part) <= 255)
  )
    return { ip: value, family: 'ipv4' };
  if (!value.includes(':') || !/^[\da-fA-F:.]+$/.test(value)) return null;
  try {
    return { ip: new URL(`http://[${value}]/`).hostname.toLowerCase(), family: 'ipv6' };
  } catch {
    return null;
  }
}

function protocol(value: unknown): Protocol | null {
  if (value === 'http/1.0' || value === 'http/1.1' || value === 'h2' || value === 'h3') return value;
  return value === 'http/2' ? 'h2' : value === 'http/3' ? 'h3' : null;
}

function traceSample(body: string, status: number): Sample {
  if (body.length > BODY_LIMIT) return { result: 'invalid-response', failure: 'oversize', status };
  const ips = body.split(/\r?\n/).filter((line) => line.startsWith('ip='));
  const protocols = body.split(/\r?\n/).filter((line) => line.startsWith('http='));
  const parsedAddress = ips.length === 1 ? address(ips[0].slice(3)) : null;
  const parsedProtocol = protocols.length === 1 ? protocol(protocols[0].slice(5)) : null;
  return parsedAddress && parsedProtocol
    ? { result: 'success', failure: 'none', status, ...parsedAddress, protocol: parsedProtocol }
    : { result: 'invalid-response', failure: 'trace-format', status };
}

function probeScript(probeId: string | number, documentKey: string) {
  return `(function () {
    var id = ${JSON.stringify(probeId)}, documentKey = ${JSON.stringify(documentKey)};
    var previous = window.__WZ_EGRESS_PROBE__;
    if (previous && previous.id === id && previous.documentKey === documentKey) return;
    if (previous && previous.cancel) previous.cancel();
    var controller = new AbortController(), settled = false, timer;
    function finish(result, fields) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({
        type: '${MESSAGE_TYPE}', id: id, documentKey: documentKey, result: result
      }, fields || {})));
    }
    window.__WZ_EGRESS_PROBE__ = { id: id, documentKey: documentKey, cancel: function () {
      settled = true; clearTimeout(timer); controller.abort();
    }};
    if (window.top !== window || location.origin !== 'https://linux.do' ||
      String(location.href) + ':' + String(performance.timeOrigin || 0) !== documentKey) {
      finish('invalid-response', { failure: 'document-mismatch' }); return;
    }
    timer = setTimeout(function () { finish('timeout', { failure: 'deadline' }); controller.abort(); }, ${DEADLINE_MS});
    Promise.resolve().then(function () {
      if (settled) return;
      return fetch('${TRACE_URL}', { method: 'GET', credentials: 'omit', cache: 'no-store',
        redirect: 'error', headers: { Accept: 'text/plain', 'Cache-Control': 'no-store' }, signal: controller.signal });
    }).then(function (response) {
      if (settled) return;
      if (response.url !== '${TRACE_URL}' || response.redirected) {
        finish('invalid-response', { failure: 'redirect', status: response.status }); return;
      }
      if (!response.ok) { finish('http-error', { failure: 'http-status', status: response.status }); return; }
      if (Number(response.headers.get('content-length')) > ${BODY_LIMIT}) {
        finish('invalid-response', { failure: 'oversize', status: response.status }); return;
      }
      return response.text().then(function (body) {
        if (settled) return;
        if (body.length > ${BODY_LIMIT}) {
          finish('invalid-response', { failure: 'oversize', status: response.status }); return;
        }
        var ips = body.split(/\\r?\\n/).filter(function (line) { return line.indexOf('ip=') === 0; });
        var protocols = body.split(/\\r?\\n/).filter(function (line) { return line.indexOf('http=') === 0; });
        var ip = ips.length === 1 ? ips[0].slice(3) : '', http = protocols.length === 1 ? protocols[0].slice(5) : '';
        var validIp = /^(?:0|[1-9]\\d{0,2})(?:\\.(?:0|[1-9]\\d{0,2})){3}$/.test(ip) &&
          ip.split('.').every(function (part) { return Number(part) <= 255; });
        if (!validIp && ip.length <= 45 && ip.indexOf(':') !== -1 && /^[\\da-fA-F:.]+$/.test(ip)) {
          try { new URL('http://[' + ip + ']/'); validIp = true; } catch (_) {}
        }
        if (!validIp || ['http/1.0', 'http/1.1', 'http/2', 'http/3', 'h2', 'h3'].indexOf(http) === -1) {
          finish('invalid-response', { failure: 'trace-format', status: response.status }); return;
        }
        finish('success', { failure: 'none', status: response.status, ip: ip, protocol: http });
      }).catch(function () { finish('network-error', { failure: 'body-read', status: response.status }); });
    }).catch(function () { finish('network-error', { failure: 'transport' }); });
  })(); true;`;
}

export function startCloudflareEgressProbe({
  fetcher,
  injectJavaScript,
  parentTraceId,
  probeId,
  documentKey,
  userAgent
}: {
  fetcher: Fetcher;
  injectJavaScript: (script: string) => void;
  parentTraceId: string;
  probeId: string | number;
  documentKey: string;
  userAgent: string;
}) {
  const trace = beginDiagnosticTrace('network', 'egress-probe', { source: 'linuxdo', parentTraceId });
  const controller = new AbortController();
  let native: Sample | undefined;
  let webView: Sample | undefined;
  let finished = false;
  let completedAt: number | undefined;
  let completedFields: DiagnosticFields | undefined;
  let cancelReason: ProbeCancelReason | undefined;
  let resolveSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const elapsed = () => Math.max(0, Math.min(1_000_000_000, Date.now() - trace.startedAt));
  const fields = (): DiagnosticFields => ({
    ...(native
      ? {
          probeNativeResult: native.result,
          probeNativeFailure: native.failure,
          probeNativeDurationMs: native.durationMs,
          probeNativeProtocol: native.protocol || 'unknown',
          probeNativeAddressFamily: native.family || 'unknown',
          ...(native.status === undefined ? {} : { probeNativeStatus: native.status })
        }
      : {}),
    ...(webView
      ? {
          probeWebViewResult: webView.result,
          probeWebViewFailure: webView.failure,
          probeWebViewDurationMs: webView.durationMs,
          probeWebViewProtocol: webView.protocol || 'unknown',
          probeWebViewAddressFamily: webView.family || 'unknown',
          ...(webView.status === undefined ? {} : { probeWebViewStatus: webView.status })
        }
      : {}),
    ...(native?.result === 'success' && webView?.result === 'success'
      ? { isSameEgress: native.ip === webView.ip }
      : {}),
    ...(cancelReason ? { probeCancelReason: cancelReason } : {})
  });
  const cancelWebView = () => {
    try {
      injectJavaScript(
        `(function(){var probe=window.__WZ_EGRESS_PROBE__;if(probe&&probe.id===${JSON.stringify(probeId)})probe.cancel();})();true;`
      );
    } catch {
      /* A disposed WebView must not affect verification. */
    }
  };
  const finish = () => {
    if (finished || !native || !webView) return;
    finished = true;
    clearTimeout(timer);
    completedAt = Date.now();
    completedFields = fields();
    resolveSettled();
    finishDiagnosticTrace(
      trace,
      native.result === 'success' && webView.result === 'success'
        ? 'success'
        : native.result === 'canceled' || webView.result === 'canceled'
          ? 'canceled'
          : 'partial',
      {
        source: 'linuxdo',
        parentTraceId,
        ...completedFields
      }
    );
    native = undefined;
    webView = undefined;
  };
  const timer = setTimeout(() => {
    if (finished) return;
    native ||= { result: 'timeout', failure: 'deadline', durationMs: elapsed() };
    webView ||= { result: 'timeout', failure: 'deadline', durationMs: elapsed() };
    controller.abort();
    cancelWebView();
    finish();
  }, DEADLINE_MS);
  void Promise.resolve()
    .then(async () => {
      if (controller.signal.aborted) return { result: 'canceled', failure: 'canceled' } as Sample;
      const response = await withDiagnosticFetcher(trace, fetcher)(TRACE_URL, {
        // RN's fetch polyfill appends a timestamp query for cache: no-store.
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: 'text/plain', 'Cache-Control': 'no-cache, no-store', 'User-Agent': userAgent },
        signal: controller.signal
      });
      if (response.url !== TRACE_URL || response.redirected)
        return { result: 'invalid-response', failure: 'redirect', status: response.status } as Sample;
      if (!response.ok) return { result: 'http-error', failure: 'http-status', status: response.status } as Sample;
      if (Number(response.headers.get('content-length')) > BODY_LIMIT)
        return { result: 'invalid-response', failure: 'oversize', status: response.status } as Sample;
      try {
        return traceSample(await response.text(), response.status);
      } catch {
        return { result: 'network-error', failure: 'body-read', status: response.status } as Sample;
      }
    })
    .catch((): Sample => ({ result: 'network-error', failure: 'transport' }))
    .then((sample) => {
      if (finished || native) return;
      native = { ...sample, durationMs: elapsed() };
      finish();
    });
  try {
    injectJavaScript(probeScript(probeId, documentKey));
  } catch {
    webView = { result: 'network-error', failure: 'bridge-unavailable', durationMs: elapsed() };
  }
  return {
    settled,
    snapshot() {
      return {
        traceId: trace.traceId,
        startedAt: trace.startedAt,
        ...(completedAt === undefined ? {} : { completedAt }),
        fields: { ...(completedFields || fields()) }
      };
    },
    receive(data: unknown) {
      if (!data || typeof data !== 'object') return false;
      const input = data as Record<string, unknown>;
      if (input.type !== MESSAGE_TYPE || input.id !== probeId || input.documentKey !== documentKey) return false;
      if (finished || webView) return true;
      const status =
        typeof input.status === 'number' && Number.isInteger(input.status) && input.status >= 100 && input.status <= 599
          ? input.status
          : undefined;
      const parsedAddress = address(input.ip);
      const parsedProtocol = protocol(input.protocol);
      webView =
        input.result === 'success' &&
        status !== undefined &&
        status >= 200 &&
        status < 300 &&
        parsedAddress &&
        parsedProtocol
          ? { result: 'success', failure: 'none', status, ...parsedAddress, protocol: parsedProtocol }
          : input.result === 'http-error' && status !== undefined && status >= 300
            ? { result: 'http-error', failure: 'http-status', status }
            : input.result === 'network-error'
              ? { result: 'network-error', failure: input.failure === 'body-read' ? 'body-read' : 'transport', status }
              : input.result === 'timeout' || input.result === 'canceled'
                ? { result: input.result, failure: input.result === 'timeout' ? 'deadline' : 'canceled' }
                : {
                    result: 'invalid-response',
                    status,
                    failure:
                      input.result === 'invalid-response' &&
                      (input.failure === 'document-mismatch' ||
                        input.failure === 'redirect' ||
                        input.failure === 'oversize')
                        ? input.failure
                        : 'trace-format'
                  };
      webView.durationMs = elapsed();
      finish();
      return true;
    },
    cancel(reason?: ProbeCancelReason) {
      if (finished) return;
      cancelReason = reason;
      native ||= { result: 'canceled', failure: 'canceled', durationMs: elapsed() };
      webView ||= { result: 'canceled', failure: 'canceled', durationMs: elapsed() };
      controller.abort();
      cancelWebView();
      finish();
    }
  };
}
