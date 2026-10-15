import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import { createDefaultWebViewUserAgentReader } from './androidWebViewUserAgentValue';

afterEach(() => setDiagnosticWriter(null));

describe('Android WebView user agent', () => {
  it('reads the exact native WebView provider identity on demand', async () => {
    const userAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel; wv) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36';

    const read = createDefaultWebViewUserAgentReader(async () => `  ${userAgent}  `);
    await expect(read()).resolves.toBe(userAgent);
  });

  it('rejects unavailable identities without inventing or caching one', async () => {
    const read = createDefaultWebViewUserAgentReader(async () => '   ');
    await expect(read()).rejects.toThrow('默认浏览器身份读取失败');
  });

  it('records one provider attempt for concurrent callers and keeps cached reads quiet', async () => {
    const events: DiagnosticEvent[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const provider = Promise.withResolvers<string>();
    const nativeRead = vi.fn(() => provider.promise);
    const read = createDefaultWebViewUserAgentReader(nativeRead);
    const first = read();
    const second = read();
    provider.resolve('PRIVATE_DEVICE_USER_AGENT');
    await expect(Promise.all([first, second])).resolves.toEqual([
      'PRIVATE_DEVICE_USER_AGENT',
      'PRIVATE_DEVICE_USER_AGENT'
    ]);
    await read();
    expect(nativeRead).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({ area: 'webview', operation: 'read-user-agent', phase: 'intent', state: 'start' }),
      expect.objectContaining({
        operation: 'read-user-agent',
        phase: 'finish',
        outcome: 'success',
        state: 'ready',
        userAgentHash: expect.stringMatching(/^[0-9a-f]{8}$/)
      })
    ]);
    expect(events[1].traceId).toBe(events[0].traceId);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_DEVICE');
  });

  it('closes a failed provider attempt and records a fresh retry without the native error text', async () => {
    const events: DiagnosticEvent[] = [];
    setDiagnosticWriter((line) => {
      events.push(JSON.parse(line));
    });
    const nativeRead = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('PRIVATE_DEVICE_PROVIDER_ERROR'))
      .mockResolvedValueOnce('PRIVATE_DEVICE_USER_AGENT');
    const read = createDefaultWebViewUserAgentReader(nativeRead);
    await expect(read()).rejects.toThrow('PRIVATE_DEVICE_PROVIDER_ERROR');
    await expect(read()).resolves.toBe('PRIVATE_DEVICE_USER_AGENT');
    const finishes = events.filter((event) => event.phase === 'finish');
    expect(finishes).toEqual([
      expect.objectContaining({ outcome: 'failure', reason: 'identity_unavailable' }),
      expect.objectContaining({ outcome: 'success' })
    ]);
    expect(finishes[0].traceId).not.toBe(finishes[1].traceId);
    expect(JSON.stringify(events)).not.toContain('PRIVATE_DEVICE');
  });
});
