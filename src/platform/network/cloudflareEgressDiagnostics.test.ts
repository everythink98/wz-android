import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { diagnosticRequestContext, setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { startCloudflareEgressProbe } from './cloudflareEgressDiagnostics';
import type { Fetcher } from './request';
import { URL as ExpoURL } from 'whatwg-url-minimum';

const TRACE_URL = 'https://linux.do/cdn-cgi/trace';
const DOCUMENT_KEY = 'https://linux.do/:123';
const BODY = 'fl=PRIVATE_SERVER\nip=203.0.113.42\nhttp=http/2\nua=PRIVATE_UA\n';

function response(body = BODY, status = 200, url = TRACE_URL) {
  const result = new Response(body, { status, headers: { 'content-type': 'text/plain' } });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

function setup({
  native = vi.fn<Fetcher>(async () => response()),
  browser = vi.fn<Fetcher>(async () => response()),
  origin = 'https://linux.do',
  href = 'https://linux.do/',
  documentKey = DOCUMENT_KEY,
  iframe = false
}: {
  native?: Mock<Fetcher>;
  browser?: Mock<Fetcher>;
  origin?: string;
  href?: string;
  documentKey?: string;
  iframe?: boolean;
} = {}) {
  const lines: string[] = [];
  const messages: Record<string, unknown>[] = [];
  const scripts: string[] = [];
  setDiagnosticWriter((line) => {
    lines.push(line);
  });
  const page = {
    ReactNativeWebView: {
      postMessage(value: string) {
        const data = JSON.parse(value) as Record<string, unknown>;
        messages.push(data);
        void Promise.resolve().then(() => probe.receive(data));
      }
    }
  };
  Object.assign(page, { top: iframe ? {} : page });
  const context = createContext({
    window: page,
    location: { origin, href },
    performance: { timeOrigin: 123 },
    fetch: browser,
    AbortController,
    URL,
    setTimeout,
    clearTimeout
  });
  const injectJavaScript = vi.fn((script: string) => {
    scripts.push(script);
    runInContext(script, context);
  });
  const probe = startCloudflareEgressProbe({
    fetcher: native,
    injectJavaScript,
    parentTraceId: 'trace-99',
    probeId: 7,
    documentKey,
    userAgent: 'PRIVATE_USER_AGENT'
  });
  return {
    probe,
    native,
    browser,
    lines,
    scripts,
    messages,
    context,
    injectJavaScript,
    finishes: () => lines.map((line) => JSON.parse(line)).filter((event) => event.phase === 'finish')
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  setDiagnosticWriter(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Cloudflare verification egress diagnostics', () => {
  it.each(['success', 'http-error', 'timeout', 'cancel'] as const)(
    'settles its completion signal without exposing samples on %s',
    async (outcome) => {
      const pending = vi.fn<Fetcher>(() => new Promise(() => undefined));
      const test = setup(
        outcome === 'timeout' || outcome === 'cancel'
          ? { native: pending, browser: pending }
          : { native: vi.fn<Fetcher>(async () => response(BODY, outcome === 'http-error' ? 403 : 200)) }
      );
      const settled = vi.fn();
      void test.probe.settled.then(settled);
      await vi.advanceTimersByTimeAsync(0);
      if (outcome === 'timeout' || outcome === 'cancel') {
        expect(settled).not.toHaveBeenCalled();
        if (outcome === 'cancel') test.probe.cancel('close');
        else await vi.advanceTimersByTimeAsync(5000);
      }
      await test.probe.settled;
      expect(settled).toHaveBeenCalledExactlyOnceWith(undefined);
      test.probe.cancel('close');
      expect(test.finishes()).toHaveLength(1);
    }
  );

  it('compares the actual two channels once and exports no address, trace body or credentials', async () => {
    let requestTrace: unknown;
    const native = vi.fn(async (_url: string, init?: RequestInit) => {
      requestTrace = diagnosticRequestContext(init);
      return response();
    });
    const test = setup({ native });
    runInContext(test.scripts[0], test.context);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.native).toHaveBeenCalledTimes(1);
    expect(test.browser).toHaveBeenCalledTimes(1);
    expect(test.native).toHaveBeenCalledWith(
      TRACE_URL,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: 'text/plain', 'Cache-Control': 'no-cache, no-store', 'User-Agent': 'PRIVATE_USER_AGENT' }
      })
    );
    expect(test.browser).toHaveBeenCalledWith(
      TRACE_URL,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { Accept: 'text/plain', 'Cache-Control': 'no-store' }
      })
    );
    const { Request: ReactNativeRequest } = createRequire(import.meta.url)('whatwg-fetch') as {
      Request: typeof Request;
    };
    const nativeInit = test.native.mock.calls[0][1];
    expect(new ReactNativeRequest(TRACE_URL, nativeInit).url).toBe(TRACE_URL);
    expect(new ReactNativeRequest(TRACE_URL, { ...nativeInit, cache: 'no-store' }).url).toContain('?_=');
    expect(requestTrace).toMatchObject({ trace: { operation: 'egress-probe' } });
    expect(test.finishes()).toEqual([
      expect.objectContaining({
        operation: 'egress-probe',
        parentTraceId: 'trace-99',
        source: 'linuxdo',
        outcome: 'success',
        probeNativeResult: 'success',
        probeWebViewResult: 'success',
        probeNativeFailure: 'none',
        probeWebViewFailure: 'none',
        probeNativeDurationMs: 0,
        probeWebViewDurationMs: 0,
        probeNativeProtocol: 'h2',
        probeWebViewProtocol: 'h2',
        probeNativeAddressFamily: 'ipv4',
        probeWebViewAddressFamily: 'ipv4',
        probeNativeStatus: 200,
        probeWebViewStatus: 200,
        isSameEgress: true
      })
    ]);
    expect(test.messages[0]).toEqual({
      type: 'linuxdo-egress-probe',
      id: 7,
      documentKey: DOCUMENT_KEY,
      result: 'success',
      failure: 'none',
      status: 200,
      ip: '203.0.113.42',
      protocol: 'http/2'
    });
    expect(test.lines.join('')).not.toMatch(/203\.0\.113|PRIVATE|ip=|ua=/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('compares IPv6 canonical forms and retains a real mismatch', async () => {
    vi.stubGlobal('URL', ExpoURL);
    const same = setup({
      native: vi.fn(async () => response('ip=2001:0db8:0:0:0:0:0:1\nhttp=http/3')),
      browser: vi.fn(async () => response('ip=2001:db8::1\nhttp=http/2'))
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(same.finishes()[0]).toMatchObject({
      isSameEgress: true,
      probeNativeProtocol: 'h3',
      probeWebViewProtocol: 'h2',
      probeNativeAddressFamily: 'ipv6'
    });
    expect(same.lines.join('')).not.toContain('2001:');
    const different = setup({ browser: vi.fn(async () => response('ip=198.51.100.9\nhttp=http/1.1')) });
    await vi.advanceTimersByTimeAsync(0);
    expect(different.finishes()[0]).toMatchObject({ isSameEgress: false, probeWebViewProtocol: 'http/1.1' });
  });

  it('records HTTP and network failure without retry or leaking server error text', async () => {
    const test = setup({
      native: vi.fn(async () => response('PRIVATE_BLOCK_BODY', 403)),
      browser: vi.fn(async () => {
        throw new Error('PRIVATE_COOKIE 198.51.100.1');
      })
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(test.finishes()[0]).toMatchObject({
      outcome: 'partial',
      probeNativeResult: 'http-error',
      probeNativeFailure: 'http-status',
      probeNativeStatus: 403,
      probeWebViewResult: 'network-error',
      probeWebViewFailure: 'transport',
      probeNativeProtocol: 'unknown'
    });
    expect(test.finishes()[0]).not.toHaveProperty('isSameEgress');
    expect(test.native).toHaveBeenCalledTimes(1);
    expect(test.browser).toHaveBeenCalledTimes(1);
    expect(test.lines.join('')).not.toMatch(/PRIVATE|198\.51\.100/);
  });

  it('rejects foreign documents, stale receipts and malformed success results', async () => {
    const foreign = setup({ origin: 'https://challenges.cloudflare.com', href: 'https://challenges.cloudflare.com/' });
    await vi.advanceTimersByTimeAsync(0);
    expect(foreign.browser).not.toHaveBeenCalled();
    expect(foreign.finishes()[0]).toMatchObject({
      probeWebViewResult: 'invalid-response',
      probeWebViewFailure: 'document-mismatch'
    });
    const wrongDocument = setup({ documentKey: 'https://linux.do/:122' });
    await vi.advanceTimersByTimeAsync(0);
    expect(wrongDocument.browser).not.toHaveBeenCalled();
    expect(wrongDocument.finishes()[0]).toMatchObject({ probeWebViewFailure: 'document-mismatch' });
    const frame = setup({ iframe: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(frame.browser).not.toHaveBeenCalled();
    expect(frame.finishes()[0]).toMatchObject({ probeWebViewFailure: 'document-mismatch' });
    const test = setup({ browser: vi.fn(() => new Promise<Response>(() => {})) });
    expect(test.probe.receive({ type: 'linuxdo-egress-probe', id: 6, documentKey: DOCUMENT_KEY })).toBe(false);
    expect(test.probe.receive({ type: 'linuxdo-egress-probe', id: 7, documentKey: 'other' })).toBe(false);
    expect(
      test.probe.receive({
        type: 'linuxdo-egress-probe',
        id: 7,
        documentKey: DOCUMENT_KEY,
        result: 'success',
        status: 200,
        ip: '999.1.2.3',
        failure: 'PRIVATE_FAILURE',
        protocol: 'PRIVATE_PROTOCOL'
      })
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(test.finishes()[0]).toMatchObject({
      probeWebViewResult: 'invalid-response',
      probeWebViewFailure: 'trace-format'
    });
    expect(test.finishes()[0]).not.toHaveProperty('isSameEgress');
    expect(test.lines.join('')).not.toMatch(/PRIVATE_PROTOCOL|PRIVATE_FAILURE/);
  });

  it.each([
    ['duplicate address', 'ip=203.0.113.42\nip=203.0.113.43\nhttp=http/2', TRACE_URL, 'trace-format'],
    ['oversized body', `ip=203.0.113.42\nhttp=http/2\n${'x'.repeat(4096)}`, TRACE_URL, 'oversize'],
    ['invalid IPv6', 'ip=2001::::1\nhttp=http/2', TRACE_URL, 'trace-format'],
    ['unexpected protocol', 'ip=203.0.113.42\nhttp=PRIVATE_PROTOCOL', TRACE_URL, 'trace-format'],
    ['redirected response', BODY, 'https://other.example/cdn-cgi/trace', 'redirect']
  ])('rejects %s in both actual response parsers', async (_name, body, url, failure) => {
    const test = setup({
      native: vi.fn(async () => response(body, 200, url)),
      browser: vi.fn(async () => response(body, 200, url))
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(test.finishes()[0]).toMatchObject({
      probeNativeResult: 'invalid-response',
      probeWebViewResult: 'invalid-response',
      probeNativeFailure: failure,
      probeWebViewFailure: failure,
      probeNativeStatus: 200,
      probeWebViewStatus: 200
    });
    expect(test.finishes()[0]).not.toHaveProperty('isSameEgress');
    expect(test.lines.join('')).not.toMatch(/PRIVATE|203\.0\.113|other\.example/);
  });

  it('bounds both channels with one deadline, aborts pending IO and ignores late success', async () => {
    let resolveNative!: (value: Response) => void;
    const native = vi.fn(
      (_url: string, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          resolveNative = resolve;
        })
    );
    const browser = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));
    const test = setup({ native, browser });
    await vi.advanceTimersByTimeAsync(5000);
    expect(test.finishes()[0]).toMatchObject({
      probeNativeResult: 'timeout',
      probeWebViewResult: 'timeout',
      probeNativeFailure: 'deadline',
      probeWebViewFailure: 'deadline',
      probeNativeDurationMs: 5000,
      probeWebViewDurationMs: 5000
    });
    expect(native.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(browser.mock.calls[0][1]?.signal?.aborted).toBe(true);
    resolveNative(response());
    test.probe.receive({
      type: 'linuxdo-egress-probe',
      id: 7,
      documentKey: DOCUMENT_KEY,
      result: 'success',
      status: 200,
      ip: '203.0.113.42',
      protocol: 'http/2'
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(test.finishes()).toHaveLength(1);
    expect(test.finishes()[0]).not.toHaveProperty('isSameEgress');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a mounted probe without affecting already completed samples', async () => {
    const browser = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));
    const test = setup({ browser });
    await vi.advanceTimersByTimeAsync(0);
    test.probe.cancel('navigation');
    test.probe.cancel();
    expect(test.finishes()).toEqual([
      expect.objectContaining({
        outcome: 'canceled',
        probeNativeResult: 'success',
        probeWebViewResult: 'canceled',
        probeWebViewFailure: 'canceled',
        probeCancelReason: 'navigation'
      })
    ]);
    expect(browser.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels before dispatch without starting either fetch', async () => {
    const test = setup();
    test.probe.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(test.native).not.toHaveBeenCalled();
    expect(test.browser).not.toHaveBeenCalled();
    expect(test.finishes()).toEqual([
      expect.objectContaining({ probeNativeResult: 'canceled', probeWebViewResult: 'canceled' })
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains an unavailable WebView and a native failure without logging their raw errors', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const fetcher = vi.fn<Fetcher>(async () => {
      throw new Error('PRIVATE_NATIVE 198.51.100.1');
    });
    const probe = startCloudflareEgressProbe({
      fetcher,
      injectJavaScript: () => {
        throw new Error('PRIVATE_WEBVIEW');
      },
      parentTraceId: 'trace-101',
      probeId: 'trace-101-egress-1',
      documentKey: DOCUMENT_KEY,
      userAgent: 'PRIVATE_UA'
    });
    await vi.advanceTimersByTimeAsync(0);
    probe.cancel();
    expect(lines.map((line) => JSON.parse(line)).filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({
        probeNativeResult: 'network-error',
        probeWebViewResult: 'network-error',
        probeNativeFailure: 'transport',
        probeWebViewFailure: 'bridge-unavailable'
      })
    ]);
    expect(lines.join('')).not.toMatch(/PRIVATE|198\.51\.100/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('separates body-read failures from transport failures without exporting error details', async () => {
    const failBody = async () => {
      const result = response();
      result.text = vi.fn(async () => {
        throw new Error('PRIVATE_BODY_FAILURE 198.51.100.1');
      });
      return result;
    };
    const test = setup({ native: vi.fn(failBody), browser: vi.fn(failBody) });
    await vi.advanceTimersByTimeAsync(0);
    expect(test.finishes()[0]).toMatchObject({
      probeNativeResult: 'network-error',
      probeWebViewResult: 'network-error',
      probeNativeFailure: 'body-read',
      probeWebViewFailure: 'body-read',
      probeNativeStatus: 200,
      probeWebViewStatus: 200
    });
    expect(test.lines.join('')).not.toMatch(/PRIVATE|198\.51\.100/);
  });

  it('returns stable safe snapshots with each channel timing for later verification checks', async () => {
    const test = setup({
      native: vi.fn(() => new Promise<Response>((resolve) => setTimeout(() => resolve(response()), 120))),
      browser: vi.fn(() => new Promise<Response>((resolve) => setTimeout(() => resolve(response()), 360)))
    });
    const initial = test.probe.snapshot();
    expect(initial).not.toHaveProperty('completedAt');
    expect(initial.fields).toEqual({});
    await vi.advanceTimersByTimeAsync(120);
    const partial = test.probe.snapshot();
    expect(partial.fields).toMatchObject({ probeNativeResult: 'success', probeNativeDurationMs: 120 });
    expect(partial.fields).not.toHaveProperty('probeWebViewResult');
    expect(partial).not.toHaveProperty('completedAt');
    await vi.advanceTimersByTimeAsync(240);
    const completed = test.probe.snapshot();
    expect(completed.completedAt).toBe(initial.startedAt + 360);
    expect(completed.traceId).toBe(initial.traceId);
    expect(completed.fields).toMatchObject({
      probeNativeDurationMs: 120,
      probeWebViewDurationMs: 360,
      isSameEgress: true
    });
    expect(JSON.stringify(completed)).not.toMatch(/PRIVATE|203\.0\.113|ip=|documentKey/);
    (completed.fields as Record<string, unknown>).isSameEgress = false;
    test.probe.cancel('close');
    expect(test.probe.snapshot().fields.isSameEgress).toBe(true);
    expect(test.probe.snapshot().fields).not.toHaveProperty('probeCancelReason');
  });
});
