import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { initialForumSessionEpochs } from '../../src/app/serverState';
import { useSessionController } from '../../src/app/useSessionController';

jest.mock('expo-secure-store', () => ({
  deleteItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined)
}));

jest.mock('../../src/legacyCookieSnapshotMigration', () => ({
  LEGACY_COOKIE_SNAPSHOT_KEYS: [],
  migrateLegacyCookieSnapshots: jest.fn(async () => ({
    linuxdo: 'retained',
    nodeseek: 'retained',
    yaohuo: 'retained'
  }))
}));

function renderSessionController(defaultFetcher: typeof fetch) {
  return renderHook(() =>
    useSessionController({
      defaultFetcher,
      forumSessionEpochsRef: { current: initialForumSessionEpochs },
      linuxDoBrowserWebViewRef: { current: null },
      linuxDoWebViewUserAgentRef: { current: '' },
      nodeSeekBrowserWebViewRef: { current: null },
      nodeSeekWebViewUserAgentRef: { current: '' },
      notify: jest.fn(),
      setLinuxDoWebViewUserAgent: jest.fn(),
      setNodeSeekWebViewUserAgent: jest.fn(),
      setWebLoginUserId: jest.fn(),
      webLoginDetectedRef: { current: false }
    })
  );
}

describe('session controller hidden Google flow', () => {
  it('[REG-SEARCH-014] routes a scoped NodeSeek Google search through HiddenBrowserHost', async () => {
    const defaultFetcher = jest.fn<typeof fetch>(async () => new Response('unexpected direct fetch'));
    const searchUrl = 'https://www.google.com/search?q=site%3Anodeseek.com+codex';
    const hook = await renderSessionController(defaultFetcher);
    let responsePromise!: Promise<Response>;

    await act(async () => {
      responsePromise = hook.result.current.forumFetchWithWebViewFallback(searchUrl);
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.url).toBe(searchUrl));
    expect(defaultFetcher).not.toHaveBeenCalled();

    const requestId = hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.id;
    await act(async () => {
      await hook.result.current.completeNodeSeekBrowserFetch({
        id: requestId,
        url: searchUrl,
        html: '<html><title>Google Search</title></html>'
      });
    });
    await expect(responsePromise).resolves.toBeInstanceOf(Response);
  });

  it('[REG-SEARCH-014] rejects a forum page as the result of a Google search task', async () => {
    const defaultFetcher = jest.fn<typeof fetch>(async () => new Response('unexpected direct fetch'));
    const searchUrl = 'https://www.google.com/search?q=site%3Anodeseek.com+codex';
    const hook = await renderSessionController(defaultFetcher);
    let responsePromise!: Promise<Response>;

    await act(async () => {
      responsePromise = hook.result.current.forumFetchWithWebViewFallback(searchUrl);
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.url).toBe(searchUrl));
    const outcome = responsePromise.then(
      () => 'resolved',
      (error: Error) => error.message
    );

    await act(async () => {
      await hook.result.current.completeNodeSeekBrowserFetch({
        id: hook.result.current.hiddenBrowserFetchRequests.nodeSeek?.id,
        url: 'https://www.nodeseek.com/search?q=codex',
        html: '<html>wrong flow</html>'
      });
    });
    await expect(outcome).resolves.toContain('外部地址');
    expect(defaultFetcher).not.toHaveBeenCalled();
  });
});
