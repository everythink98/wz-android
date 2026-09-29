import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryObserver } from '@tanstack/react-query';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import { discourseReadingQueryKey } from '@/platform/query/discourseReadingRuntime';
import { accountSessionSnapshotFromEvent, createAccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { setLinuxDoCookieResponseBarrier } from '@/platform/network/managedCookies';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import type { Fetcher } from '@/platform/network/request';
import type { Source } from '@/domain/forum/models';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { fireEvent, render } from '../render';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef(function MockWebView(props: Record<string, unknown>, ref: unknown) {
      React.useImperativeHandle(
        ref,
        () => ({ stopLoading: jest.fn(), injectJavaScript: mockWebViewInjectJavaScript }),
        []
      );
      React.useEffect(() => {
        mockWebViewLoads.push((props.source as { uri?: string })?.uri || '');
      }, []);
      return React.createElement(View, { ...props, testID: 'login-webview' });
    })
  };
});
let mockWebViewLoads: string[] = [];
const mockWebViewInjectJavaScript = jest.fn<void, [string]>();
jest.mock('@/platform/network/managedCookies', () => ({
  ...jest.requireActual('@/platform/network/managedCookies'),
  setLinuxDoCookieResponseBarrier: jest.fn(async () => undefined),
  readManagedCookieHeader: jest.fn(async () => ({ status: 'ok', header: 'test-session=fixture' }))
}));

let events: DiagnosticEvent[] = [];
function seedAccount(username = 'alice') {
  appQueryClient.setQueryData(
    accountQueryKeys.snapshot('linuxdo'),
    accountSessionSnapshotFromEvent(createAccountSessionSnapshot('linuxdo'), {
      type: 'session-updated',
      loggedIn: true,
      currentUser: { source: 'linuxdo', id: username, username, url: `https://linux.do/u/${username}` }
    })
  );
}

async function renderRuntime(fetcher: Fetcher) {
  seedAccount();
  const notify = jest.fn();
  const openUser = async () => undefined;
  const loginNavigation = { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true };
  return renderHook(
    ({ enabledSources }: { enabledSources: readonly Source[] }) =>
      useAccountRuntime({
        appActive: true,
        enabledSources,
        fetcher,
        loginNavigation,
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser,
        ready: false,
        screen: 'search',
        webViewBlockMessage: ''
      }),
    { initialProps: { enabledSources: ['linuxdo'] }, wrapper: QueryTestWrapper }
  );
}

beforeEach(() => {
  mockWebViewLoads = [];
  mockWebViewInjectJavaScript.mockReset();
  events = [];
  setDiagnosticWriter((line) => {
    events.push(JSON.parse(line) as DiagnosticEvent);
  });
});
afterEach(() => setDiagnosticWriter(null));

async function renderManualLogin(fetcher: Fetcher) {
  let runtime!: ReturnType<typeof useAccountRuntime>;
  const notify = jest.fn();
  function Harness({ active = true, enabled = true }: { active?: boolean; enabled?: boolean }) {
    runtime = useAccountRuntime({
      appActive: active,
      enabledSources: enabled ? ['linuxdo'] : [],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'search',
      webViewBlockMessage: ''
    });
    return runtime.hosts.element;
  }
  seedAccount();
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  await act(async () => {
    await runtime.hosts.showLinuxDoVerification('登录');
  });
  await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
  return {
    view,
    runtime: () => runtime,
    change: (props: { active?: boolean; enabled?: boolean }) => view.rerender(<Harness {...props} />)
  };
}

function recordCookieBarriers() {
  const barrier = jest.mocked(setLinuxDoCookieResponseBarrier);
  const previous = barrier.getMockImplementation()!;
  const realBarrier = jest.requireActual<typeof import('@/platform/network/managedCookies')>(
    '@/platform/network/managedCookies'
  ).setLinuxDoCookieResponseBarrier;
  barrier.mockImplementation((blocked, reason, generation, _module, parentTraceId) =>
    realBarrier(blocked, reason, generation, { setLinuxDoCookieResponseBarrier: async () => undefined }, parentTraceId)
  );
  return () => barrier.mockImplementation(previous);
}

async function renderSiteRuntime(source: 'nodeseek' | 'yaohuo', fetcher: Fetcher) {
  let runtime!: ReturnType<typeof useAccountRuntime>;
  const notify = jest.fn();
  function Harness({ active = true }: { active?: boolean }) {
    runtime = useAccountRuntime({
      appActive: active,
      enabledSources: [source],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'topic',
      webViewBlockMessage: ''
    });
    return runtime.hosts.element;
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  return { view, runtime: () => runtime, active: (active: boolean) => view.rerender(<Harness active={active} />) };
}

function seedNodeSeekAccount() {
  appQueryClient.setQueryData(
    accountQueryKeys.snapshot('nodeseek'),
    accountSessionSnapshotFromEvent(createAccountSessionSnapshot('nodeseek'), {
      type: 'session-updated',
      loggedIn: true,
      currentUser: { source: 'nodeseek', id: '42', username: 'alice', url: 'https://www.nodeseek.com/space/42' }
    })
  );
}

it.each(['nodeseek', 'yaohuo'] as const)(
  'keeps ordinary %s browsing open after a logged-in page hint until the user checks',
  async (site) => {
    const fetcher = jest.fn(
      async () =>
        new Response(
          site === 'nodeseek'
            ? '<html><a class="Username" href="/space/42">alice</a></html>'
            : '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">火友</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
        )
    );
    const { view, runtime } = await renderSiteRuntime(site, fetcher);
    try {
      await act(async () => runtime().center.handleAccountCenterCommand({ type: 'open-login', site }));
      const webView = view.getByTestId('login-webview');
      const url = site === 'nodeseek' ? 'https://www.nodeseek.com/' : 'https://www.yaohuo.me/wapindex.aspx?sid=-2';
      await fireEvent(webView, 'loadStart', { nativeEvent: { url, loading: true } });
      await fireEvent(webView, 'loadEnd', { nativeEvent: { url } });
      await fireEvent(webView, 'message', {
        nativeEvent: {
          url: new URL(url).origin,
          data: JSON.stringify({
            type: `${site}-login`,
            documentKey: `${url}:1234`,
            status: 'logged-in',
            hasChallengeMarker: false,
            userAgent: 'WebView fixture agent'
          })
        }
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(runtime().hosts.surfaces[site]).toBe(true);
      expect(view.getByTestId('login-webview')).toBeTruthy();
      expect(mockWebViewLoads).toHaveLength(1);
      await fireEvent.press(view.getByText('检测登录'));
      await waitFor(() => expect(runtime().hosts.surfaces[site]).toBe(false));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(runtime().read.accountSessionViewModels[site].currentUser?.id).toBe(site === 'nodeseek' ? '42' : '7');
    } finally {
      await view.unmount();
    }
  }
);

it('keeps the same NodeSeek window through a rejected exact recovery and closes only after its explicit retry succeeds', async () => {
  seedNodeSeekAccount();
  const fetcher: Fetcher = async () => new Response('<html><a class="Username" href="/space/42">alice</a></html>');
  const { view, runtime } = await renderSiteRuntime('nodeseek', fetcher);
  const pending = Promise.withResolvers<'verification-required'>();
  const resume = jest
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue('completed');
  await act(async () =>
    runtime().hosts.requestNodeSeekVerification('需要验证', {
      queryKey: ['blocked-topic'],
      isCurrent: () => true,
      resume
    })
  );
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
  await fireEvent.press(view.getByText('检测并继续'));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(runtime().hosts.surfaces.nodeseek).toBe(true);
  expect(view.getByTestId('login-webview')).toBeTruthy();
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(true);
  expect(view.getByLabelText('正在检测…').props.accessibilityState.disabled).toBe(true);
  await act(async () => pending.resolve('verification-required'));
  expect(runtime().hosts.surfaces.nodeseek).toBe(true);
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
  expect(runtime().read.accountSessionViewModels.nodeseek.isLoggedIn).toBe(true);
  expect(mockWebViewLoads).toEqual(['https://www.nodeseek.com']);
  await fireEvent.press(view.getByText('检测并继续'));
  expect(resume).toHaveBeenCalledTimes(2);
  expect(runtime().hosts.surfaces.nodeseek).toBe(false);
  await view.unmount();
});

it.each(['reopened', 'background'] as const)('does not let a late NodeSeek recovery close a %s panel', async (exit) => {
  seedNodeSeekAccount();
  const { view, runtime, active } = await renderSiteRuntime(
    'nodeseek',
    async () => new Response('<html><a class="Username" href="/space/42">alice</a></html>')
  );
  const pending = Promise.withResolvers<'completed'>();
  const resume = jest.fn(() => pending.promise);
  await act(async () =>
    runtime().hosts.requestNodeSeekVerification('需要验证', { queryKey: ['old-topic'], isCurrent: () => true, resume })
  );
  await fireEvent.press(view.getByText('检测并继续'));
  expect(resume).toHaveBeenCalledTimes(1);
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(true);
  if (exit === 'reopened') {
    await fireEvent.press(view.getByLabelText('关闭'));
    await act(async () => runtime().hosts.requestNodeSeekVerification());
  } else {
    await active(false);
    expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
    await active(true);
  }
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
  await act(async () => pending.resolve('completed'));
  expect(runtime().hosts.surfaces.nodeseek).toBe(true);
  expect(view.getByTestId('login-webview')).toBeTruthy();
  expect(view.queryByLabelText('正在检测…')).toBeNull();
  expect(runtime().read.notificationPrivateAccessAllowed('nodeseek', 'nodeseek:42')).toBe(false);
  await view.unmount();
});

it.each(['complete', 'reopened', 'background'] as const)(
  'closes only the current Yaohuo panel after authoritative identity on %s',
  async (exit) => {
    const pending = Promise.withResolvers<void>();
    const next = Promise.withResolvers<void>();
    let requests = 0;
    const fetcher = jest.fn(async () => {
      await (++requests === 1 ? pending.promise : next.promise);
      return new Response(
        '<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=7">火友</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>'
      );
    });
    const { view, runtime, active } = await renderSiteRuntime('yaohuo', fetcher);
    await act(async () => runtime().hosts.showYaohuoLogin());
    const onCheck = runtime().hosts.element.props.view.checkYaohuoLoginAndClose;
    await act(async () => {
      onCheck();
      onCheck();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      events.filter((event) => event.source === 'yaohuo' && event.operation === 'check' && event.phase === 'intent')
    ).toHaveLength(1);
    if (exit === 'reopened') {
      await fireEvent.press(view.getByLabelText('关闭'));
      await act(async () => runtime().hosts.showYaohuoLogin());
      await fireEvent.press(view.getByText('检测登录'));
    }
    if (exit === 'background') {
      await active(false);
      await active(true);
    }
    await act(async () => pending.resolve());
    expect(runtime().hosts.surfaces.yaohuo).toBe(exit !== 'complete');
    if (exit === 'reopened') {
      expect(view.getByLabelText('正在检测…').props.accessibilityState.disabled).toBe(true);
      await act(async () => next.resolve());
      expect(runtime().hosts.surfaces.yaohuo).toBe(false);
    }
    if (exit === 'complete') {
      expect(runtime().read.accountSessionViewModels.yaohuo.currentUser?.id).toBe('7');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    await view.unmount();
  }
);

it.each([
  ['origin', 'complete'],
  ['origin', 'detect'],
  ['origin', 'close'],
  ['origin', 'navigate'],
  ['full-url', 'complete']
] as const)('records the visible verification egress through the %s bridge and permits %s', async (bridge, action) => {
  const traceUrl = 'https://linux.do/cdn-cgi/trace';
  const documentUrl = 'https://linux.do/latest';
  // Android WebMessageListener supplies sourceOrigin; the legacy bridge supplies the full document URL.
  const messageUrl = bridge === 'origin' ? 'https://linux.do' : documentUrl;
  const restoreBarrier = recordCookieBarriers();
  const now = jest.spyOn(Date, 'now');
  const pending = Promise.withResolvers<Response>();
  const traceResponse = () => {
    const response = new Response('ip=192.0.2.17\nhttp=h2\n', { headers: { 'content-type': 'text/plain' } });
    Object.defineProperty(response, 'url', { value: traceUrl });
    return response;
  };
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url, init) => {
    if (url === traceUrl) {
      init?.signal?.addEventListener('abort', () => pending.reject(new Error('aborted')), { once: true });
      return pending.promise;
    }
    if (url.endsWith('/session/current.json'))
      return new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }));
    throw new Error(`Unexpected test request: ${url}`);
  });
  let login: Awaited<ReturnType<typeof renderManualLogin>> | undefined;
  try {
    const { view, runtime } = (login = await renderManualLogin(fetcher));
    const webView = view.getByTestId('login-webview');
    await fireEvent(webView, 'message', {
      nativeEvent: {
        url: messageUrl,
        data: JSON.stringify({
          type: 'linuxdo-webview',
          userAgent: 'WebView fixture agent',
          documentKey: `${documentUrl}:1`,
          status: 'logged-in',
          hasChallengeMarker: false
        })
      }
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(fetcher).toHaveBeenCalledWith(traceUrl, expect.objectContaining({ method: 'GET', credentials: 'omit' }));
    expect(browserFetchIntentFromInit(fetcher.mock.calls[0][1])).toBeUndefined();
    const probe = events.find((event) => event.operation === 'egress-probe' && event.phase === 'intent');
    expect(probe).toMatchObject({ source: 'linuxdo', parentTraceId: expect.stringMatching(/^trace-/) });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ traceId: probe!.parentTraceId, area: 'credential', operation: 'check' })
      ])
    );
    if (action === 'complete') {
      await fireEvent(webView, 'loadStart', { nativeEvent: { url: documentUrl, loading: false } });
      await fireEvent(webView, 'loadStart', { nativeEvent: { url: documentUrl, loading: true } });
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
      expect(events.some((event) => event.traceId === probe!.traceId && event.phase === 'finish')).toBe(false);
      const browserFetch = jest.fn(async () => traceResponse());
      await act(async () => {
        new Function('window', 'location', 'performance', 'fetch', mockWebViewInjectJavaScript.mock.calls[0][0])(
          {
            get top(): unknown {
              return this;
            },
            ReactNativeWebView: {
              postMessage: (data: string) => webView.props.onMessage({ nativeEvent: { url: messageUrl, data } })
            }
          },
          { origin: 'https://linux.do', href: documentUrl },
          { timeOrigin: 1 },
          browserFetch
        );
        pending.resolve(traceResponse());
      });
      expect(browserFetch).toHaveBeenCalledWith(
        traceUrl,
        expect.objectContaining({ method: 'GET', credentials: 'omit' })
      );
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
      await waitFor(() =>
        expect(events.some((event) => event.traceId === probe!.traceId && event.phase === 'finish')).toBe(true)
      );
      expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/current.json'))).toHaveLength(0);
      expect(events.some((event) => event.verificationAction === 'auto-check')).toBe(false);
      now.mockReturnValue(Date.now() + 1500);
      await fireEvent.press(view.getByText('检测登录'));
      await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
    } else {
      if (action === 'navigate') {
        await act(async () => {
          expect(webView.props.onShouldStartLoadWithRequest({ url: 'https://linux.do/categories' })).toBe(true);
        });
        expect(runtime().hosts.linuxDoVerificationVisible).toBe(true);
        expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
      }
      await fireEvent.press(action === 'close' ? view.getByLabelText('关闭') : view.getByText('检测登录'));
      await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/current.json'))).toHaveLength(1);
    }
    await waitFor(() =>
      expect(events.filter((event) => event.operation === 'egress-probe' && event.phase === 'finish')).toEqual([
        expect.objectContaining({
          traceId: probe!.traceId,
          parentTraceId: probe!.parentTraceId,
          outcome: action === 'complete' ? 'success' : 'canceled',
          ...(action === 'complete'
            ? { isSameEgress: true, probeNativeProtocol: 'h2', probeWebViewProtocol: 'h2' }
            : { probeNativeResult: 'canceled', probeWebViewResult: 'canceled' }),
          ...(action === 'navigate' ? { probeCancelReason: 'navigation' } : {})
        })
      ])
    );
    const checkpoint = events.find(
      (event) =>
        event.traceId === probe!.parentTraceId &&
        event.egressCheckpoint === (action === 'close' ? 'close' : action === 'navigate' ? 'navigation' : 'check')
    );
    expect(checkpoint).toMatchObject({
      egressProbeTraceId: probe!.traceId,
      egressProbeState: action === 'complete' ? 'completed' : 'pending',
      ...(action === 'complete'
        ? { isSameEgress: true, probeNativeResult: 'success', probeWebViewResult: 'success' }
        : {})
    });
    expect(checkpoint!.egressProbeAgeMs).toEqual(expect.any(Number));
    if (action === 'complete') expect(checkpoint!.egressProbeAgeMs).toBeGreaterThanOrEqual(1500);
    const handoff = events.find(
      (event) =>
        event.operation === 'cookie-barrier' &&
        event.cookieBarrierReason === 'surface-close' &&
        event.phase === 'finish'
    );
    expect(handoff).toMatchObject({
      outcome: 'success',
      surfaceGeneration: expect.any(Number),
      ...(action === 'close' ? {} : { parentTraceId: probe!.parentTraceId })
    });
    expect(checkpoint!.surfaceGeneration).toBe(handoff!.surfaceGeneration);
    expect(JSON.stringify(events)).not.toContain('192.0.2.17');
  } finally {
    pending.resolve(traceResponse());
    await login?.view.unmount();
    restoreBarrier();
    now.mockRestore();
  }
});

it.each(['current', 'stale', 'identity-changed'] as const)(
  'settles %s NodeSeek verification without requiring public readers to log in',
  async (state) => {
    let runtime!: ReturnType<typeof useAccountRuntime>;
    const notify = jest.fn();
    const fetcher: Fetcher = async () =>
      new Response('<html><meta name="nodeseekAccountState" content="anonymous"></html>', {
        headers: { 'content-type': 'text/html' }
      });
    function Harness() {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: ['nodeseek'],
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: false,
        screen: 'topic',
        webViewBlockMessage: ''
      });
      return runtime.hosts.element;
    }
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    await act(async () => {
      if (state === 'identity-changed') {
        appQueryClient.setQueryData(
          accountQueryKeys.snapshot('nodeseek'),
          accountSessionSnapshotFromEvent(createAccountSessionSnapshot('nodeseek'), {
            type: 'session-updated',
            loggedIn: true,
            currentUser: { source: 'nodeseek', id: '42', username: 'alice', url: 'https://www.nodeseek.com/space/42' }
          })
        );
      }
    });
    const resume = jest.fn(async () => 'completed' as const);
    await act(async () =>
      runtime.hosts.requestNodeSeekVerification('需要验证', {
        queryKey: ['nodeseek-public-topic'],
        isCurrent: () => state !== 'stale',
        resume
      })
    );
    expect(runtime.read.accountSessionViewModels.nodeseek.isLoggedIn).toBe(state === 'identity-changed');
    await fireEvent.press(view.getByText('检测并继续'));
    await waitFor(() => expect(runtime.hosts.surfaces.nodeseek).toBe(false));
    expect(resume).toHaveBeenCalledTimes(state === 'current' ? 1 : 0);
    expect(runtime.read.accountSessionViewModels.nodeseek.isLoggedIn).toBe(false);
    expect(notify).not.toHaveBeenCalledWith('NodeSeek当前未登录。');
    await view.unmount();
  }
);

it.each(['automatic', 'manual'] as const)(
  'returns directly from CDK and retries the original reading body through %s detection and cookie handoff',
  async (detection) => {
    const restoreBarrier = recordCookieBarriers();
    jest.useFakeTimers({ doNotFake: ['performance'] });
    let clock = 0;
    const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
    const traceUrl = 'https://linux.do/cdn-cgi/trace';
    const nativeProbe = Promise.withResolvers<Response>();
    const traceResponse = () => {
      const response = new Response('ip=192.0.2.17\nhttp=h2\n', { headers: { 'content-type': 'text/plain' } });
      Object.defineProperty(response, 'url', { value: traceUrl });
      return response;
    };
    let challenged = true;
    const bodies: string[] = [];
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url, init) => {
      if (url === traceUrl) return nativeProbe.promise;
      if (url.endsWith('/session/csrf')) return new Response(JSON.stringify({ csrf: 'fixture' }));
      if (!url.endsWith('/topics/timings')) throw new Error('Unexpected test request');
      bodies.push(String(init?.body));
      return challenged
        ? new Response('<title>Just a moment...</title>', {
            status: 403,
            headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
          })
        : new Response('');
    });
    seedAccount();
    let runtime!: ReturnType<typeof useAccountRuntime>;
    const notify = jest.fn();
    function Harness() {
      runtime = useAccountRuntime({
        appActive: true,
        enabledSources: ['linuxdo'],
        fetcher,
        loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
        notify,
        nodeSeekRecoveryThreshold: 1,
        openUser: async () => undefined,
        ready: false,
        screen: 'search',
        webViewBlockMessage: ''
      });
      return runtime.hosts.element;
    }
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    const advance = async (milliseconds: number) =>
      act(async () => {
        for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
          clock += 1000;
          await jest.advanceTimersByTimeAsync(1000);
        }
      });
    const releaseHandoff = Promise.withResolvers<void>();
    try {
      const reading = runtime.read.readGateway.reading!;
      const scope = reading.scope();
      const session = reading.begin('12');
      session.visible([1]);
      session.active(true);
      await advance(1000);
      expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
      expect(reading.scope()).toBe(scope);
      session.visible([2]);
      await advance(10000);
      expect(mockWebViewLoads).toEqual(['https://cdk.linux.do/']);
      expect(bodies).toHaveLength(1);
      expect(reading.state()['12'].readPosts[2]).toBeUndefined();
      const original = events.find((event) => event.operation === 'reading-timings' && event.phase === 'intent')!;
      const accepted = events.find(
        (event) =>
          event.operation === 'check' && event.batchId === original.batchId && event.readingRecoveryState === 'paused'
      )!;
      expect(accepted).toMatchObject({ phase: 'apply', batchId: expect.any(Number) });
      const challenge = view.getByTestId('login-webview');
      await fireEvent(challenge, 'loadStart', {
        nativeEvent: { url: 'https://cdk.linux.do/login', loading: false }
      });
      for (let index = 0; index < 2; index++) {
        await fireEvent(challenge, 'message', {
          nativeEvent: { url: 'https://cdk.linux.do/login?token=secret-fixture', data: 'secret-fixture' }
        });
      }
      await fireEvent(challenge, 'loadEnd', { nativeEvent: { url: 'https://cdk.linux.do/login' } });
      expect(view.getByTestId('login-webview').props.source.uri).toBe('https://cdk.linux.do/');
      await fireEvent(challenge, 'message', {
        nativeEvent: {
          url: 'https://cdk.linux.do',
          data: JSON.stringify({
            type: 'linuxdo-webview',
            documentKey: 'https://cdk.linux.do/login:1',
            status: 'logged-out',
            hasChallengeMarker: false
          })
        }
      });
      const forum = view.getByTestId('login-webview');
      expect(forum.props.source.uri).toBe('https://linux.do/latest');
      expect(bodies).toHaveLength(1);
      expect(events.filter((event) => event.verificationAction === 'message-ignored')).toHaveLength(1);
      expect(events).toContainEqual(
        expect.objectContaining({
          traceId: accepted.traceId,
          verificationAction: 'return-to-forum',
          verificationPage: 'alternate-login'
        })
      );
      await fireEvent(forum, 'loadStart', { nativeEvent: { url: 'https://linux.do/latest', loading: true } });
      const pageMessage = (status: string) =>
        fireEvent(forum, 'message', {
          nativeEvent: {
            url: 'https://linux.do',
            data: JSON.stringify({
              type: 'linuxdo-webview',
              documentKey: 'https://linux.do/latest:1',
              userAgent: 'fixture-agent',
              status,
              hasChallengeMarker: false
            })
          }
        });
      await pageMessage('unknown');
      expect(bodies).toHaveLength(1);
      await fireEvent(forum, 'loadStart', { nativeEvent: { url: 'https://linux.do/latest', loading: true } });
      await fireEvent(forum, 'loadEnd', { nativeEvent: { url: 'https://linux.do/latest' } });
      await pageMessage('logged-in');
      await fireEvent(forum, 'loadStart', { nativeEvent: { url: 'https://linux.do/latest', loading: true } });
      await fireEvent(forum, 'loadEnd', { nativeEvent: { url: 'https://linux.do/latest' } });
      const script = mockWebViewInjectJavaScript.mock.calls.find(([value]) =>
        value.includes('__WZ_EGRESS_PROBE__')
      )![0];
      const browserFetch = jest.fn(async () => traceResponse());
      await act(async () => {
        new Function('window', 'location', 'performance', 'fetch', script)(
          {
            get top(): unknown {
              return this;
            },
            ReactNativeWebView: {
              postMessage: (data: string) => forum.props.onMessage({ nativeEvent: { url: 'https://linux.do', data } })
            }
          },
          { origin: 'https://linux.do', href: 'https://linux.do/latest' },
          { timeOrigin: 1 },
          browserFetch
        );
      });
      expect(browserFetch).toHaveBeenCalledWith(traceUrl, expect.objectContaining({ credentials: 'omit' }));
      expect(fetcher).toHaveBeenCalledWith(traceUrl, expect.objectContaining({ credentials: 'omit' }));
      expect(bodies).toHaveLength(1);
      const handoff = jest.mocked(setLinuxDoCookieResponseBarrier).getMockImplementation()!;
      jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(async (...args) => {
        expect(view.queryByTestId('login-webview')).toBeNull();
        await releaseHandoff.promise;
        await handoff(...args);
      });
      challenged = false;
      if (detection === 'manual') await fireEvent.press(view.getByText('检测并继续'));
      await act(async () => nativeProbe.resolve(traceResponse()));
      expect(view.queryByTestId('login-webview')).toBeNull();
      expect(bodies).toHaveLength(1);
      expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
      expect(events.filter((event) => event.verificationAction === 'auto-check')).toHaveLength(
        detection === 'automatic' ? 1 : 0
      );
      await act(async () => releaseHandoff.resolve());
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(reading.scope()).toBe(scope);
      expect(reading.state()['12'].server.lastReadPostNumber).toBe(1);
      expect(runtime.hosts.linuxDoVerificationVisible).toBe(false);
      expect(notify).toHaveBeenCalledWith('linux.do 阅读记录已同步。');
      expect(events.filter((event) => event.operation === 'reading-timings' && event.phase === 'intent')).toEqual([
        expect.objectContaining({ batchId: original.batchId, attempt: 1, isRecovery: false }),
        expect.objectContaining({ batchId: original.batchId, attempt: 2, isRecovery: true })
      ]);
      const completed = events.find(
        (event) =>
          event.operation === 'check' &&
          event.batchId === original.batchId &&
          event.readingRecoveryState === 'completed'
      )!;
      expect(completed).toMatchObject({ phase: 'apply', traceId: accepted.traceId });
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            traceId: completed.traceId,
            batchId: original.batchId,
            readingRecoveryState: 'resuming'
          }),
          expect.objectContaining({
            operation: 'cookie-barrier',
            phase: 'finish',
            parentTraceId: completed.traceId,
            outcome: 'success'
          }),
          expect.objectContaining({
            operation: 'egress-probe',
            phase: 'finish',
            parentTraceId: completed.traceId,
            outcome: detection === 'automatic' ? 'success' : 'canceled'
          })
        ])
      );
      expect(JSON.stringify(events)).not.toMatch(/secret-fixture|192\.0\.2\.17/);
    } finally {
      nativeProbe.resolve(traceResponse());
      releaseHandoff.resolve();
      await view.unmount();
      monotonic.mockRestore();
      jest.useRealTimers();
      restoreBarrier();
    }
  }
);

it.each([
  ['handoff', 'close'],
  ['csrf', 'back'],
  ['timings', 'background'],
  ['handoff', 'source'],
  ['handoff', 'identity']
] as const)('ends reading recovery during %s on %s without late sends or reopened panels', async (stage, exit) => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  let csrf = 0;
  const fetcher: Fetcher = async (url) => {
    if (url.endsWith('/session/csrf')) {
      if (++csrf === 2 && stage === 'csrf') await pending;
      return new Response(JSON.stringify({ csrf: 'fixture' }));
    }
    if (++posts === 1)
      return new Response('<title>Just a moment...</title>', {
        status: 403,
        headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
      });
    if (stage === 'timings') await pending;
    return new Response('');
  };
  seedAccount();
  const notify = jest.fn();
  let runtime!: ReturnType<typeof useAccountRuntime>;
  function Harness({ active = true, enabled = true }: { active?: boolean; enabled?: boolean }) {
    runtime = useAccountRuntime({
      appActive: active,
      enabledSources: enabled ? ['linuxdo'] : [],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'search',
      webViewBlockMessage: ''
    });
    return runtime.hosts.element;
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  try {
    const session = runtime.read.readGateway.reading!.begin('12');
    session.visible([1]);
    session.active(true);
    await act(async () => {
      clock += 1000;
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(posts).toBe(1);
    await act(async () => {
      clock += 10000;
      await jest.advanceTimersByTimeAsync(10000);
    });
    if (stage === 'handoff') jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => pending);
    await fireEvent.press(view.getByText('检测并继续'));
    expect(view.getByText('可以随时关闭并返回原页面。')).toBeTruthy();
    if (exit === 'close') await fireEvent.press(view.getByLabelText('关闭'));
    if (exit === 'back')
      await act(async () => {
        expect(runtime.hosts.closeTopmostSurface()).toBe('linuxdo-panel-closed');
      });
    if (exit === 'source') await view.rerender(<Harness enabled={false} />);
    if (exit === 'identity')
      await act(async () => {
        seedAccount('bob');
      });
    if (exit === 'background') await view.rerender(<Harness active={false} />);
    await act(async () => {
      release();
    });
    if (exit === 'background') {
      await view.rerender(<Harness />);
      expect(view.getByText(/检测因切到后台而中断/)).toBeTruthy();
      await fireEvent.press(view.getByText('返回原页面'));
    }
    await act(async () => {
      clock += 30000;
      await jest.advanceTimersByTimeAsync(30000);
    });
    expect(posts).toBe(stage === 'timings' ? 2 : 1);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(false);
    expect(mockWebViewLoads).toEqual(['https://cdk.linux.do/']);
  } finally {
    release();
    await view.unmount();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it('suppresses canceled query notifications until a new explicit request produces a new error', async () => {
  jest.useFakeTimers();
  const queryKey = ['cancel-recovery-query'];
  let attempts = 0;
  const observer = new QueryObserver(appQueryClient, {
    queryKey,
    retry: false,
    queryFn: async () => {
      ++attempts;
      throw new Error('blocked');
    }
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const hook = await renderRuntime(async () => new Response('{}'));
  const resume = jest.fn(async () => 'verification-required' as const);
  try {
    await act(async () => {
      await observer.refetch();
    });
    await act(async () => {
      expect(await hook.result.current.hosts.showLinuxDoVerification('page', { queryKey, resume })).toBe(true);
    });
    await act(async () => {
      hook.result.current.hosts.closeTopmostSurface();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    await act(async () => {
      expect(await hook.result.current.hosts.showLinuxDoVerification('duplicate', { queryKey, resume })).toBe(false);
    });
    const previousAttempts = attempts;
    await act(async () => {
      await observer.refetch();
    });
    expect(attempts).toBe(previousAttempts + 1);
    await act(async () => {
      expect(await hook.result.current.hosts.showLinuxDoVerification('new request', { queryKey, resume })).toBe(true);
    });
    expect(resume).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      hook.result.current.hosts.closePanels();
    });
    await hook.unmount();
    unsubscribe();
    observer.destroy();
    jest.useRealTimers();
  }
});

it('accepts an explicitly current read recovery without an active Query observer', async () => {
  const hook = await renderRuntime(async () => new Response('{}'));
  const resume = jest.fn(async () => 'completed' as const);
  await act(async () => {
    expect(
      await hook.result.current.hosts.showLinuxDoVerification('page', {
        queryKey: ['explicit-detail-refresh'],
        isCurrent: () => true,
        resume
      })
    ).toBe(true);
  });
  expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(true);
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  await hook.unmount();
});

it('accepts fresh server reading after changing the NodeSeek recovery setting', async () => {
  seedAccount();
  let lastRead = 20;
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(
    async () => new Response(JSON.stringify({ id: 12, last_read_post_number: lastRead, highest_post_number: 250 }))
  );
  const options = {
    appActive: true,
    enabledSources: ['linuxdo'] as Source[],
    fetcher,
    loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
    notify: jest.fn(),
    openUser: async () => undefined,
    ready: false,
    screen: 'search' as const,
    webViewBlockMessage: ''
  };
  const hook = await renderHook(
    ({ threshold }: { threshold: number }) => useAccountRuntime({ ...options, nodeSeekRecoveryThreshold: threshold }),
    { initialProps: { threshold: 1 }, wrapper: QueryTestWrapper }
  );
  try {
    const reading = hook.result.current.read.readGateway.reading!;
    await act(async () => {
      await hook.result.current.read.readGateway.getTopicReading('12', { trackVisit: true });
      await hook.result.current.read.readGateway.getTopicReading('12', { trackVisit: true });
    });
    expect(reading.state()['12'].server.lastReadPostNumber).toBe(20);
    await hook.rerender({ threshold: 2 });
    lastRead = 200;
    await act(async () => {
      await hook.result.current.read.readGateway.getTopicReading('12', { trackVisit: true });
    });
    expect(hook.result.current.read.readGateway.reading!.state()['12'].server.lastReadPostNumber).toBe(200);
    expect(hook.result.current.read.readGateway.reading).toBe(reading);
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {
    await hook.unmount();
  }
});

it.each(['csrf', 'timings'] as const)(
  'preserves in-flight %s and paused reading when its transport changes',
  async (stage) => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
    let clock = 0;
    const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const oldFetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) =>
      url.endsWith(stage === 'csrf' ? '/session/csrf' : '/topics/timings')
        ? pending
        : new Response(JSON.stringify({ csrf: 'same-transport-identity' }))
    );
    const nextFetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async () => new Response(''));
    const options = {
      enabledSources: ['linuxdo'] as Source[],
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify: jest.fn(),
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'search' as const,
      webViewBlockMessage: ''
    };
    seedAccount();
    const hook = await renderHook(
      (props: { fetcher: Fetcher; appActive: boolean }) => useAccountRuntime({ ...options, ...props }),
      { initialProps: { fetcher: oldFetcher, appActive: true }, wrapper: QueryTestWrapper }
    );
    const advance = async (milliseconds: number) => {
      await act(async () => {
        for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
          clock += 1000;
          await jest.advanceTimersByTimeAsync(1000);
        }
      });
    };
    const postBodies = () =>
      [...oldFetcher.mock.calls, ...nextFetcher.mock.calls]
        .filter(([url]) => url.endsWith('/topics/timings'))
        .map(([, init]) => Object.fromEntries(new URLSearchParams(init?.body as string)));
    try {
      const reading = hook.result.current.read.readGateway.reading!;
      const session = reading.begin('12');
      session.visible([1]);
      session.active(true);
      await advance(1000);
      const heldSignal = oldFetcher.mock.calls.at(-1)?.[1]?.signal;
      session.visible([2]);
      await advance(5000);
      await hook.rerender({ fetcher: nextFetcher, appActive: false });
      expect(heldSignal?.aborted).toBe(false);
      await act(async () => {
        complete(
          stage === 'csrf' ? new Response(JSON.stringify({ csrf: 'same-transport-identity' })) : new Response('')
        );
      });
      expect(postBodies()).toEqual([
        { topic_id: '12', topic_time: '1000', 'timings[1]': '1000' },
        { topic_id: '12', topic_time: '5000', 'timings[2]': '5000' }
      ]);
      await advance(10000);
      expect(postBodies()).toHaveLength(2);
      session.visible([3]);
      await hook.rerender({ fetcher: nextFetcher, appActive: true });
      await advance(1000);
      await act(async () => session.end());
      expect(postBodies()).toEqual([
        { topic_id: '12', topic_time: '1000', 'timings[1]': '1000' },
        { topic_id: '12', topic_time: '5000', 'timings[2]': '5000' },
        { topic_id: '12', topic_time: '1000', 'timings[3]': '1000' }
      ]);
      expect(nextFetcher.mock.calls.every(([url]) => url.endsWith('/topics/timings'))).toBe(true);
      expect(reading.state()['12'].anchor).toEqual({ floor: 3 });
    } finally {
      complete(new Response(''));
      await hook.unmount();
      monotonic.mockRestore();
      jest.useRealTimers();
    }
  }
);

it.each(
  (['csrf', 'timings'] as const).flatMap((stage) =>
    (['changed', 'anonymous', 'disabled'] as const).map((transition) => ({ stage, transition }))
  )
)('isolates pending reading at $stage when the account becomes $transition', async ({ stage, transition }) => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  let complete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  let held = false;
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) => {
    if (!held && url.endsWith(stage === 'csrf' ? '/session/csrf' : '/topics/timings')) {
      held = true;
      return pending;
    }
    return url.endsWith('/session/csrf') ? new Response(JSON.stringify({ csrf: 'current-token' })) : new Response('');
  });
  let hook: Awaited<ReturnType<typeof renderRuntime>> | undefined;
  const advance = async (milliseconds: number) => {
    await act(async () => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
        clock += 1000;
        await jest.advanceTimersByTimeAsync(1000);
      }
    });
  };
  const postBodies = () =>
    fetcher.mock.calls
      .filter(([url]) => url.endsWith('/topics/timings'))
      .map(([, init]) => Object.fromEntries(new URLSearchParams(init?.body as string)));
  try {
    hook = await renderRuntime(fetcher);
    const oldReading = hook.result.current.read.readGateway.reading!;
    const oldScope = oldReading.scope();
    const oldSession = oldReading.begin('12');
    oldSession.visible([1]);
    oldSession.active(true);
    await advance(1000);
    expect(held).toBe(true);
    oldSession.visible([2]);
    await advance(5000);
    const expectedOldPosts = stage === 'timings' ? 1 : 0;
    expect(postBodies()).toHaveLength(expectedOldPosts);
    const heldSignal = fetcher.mock.calls[stage === 'csrf' ? 0 : 1][1]?.signal;

    if (transition === 'disabled') await hook.rerender({ enabledSources: [] });
    else
      await act(async () => {
        if (transition === 'changed') seedAccount('bob');
        else appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), createAccountSessionSnapshot('linuxdo'));
      });
    await waitFor(() => expect(heldSignal?.aborted).toBe(true));
    expect(appQueryClient.getQueryData(discourseReadingQueryKey(oldScope))).toBeUndefined();
    const current = hook.result.current.read.readGateway.reading!;
    expect(current.state()).toEqual({});
    const newSession = current.begin('13');
    newSession.visible([1]);
    newSession.active(true);
    await advance(1000);
    await act(async () => newSession.end());
    expect(postBodies().map((body) => body.topic_id)).toEqual([
      ...(stage === 'timings' ? ['12'] : []),
      ...(transition === 'changed' ? ['13'] : [])
    ]);
    await act(async () => {
      complete(
        stage === 'csrf'
          ? new Response(JSON.stringify({ csrf: 'stale-token' }))
          : new Response(JSON.stringify({ errors: ['登录状态已失效'] }), { status: 401 })
      );
    });
    await advance(30000);
    expect(postBodies()).toHaveLength(expectedOldPosts + (transition === 'changed' ? 1 : 0));
    expect(current.state()['12']).toBeUndefined();
    if (transition === 'changed') {
      expect(hook.result.current.read.accountSessionViewModels.linuxdo.currentUser?.username).toBe('bob');
      expect(current.state()['13'].server.lastReadPostNumber).toBe(1);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/csrf'))).toHaveLength(2);
    } else {
      expect(current.scope()).toBeNull();
      expect(current.state()).toEqual({});
    }
    if (transition === 'disabled') {
      await hook.rerender({ enabledSources: ['linuxdo'] });
      oldSession.visible([3]);
      oldSession.active(true);
      await advance(1000);
      expect(postBodies()).toHaveLength(expectedOldPosts);
      expect(current.state()).toEqual({});
      const resumed = hook.result.current.read.readGateway.reading!.begin('13');
      resumed.visible([1]);
      resumed.active(true);
      await advance(1000);
      await act(async () => resumed.end());
      expect(postBodies().at(-1)?.topic_id).toBe('13');
    }
    await act(async () => oldSession.end());
    expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(false);
  } finally {
    complete(new Response(''));
    await hook?.unmount();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it('pauses reading behind read recovery and resumes without replacing account progress', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const monotonic = jest.spyOn(performance, 'now').mockImplementation(() => clock);
  const queryKey = ['reading-recovery-overlay'];
  const observer = new QueryObserver(appQueryClient, {
    queryKey,
    queryFn: async () => ({}),
    initialData: {},
    staleTime: Infinity
  });
  const unsubscribe = observer.subscribe(() => undefined);
  const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (url) =>
    url.endsWith('/session/csrf') ? new Response(JSON.stringify({ csrf: 'test' })) : new Response('')
  );
  let hook: Awaited<ReturnType<typeof renderRuntime>> | undefined;
  const advance = async (milliseconds: number) => {
    await act(async () => {
      for (let elapsed = 0; elapsed < milliseconds; elapsed += 1000) {
        clock += 1000;
        await jest.advanceTimersByTimeAsync(1000);
      }
    });
  };
  try {
    hook = await renderRuntime(fetcher);
    const reading = hook.result.current.read.readGateway.reading!;
    const scope = reading.scope();
    const plan = hook.result.current.read.readGateway.getReadPlan('linuxdo', 'topic');
    const session = reading.begin('12');
    session.visible([1], { floor: 1 });
    session.active(true);
    await advance(1000);
    expect(reading.state()['12'].readPosts[1]).toBe(true);
    await act(async () => {
      await hook!.result.current.hosts.showLinuxDoVerification('读取需要验证', {
        queryKey,
        resume: async () => 'completed'
      });
    });
    expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(true);
    expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'topic')).toEqual(plan);
    session.visible([2], { floor: 2 });
    await advance(10000);
    expect(reading.state()['12'].readPosts[2]).toBeUndefined();
    expect(reading.state()['12'].anchor).toEqual({ floor: 1 });
    expect(reading.scope()).toBe(scope);
    await act(async () => hook!.result.current.hosts.closePanels());
    expect(hook.result.current.hosts.linuxDoVerificationVisible).toBe(false);
    expect(hook.result.current.read.readGateway.reading).toBe(reading);
    await advance(1000);
    expect(reading.state()['12'].readPosts[2]).toBe(true);
    await act(async () => session.end());
    expect(
      fetcher.mock.calls
        .filter(([url]) => url.endsWith('/topics/timings'))
        .reduce((total, [, init]) => total + Number(new URLSearchParams(init?.body as string).get('topic_time')), 0)
    ).toBe(2000);
  } finally {
    await hook?.unmount();
    unsubscribe();
    monotonic.mockRestore();
    jest.useRealTimers();
  }
});

it.each(['loading', 'ready'] as const)(
  'preserves the same login page across background and foreground: %s',
  async (phase) => {
    seedAccount();
    const fetcher = jest.fn(async () => new Response('{}'));
    const options = {
      enabledSources: ['linuxdo'] as Source[],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify: jest.fn(),
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'search' as const,
      webViewBlockMessage: ''
    };
    let runtime!: ReturnType<typeof useAccountRuntime>;
    function Harness({ appActive }: { appActive: boolean }) {
      runtime = useAccountRuntime({ ...options, appActive });
      return runtime.hosts.element;
    }
    const view = await render(<Harness appActive />, { wrapper: QueryTestWrapper });
    await act(async () => runtime.center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' }));
    const webView = await view.findByTestId('login-webview');
    if (phase === 'ready') await fireEvent(webView, 'loadEnd', { nativeEvent: {} });
    const epoch = runtime.read.forumSessionEpochs.linuxdo;
    const handoffs = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;

    await view.rerender(<Harness appActive={false} />);
    expect(view.getByTestId('login-webview')).toBe(webView);
    await view.rerender(<Harness appActive />);
    expect(view.getByTestId('login-webview')).toBe(webView);
    expect(runtime.hosts.linuxDoVerificationVisible).toBe(true);
    expect(runtime.read.forumSessionEpochs.linuxdo).toBe(epoch);
    expect(setLinuxDoCookieResponseBarrier).toHaveBeenCalledTimes(handoffs);
    expect(fetcher).not.toHaveBeenCalled();
  }
);

it.each(['anonymous', 'same', 'changed', 'unknown'] as const)(
  'settles a category HTTP 400 through one concurrent account probe: %s',
  async (outcome) => {
    let complete!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      complete = resolve;
    });
    const fetcher = jest.fn<ReturnType<Fetcher>, Parameters<Fetcher>>(async (input, init) => {
      if (input.endsWith('/site.json'))
        return new Response(JSON.stringify({ errors: ['分类读取失败'] }), { status: 400 });
      if (input.endsWith('/session/current.json'))
        return browserFetchIntentFromInit(init)?.owner === 'account'
          ? pending
          : new Response(JSON.stringify({ current_user: { username: 'alice' } }));
      if (input.endsWith('/latest')) return new Response('<html></html>');
      throw new Error(`Unexpected test request: ${input}`);
    });
    const probes = () =>
      fetcher.mock.calls.filter(
        ([url, init]) => url.endsWith('/session/current.json') && browserFetchIntentFromInit(init)?.owner === 'account'
      );
    const hook = await renderRuntime(fetcher);
    const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
    try {
      await act(async () => {
        await expect(
          hook.result.current.read.readGateway.getLinuxDoTopicCreationContext({ source: 'linuxdo' })
        ).rejects.toMatchObject({ status: 400 });
      });
      await waitFor(() => expect(probes()).toHaveLength(1));
      await act(async () => {
        hook.result.current.write.requestAccountRecheck('linuxdo', epoch, 'trace-987');
      });
      expect(probes()).toHaveLength(1);
      await waitFor(() =>
        expect(hook.result.current.read.accountSessionViewModels.linuxdo).toMatchObject({
          isLoggedIn: true,
          isVerifying: true
        })
      );
      expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'topic-creation-context')).toMatchObject({
        lane: 'authenticated'
      });
      await act(async () => {
        complete(
          outcome === 'unknown'
            ? new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status: 403 })
            : new Response(
                JSON.stringify({
                  current_user: outcome === 'anonymous' ? null : { username: outcome === 'changed' ? 'bob' : 'alice' }
                })
              )
        );
      });
      await waitFor(() => expect(hook.result.current.read.accountSessionViewModels.linuxdo.isVerifying).toBe(false));
      expect(hook.result.current.read.accountSessionViewModels.linuxdo.isLoggedIn).toBe(outcome !== 'anonymous');
      expect(hook.result.current.read.forumSessionEpochs.linuxdo).toBe(
        epoch + (outcome === 'anonymous' || outcome === 'changed' ? 1 : 0)
      );
      expect(hook.result.current.read.readGateway.getReadPlan('linuxdo', 'topic-creation-context')).toMatchObject(
        outcome === 'anonymous' ? { state: 'blocked', reason: 'login-required' } : { lane: 'authenticated' }
      );
      expect(hook.result.current.read.accountSessionViewModels.linuxdo.currentUser?.username).toBe(
        outcome === 'anonymous' ? undefined : outcome === 'changed' ? 'bob' : 'alice'
      );
      if (outcome === 'unknown')
        expect(hook.result.current.read.accountSessionViewModels.linuxdo.lastError).toBeTruthy();
      expect(probes()).toHaveLength(1);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/site.json'))).toHaveLength(1);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/session/current.json'))).toHaveLength(2);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'account-reconcile',
            phase: 'intent',
            parentTraceId: expect.stringMatching(/^trace-/)
          }),
          expect.objectContaining({
            operation: 'account-reconcile',
            phase: 'guard',
            reason: 'duplicate',
            parentTraceId: 'trace-987'
          }),
          expect.objectContaining({ operation: 'account-reconcile', phase: 'finish' })
        ])
      );
    } finally {
      await act(async () => complete(new Response(JSON.stringify({ current_user: { username: 'alice' } }))));
    }
  }
);

it('ignores stale, disabled, anonymous and login-surface recheck requests', async () => {
  const fetcher = jest.fn(async () => new Response('{}'));
  const hook = await renderRuntime(fetcher);
  const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
  const request = hook.result.current.write.requestAccountRecheck;
  await act(async () => {
    request('linuxdo', epoch - 1);
  });
  await hook.rerender({ enabledSources: [] });
  await act(async () => {
    request('linuxdo', epoch);
  });
  await hook.rerender({ enabledSources: ['linuxdo'] });
  await act(async () => {
    appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), createAccountSessionSnapshot('linuxdo'));
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
    appQueryClient.setQueryData(accountQueryKeys.snapshot('linuxdo'), {
      ...createAccountSessionSnapshot('linuxdo'),
      identityTrust: 'none'
    });
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
    seedAccount();
    hook.result.current.hosts.showLinuxDoVerification('需要验证');
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
  });
  expect(fetcher).not.toHaveBeenCalled();
});

it('discards a recheck result when its source is disabled while the probe is in flight', async () => {
  let complete!: (response: Response) => void;
  const fetcher = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        complete = resolve;
      })
  );
  const hook = await renderRuntime(fetcher);
  const epoch = hook.result.current.read.forumSessionEpochs.linuxdo;
  await act(async () => {
    hook.result.current.write.requestAccountRecheck('linuxdo', epoch);
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await hook.rerender({ enabledSources: [] });
  expect(setLinuxDoCookieResponseBarrier).toHaveBeenLastCalledWith(true, 'source-change');
  await act(async () => {
    complete(new Response(JSON.stringify({ current_user: null })));
  });
  expect(appQueryClient.getQueryData(accountQueryKeys.snapshot('linuxdo'))).toMatchObject({
    status: 'logged-in',
    currentUser: { username: 'alice' }
  });
  expect(hook.result.current.read.forumSessionEpochs.linuxdo).toBe(epoch);
});

it('awaits the native cookie handoff before probing after login closes', async () => {
  const fetcher = jest.fn(
    async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
  );
  const hook = await renderRuntime(fetcher);
  await act(async () => {
    await hook.result.current.hosts.showLinuxDoVerification('登录');
  });
  let release!: () => void;
  jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.at(-1)?.slice(0, 3)).toEqual([
    false,
    'surface-close',
    expect.any(Number)
  ]);
  expect(fetcher).not.toHaveBeenCalled();
  const callsBeforeDuplicateClose = jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.length;
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls).toHaveLength(callsBeforeDuplicateClose);
  await act(async () => {
    release();
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
});

it('retries a failed close handoff before the account-center refresh and releases private access only afterward', async () => {
  const fetcher = jest.fn(
    async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
  );
  const hook = await renderRuntime(fetcher);
  await act(async () => {
    await hook.result.current.hosts.showLinuxDoVerification('登录');
  });
  jest.mocked(setLinuxDoCookieResponseBarrier).mockRejectedValueOnce(new Error('disk unavailable'));
  await act(async () => {
    hook.result.current.hosts.closePanels();
  });
  expect(fetcher).not.toHaveBeenCalled();
  await waitFor(() => expect(hook.result.current.read.statusBusy).toBe(false));
  expect(hook.result.current.read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(false);
  const gate = Promise.withResolvers<void>();
  jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => gate.promise);
  let refresh!: Promise<void>;
  await act(async () => {
    refresh = hook.result.current.center.handleAccountCenterCommand({ type: 'refresh' });
  });
  expect(fetcher).not.toHaveBeenCalled();
  await act(async () => {
    gate.resolve();
    await refresh;
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(hook.result.current.read.notificationPrivateAccessAllowed('linuxdo', 'linuxdo:alice')).toBe(true);
});

it.each(['alice', 'bob'])(
  'hands off cookies before manual verification of %s and keeps native renewal enabled',
  async (username) => {
    jest.useFakeTimers();
    let release!: () => void;
    const identityHandoff = Promise.withResolvers<void>();
    let blocked = true;
    let cookie = 'A';
    const fetcher = jest.fn(async () => {
      // The native receiver owns response cookies; an open WebView barrier rejects renewal.
      if (!blocked) cookie = 'B';
      return new Response(JSON.stringify({ current_user: { id: username, username } }));
    });
    const { view, runtime } = await renderManualLogin(fetcher);
    try {
      jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(async () => {
        expect(view.queryByTestId('login-webview')).toBeNull();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        blocked = false;
      });
      if (username === 'bob') {
        // Native barrier calls share one worker; the final handoff joins identity-change.
        jest
          .mocked(setLinuxDoCookieResponseBarrier)
          .mockImplementationOnce(() => identityHandoff.promise)
          .mockImplementationOnce(() => identityHandoff.promise);
      }
      await fireEvent.press(view.getByText('检测登录'));
      await waitFor(() => expect(view.queryByTestId('login-webview')).toBeNull());
      expect(view.getByText('正在检测…')).toBeTruthy();
      expect(view.getByLabelText('刷新页面').props.accessibilityState.disabled).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();
      await act(async () => {
        release();
      });
      if (username === 'bob') {
        expect(view.getByText('正在检测…')).toBeTruthy();
        await act(async () => {
          identityHandoff.resolve();
        });
      }
      await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cookie).toBe('B');
      expect(jest.mocked(setLinuxDoCookieResponseBarrier).mock.calls.at(-1)?.[0]).toBe(false);
    } finally {
      release?.();
      identityHandoff.resolve();
      await view.unmount();
      jest.useRealTimers();
    }
  }
);

it.each(['background', 'disabled', 'close', 'failure'] as const)(
  'settles a pending manual cookie handoff on %s without an obsolete identity request',
  async (exit) => {
    jest.useFakeTimers();
    const fetcher = jest.fn(
      async () => new Response(JSON.stringify({ current_user: { id: 'alice', username: 'alice' } }))
    );
    const { view, runtime, change } = await renderManualLogin(fetcher);
    const gate = Promise.withResolvers<void>();
    jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(async () => {
      await gate.promise;
      if (exit === 'failure') throw new Error('disk unavailable');
    });
    try {
      await fireEvent.press(view.getByText('检测登录'));
      await fireEvent.press(view.getByText('正在检测…'));
      expect(fetcher).not.toHaveBeenCalled();
      if (exit === 'background') await change({ active: false });
      if (exit === 'disabled') await change({ enabled: false });
      if (exit === 'close') await fireEvent.press(view.getByLabelText('关闭'));
      await act(async () => {
        gate.resolve();
      });
      expect(fetcher).toHaveBeenCalledTimes(exit === 'close' ? 1 : 0);
      if (exit === 'background' || exit === 'failure') {
        if (exit === 'background') await change({ active: true });
        if (exit === 'failure') {
          expect(view.getByText(/disk unavailable/)).toBeTruthy();
          await fireEvent.press(view.getByText('重新打开登录页'));
          await waitFor(() => expect(view.getByTestId('login-webview')).toBeTruthy());
        }
        await fireEvent.press(view.getByText('检测登录'));
        await waitFor(() => expect(runtime().hosts.linuxDoVerificationVisible).toBe(false));
        expect(fetcher).toHaveBeenCalledTimes(1);
      } else expect(runtime().hosts.linuxDoVerificationVisible).toBe(false);
    } finally {
      gate.resolve();
      await view.unmount();
      jest.useRealTimers();
    }
  }
);
