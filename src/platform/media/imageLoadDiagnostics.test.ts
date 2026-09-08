import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { normalizeNativeReadNetworkDiagnosticEvents } from '@/platform/diagnostics/nativeReadNetworkDiagnostics';
import { compatibleImageRequestIdentity } from './compatibleImageSources';
import { imageFailureKind, imageLoadDiagnosticAttempt } from './imageLoadDiagnostics';

vi.mock('react-native', () => ({ NativeModules: {} }));

afterEach(() => setDiagnosticWriter(null));

describe('image request diagnostic correlation', () => {
  it('connects a failed display, successful probe and retry without changing cache identity or exposing secrets', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const source = {
      uri: 'https://private.example/image?token=SECRET',
      cacheKey: 'original-key',
      headers: { Cookie: 'SECRET' }
    };
    const first = imageLoadDiagnosticAttempt(source, 'fresco');
    first.start();
    first.failed({ nativeEvent: { error: 'java.io.InterruptedIOException: executor rejected SECRET' } });
    first.canceled();
    const retry = imageLoadDiagnosticAttempt(source, 'fresco');
    retry.start();
    retry.loaded('disk');
    retry.displayed();
    retry.canceled();
    expect(first.source.uri).toBe(source.uri);
    expect(first.source).toMatchObject({ cacheKey: source.cacheKey });
    expect(compatibleImageRequestIdentity(first.source)).toBe(compatibleImageRequestIdentity(source));
    expect(compatibleImageRequestIdentity(retry.source)).toBe(compatibleImageRequestIdentity(source));
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const failures = events.filter((event) => event.phase === 'finish' && event.outcome === 'failure');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      operation: 'image-load',
      imageConsumer: 'fresco',
      imageFailure: 'executor_rejected'
    });
    const success = events.find((event) => event.phase === 'finish' && event.outcome === 'success')!;
    expect(success.mediaRef).toBe(failures[0].mediaRef);
    expect(success.traceId).not.toBe(failures[0].traceId);
    const poster = imageLoadDiagnosticAttempt({ uri: 'file:///cache/private-poster.png' }, 'glide', source.uri);
    poster.start();
    poster.displayed();
    expect(JSON.parse(lines.at(-1)!).mediaRef).toBe(failures[0].mediaRef);
    expect(lines.join('')).not.toContain('private-poster');
    const probe = normalizeNativeReadNetworkDiagnosticEvents([
      {
        timeMs: Date.now(),
        operation: 'request',
        phase: 'response-headers',
        imageTraceId: first.source.headers!['X-WZ-Image-Trace'],
        imageSessionId: first.source.headers!['X-WZ-Image-Session'],
        mediaRef: first.source.headers!['X-WZ-Image-Ref'],
        imageConsumer: 'svg-probe',
        generation: 4,
        callId: 'abc123',
        status: 200,
        imageContentType: 'image',
        url: source.uri,
        cookie: 'SECRET',
        message: 'SECRET'
      }
    ]);
    expect(probe[0]).toMatchObject({
      traceId: failures[0].traceId,
      appSessionId: failures[0].appSessionId,
      mediaRef: failures[0].mediaRef,
      imageConsumer: 'svg-probe',
      generation: 4,
      status: 200
    });
    expect(JSON.stringify([...events, ...probe])).not.toMatch(/SECRET|private\.example|original-key/);
  });

  it.each([
    ['SocketTimeoutException: timeout', 'timeout'],
    ['Canceled', 'canceled'],
    ['HTTP status code 403', 'http_error'],
    ['Failed to decode image', 'decode_error'],
    ['SSLHandshakeException', 'tls_error'],
    ['UnknownHostException', 'dns_error'],
    ['IOException: broken pipe', 'network_error'],
    ['arbitrary private error', 'unknown']
  ])('classifies %s without recording its message', (message, expected) => {
    expect(imageFailureKind({ error: message })).toBe(expected);
  });
});
