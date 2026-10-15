import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultAndroidWebViewUserAgent } from './androidWebViewUserAgent';
import { resolveWebViewUserAgent } from './resolveWebViewUserAgent';

vi.mock('./androidWebViewUserAgent', () => ({ getDefaultAndroidWebViewUserAgent: vi.fn() }));

beforeEach(() => {
  vi.mocked(getDefaultAndroidWebViewUserAgent).mockReset();
});

describe('request WebView identity preparation', () => {
  it('does not start provider initialization for an already canceled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(resolveWebViewUserAgent(undefined, controller.signal)).rejects.toThrow('请求已取消');
    expect(getDefaultAndroidWebViewUserAgent).not.toHaveBeenCalled();
  });

  it('keeps a saved identity without reading the provider', async () => {
    await expect(resolveWebViewUserAgent('saved-provider-identity')).resolves.toBe('saved-provider-identity');
    expect(getDefaultAndroidWebViewUserAgent).not.toHaveBeenCalled();
  });

  it('cancels one waiter without canceling another request for the same identity', async () => {
    let ready!: (value: string) => void;
    const provider = new Promise<string>((resolve) => {
      ready = resolve;
    });
    vi.mocked(getDefaultAndroidWebViewUserAgent).mockReturnValue(provider);
    const controller = new AbortController();
    const first = resolveWebViewUserAgent(undefined, controller.signal);
    const second = resolveWebViewUserAgent();
    const canceled = expect(first).rejects.toThrow('请求已取消');
    controller.abort();
    await canceled;
    ready('native-provider-identity');
    await expect(second).resolves.toBe('native-provider-identity');
  });

  it('propagates provider failure before a request can be sent', async () => {
    vi.mocked(getDefaultAndroidWebViewUserAgent).mockRejectedValue(new Error('provider unavailable'));
    await expect(resolveWebViewUserAgent()).rejects.toThrow('provider unavailable');
  });
});
